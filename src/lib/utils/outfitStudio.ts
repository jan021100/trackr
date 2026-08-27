import type { Outfit } from './outfitGenerator';

export const STUDIO_SLOTS = ['outerwear', 'layer', 'top', 'bottom', 'shoes', 'accessory'] as const;
export type StudioSlot = (typeof STUDIO_SLOTS)[number];

export type StudioItem = {
  id?: string;
  product?: string;
  name?: string;
  brand?: string;
  mainCategory?: string;
  lowerCategory?: string;
  status?: string;
  outfitEligible?: boolean;
  color?: string;
  imageUrl?: string;
  imageBase64?: string;
};

export type StudioLayout<T extends StudioItem = StudioItem> = Record<StudioSlot, T | null>;

export type StudioCanvasPlacement = {
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type StudioCanvasLayout = Record<StudioSlot, StudioCanvasPlacement | null>;

export type SerializedStudioCanvas = Partial<Record<StudioSlot, (StudioCanvasPlacement & { itemId: string }) | null>>;

const DEFAULT_CANVAS_PLACEMENTS: Record<StudioSlot, StudioCanvasPlacement> = {
  outerwear: { x: 42, y: 31, scale: 1, z: 2 },
  layer: { x: 47, y: 31, scale: .94, z: 3 },
  top: { x: 52, y: 30, scale: 1, z: 4 },
  bottom: { x: 50, y: 59, scale: 1, z: 5 },
  shoes: { x: 51, y: 84, scale: .9, z: 6 },
  accessory: { x: 73, y: 48, scale: .82, z: 7 }
};

export function emptyStudioLayout<T extends StudioItem>(): StudioLayout<T> {
  return { outerwear: null, layer: null, top: null, bottom: null, shoes: null, accessory: null };
}

export function emptyStudioCanvas(): StudioCanvasLayout {
  return { outerwear: null, layer: null, top: null, bottom: null, shoes: null, accessory: null };
}

export function defaultStudioCanvasPlacement(slot: StudioSlot): StudioCanvasPlacement {
  return { ...DEFAULT_CANVAS_PLACEMENTS[slot] };
}

function finiteOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampStudioCanvasPlacement(
  placement: Partial<StudioCanvasPlacement>,
  fallback: StudioCanvasPlacement
): StudioCanvasPlacement {
  return {
    x: Math.min(96, Math.max(4, finiteOr(placement.x, fallback.x))),
    y: Math.min(96, Math.max(4, finiteOr(placement.y, fallback.y))),
    scale: Math.min(1.45, Math.max(.55, finiteOr(placement.scale, fallback.scale))),
    z: Math.min(99, Math.max(1, Math.round(finiteOr(placement.z, fallback.z))))
  };
}

export function studioCanvasFromLayout(
  layout: StudioLayout,
  saved?: SerializedStudioCanvas | null
): StudioCanvasLayout {
  const canvas = emptyStudioCanvas();
  for (const slot of STUDIO_SLOTS) {
    const itemId = layout[slot]?.id;
    if (!itemId) continue;
    const fallback = defaultStudioCanvasPlacement(slot);
    const candidate = saved?.[slot];
    canvas[slot] = candidate?.itemId === itemId
      ? clampStudioCanvasPlacement(candidate, fallback)
      : fallback;
  }
  return canvas;
}

export function serializeStudioCanvas(layout: StudioLayout, canvas: StudioCanvasLayout): SerializedStudioCanvas {
  return Object.fromEntries(STUDIO_SLOTS.map((slot) => {
    const itemId = layout[slot]?.id;
    const placement = canvas[slot];
    return [slot, itemId && placement ? { itemId, ...placement } : null];
  })) as SerializedStudioCanvas;
}

export function isStudioEligible(item: StudioItem): boolean {
  const status = String(item.status ?? '').trim().toLowerCase();
  return !['sold', 'retired', 'archived'].includes(status) && item.outfitEligible !== false;
}

export function preferredStudioSlot(item: StudioItem): StudioSlot {
  const lower = String(item.lowerCategory ?? '').toLowerCase();
  if (/(jacket|vest|coat)/.test(lower)) return 'outerwear';
  if (/(sweater|hoodie|thick shirt)/.test(lower)) return 'layer';
  if (/(pants|shorts|chinos|joggers|leggings|jeans)/.test(lower)) return 'bottom';
  if (/(shoe|sneaker|slide)/.test(lower)) return 'shoes';
  if (/(glove|headwear|sock|bag|backpack|glass|warmer|other)/.test(lower)) return 'accessory';
  return 'top';
}

export function placeStudioItem<T extends StudioItem>(
  layout: StudioLayout<T>,
  item: T,
  target: StudioSlot = preferredStudioSlot(item)
): StudioLayout<T> {
  const next = { ...layout };
  for (const slot of STUDIO_SLOTS) {
    if (item.id && next[slot]?.id === item.id) next[slot] = null;
  }
  next[target] = item;
  return next;
}

export function removeStudioItem<T extends StudioItem>(layout: StudioLayout<T>, slot: StudioSlot): StudioLayout<T> {
  return { ...layout, [slot]: null };
}

export function studioLayoutFromOutfit<T extends StudioItem>(outfit: Outfit): StudioLayout<T> {
  return {
    outerwear: (outfit.jacket as T | null | undefined) ?? null,
    layer: (outfit.mid as T | null | undefined) ?? null,
    top: (outfit.base as T | null | undefined) ?? null,
    bottom: (outfit.pants as T | null | undefined) ?? null,
    shoes: (outfit.shoes as T | null | undefined) ?? null,
    accessory: (outfit.accessory as T | null | undefined) ?? null
  };
}

export function studioLayoutFromItemIds<T extends StudioItem>(items: readonly T[], itemIds: readonly string[]): StudioLayout<T> {
  let layout = emptyStudioLayout<T>();
  for (const id of itemIds) {
    const item = items.find((entry) => entry.id === id);
    if (!item) continue;
    const preferred = preferredStudioSlot(item);
    const target = layout[preferred] === null ? preferred : STUDIO_SLOTS.find((slot) => layout[slot] === null);
    if (target) layout = placeStudioItem(layout, item, target);
  }
  return layout;
}

export function studioItemIds(layout: StudioLayout): string[] {
  return STUDIO_SLOTS.map((slot) => layout[slot]?.id).filter((id): id is string => Boolean(id));
}

export function searchStudioItems<T extends StudioItem>(items: readonly T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (!isStudioEligible(item)) return false;
    const text = [item.product, item.name, item.brand, item.mainCategory, item.lowerCategory, item.color]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
