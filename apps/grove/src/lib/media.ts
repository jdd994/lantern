// media.ts
// Client-side handling for keepsake scans and photos, ported from Driftless's
// proven polaroid path. Downscale + re-encode images so a shoebox of scans
// stays kind to device storage (and to sync later); PDFs pass through intact —
// a scanned letter is often a PDF and re-encoding one isn't ours to do.
// No IO or crypto here.

export const MAX_DIM = 1600; // longest edge, px
export const QUALITY = 0.85;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// Base64-encode bytes (chunked, so large scans don't overflow the call stack).
// Used to build data: URLs for display — allowed by the CSP everywhere, unlike
// blob: URLs.
export function bytesToBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function isHeic(file: File): boolean {
  return /(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

// Downscale + re-encode a photo to JPEG. Throws (never stores an unviewable
// blob) so the caller can show a clear message instead of a blank keepsake.
async function compressImage(file: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (isHeic(file)) {
      throw new Error(
        "This photo is in Apple's HEIC format, which this device can't open. Convert it to a JPEG first — e.g. open it in Google Photos, tap Edit, then Save copy — and add that."
      );
    }
    throw new Error("Couldn't read that image — try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image on this device.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", QUALITY)
  );
  if (!blob) throw new Error("Couldn't process that image.");
  return { bytes: await blob.arrayBuffer(), type: "image/jpeg" };
}

// What a keepsake can carry: a photo or scan (any image the browser reads,
// re-encoded small) or a PDF (a scanned letter, a certificate — kept as-is,
// within reason).
export async function prepareKeepsakeFile(file: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (isPdf(file)) {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error("That PDF is over 10 MB. Export it smaller — a scan doesn't need print resolution to be read.");
    }
    return { bytes: await file.arrayBuffer(), type: "application/pdf" };
  }
  return compressImage(file);
}
