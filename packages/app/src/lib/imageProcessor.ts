/**
 * Image processing before send:
 *  - Strips all EXIF/metadata by routing through canvas (canvas never preserves EXIF)
 *  - Resizes to MAX_DIMENSION on the longest side if larger
 *  - Re-encodes as JPEG at QUALITY (WebP where supported)
 *  - Generates a base64 thumbnail for inline preview
 */

const MAX_DIMENSION  = 2048;
const QUALITY        = 0.85;
const THUMB_SIZE     = 320;
const THUMB_QUALITY  = 0.6;

export interface ProcessedImage {
  data:      Uint8Array;
  mimeType:  string;
  width:     number;
  height:    number;
  thumbnail: string; // base64 data URL
}

function supportsWebP(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch { return false; }
}

function drawToCanvas(img: ImageBitmap, maxDim: number): HTMLCanvasElement {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
    else                 { width  = Math.round(width  * maxDim / height); height = maxDim; }
  }
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** Load a File into an ImageBitmap, falling back to an <img> element on
 *  Android WebView where createImageBitmap is unreliable or absent. */
async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  return new Promise<ImageBitmap>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // createImageBitmap from an HTMLImageElement is universally supported
      // once the image has loaded.
      createImageBitmap(img).then(resolve).catch(reject);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

/** canvas.toBlob with a Promise wrapper that rejects on null (Android quirk). */
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob returned null')), mime, quality);
  });
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const bitmap = await loadBitmap(file);

  const outMime = supportsWebP() ? 'image/webp' : 'image/jpeg';

  // Full-size canvas (resized + EXIF stripped)
  const canvas = drawToCanvas(bitmap, MAX_DIMENSION);
  const blob   = await canvasToBlob(canvas, outMime, QUALITY);
  const data   = new Uint8Array(await blob.arrayBuffer());

  // Thumbnail canvas
  const thumbCanvas = drawToCanvas(bitmap, THUMB_SIZE);
  const thumbnail   = thumbCanvas.toDataURL(outMime, THUMB_QUALITY);

  bitmap.close();

  return { data, mimeType: outMime, width: canvas.width, height: canvas.height, thumbnail };
}

/** Returns true for image MIME types we can process through canvas */
export function isProcessableImage(mimeType: string): boolean {
  return /^image\/(jpeg|jpg|png|webp|gif|bmp|avif|heic|heif)$/i.test(mimeType);
}
