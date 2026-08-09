"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  uploadProductImage,
  setPrimaryImage,
  deleteProductImage,
  type ProductImage,
} from "@/lib/actions/product-image";
import { prepareImage, formatBytes, ImagePrepareError, MAX_DIM } from "@/lib/image-prepare";
import { shopifyCdnResize } from "@/lib/shopify/image";
import { pushProductImagesAction } from "@/lib/actions/shopify";
import { Button } from "@/components/ui/button";
import { Label, Input } from "@/components/ui/input";

type QueueItem = {
  id: string;
  file: File;
  status: "waiting" | "working" | "done" | "error";
  note?: string;
};

// Shopify keeps our filename when it re-hosts an image, so after a sync the
// product's main picture is the same file as a gallery tile — just served from
// their CDN under a different URL. Comparing filenames is what makes the two
// recognisable as one image.
function fileNameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || null;
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function ImageUploader({
  productId,
  productName,
  currentUrl,
  images,
  shopifyLinked,
}: {
  productId: string;
  productName: string;
  currentUrl: string | null;
  images: ProductImage[];
  shopifyLinked: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [gallery, setGallery] = useState<ProductImage[]>(images);
  const [primary, setPrimary] = useState<string | null>(currentUrl);
  const [base, setBase] = useState(slugify(productName) || "product");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [shopifyNote, setShopifyNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function onPick(files: FileList | null) {
    if (!files?.length) return;
    setQueue(
      Array.from(files).map((file, i) => ({
        id: `${file.name}-${file.lastModified}-${i}`,
        file,
        status: "waiting" as const,
      })),
    );
  }

  function patch(id: string, changes: Partial<QueueItem>) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  // One request per picture, in order. Sending the whole selection in a single
  // request would blow the body limit again and would lose per-file progress.
  async function upload() {
    setBusy(true);
    let seq = gallery.length;
    let uploadedAny = false;

    for (const item of queue) {
      if (item.status === "done") continue;
      patch(item.id, { status: "working", note: "Optimizing…" });

      try {
        const prepared = await prepareImage(item.file);
        seq += 1;

        const body = new FormData();
        body.append("image", prepared.blob, item.file.name);
        body.append("base", base);
        body.append("seq", String(seq));

        patch(item.id, { note: "Uploading…" });
        const result = await uploadProductImage(productId, null, body);

        if (!result.ok) {
          seq -= 1;
          patch(item.id, { status: "error", note: result.error });
          continue;
        }

        uploadedAny = true;
        setGallery((g) => [...g, result.image]);
        setPrimary((p) => p ?? result.image.url);
        patch(item.id, {
          status: "done",
          note: `${result.image.name} · ${formatBytes(result.image.bytes)}`,
        });
      } catch (err) {
        patch(item.id, {
          status: "error",
          note: err instanceof ImagePrepareError ? err.message : "Could not read that file",
        });
      }
    }

    // Storing the picture is only half the job — it has to reach the store, or
    // the product page customers see is unchanged.
    if (uploadedAny && shopifyLinked) {
      await sendToShopify();
    }

    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (uploadedAny) router.refresh();
  }

  async function sendToShopify() {
    setShopifyNote({ text: "Sending to Shopify…", bad: false });
    const res = await pushProductImagesAction(productId);
    if (res.error) {
      setShopifyNote({ text: `Shopify: ${res.error}`, bad: true });
      return;
    }
    const r = res.result;
    const bits = [`${r?.created ?? 0} sent to Shopify`];
    if (r?.alreadyThere) bits.push(`${r.alreadyThere} already there`);
    if (r?.featuredSet) bits.push("main image featured");
    if (r?.variantsWithImage) bits.push(`${r.variantsWithImage} variants linked`);
    setShopifyNote({ text: bits.join(" · ") + " ✓", bad: false });
  }

  function makePrimary(url: string) {
    setPrimary(url);
    startTransition(async () => {
      await setPrimaryImage(productId, url);
      // Shopify features whichever media sits first, so the choice only counts
      // once it's been reordered over there too.
      if (shopifyLinked) await sendToShopify();
      router.refresh();
    });
  }

  function remove(image: ProductImage) {
    setGallery((g) => g.filter((i) => i.path !== image.path));
    if (primary === image.url) {
      setPrimary(gallery.find((i) => i.path !== image.path)?.url ?? null);
    }
    startTransition(async () => {
      await deleteProductImage(productId, image.path);
      router.refresh();
    });
  }

  const waiting = queue.filter((i) => i.status !== "done").length;

  // A Shopify-synced product's picture lives on their CDN, not in our bucket,
  // so it won't come back from the listing. Show it alongside ours (it isn't
  // ours to delete) rather than leaving the grid with no main image — unless
  // it's just their copy of a picture already in the gallery, which would
  // otherwise appear twice.
  const primaryName = fileNameOf(primary);
  const isMain = (image: ProductImage) =>
    image.url === primary || (primaryName !== null && image.name === primaryName);
  const external = primary && !gallery.some(isMain) ? primary : null;

  return (
    <div className="space-y-5">
      {/* Gallery */}
      {gallery.length > 0 || external ? (
        <div className="grid grid-cols-3 gap-2">
          {external && (
            <div className="space-y-1">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-pink bg-ink/5">
                <Image
                  // Shopify originals run to ~6 MB and blow the optimizer's
                  // timeout — ask their CDN for a capped copy, as everywhere else.
                  src={shopifyCdnResize(external, 400) ?? external}
                  alt={productName}
                  fill
                  sizes="140px"
                  className="object-cover"
                />
                <span className="label-caps absolute left-1 top-1 rounded bg-pink px-1.5 py-0.5 text-[10px] text-black">
                  Main
                </span>
              </div>
              <p className="text-[11px] text-ink/40">From Shopify</p>
            </div>
          )}
          {gallery.map((image) => {
            const isPrimary = isMain(image);
            return (
              <div key={image.path} className="space-y-1">
                <div
                  className={`relative aspect-square overflow-hidden rounded-lg border bg-ink/5 ${
                    isPrimary ? "border-pink" : "border-line"
                  }`}
                >
                  <Image
                    src={image.url}
                    alt={productName}
                    fill
                    sizes="140px"
                    className="object-cover"
                  />
                  {isPrimary && (
                    <span className="label-caps absolute left-1 top-1 rounded bg-pink px-1.5 py-0.5 text-[10px] text-black">
                      Main
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-ink/50">
                  {isPrimary ? (
                    <span>&nbsp;</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => makePrimary(image.url)}
                      disabled={pending}
                      className="hover:text-ink"
                    >
                      Set main
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(image)}
                    disabled={pending}
                    className="hover:text-status-cancelled"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex aspect-square w-40 items-center justify-center rounded-lg border border-line bg-ink/5 text-ink/30">
          <span className="label-caps">No image</span>
        </div>
      )}

      {/* Picker */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="seo-base">SEO filename</Label>
          <Input
            id="seo-base"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="product-name-keywords"
          />
          <p className="text-xs text-ink/40">
            Saved as <span className="text-ink/60">{slugify(base) || "product"}-1-xxxxx.webp</span>
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          name="images"
          accept="image/*"
          multiple
          onChange={(e) => onPick(e.target.files)}
          className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-ink hover:file:border-ink"
        />

        {queue.length > 0 && (
          <ul className="space-y-1 text-xs">
            {queue.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-ink/70">{item.file.name}</span>
                <span
                  className={
                    item.status === "error"
                      ? "shrink-0 text-status-cancelled"
                      : "shrink-0 text-ink/40"
                  }
                >
                  {item.note ?? formatBytes(item.file.size)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={upload} disabled={busy || waiting === 0}>
            {busy ? "Working…" : `Upload ${waiting || ""} ${waiting === 1 ? "image" : "images"}`}
          </Button>
          {shopifyLinked && gallery.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || pending}
              onClick={() => startTransition(sendToShopify)}
            >
              Push images to Shopify
            </Button>
          )}
        </div>

        {shopifyNote && (
          <p className={`text-xs ${shopifyNote.bad ? "text-status-cancelled" : "text-ink/60"}`}>
            {shopifyNote.text}
          </p>
        )}
        {!shopifyLinked && (
          <p className="text-xs text-ink/40">
            This product isn&apos;t linked to Shopify yet — push the product first and its pictures
            go with it.
          </p>
        )}

        <p className="text-xs text-ink/40">
          Each picture is resized to max {MAX_DIM}px, converted to WebP and renamed. The first one
          becomes the main image if the product doesn&apos;t have one yet.
        </p>
      </div>
    </div>
  );
}
