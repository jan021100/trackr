import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWardrobeCatalogHtml,
  exportTrackrOutfitCode,
  parseTrackrOutfitCode
} from '../src/lib/utils/outfitExchange.ts';
import { emptyStudioLayout } from '../src/lib/utils/outfitStudio.ts';

const items = [
  { id: 'top-1', product: 'Oxford <Shirt>', brand: 'Example', color: 'Blue', mainCategory: 'Casual', lowerCategory: 'Thin Shirts', status: 'active', imageBase64: 'data:image/webp;base64,AAAA' },
  { id: 'pants-1', product: 'Chinos', brand: 'Example', color: 'Navy', mainCategory: 'Casual', lowerCategory: 'Chinos', status: 'active', imageUrl: 'https://example.com/pants.jpg' },
  { id: 'sold-1', product: 'Old Shoes', mainCategory: 'Casual', lowerCategory: 'Shoes', status: 'sold' }
];

test('visual catalogue contains every requested identity field, pictures, manifest and AI instructions', () => {
  const html = buildWardrobeCatalogHtml(items, new Date('2026-08-21T00:00:00Z'));
  assert.match(html, /data:image\/webp;base64,AAAA/);
  assert.match(html, /https:\/\/example\.com\/pants\.jpg/);
  for (const value of ['top-1', 'Oxford &lt;Shirt&gt;', 'Example', 'Blue', 'Casual', 'Thin Shirts']) assert.match(html, new RegExp(value));
  assert.match(html, /TRACKR_OUTFIT_V1/);
  assert.match(html, /Machine-readable wardrobe manifest/);
  assert.doesNotMatch(html, /<h2>Oxford <Shirt><\/h2>/, 'item text must be escaped');
});

test('outfit codes round-trip exact IDs and slots', () => {
  const layout = emptyStudioLayout();
  layout.top = items[0];
  layout.bottom = items[1];
  const code = exportTrackrOutfitCode(layout, 'Blue day');
  const imported = parseTrackrOutfitCode(`Here you go:\n\`\`\`json\n${code}\n\`\`\``, items);
  assert.equal(imported.ok, true);
  assert.equal(imported.name, 'Blue day');
  assert.equal(imported.layout.top.id, 'top-1');
  assert.equal(imported.layout.bottom.id, 'pants-1');
});

test('import rejects invented, duplicated, unavailable and malformed item references atomically', () => {
  const variants = [
    { format: 'trackr-outfit', version: 1, slots: { top: 'invented', bottom: 'pants-1' } },
    { format: 'trackr-outfit', version: 1, slots: { top: 'top-1', bottom: 'top-1' } },
    { format: 'trackr-outfit', version: 1, slots: { top: 'top-1', shoes: 'sold-1' } },
    { format: 'trackr-outfit', version: 2, slots: { top: 'top-1', bottom: 'pants-1' } }
  ];
  for (const value of variants) {
    const imported = parseTrackrOutfitCode(JSON.stringify(value), items);
    assert.equal(imported.ok, false);
    assert.ok(imported.errors.length);
    assert.ok(Object.values(imported.layout).every((item) => item === null), 'invalid imports must never partially load');
  }
  assert.equal(parseTrackrOutfitCode('x'.repeat(50_001), items).ok, false);
});
