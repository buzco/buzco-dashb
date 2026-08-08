// Browser-side image downscaling, run before anything is sent to a Server
// Action.
//
// Why this exists: a Server Action request body is capped at 1 MB by default,
// and the platform we deploy to (Vercel) refuses request bodies over ~4.5 MB
// no matter what next.config says. A phone photo is 3-8 MB, so uploading the
// original was never going to work. Shrinking to the long-edge cap in the
// browser first gets each file down to a few hundred KB, which comfortably
// fits — and it makes selecting a dozen pictures at once practical.
//
// This is transport prep only. The server still re-encodes with sharp, which
// owns the final quality/format decision (see lib/actions/product-image.ts).

export const MAX_DIM = 1600; // px on the long edge — matches the server cap

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  /** false when we had to fall back to shipping the untouched original */
  downscaled: boolean;
};

export class ImagePrepareError extends Error {}

// Encoded at near-lossless quality: this is a transport format, not the
// final artefact, so the only lossy step that should matter is sharp's.
const TRANSPORT_QUALITY = 0.95;

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, TRANSPORT_QUALITY));
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    // from-image applies the EXIF orientation while decoding, so a portrait
    // phone photo doesn't arrive on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Formats the browser can't decode — HEIC from an iPhone is the common
    // one. Small files can still go to the server untouched and let sharp
    // have a go; anything bigger would just bounce off the body limit.
    if (file.size <= 3.5 * 1024 * 1024) {
      return { blob: file, width: 0, height: 0, downscaled: false };
    }
    throw new ImagePrepareError(
      "Browser can't read this format (HEIC?) — export it as JPEG or PNG first",
    );
  }

  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImagePrepareError("Canvas unavailable in this browser");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // toBlob silently falls back to PNG when the type is unsupported, so check
  // what actually came back rather than trusting the request.
  const webp = await toBlob(canvas, "image/webp");
  if (webp && webp.type === "image/webp") {
    return { blob: webp, width, height, downscaled: true };
  }
  const jpeg = await toBlob(canvas, "image/jpeg");
  if (jpeg) {
    return { blob: jpeg, width, height, downscaled: true };
  }
  throw new ImagePrepareError("Could not re-encode this image");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
