import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMAGE_MAX_DATA_URL_BYTES,
  IMAGE_MAX_DIMENSION,
  IMAGE_FALLBACK_TYPE,
  IMAGE_OUTPUT_TYPE,
  IMAGE_OUTPUT_TYPES,
  dataUrlByteLength,
  fitImageDimensions,
  formatImageBytes,
  imageFileFromClipboard
} from '../src/lib/utils/imageCompression.ts';

test('Firestore image policy prefers WebP, preserves transparency with Safari PNG fallback, and stays below 80 KiB', () => {
  assert.equal(IMAGE_OUTPUT_TYPE, 'image/webp');
  assert.equal(IMAGE_FALLBACK_TYPE, 'image/png');
  assert.deepEqual(IMAGE_OUTPUT_TYPES, ['image/webp', 'image/png']);
  assert.equal(IMAGE_MAX_DIMENSION, 700);
  assert.equal(IMAGE_MAX_DATA_URL_BYTES, 80 * 1024);
});

test('dimension fitting never upscales and preserves aspect ratio', () => {
  assert.deepEqual(fitImageDimensions(1400, 700), { width: 700, height: 350 });
  assert.deepEqual(fitImageDimensions(300, 500), { width: 300, height: 500 });
  assert.throws(() => fitImageDimensions(0, 500));
});

test('stored data URL size is measured as UTF-8 bytes', () => {
  assert.equal(dataUrlByteLength('data:image/webp;base64,AAAA'), 27);
  assert.equal(formatImageBytes(80 * 1024), '80 KB');
});

test('clipboard paste accepts image files and ignores copied text', () => {
  const image = { name: 'pasted.png', type: 'image/png' };
  const clipboard = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }], files: [] };
  assert.equal(imageFileFromClipboard(clipboard), image);
  assert.equal(imageFileFromClipboard({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] }), null);
});

test('item and book editors send pasted images through the shared safe compressor', () => {
  for (const path of ['../src/lib/components/ItemEditor.svelte', '../src/routes/(app)/life/+page.svelte']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /imageFileFromClipboard\(event\.clipboardData\)/);
    assert.match(source, /on:paste=/);
    assert.match(source, /compressImageForFirestore\(file\)/);
  }
});

test('every clothing upload uses the guarded shared compressor', () => {
  const sources = ['../src/lib/components/ItemEditor.svelte']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

  for (const source of sources) {
    assert.match(source, /compressImageForFirestore\(file\)/);
    assert.doesNotMatch(source, /toDataURL\(['"]image\/png/);
    assert.match(source, /previous image has been preserved/i);
    assert.match(source, /Safari-compatible WebP/i);
    assert.match(source, /transparent PNG/i);
  }

  const legacyRoute = readFileSync(new URL('../src/routes/(app)/clothing/edit/[id]/+page.svelte', import.meta.url), 'utf8');
  assert.match(legacyRoute, /itemEditHref/);
  assert.doesNotMatch(legacyRoute, /type=["']file["']/);
});

test('Safari uses a lazy WebAssembly WebP encoder before transparent PNG fallback', () => {
  const compressor = readFileSync(
    new URL('../src/lib/utils/imageCompression.ts', import.meta.url),
    'utf8'
  );
  const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(compressor, /import\('@jsquash\/webp\/encode'\)/);
  assert.match(compressor, /alpha_quality:\s*100/);
  assert.match(compressor, /exact:\s*1/);
  assert.match(compressor, /IMAGE_FALLBACK_TYPE = 'image\/png'/);
  assert.doesNotMatch(compressor, /image\/jpeg/);
  assert.match(viteConfig, /exclude:\s*\['@jsquash\/webp'\]/);
});

test('image format is reported only by the save flows after Firestore succeeds', () => {
  const clothing = readFileSync(
    new URL('../src/routes/(app)/clothing/+page.svelte', import.meta.url),
    'utf8'
  );
  const universalModal = readFileSync(
    new URL('../src/lib/components/UniversalItemEditorModal.svelte', import.meta.url),
    'utf8'
  );

  assert.match(clothing, /Image successfully saved as WebP/);
  assert.match(clothing, /transparent PNG fallback/);
  assert.ok(clothing.indexOf('await updateDoc(ref, payload)') < clothing.indexOf('imageSavedMessage(savedImageFormat)'));
  assert.ok(universalModal.indexOf('await updateDoc') < universalModal.indexOf("dispatch('saved'"));
});

test('large image strings are excluded from Firestore indexes', () => {
  const config = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.fieldOverrides, [
    { collectionGroup: 'items', fieldPath: 'imageBase64', indexes: [] },
    { collectionGroup: 'imageBackups', fieldPath: 'originalImageBase64', indexes: [] },
    { collectionGroup: 'lifeBooks', fieldPath: 'coverImageBase64', indexes: [] }
  ]);
});
