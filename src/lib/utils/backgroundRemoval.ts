import { fitImageDimensions } from './imageCompression';

export const BACKGROUND_REMOVAL_VERSION = 1;

export type BackgroundRemovalMetrics = {
  backgroundColor: { red: number; green: number; blue: number };
  borderUniformity: number;
  removedRatio: number;
  transparentRatio: number;
  confidence: number;
  safe: boolean;
  reason: string;
};

export type BackgroundRemovalPixels = BackgroundRemovalMetrics & {
  pixels: Uint8ClampedArray;
};

export type BackgroundRemovalPreview = BackgroundRemovalMetrics & {
  canvas: HTMLCanvasElement;
  sourceByteLength: number;
  width: number;
  height: number;
};

function colorDistance(red: number, green: number, blue: number, target: { red: number; green: number; blue: number }) {
  return Math.hypot(red - target.red, green - target.green, blue - target.blue);
}

function borderPixelIndexes(width: number, height: number): number[] {
  const indexes: number[] = [];
  const step = Math.max(1, Math.floor((width + height) / 900));
  for (let x = 0; x < width; x += step) {
    indexes.push(x, (height - 1) * width + x);
  }
  for (let y = step; y < height - 1; y += step) {
    indexes.push(y * width, y * width + width - 1);
  }
  return indexes;
}

function dominantBorderColor(pixels: Uint8ClampedArray, indexes: readonly number[]) {
  const bins = new Map<string, { count: number; red: number; green: number; blue: number }>();
  for (const index of indexes) {
    const offset = index * 4;
    if (pixels[offset + 3] < 32) continue;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const key = `${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`;
    const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bin.count += 1;
    bin.red += red;
    bin.green += green;
    bin.blue += blue;
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return { red: 255, green: 255, blue: 255 };
  return {
    red: dominant.red / dominant.count,
    green: dominant.green / dominant.count,
    blue: dominant.blue / dominant.count
  };
}

export function removeUniformBackgroundPixels(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number
): BackgroundRemovalPixels {
  if (width <= 0 || height <= 0 || sourcePixels.length !== width * height * 4) {
    throw new Error('Invalid image pixels.');
  }

  const pixels = new Uint8ClampedArray(sourcePixels);
  const pixelCount = width * height;
  let transparentPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (pixels[index * 4 + 3] < 245) transparentPixels += 1;
  }
  const transparentRatio = transparentPixels / pixelCount;
  const borderIndexes = borderPixelIndexes(width, height);
  const backgroundColor = dominantBorderColor(pixels, borderIndexes);
  const uniformLimit = 55;
  const opaqueBorder = borderIndexes.filter((index) => pixels[index * 4 + 3] >= 32);
  const uniformBorder = opaqueBorder.filter((index) => {
    const offset = index * 4;
    return colorDistance(pixels[offset], pixels[offset + 1], pixels[offset + 2], backgroundColor) <= uniformLimit;
  });
  const borderUniformity = opaqueBorder.length ? uniformBorder.length / opaqueBorder.length : 0;

  if (transparentRatio >= 0.03) {
    return {
      pixels,
      backgroundColor,
      borderUniformity,
      removedRatio: 0,
      transparentRatio,
      confidence: 1,
      safe: false,
      reason: 'This image already contains useful transparency.'
    };
  }
  if (borderUniformity < 0.8) {
    return {
      pixels,
      backgroundColor,
      borderUniformity,
      removedRatio: 0,
      transparentRatio,
      confidence: borderUniformity,
      safe: false,
      reason: 'The background is not uniform enough for safe automatic removal.'
    };
  }

  const hardLimit = 26;
  const floodLimit = 66;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  let alphaRemoved = 0;

  function enqueue(index: number) {
    if (visited[index]) return;
    const offset = index * 4;
    if (pixels[offset + 3] < 16 || colorDistance(pixels[offset], pixels[offset + 1], pixels[offset + 2], backgroundColor) <= floodLimit) {
      visited[index] = 1;
      queue[queueEnd++] = index;
    }
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    const offset = index * 4;
    const oldAlpha = pixels[offset + 3];
    const distance = colorDistance(pixels[offset], pixels[offset + 1], pixels[offset + 2], backgroundColor);
    const newAlpha = distance <= hardLimit
      ? 0
      : Math.min(oldAlpha, Math.round(((distance - hardLimit) / (floodLimit - hardLimit)) * oldAlpha));
    pixels[offset + 3] = newAlpha;
    alphaRemoved += oldAlpha - newAlpha;

    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }

  const removedRatio = alphaRemoved / (pixelCount * 255);
  const removalShapeScore = removedRatio >= 0.1 && removedRatio <= 0.78 ? 1 : 0.35;
  const confidence = Math.max(0, Math.min(1, borderUniformity * 0.72 + removalShapeScore * 0.28));
  const safe = borderUniformity >= 0.92 && removedRatio >= 0.1 && removedRatio <= 0.78;
  const reason = safe
    ? 'Uniform edge-connected background detected.'
    : removedRatio < 0.1
      ? 'Too little background was detected.'
      : removedRatio > 0.78
        ? 'Too much of the image would be removed.'
        : 'This result needs individual review.';

  return { pixels, backgroundColor, borderUniformity, removedRatio, transparentRatio, confidence, safe, reason };
}

function loadImageSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(source)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(
      /^https?:\/\//i.test(source)
        ? 'The image host blocks background processing. Re-upload the original file to process it.'
        : 'This image could not be opened.'
    ));
    image.src = source;
  });
}

export async function createBackgroundRemovalPreview(source: string): Promise<BackgroundRemovalPreview> {
  const image = await loadImageSource(source);
  const dimensions = fitImageDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) throw new Error('Background processing is unavailable in this browser.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    throw new Error('The image host does not permit safe pixel access. Re-upload the original file.');
  }
  const result = removeUniformBackgroundPixels(imageData.data, canvas.width, canvas.height);
  if (result.removedRatio > 0) {
    imageData.data.set(result.pixels);
    context.putImageData(imageData, 0, 0);
  }
  return {
    ...result,
    canvas,
    sourceByteLength: new TextEncoder().encode(source).byteLength,
    width: canvas.width,
    height: canvas.height
  };
}
