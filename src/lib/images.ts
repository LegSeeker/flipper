export interface ProcessedImage {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: string;
}

const FULL_MAX = 1600;
const THUMB_MAX = 360;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Respect EXIF rotation from phone cameras.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(
  src: ImageBitmap | HTMLImageElement,
  max: number,
  quality: number,
): Promise<{ blob: Blob; w: number; h: number }> {
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Resize + re-encode as JPEG. Re-encoding also strips EXIF metadata (including GPS
 * location), which matters because photos may end up in marketplace listings.
 */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image file');
  const src = await decode(file).catch(() => {
    throw new Error('This image format is not supported by your browser (try JPEG or PNG).');
  });
  try {
    const full = await render(src, FULL_MAX, 0.82);
    const thumb = await render(src, THUMB_MAX, 0.75);
    return { blob: full.blob, thumb: thumb.blob, width: full.w, height: full.h, mime: 'image/jpeg' };
  } finally {
    if ('close' in src) src.close();
  }
}

/**
 * Downscale a photo for an AI model: large enough to read labels and spot
 * damage, small enough to keep requests quick and cheap.
 */
export async function imageForAi(file: Blob, max = 1024): Promise<{ mime: string; data: string }> {
  const src = await decode(file);
  try {
    const out = await render(src, max, 0.8);
    return { mime: 'image/jpeg', data: await blobToBase64(out.blob) };
  } finally {
    if ('close' in src) src.close();
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
