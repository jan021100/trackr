import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOutfitFeedback,
  createPersonalOutfitModel,
  generateSmartOutfit,
  markSuggestionSeen
} from '../src/lib/utils/smartOutfitEngine.ts';

const sparseCasual = [
  { id: 'top', mainCategory: 'Casual', lowerCategory: 'T-Shirts', color: 'White', product: 'Tee', status: 'active' },
  { id: 'bottom', mainCategory: 'Casual', lowerCategory: 'Chinos', color: 'Navy', product: 'Chinos', status: 'active' },
  { id: 'shoes', mainCategory: 'Casual', lowerCategory: 'Sneakers', color: 'White', product: 'Sneakers', status: 'active' },
  { id: 'cap', mainCategory: 'Casual', lowerCategory: 'Headwear', color: 'Navy', product: 'Cap', status: 'active' }
];

test('smart suggestions work when every optional style field is missing', () => {
  const before = structuredClone(sparseCasual);
  const suggestion = generateSmartOutfit(sparseCasual, { mode: 'summer', scope: 'casual', seed: 1 });

  assert.ok(suggestion);
  assert.equal(suggestion.outfit.base.id, 'top');
  assert.equal(suggestion.outfit.pants.id, 'bottom');
  assert.equal(suggestion.outfit.shoes.id, 'shoes');
  assert.equal(suggestion.metadataCoverage, 0);
  assert.equal(suggestion.features.length, 16);
  assert.ok(suggestion.features.every(Number.isFinite));
  assert.ok(Number.isFinite(suggestion.score));
  assert.deepEqual(sparseCasual, before, 'generating must never mutate wardrobe items');
});

test('optional metadata raises information coverage but never gates eligibility', () => {
  const sparse = generateSmartOutfit(sparseCasual, { mode: 'summer', scope: 'casual', seed: 2 });
  const detailedItems = sparseCasual.map((item) => ({
    ...item,
    season: '1/3',
    style: 'casual',
    fit: 'regular',
    pattern: 'plain',
    weight: 'thin'
  }));
  const detailed = generateSmartOutfit(detailedItems, { mode: 'summer', scope: 'casual', seed: 2 });

  assert.ok(sparse);
  assert.ok(detailed);
  assert.deepEqual(
    [sparse.outfit.base.id, sparse.outfit.pants.id, sparse.outfit.shoes.id],
    ['top', 'bottom', 'shoes']
  );
  assert.ok(detailed.metadataCoverage > sparse.metadataCoverage);
});

test('sports suggestions deliberately combine cycling, running, and other sports', () => {
  const items = [
    { id: 'jersey', mainCategory: 'Cycling', lowerCategory: 'SS Jerseys', color: 'Blue', status: 'active' },
    { id: 'shorts', mainCategory: 'Other Sports', lowerCategory: 'Shorts', color: 'Black', status: 'active' },
    { id: 'runner', mainCategory: 'Running', lowerCategory: 'Running Shoes', color: 'White', status: 'active' },
    ...sparseCasual
  ];
  const suggestion = generateSmartOutfit(items, { mode: 'summer', scope: 'sports', seed: 3 });

  assert.ok(suggestion);
  assert.deepEqual(
    [suggestion.outfit.base.id, suggestion.outfit.pants.id, suggestion.outfit.shoes.id],
    ['jersey', 'shorts', 'runner']
  );
});

test('unavailable pieces are never suggested', () => {
  const unavailable = [
    ...sparseCasual,
    { id: 'sold-top', mainCategory: 'Casual', lowerCategory: 'T-Shirts', color: 'White', status: 'sold' },
    { id: 'sale-bottom', mainCategory: 'Casual', lowerCategory: 'Pants', color: 'Black', status: 'for sale' },
    { id: 'disabled-shoes', mainCategory: 'Casual', lowerCategory: 'Shoes', color: 'Black', status: 'active', outfitEligible: false }
  ];
  const suggestion = generateSmartOutfit(unavailable, { scope: 'casual', seed: 4 });

  assert.ok(suggestion);
  const ids = Object.values(suggestion.outfit).filter(Boolean).map((item) => item.id);
  assert.ok(!ids.some((id) => ['sold-top', 'sale-bottom', 'disabled-shoes'].includes(id)));
});

test('feedback learns preferences without modifying the suggestion or wardrobe', () => {
  const suggestion = generateSmartOutfit(sparseCasual, { scope: 'casual', seed: 5 });
  assert.ok(suggestion);
  const originalSuggestion = structuredClone(suggestion);
  const model = createPersonalOutfitModel();
  const liked = applyOutfitFeedback(model, suggestion, 'like');

  assert.equal(liked.feedbackCount, 1);
  assert.ok(liked.itemAffinity.top > 0);
  assert.ok(liked.pairAffinity['bottom~top'] > 0);
  assert.notDeepEqual(liked.network, model.network);
  assert.deepEqual(suggestion, originalSuggestion);
  assert.equal(model.feedbackCount, 0, 'learning returns a new model instead of mutating persisted state');
});

test('the stored learning profile stays compact and sanitizes invalid affinity data', () => {
  const pairAffinity = Object.fromEntries(Array.from({ length: 1400 }, (_, index) => [`pair-${index}`, index % 2 ? index / 100 : -index / 100]));
  pairAffinity.invalid = Number.NaN;
  const model = createPersonalOutfitModel({ pairAffinity });

  assert.equal(Object.keys(model.pairAffinity).length, 1200);
  assert.ok(Object.values(model.pairAffinity).every((value) => Number.isFinite(value) && Math.abs(value) <= 3));
  assert.ok(JSON.stringify(model).length < 100_000, 'learning must stay far below Firestore document limits');
});

test('consecutive generations rotate individual pieces when alternatives exist', () => {
  const items = [
    ...['a', 'b', 'c'].map((id) => ({ id: `top-${id}`, mainCategory: 'Casual', lowerCategory: 'T-Shirts', color: 'White', status: 'active' })),
    ...['a', 'b', 'c'].map((id) => ({ id: `bottom-${id}`, mainCategory: 'Casual', lowerCategory: 'Chinos', color: 'Navy', status: 'active' })),
    ...['a', 'b', 'c'].map((id) => ({ id: `shoes-${id}`, mainCategory: 'Casual', lowerCategory: 'Sneakers', color: 'White', status: 'active' }))
  ];
  let model = createPersonalOutfitModel();
  const first = generateSmartOutfit(items, { mode: 'springFall', scope: 'casual', model, seed: 0 });
  assert.ok(first);
  model = markSuggestionSeen(model, first);
  const second = generateSmartOutfit(items, { mode: 'springFall', scope: 'casual', model, seed: 1 });
  assert.ok(second);

  const firstCore = new Set([first.outfit.base.id, first.outfit.pants.id, first.outfit.shoes.id]);
  const secondCore = [second.outfit.base.id, second.outfit.pants.id, second.outfit.shoes.id];
  assert.equal(secondCore.filter((id) => firstCore.has(id)).length, 0);
});

test('necessary repeats remain possible when a role has no alternative', () => {
  const items = [
    ...['a', 'b'].map((id) => ({ id: `top-${id}`, mainCategory: 'Casual', lowerCategory: 'T-Shirts', color: 'White', status: 'active' })),
    ...['a', 'b'].map((id) => ({ id: `bottom-${id}`, mainCategory: 'Casual', lowerCategory: 'Chinos', color: 'Navy', status: 'active' })),
    { id: 'only-shoes', mainCategory: 'Casual', lowerCategory: 'Sneakers', color: 'White', status: 'active' }
  ];
  let model = createPersonalOutfitModel();
  const first = generateSmartOutfit(items, { mode: 'springFall', scope: 'casual', model, seed: 0 });
  assert.ok(first);
  model = markSuggestionSeen(model, first);
  const second = generateSmartOutfit(items, { mode: 'springFall', scope: 'casual', model, seed: 1 });
  assert.ok(second);
  assert.equal(second.outfit.shoes.id, 'only-shoes');
  assert.notEqual(second.outfit.base.id, first.outfit.base.id);
  assert.notEqual(second.outfit.pants.id, first.outfit.pants.id);
});
