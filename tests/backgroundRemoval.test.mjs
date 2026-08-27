import test from 'node:test';
import assert from 'node:assert/strict';
import { removeUniformBackgroundPixels } from '../src/lib/utils/backgroundRemoval.ts';

function image(width, height, color = [250, 250, 250, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) pixels.set(color, index * 4);
  return pixels;
}

function paint(pixels, width, fromX, fromY, toX, toY, color) {
  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) pixels.set(color, (y * width + x) * 4);
  }
}

test('uniform edge-connected background is removed while the garment remains opaque', () => {
  const pixels = image(20, 20);
  paint(pixels, 20, 6, 3, 14, 18, [30, 70, 150, 255]);
  const result = removeUniformBackgroundPixels(pixels, 20, 20);

  assert.equal(result.safe, true);
  assert.ok(result.removedRatio > 0.5);
  assert.equal(result.pixels[3], 0);
  assert.equal(result.pixels[(10 * 20 + 10) * 4 + 3], 255);
  assert.equal(pixels[3], 255, 'input pixels must never be mutated');
});

test('existing transparency is preserved and not processed again', () => {
  const pixels = image(10, 10);
  paint(pixels, 10, 0, 0, 3, 3, [0, 0, 0, 0]);
  const result = removeUniformBackgroundPixels(pixels, 10, 10);
  assert.equal(result.safe, false);
  assert.equal(result.removedRatio, 0);
  assert.match(result.reason, /already contains useful transparency/);
});

test('non-uniform borders are rejected instead of risking the item', () => {
  const pixels = image(12, 12, [255, 255, 255, 255]);
  for (let x = 0; x < 12; x += 1) {
    pixels.set(x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4);
    pixels.set(x % 2 ? [255, 0, 0, 255] : [0, 255, 0, 255], ((11 * 12) + x) * 4);
  }
  const result = removeUniformBackgroundPixels(pixels, 12, 12);
  assert.equal(result.safe, false);
  assert.equal(result.removedRatio, 0);
});
