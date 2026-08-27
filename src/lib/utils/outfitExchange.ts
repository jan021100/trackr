import type {
  StudioItem,
  StudioLayout,
  StudioSlot
} from './outfitStudio';

const EXCHANGE_SLOTS: readonly StudioSlot[] = ['outerwear', 'layer', 'top', 'bottom', 'shoes', 'accessory'];

function emptyExchangeLayout<T extends StudioItem>(): StudioLayout<T> {
  return { outerwear: null, layer: null, top: null, bottom: null, shoes: null, accessory: null };
}

function exchangeEligible(item: StudioItem): boolean {
  const status = String(item.status ?? '').trim().toLowerCase();
  return !['sold', 'retired', 'archived'].includes(status) && item.outfitEligible !== false;
}

export const TRACKR_OUTFIT_FORMAT = 'trackr-outfit';
export const TRACKR_OUTFIT_VERSION = 1;

export type WardrobeExchangeItem = StudioItem & {
  id: string;
  brand?: string;
  product?: string;
  name?: string;
  color?: string;
  mainCategory?: string;
  lowerCategory?: string;
  imageBase64?: string;
  imageUrl?: string;
};

export type OutfitCodeResult<T extends StudioItem> = {
  ok: boolean;
  name: string;
  layout: StudioLayout<T>;
  errors: string[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeImage(value: unknown): string {
  const image = String(value ?? '').trim();
  return /^(?:data:image\/(?:png|jpeg|jpg|webp);base64,|https?:\/\/)/i.test(image) ? image : '';
}

function displayName(item: WardrobeExchangeItem): string {
  return String(item.product || item.name || 'Unnamed item');
}

export function exportTrackrOutfitCode(layout: StudioLayout, name = ''): string {
  const slots = Object.fromEntries(EXCHANGE_SLOTS
    .filter((slot) => Boolean(layout[slot]?.id))
    .map((slot) => [slot, layout[slot]!.id]));
  return `TRACKR_OUTFIT_V1\n${JSON.stringify({
    format: TRACKR_OUTFIT_FORMAT,
    version: TRACKR_OUTFIT_VERSION,
    name: name.trim().slice(0, 80) || 'ChatGPT outfit',
    slots
  }, null, 2)}`;
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('No JSON object was found.');
  return JSON.parse(raw.slice(first, last + 1));
}

export function parseTrackrOutfitCode<T extends StudioItem>(raw: string, wardrobe: readonly T[]): OutfitCodeResult<T> {
  const empty = emptyExchangeLayout<T>();
  if (!raw.trim()) return { ok: false, name: '', layout: empty, errors: ['Paste an outfit code first.'] };
  if (raw.length > 50_000) return { ok: false, name: '', layout: empty, errors: ['This outfit code is unexpectedly large and was not opened.'] };

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return { ok: false, name: '', layout: empty, errors: ['The outfit code is not valid JSON. Ask ChatGPT to return TRACKR_OUTFIT_V1 exactly.'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, name: '', layout: empty, errors: ['The outfit code must contain one JSON object.'] };
  }

  const data = parsed as Record<string, unknown>;
  const errors: string[] = [];
  if (data.format !== TRACKR_OUTFIT_FORMAT || Number(data.version) !== TRACKR_OUTFIT_VERSION) {
    errors.push('Unsupported outfit format. Expected trackr-outfit version 1.');
  }
  if (!data.slots || typeof data.slots !== 'object' || Array.isArray(data.slots)) {
    errors.push('The code is missing its slots object.');
  }
  if (errors.length) return { ok: false, name: '', layout: empty, errors };

  const slots = data.slots as Record<string, unknown>;
  const unknownSlots = Object.keys(slots).filter((slot) => !EXCHANGE_SLOTS.includes(slot as StudioSlot));
  if (unknownSlots.length) errors.push(`Unknown slot${unknownSlots.length === 1 ? '' : 's'}: ${unknownSlots.join(', ')}.`);

  const byId = new Map(wardrobe.map((item) => [String(item.id), item]));
  const seen = new Set<string>();
  const layout = emptyExchangeLayout<T>();
  for (const slot of EXCHANGE_SLOTS) {
    const rawId = slots[slot];
    if (rawId === undefined || rawId === null || rawId === '') continue;
    if (typeof rawId !== 'string') {
      errors.push(`${slot} must contain one item ID.`);
      continue;
    }
    const id = rawId.trim();
    const item = byId.get(id);
    if (!item) {
      errors.push(`Item ID “${id}” was not found in this wardrobe.`);
      continue;
    }
    if (!exchangeEligible(item)) {
      errors.push(`Item ID “${id}” is not currently available for outfits.`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`Item ID “${id}” is used more than once.`);
      continue;
    }
    seen.add(id);
    layout[slot] = item;
  }
  if (seen.size < 2) errors.push('An imported outfit needs at least two valid pieces.');

  return {
    ok: errors.length === 0,
    name: String(data.name ?? 'ChatGPT outfit').trim().slice(0, 80) || 'ChatGPT outfit',
    layout: errors.length ? empty : layout,
    errors
  };
}

export function buildWardrobeCatalogHtml(items: readonly WardrobeExchangeItem[], generatedAt = new Date()): string {
  const manifest = items.map((item) => ({
    itemId: item.id,
    name: displayName(item),
    brand: item.brand || '',
    color: item.color || '',
    mainCategory: item.mainCategory || '',
    subcategory: item.lowerCategory || '',
    status: item.status || '',
    outfitEligible: item.outfitEligible !== false
  }));
  const cards = items.map((item) => {
    const image = safeImage(item.imageBase64 || item.imageUrl);
    return `<article class="item">
      <div class="image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(displayName(item))}">` : '<span>No image</span>'}</div>
      <div class="copy"><h2>${escapeHtml(displayName(item))}</h2><p>${escapeHtml(item.brand || 'Unknown brand')} · ${escapeHtml(item.color || 'Unknown color')}</p>
      <dl><div><dt>Item ID</dt><dd>${escapeHtml(item.id)}</dd></div><div><dt>Category</dt><dd>${escapeHtml(item.mainCategory || '—')} / ${escapeHtml(item.lowerCategory || '—')}</dd></div><div><dt>Availability</dt><dd>${escapeHtml(item.outfitEligible === false ? 'Not outfit eligible' : item.status || 'Available')}</dd></div></dl></div>
    </article>`;
  }).join('');
  const example = exportTrackrOutfitCode(emptyExchangeLayout(), 'Suggested outfit').replace('"slots": {}', '"slots": {\n    "top": "EXACT_ITEM_ID",\n    "bottom": "EXACT_ITEM_ID",\n    "shoes": "EXACT_ITEM_ID"\n  }');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trackr wardrobe for ChatGPT</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:28px;background:#f5f5f2;color:#171717;font-family:Arial,sans-serif}header{padding:28px;border-radius:22px;background:linear-gradient(120deg,#ece8ff,#fff 55%,#fff0e5)}h1{margin:0;font-size:34px}header p{max-width:850px;line-height:1.5}.rules{margin:18px 0;padding:18px;border:2px solid #171717;border-radius:16px;background:#fff}.rules h2{margin-top:0}.rules li{margin:.35rem 0;line-height:1.4}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.item{min-height:190px;padding:12px;display:grid;grid-template-columns:135px 1fr;gap:12px;break-inside:avoid;border:1px solid #ddd;border-radius:15px;background:#fff}.image{height:165px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#f0f0ed}.image img{width:100%;height:100%;object-fit:contain}.image span{color:#999}.copy h2{margin:5px 0;font-size:17px}.copy p{margin:0;color:#666;font-size:13px}dl{margin-top:18px}dl div{margin-top:8px}dt{color:#888;font-size:9px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase}dd{margin:2px 0;font-size:11px;overflow-wrap:anywhere}.manifest{margin-top:20px;padding:20px;break-before:page;border-radius:16px;background:#fff}.manifest pre{padding:16px;overflow-wrap:anywhere;white-space:pre-wrap;border-radius:10px;background:#f2f2ef;font-size:9px;line-height:1.4}@media print{body{padding:0;background:#fff}header,.rules,.manifest{break-inside:avoid}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.item{min-height:165px}.image{height:140px}}
  </style></head><body>
  <header><p>TRACKR AI WARDROBE · ${escapeHtml(generatedAt.toLocaleDateString())}</p><h1>Visual wardrobe catalogue</h1><p>${items.length} wardrobe pieces with stable Trackr IDs. Inspect both the images and metadata before suggesting an outfit.</p></header>
  <section class="rules"><h2>Instructions for ChatGPT</h2><ol><li>Use only exact item IDs contained in this document. Never invent or alter an ID.</li><li>Analyze the garment images together with name, brand, color and category.</li><li>Do not choose sold, retired, archived, or “Not outfit eligible” pieces.</li><li>Choose at most one item for each Trackr slot: outerwear, layer, top, bottom, shoes, accessory.</li><li>Return the result as one plain code block in the exact TRACKR_OUTFIT_V1 JSON format shown in the appendix. Do not put IDs in any other fields.</li></ol></section>
  <main class="grid">${cards}</main>
  <section class="manifest"><h2>Machine-readable wardrobe manifest</h2><p>Use this metadata to copy IDs exactly. The images above are the visual source of truth.</p><pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre><h2>Required response format</h2><pre>${escapeHtml(example)}</pre></section>
  <script>addEventListener('load',async()=>{const images=[...document.images];await Promise.race([Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve}))),new Promise(resolve=>setTimeout(resolve,8000))]);setTimeout(()=>print(),400)});<\/script>
  </body></html>`;
}
