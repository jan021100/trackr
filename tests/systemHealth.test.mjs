import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FIRESTORE_FREE_STORAGE_BYTES,
  analyzeWardrobeStorage,
  detectStoredImageFormat,
  formatBytes,
  performanceScore
} from '../src/lib/utils/systemHealth.ts';

test('system health identifies stored image formats without changing records', () => {
  assert.equal(detectStoredImageFormat('data:image/webp;base64,AA', ''), 'webp');
  assert.equal(detectStoredImageFormat('data:image/png;base64,AA', ''), 'png');
  assert.equal(detectStoredImageFormat('data:image/jpeg;base64,AA', ''), 'jpeg');
  assert.equal(detectStoredImageFormat('', 'https://example.com/item.png'), 'url-only');
  assert.equal(detectStoredImageFormat('', ''), 'none');
});

test('wardrobe storage report calculates WebP coverage and sorts large images', () => {
  const records = [
    { id: 'webp', data: { product: 'WebP item', imageBase64: `data:image/webp;base64,${'A'.repeat(20)}` } },
    { id: 'png', data: { product: 'PNG item', imageBase64: `data:image/png;base64,${'A'.repeat(40)}` } },
    { id: 'none', data: { product: 'No image' } }
  ];
  const original = structuredClone(records);
  const report = analyzeWardrobeStorage(records);

  assert.equal(report.documentCount, 3);
  assert.equal(report.embeddedImageCount, 2);
  assert.equal(report.webpCount, 1);
  assert.equal(report.webpCoverage, 50);
  assert.equal(report.formats.png, 1);
  assert.equal(report.largestImages[0].id, 'png');
  assert.equal(report.nonWebpImages[0].id, 'png');
  assert.ok(report.estimatedFreeStoragePercent < 1);
  assert.deepEqual(records, original);
});

test('system thresholds stay tied to the Firestore free storage allowance', () => {
  assert.equal(FIRESTORE_FREE_STORAGE_BYTES, 1024 ** 3);
  assert.equal(formatBytes(80 * 1024), '80 KB');
  assert.equal(formatBytes(2.5 * 1024 ** 2), '2.5 MB');
  assert.equal(performanceScore({
    navigationMs: 1000,
    resourceCount: 10,
    transferredBytes: 1000,
    firestoreRequestCount: 2,
    firestoreTransferredBytes: 500,
    slowResourceCount: 0,
    longTaskCount: 0
  }), 100);
});

test('System image processing remains owner-scoped, preview-first, and transaction protected', () => {
  const systemPage = readFileSync(
    new URL('../src/routes/(app)/system/+page.svelte', import.meta.url),
    'utf8'
  );
  const layout = readFileSync(
    new URL('../src/routes/(app)/+layout.svelte', import.meta.url),
    'utf8'
  );

  assert.match(systemPage, /collection\(db, 'users', activeUserId, 'items'\)/);
  assert.match(systemPage, /getDocs\(/);
  assert.match(systemPage, /immutableBackupId\(candidate\.id, candidate\.originalImageBase64 \|\| candidate\.originalImageUrl\)/);
  assert.match(systemPage, /doc\(db, 'users', activeUserId, 'imageBackups', backupId\)/);
  assert.match(systemPage, /runTransaction\(db/);
  assert.match(systemPage, /currentBase64 !== candidate\.originalImageBase64/);
  assert.match(systemPage, /if \(!backupSnapshot\.exists\(\)\)/);
  assert.match(systemPage, /Nothing has been saved yet/);
  assert.match(systemPage, /restoreAllOriginals/);
  assert.match(systemPage, /imageBackgroundRemovalVersion \?\? 0/);
  assert.match(systemPage, /Generated cut-outs are no longer stored on restored items/);
  assert.doesNotMatch(systemPage, /\b(?:addDoc|deleteDoc|writeBatch)\b/);
  assert.match(layout, /name: 'System', path: '\/system'/);
  assert.doesNotMatch(layout, /path: '\/settings'/);
});
