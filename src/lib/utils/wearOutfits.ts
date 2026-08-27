import type { WearDayEntry, WearInsightItem } from './wearInsights';

export const WEAR_OUTFIT_SLOTS = ['head', 'upper', 'hands', 'lower', 'legs', 'socks', 'shoes', 'carry'] as const;
export type WearOutfitSlot = (typeof WEAR_OUTFIT_SLOTS)[number];
export type WearOutfitKind = 'casual' | 'sports';

export const WEAR_OUTFIT_SLOT_LABELS: Record<WearOutfitSlot, string> = {
  head: 'Head',
  upper: 'Upper body',
  hands: 'Hands',
  lower: 'Lower body',
  legs: 'Legs',
  socks: 'Socks',
  shoes: 'Shoes',
  carry: 'Carry'
};

export type WearOutfit<T extends WearInsightItem = WearInsightItem> = {
  kind: WearOutfitKind;
  label: string;
  entries: WearDayEntry<T>[];
  slots: Record<WearOutfitSlot, WearDayEntry<T>[]>;
  totalWears: number;
};

export type WearDayOutfits<T extends WearInsightItem = WearInsightItem> = {
  casual: WearOutfit<T> | null;
  sports: WearOutfit<T> | null;
};

export function wearOutfitKind(item: WearInsightItem): WearOutfitKind {
  return String(item.mainCategory ?? '').trim().toLowerCase() === 'casual' ? 'casual' : 'sports';
}

export function wearOutfitSlot(item: WearInsightItem): WearOutfitSlot {
  const category = String(item.lowerCategory ?? '').trim().toLowerCase();
  if (/(headwear|hat|cap|helmet|beanie|glass)/.test(category)) return 'head';
  if (/(shoe|sneaker|slide|boot|trainer)/.test(category)) return 'shoes';
  if (/sock/.test(category)) return 'socks';
  if (/arm warmer/.test(category)) return 'hands';
  if (/(leg warmer|knee warmer)/.test(category)) return 'legs';
  if (/(pants|shorts|chinos|joggers|leggings|jeans|bib)/.test(category)) return 'lower';
  if (/glove/.test(category)) return 'hands';
  if (/(bag|backpack)/.test(category)) return 'carry';
  return 'upper';
}

function layerRank(item: WearInsightItem): number {
  const category = String(item.lowerCategory ?? '').trim().toLowerCase();
  if (/(base layer|undershirt)/.test(category)) return 0;
  if (/(t-shirt|shirt|polo|jersey|top)/.test(category)) return 1;
  if (/(sweater|hoodie|mid layer)/.test(category)) return 2;
  if (/vest/.test(category)) return 3;
  if (/(jacket|coat|shell)/.test(category)) return 4;
  return 2;
}

function slotRank(entry: WearDayEntry): number {
  if (wearOutfitSlot(entry.item) === 'upper') return layerRank(entry.item);
  const category = String(entry.item.lowerCategory ?? '').trim().toLowerCase();
  if (/legging/.test(category)) return 0;
  if (/short/.test(category)) return 1;
  return 2;
}

function buildOutfit<T extends WearInsightItem>(kind: WearOutfitKind, entries: WearDayEntry<T>[]): WearOutfit<T> | null {
  if (!entries.length) return null;
  const slots: Record<WearOutfitSlot, WearDayEntry<T>[]> = {
    head: [],
    upper: [],
    hands: [],
    lower: [],
    legs: [],
    socks: [],
    shoes: [],
    carry: []
  };
  for (const entry of entries) slots[wearOutfitSlot(entry.item)].push(entry);
  for (const slot of WEAR_OUTFIT_SLOTS) {
    slots[slot] = [...slots[slot]].sort((a, b) => slotRank(a) - slotRank(b));
  }
  return {
    kind,
    label: kind === 'casual' ? 'Casual' : 'Sports',
    entries: [...entries],
    slots,
    totalWears: entries.reduce((sum, entry) => sum + entry.count, 0)
  };
}

export function buildWearDayOutfits<T extends WearInsightItem>(entries: readonly WearDayEntry<T>[]): WearDayOutfits<T> {
  const casual = entries.filter((entry) => wearOutfitKind(entry.item) === 'casual');
  const sports = entries.filter((entry) => wearOutfitKind(entry.item) === 'sports');
  return {
    casual: buildOutfit('casual', casual),
    sports: buildOutfit('sports', sports)
  };
}
