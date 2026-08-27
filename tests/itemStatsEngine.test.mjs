import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeItemStats, normalizeDateKey } from '../src/lib/utils/itemStatsEngine.ts';

test('date normalization accepts stored Firestore and ISO date shapes', () => {
  assert.equal(normalizeDateKey('2026-08-10T08:30:00.000Z'), '2026-08-10');
  assert.equal(normalizeDateKey({ seconds: 1_786_320_000 }), '2026-08-10');
  assert.equal(normalizeDateKey('not-a-date'), null);
});

test('item analysis keeps wear totals and cost-per-wear stable', () => {
  const item = {
    id: 'jacket-1',
    product: 'Rain Jacket',
    brand: 'Example',
    mainCategory: 'Cycling',
    lowerCategory: 'Jackets',
    price: 120,
    worn: 12,
    purchaseDate: '2026-01-01',
    lastWorn: '2026-08-01',
    wearLog: ['2026-07-01', '2026-08-01'],
    labels: ['Second-Hand']
  };
  const before = structuredClone(item);
  const result = analyzeItemStats(item);

  assert.equal(result.metrics.wornCount, 12);
  assert.equal(result.metrics.recordedWearCount, 2);
  assert.equal(result.metrics.costPerWear, 10);
  assert.equal(result.classification.acquisitionType, 'second-hand');
  assert.equal(result.classification.isSportsItem, true);
  assert.deepEqual(item, before);
});

test('wear-log count cannot be under-reported by a stale worn field', () => {
  const result = analyzeItemStats({
    price: 50,
    worn: 1,
    wearLog: ['2026-08-01', '2026-08-02', '2026-08-03']
  });

  assert.equal(result.metrics.wornCount, 3);
  assert.equal(result.metrics.costPerWear, 16.67);
});
