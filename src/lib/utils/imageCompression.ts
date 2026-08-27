export const IMAGE_MAX_DIMENSION = 700;
export const IMAGE_MAX_DATA_URL_BYTES = 80 * 1024;
export const IMAGE_OUTPUT_TYPE = 'image/webp';
export const IMAGE_FALLBACK_TYPE = 'image/png';
export const IMAGE_OUTPUT_TYPES = [IMAGE_OUTPUT_TYPE, IMAGE_FALLBACK_TYPE] as const;

type ImageOutputType = (typeof IMAGE_OUTPUT_TYPES)[number];
export type ImageStorageFormat = 'webp' | 'png';

export type CompressedImage = {
  dataUrl: string;
  byteLength: number;
  width: number;
  height: number;
  sourceByteLength: number;
  mimeType: ImageOutputType;
  storageFormat: ImageStorageFormat;
};

export function dataUrlByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function formatImageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function imageFileFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file' || !item.type.toLowerCase().startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return Array.from(clipboardData.files ?? []).find((file) => file.type.toLowerCase().startsWith('image/')) ?? null;
}

export function fitImageDimensions(width: number, height: number, maxDimension = IMAGE_MAX_DIMENSION) {
  if (width <= 0 || height <= 0 || maxDimension <= 0) throw new Error('Invalid image dimensions.');
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('This image could not be opened.'));
    };
    image.src = objectUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: ImageOutputType, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      // Safari may silently return PNG when its canvas cannot encode WebP.
      if (!blob || blob.type.toLowerCase() !== mimeType) return resolve(null);
      resolve(blob);
    }, mimeType, quality);
  });
}

async function wasmWebPBlob(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  quality: number
): Promise<Blob | null> {
  try {
    // Loaded only when the browser's own canvas encoder cannot produce WebP (notably Safari).
    const { default: encodeWebP } = await import('@jsquash/webp/encode');
    const pixels = context.getImageData(0, 0, width, height);
    const buffer = await encodeWebP(pixels, {
      quality: Math.round(quality * 100),
      method: 4,
      alpha_compression: 1,
      alpha_filtering: 1,
      alpha_quality: 100,
      exact: 1
    });
    return new Blob([buffer], { type: IMAGE_OUTPUT_TYPE });
  } catch (error) {
    console.warn('WebAssembly WebP encoding unavailable; using transparent PNG fallback.', error);
    return null;
  }
}

function drawImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number
) {
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  quality: number,
  preferredType?: ImageOutputType
): Promise<{ blob: Blob; mimeType: ImageOutputType }> {
  const outputTypes: readonly ImageOutputType[] = preferredType
    ? [preferredType, ...IMAGE_OUTPUT_TYPES.filter((type) => type !== preferredType)]
    : IMAGE_OUTPUT_TYPES;

  for (const mimeType of outputTypes) {
    drawImage(context, image, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, mimeType, quality);
    if (blob) return { blob, mimeType };

    if (mimeType === IMAGE_OUTPUT_TYPE) {
      const wasmBlob = await wasmWebPBlob(context, canvas.width, canvas.height, quality);
      if (wasmBlob) return { blob: wasmBlob, mimeType };
    }
  }

  throw new Error('This browser could not create a compatible compressed image.');
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('The compressed image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageForFirestore(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Please choose an image smaller than 25 MB.');

  const image = await loadImage(file);
  let dimensions = fitImageDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Image compression is unavailable in this browser.');

  let quality = 0.78;
  let attempts = 0;
  let outputType: ImageOutputType | undefined;
  while (attempts < 12) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const encoded = await encodeCanvas(canvas, context, image, quality, outputType);
    outputType = encoded.mimeType;
    const blob = encoded.blob;
    const dataUrl = await blobDataUrl(blob);
    const byteLength = dataUrlByteLength(dataUrl);
    if (byteLength <= IMAGE_MAX_DATA_URL_BYTES) {
      return {
        dataUrl,
        byteLength,
        width: canvas.width,
        height: canvas.height,
        sourceByteLength: file.size,
        mimeType: outputType,
        storageFormat: outputType === IMAGE_OUTPUT_TYPE ? 'webp' : 'png'
      };
    }

    attempts += 1;
    // PNG is lossless and ignores the quality parameter, so reduce only its dimensions.
    if (outputType === IMAGE_OUTPUT_TYPE && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.08);
    } else {
      dimensions = fitImageDimensions(
        Math.max(1, Math.round(dimensions.width * 0.82)),
        Math.max(1, Math.round(dimensions.height * 0.82)),
        IMAGE_MAX_DIMENSION
      );
    }
  }

  throw new Error('This image could not be reduced below the safe Firestore limit.');
}

export async function compressCanvasForFirestore(
  sourceCanvas: HTMLCanvasElement,
  sourceByteLength = 0
): Promise<CompressedImage> {
  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) throw new Error('The processed image is empty.');
  let dimensions = fitImageDimensions(sourceCanvas.width, sourceCanvas.height);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Image compression is unavailable in this browser.');

  let quality = 0.78;
  let attempts = 0;
  let outputType: ImageOutputType | undefined;
  while (attempts < 12) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const encoded = await encodeCanvas(canvas, context, sourceCanvas, quality, outputType);
    outputType = encoded.mimeType;
    const dataUrl = await blobDataUrl(encoded.blob);
    const byteLength = dataUrlByteLength(dataUrl);
    if (byteLength <= IMAGE_MAX_DATA_URL_BYTES) {
      return {
        dataUrl,
        byteLength,
        width: canvas.width,
        height: canvas.height,
        sourceByteLength,
        mimeType: outputType,
        storageFormat: outputType === IMAGE_OUTPUT_TYPE ? 'webp' : 'png'
      };
    }
    attempts += 1;
    if (outputType === IMAGE_OUTPUT_TYPE && quality > 0.5) quality = Math.max(0.5, quality - 0.08);
    else {
      dimensions = fitImageDimensions(
        Math.max(1, Math.round(dimensions.width * 0.82)),
        Math.max(1, Math.round(dimensions.height * 0.82)),
        IMAGE_MAX_DIMENSION
      );
    }
  }
  throw new Error('This processed image could not be reduced below the safe Firestore limit.');
}
