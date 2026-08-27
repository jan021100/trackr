import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  itemEditHref,
  safeInternalReturnPath,
  withImageSavedNotice
} from '../src/lib/utils/appNavigation.ts';

test('item editor links remember safe internal source pages', () => {
  assert.equal(
    itemEditHref('shirt/one', '/wear-calendar?date=2026-08-18'),
    '/wear-calendar?date=2026-08-18&editItem=shirt%2Fone'
  );
  assert.equal(safeInternalReturnPath('/analytics?range=90#items'), '/analytics?range=90#items');
});

test('unsafe or recursive editor return targets fall back to Clothing', () => {
  assert.equal(safeInternalReturnPath('https://example.com'), '/clothing');
  assert.equal(safeInternalReturnPath('//example.com/path'), '/clothing');
  assert.equal(safeInternalReturnPath('/clothing/edit/item-two'), '/clothing');
  assert.equal(safeInternalReturnPath('/safe\\redirect'), '/clothing');
});

test('image confirmation is added without losing calendar state', () => {
  assert.equal(
    withImageSavedNotice('/wear-calendar?date=2026-08-18', 'webp'),
    '/wear-calendar?date=2026-08-18&imageSaved=webp'
  );
  assert.equal(withImageSavedNotice('/analytics', null), '/analytics');
});

test('calendar uses the universal modal editor without leaving the selected day', () => {
  const calendar = readFileSync(new URL('../src/routes/(app)/wear-calendar/+page.svelte', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/routes/(app)/+layout.svelte', import.meta.url), 'utf8');
  assert.match(calendar, /itemEditHref\(itemId, `\/wear-calendar\?date=\$\{selectedDate\}`\)/);
  assert.match(calendar, /goto\(editItemPath\(entry\.item\.id\)\)/);
  assert.doesNotMatch(calendar, /<ItemEditor|updateDoc|deleteDoc/);
  assert.match(layout, /<UniversalItemEditorModal/);
});
