import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSummerOutfit,
  generateSpringOutfit,
  generateWinterOutfit
} from '../src/lib/utils/outfitGenerator.ts';

const wardrobe = [
  { id: 'base', mainCategory: 'Casual', lowerCategory: 'T-Shirts', status: 'active', color: 'White' },
  { id: 'mid', mainCategory: 'Casual', lowerCategory: 'Sweaters', status: 'active', color: 'Navy' },
  { id: 'light-jacket', mainCategory: 'Casual', lowerCategory: 'Jackets', status: 'active', season: '2/3', color: 'Navy' },
  { id: 'warm-jacket', mainCategory: 'Casual', lowerCategory: 'Jackets', status: 'active', season: '3/3', color: 'Black' },
  { id: 'pants', mainCategory: 'Casual', lowerCategory: 'Pants', status: 'active', color: 'Black' },
  { id: 'shorts', mainCategory: 'Casual', lowerCategory: 'Shorts', status: 'active', color: 'Black' },
  { id: 'shoes', mainCategory: 'Casual', lowerCategory: 'Shoes', status: 'active', color: 'White' },
  { id: 'sold', mainCategory: 'Casual', lowerCategory: 'T-Shirts', status: 'sold', color: 'Red' },
  { id: 'cycling', mainCategory: 'Cycling', lowerCategory: 'SS Jerseys', status: 'active', color: 'Red' },
  { id: 'excluded', mainCategory: 'Casual', lowerCategory: 'T-Shirts', status: 'active', outfitEligible: false, color: 'Red' }
];

function ids(outfit) {
  return Object.values(outfit).filter(Boolean).map((item) => item.id);
}

test('summer outfits use the required casual core and shorts', () => {
  const outfit = generateSummerOutfit(wardrobe);
  assert.equal(outfit.base?.id, 'base');
  assert.equal(outfit.pants?.id, 'shorts');
  assert.equal(outfit.shoes?.id, 'shoes');
  assert.equal(outfit.mid, undefined);
  assert.equal(outfit.jacket, undefined);
});

test('spring and winter outfits select the appropriate outerwear', () => {
  const spring = generateSpringOutfit(wardrobe);
  const winter = generateWinterOutfit(wardrobe);

  assert.equal(spring.mid?.id, 'mid');
  assert.equal(spring.jacket?.id, 'light-jacket');
  assert.equal(winter.mid?.id, 'mid');
  assert.equal(winter.jacket?.id, 'warm-jacket');
});

test('outfit generation excludes sold, disabled, and non-casual items without mutating input', () => {
  const before = structuredClone(wardrobe);
  const selected = ids(generateWinterOutfit(wardrobe));

  assert.equal(selected.includes('sold'), false);
  assert.equal(selected.includes('cycling'), false);
  assert.equal(selected.includes('excluded'), false);
  assert.deepEqual(wardrobe, before);
});
