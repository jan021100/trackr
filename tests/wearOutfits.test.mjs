import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WEAR_OUTFIT_SLOTS,
  buildWearDayOutfits,
  wearOutfitKind,
  wearOutfitSlot
} from '../src/lib/utils/wearOutfits.ts';

function entry(id, mainCategory, lowerCategory, count = 1) {
  return { item: { id, product: id, mainCategory, lowerCategory }, count };
}

test('wear calendar keeps Casual separate and combines every sport into one outfit', () => {
  const entries = [
    entry('shirt', 'Casual', 'T-Shirts'),
    entry('pants', 'Casual', 'Pants'),
    entry('cycling-socks', 'Cycling', 'Socks'),
    entry('running-shirt', 'Running', 'T-Shirts'),
    entry('gym-shorts', 'Other Sports', 'Shorts')
  ];
  const before = structuredClone(entries);
  const outfits = buildWearDayOutfits(entries);

  assert.deepEqual(outfits.casual.entries.map((value) => value.item.id), ['shirt', 'pants']);
  assert.deepEqual(outfits.sports.entries.map((value) => value.item.id), [
    'cycling-socks', 'running-shirt', 'gym-shorts'
  ]);
  assert.deepEqual(entries, before);
});

test('outfit slots run head-to-toe and stack upper-body layers from base to jacket', () => {
  const entries = [
    entry('jacket', 'Casual', 'Jackets'),
    entry('shirt', 'Casual', 'Shirts'),
    entry('sweater', 'Casual', 'Sweaters'),
    entry('hat', 'Casual', 'Headwear'),
    entry('pants', 'Casual', 'Pants'),
    entry('socks', 'Casual', 'Socks'),
    entry('shoes', 'Casual', 'Shoes')
  ];
  const outfit = buildWearDayOutfits(entries).casual;

  assert.deepEqual(WEAR_OUTFIT_SLOTS.slice(0, 7), ['head', 'upper', 'hands', 'lower', 'legs', 'socks', 'shoes']);
  assert.deepEqual(outfit.slots.upper.map((value) => value.item.id), ['shirt', 'sweater', 'jacket']);
  assert.equal(outfit.slots.head[0].item.id, 'hat');
  assert.equal(outfit.slots.shoes[0].item.id, 'shoes');
});

test('category classification covers mixed sport pieces and accessories', () => {
  assert.equal(wearOutfitKind({ id: 'x', mainCategory: 'Casual' }), 'casual');
  assert.equal(wearOutfitKind({ id: 'x', mainCategory: 'Cycling' }), 'sports');
  assert.equal(wearOutfitKind({ id: 'x', mainCategory: 'Running' }), 'sports');
  assert.equal(wearOutfitKind({ id: 'x', mainCategory: 'Other Sports' }), 'sports');
  assert.equal(wearOutfitSlot({ id: 'x', lowerCategory: 'Gloves' }), 'hands');
  assert.equal(wearOutfitSlot({ id: 'x', lowerCategory: 'Arm Warmers' }), 'hands');
  assert.equal(wearOutfitSlot({ id: 'x', lowerCategory: 'Leg Warmers' }), 'legs');
  assert.equal(wearOutfitSlot({ id: 'x', lowerCategory: 'Backpacks' }), 'carry');
});

test('wear calendar remains owner-scoped and delegates every edit to the universal modal', () => {
  const source = readFileSync(new URL('../src/routes/(app)/wear-calendar/+page.svelte', import.meta.url), 'utf8');

  assert.match(source, /collection\(db, 'users', currentUser\.uid, 'items'\)/);
  assert.match(source, /buildWearDayOutfits/);
  assert.match(source, /class="mini-outfits"/);
  assert.match(source, /itemEditHref/);
  assert.match(source, /\.outfit-slot\.upper,\.outfit-slot\.lower\{min-height:82px\}/);
  assert.match(source, /\.outfit-slot\.carry \.outfit-piece\{width:54px;height:54px\}/);
  assert.match(source, /\.outfit-names\{position:relative;z-index:2;/);
  assert.doesNotMatch(source, /\.outfit-slot\+\.outfit-slot\{margin-top:-/);
  assert.doesNotMatch(source, /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/);
});
