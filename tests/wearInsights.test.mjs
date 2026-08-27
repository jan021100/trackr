import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyRecap,
  buildWearDayIndex,
  normalizeWearDate,
  searchWardrobeItems
} from '../src/lib/utils/wearInsights.ts';

const items = [
  {
    id: 'jacket', product: 'Rain Jacket', brand: 'MAAP', color: 'Purple',
    mainCategory: 'Cycling', lowerCategory: 'Jackets', status: 'active', labels: ['Second-Hand'],
    price: 120, worn: 4, purchaseDate: '2026-06-01', lastWorn: '2026-08-10',
    wearLog: ['2026-07-02', '2026-08-01', '2026-08-10', '2026-08-10']
  },
  {
    id: 'shirt', product: 'Oxford Shirt', brand: 'Arket', color: 'Blue',
    mainCategory: 'Casual', lowerCategory: 'Shirts', status: 'active', labels: ['Gift'],
    price: 80, worn: 2, purchaseDate: '2026-07-15', lastWorn: '2026-08-02',
    wearLog: ['2026-07-20', '2026-08-02']
  },
  {
    id: 'sold', product: 'Old Shoes', brand: 'Example', mainCategory: 'Casual',
    status: 'sold', price: 50, worn: 1, wearLog: ['2026-08-03']
  }
];

test('wear-date normalization accepts stored date shapes and rejects invalid calendar dates', () => {
  assert.equal(normalizeWearDate('2026-08-10T12:00:00Z'), '2026-08-10');
  assert.equal(normalizeWearDate({ seconds: 1_786_320_000 }), '2026-08-10');
  assert.equal(normalizeWearDate('2026-02-31'), null);
});

test('wardrobe search matches all terms across item fields and labels without mutation', () => {
  const before = structuredClone(items);
  assert.deepEqual(searchWardrobeItems(items, 'maap purple'), [items[0]]);
  assert.deepEqual(searchWardrobeItems(items, 'gift casual'), [items[1]]);
  assert.deepEqual(searchWardrobeItems(items, ''), items);
  assert.deepEqual(items, before);
});

test('wear calendar groups duplicate wears per item and ignores invalid entries', () => {
  const index = buildWearDayIndex([...items, { id: 'bad', wearLog: ['not-a-date'] }]);
  assert.equal(index['2026-08-10'][0].item.id, 'jacket');
  assert.equal(index['2026-08-10'][0].count, 2);
  assert.equal(index['not-a-date'], undefined);
});

test('monthly recap excludes sold items and calculates tracked CPW movement', () => {
  const recap = buildMonthlyRecap(items, '2026-08');
  assert.equal(recap.activeDays, 3);
  assert.equal(recap.totalWears, 4);
  assert.equal(recap.uniquePieces, 2);
  assert.equal(recap.topPieces[0].item.id, 'jacket');
  assert.deepEqual(recap.categorySplit.map(({ name, wears }) => ({ name, wears })), [
    { name: 'Cycling', wears: 3 },
    { name: 'Casual', wears: 1 }
  ]);
  assert.ok(recap.costPerWearAtEnd < recap.costPerWearAtStart);
});
