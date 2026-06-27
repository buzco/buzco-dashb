"use client";

import { useActionState } from "react";
import Image from "next/image";
import { uploadProductImage, type UploadImageState } from "@/lib/actions/product-image";
import { Button } from "@/components/ui/button";

export function ImageUploader({
  productId,
  currentUrl,
}: {
  productId: string;
  currentUrl: string | null;
}) {
  const action = uploadProductImage.bind(null, productId, null);
  const [state, formAction, isPending] = useActionState<UploadImageState | undefined, FormData>(
    action,
    undefined,
  );

  const shownUrl = state?.url ?? currentUrl;

  return (
    <form action={formAction} className="space-y-3">
      <div className="relative aspect-square w-40 overflow-hidden rounded-lg border border-line bg-ink/5">
        {shownUrl ? (
          <Image src={shownUrl} alt="Product" fill sizes="160px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-ink/30">
            <span className="label-caps">No image</span>
          </div>
        )}
      </div>

      <input
        type="file"
        name="image"
        accept="image/*"
        required
        className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-ink hover:file:border-ink"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Optimizing…" : "Upload image"}
        </Button>
        {state?.error && <span className="text-sm text-status-cancelled">{state.error}</span>}
        {state?.ok && <span className="text-sm text-ink/60">Saved (WebP) ✓</span>}
      </div>
      <p className="text-xs text-ink/40">
        Converted to WebP, resized to max 1600px, stored with an SEO filename.
      </p>
    </form>
  );
}
