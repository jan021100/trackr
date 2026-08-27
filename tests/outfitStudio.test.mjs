import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyStudioLayout,
  clampStudioCanvasPlacement,
  defaultStudioCanvasPlacement,
  placeStudioItem,
  preferredStudioSlot,
  searchStudioItems,
  studioItemIds,
  serializeStudioCanvas,
  studioCanvasFromLayout,
  studioLayoutFromItemIds,
  studioLayoutFromOutfit
} from '../src/lib/utils/outfitStudio.ts';

const items = [
  { id: 'tee', product: 'White Tee', brand: 'Example', lowerCategory: 'T-Shirts', status: 'active' },
  { id: 'jeans', product: 'Blue Jeans', lowerCategory: 'Jeans', status: 'active' },
  { id: 'shoes', product: 'Black Shoes', lowerCategory: 'Shoes', status: 'active' },
  { id: 'sold', product: 'Old Coat', lowerCategory: 'Jackets', status: 'sold' }
];

test('studio classifies pieces into visual outfit slots', () => {
  assert.equal(preferredStudioSlot(items[0]), 'top');
  assert.equal(preferredStudioSlot(items[1]), 'bottom');
  assert.equal(preferredStudioSlot(items[2]), 'shoes');
});

test('placing and replacing studio pieces does not mutate the previous layout', () => {
  const original = emptyStudioLayout();
  const withTee = placeStudioItem(original, items[0], 'top');
  const moved = placeStudioItem(withTee, items[0], 'layer');
  assert.equal(original.top, null);
  assert.equal(withTee.top.id, 'tee');
  assert.equal(moved.top, null);
  assert.equal(moved.layer.id, 'tee');
});

test('saved outfit IDs remain dashboard-compatible and reconstruct safely', () => {
  const layout = studioLayoutFromItemIds(items, ['tee', 'jeans', 'shoes', 'missing']);
  assert.deepEqual(studioItemIds(layout), ['tee', 'jeans', 'shoes']);
  const generated = studioLayoutFromOutfit({ base: items[0], pants: items[1], shoes: items[2] });
  assert.deepEqual(studioItemIds(generated), ['tee', 'jeans', 'shoes']);
});

test('studio search excludes sold and outfit-disabled pieces', () => {
  const results = searchStudioItems([...items, { id: 'off', product: 'Hidden Tee', outfitEligible: false }], '');
  assert.deepEqual(results.map((item) => item.id), ['tee', 'jeans', 'shoes']);
  assert.deepEqual(searchStudioItems(items, 'blue jeans').map((item) => item.id), ['jeans']);
});

test('free canvas positions are responsive, bounded, and serialize without changing item IDs', () => {
  const layout = studioLayoutFromItemIds(items, ['tee', 'jeans', 'shoes']);
  const canvas = studioCanvasFromLayout(layout);
  canvas.top = clampStudioCanvasPlacement({ x: 140, y: -20, scale: 4, z: 7 }, defaultStudioCanvasPlacement('top'));
  assert.deepEqual(canvas.top, { x: 96, y: 4, scale: 1.45, z: 7 });

  const saved = serializeStudioCanvas(layout, canvas);
  assert.equal(saved.top.itemId, 'tee');
  assert.deepEqual(studioItemIds(layout), ['tee', 'jeans', 'shoes']);
  assert.deepEqual(studioCanvasFromLayout(layout, saved).top, canvas.top);
});

test('legacy saved outfits receive safe default canvas positions', () => {
  const layout = studioLayoutFromItemIds(items, ['tee', 'jeans']);
  const canvas = studioCanvasFromLayout(layout);
  assert.deepEqual(canvas.top, defaultStudioCanvasPlacement('top'));
  assert.deepEqual(canvas.bottom, defaultStudioCanvasPlacement('bottom'));
  assert.equal(canvas.shoes, null);
});

test('studio free positioning stays local until the owner explicitly saves', () => {
  const source = readFileSync(new URL('../src/routes/(app)/outfit-studio/+page.svelte', import.meta.url), 'utf8');
  assert.match(source, /on:pointerdown=\{\(event\) => beginMove\(event, slot\)\}/);
  assert.match(source, /touch-action:none/);
  assert.match(source, /const serializedCanvas = serializeStudioCanvas\(layout, canvas\)/);
  assert.match(source, /addDoc\(collection\(db, 'users', userId, 'outfits'\)/);
  assert.doesNotMatch(source, /\b(updateDoc|deleteDoc|writeBatch|runTransaction)\b/);
});

test('all outfit suggestion modes live in the visual studio, not the dashboard', () => {
  const studio = readFileSync(new URL('../src/routes/(app)/outfit-studio/+page.svelte', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/routes/(app)/dashboard/+page.svelte', import.meta.url), 'utf8');
  assert.match(studio, /generateSmartOutfit/);
  for (const mode of ['summer', 'warmSpringFall', 'springFall', 'winter', 'rotation', 'discovery']) {
    assert.match(studio, new RegExp(mode));
  }
  assert.match(studio, /outfitScope/);
  assert.match(studio, /'outfitIntelligence'/);
  assert.doesNotMatch(dashboard, /from '\$lib\/utils\/outfitGenerator'/);
  assert.doesNotMatch(dashboard, /addDoc\(collection\(db, 'users', uid, 'outfits'/);
});

test('the selected canvas piece opens only the universal editor and preserves the draft', () => {
  const studio = readFileSync(new URL('../src/routes/(app)/outfit-studio/+page.svelte', import.meta.url), 'utf8');
  assert.match(studio, /class="edit-item" on:click=\{openSelectedItemEditor\}>Edit item<\/button>/);
  assert.match(studio, /goto\(itemEditHref\(item\.id, '\/outfit-studio'\)/);
  assert.match(studio, /sessionStorage\.setItem\(EDITOR_DRAFT_KEY/);
  assert.match(studio, /restoreEditorCanvasDraft\(\)/);
  assert.doesNotMatch(studio, /<ItemEditor|<UniversalItemEditorModal/);
});
