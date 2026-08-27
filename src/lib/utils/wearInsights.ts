export type WearInsightItem = {
  id: string;
  name?: string;
  product?: string;
  brand?: string;
  color?: string;
  mainCategory?: string;
  lowerCategory?: string;
  status?: string;
  condition?: string;
  season?: string;
  size?: string;
  style?: string;
  pattern?: string;
  labels?: unknown[];
  price?: number | string;
  worn?: number | string;
  wearLog?: unknown[];
  lastWorn?: unknown;
  purchaseDate?: unknown;
  imageUrl?: string;
  imageBase64?: string;
};

export type WearDayEntry<T extends WearInsightItem = WearInsightItem> = {
  item: T;
  count: number;
};

export type MonthlyRecap<T extends WearInsightItem = WearInsightItem> = {
  monthKey: string;
  activeDays: number;
  totalWears: number;
  uniquePieces: number;
  topPieces: Array<WearDayEntry<T>>;
  categorySplit: Array<{ name: string; wears: number; share: number }>;
  neglected: T[];
  costPerWearAtStart: number | null;
  costPerWearAtEnd: number | null;
  costPerWearChange: number | null;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function validDateKey(value: string): string | null {
  if (!DATE_KEY.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

export function normalizeWearDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const direct = validDateKey(value.slice(0, 10));
    if (direct) return direct;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
  }
  return null;
}

function searchableText(item: WearInsightItem): string {
  const fields = [
    item.name,
    item.product,
    item.brand,
    item.color,
    item.mainCategory,
    item.lowerCategory,
    item.status,
    item.condition,
    item.season,
    item.size,
    item.style,
    item.pattern,
    ...(Array.isArray(item.labels) ? item.labels : [])
  ];
  return fields.filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
}

export function searchWardrobeItems<T extends WearInsightItem>(items: readonly T[], query: string): T[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...items];
  return items.filter((item) => {
    const haystack = searchableText(item);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function buildWearDayIndex<T extends WearInsightItem>(items: readonly T[]): Record<string, WearDayEntry<T>[]> {
  const dayMaps = new Map<string, Map<string, WearDayEntry<T>>>();
  for (const item of items) {
    if (!Array.isArray(item.wearLog)) continue;
    for (const rawDate of item.wearLog) {
      const date = normalizeWearDate(rawDate);
      if (!date) continue;
      const itemMap = dayMaps.get(date) ?? new Map<string, WearDayEntry<T>>();
      const existing = itemMap.get(item.id);
      itemMap.set(item.id, existing ? { ...existing, count: existing.count + 1 } : { item, count: 1 });
      dayMaps.set(date, itemMap);
    }
  }

  return Object.fromEntries(
    [...dayMaps.entries()].map(([date, itemMap]) => [
      date,
      [...itemMap.values()].sort((a, b) => b.count - a.count)
    ])
  );
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActive(item: WearInsightItem): boolean {
  return !['sold', 'archived', 'retired'].includes(String(item.status ?? '').trim().toLocaleLowerCase());
}

export function buildMonthlyRecap<T extends WearInsightItem>(items: readonly T[], monthKey: string): MonthlyRecap<T> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('monthKey must use YYYY-MM');
  const monthStart = `${monthKey}-01`;
  const [year, month] = monthKey.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const activeItems = items.filter(isActive);
  const activeDays = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const pieceCounts: Array<WearDayEntry<T>> = [];
  let totalWears = 0;
  let valueAtStart = 0;
  let valueAtEnd = 0;
  let wearsAtStart = 0;
  let wearsAtEnd = 0;

  for (const item of activeItems) {
    const dates = (Array.isArray(item.wearLog) ? item.wearLog : [])
      .map(normalizeWearDate)
      .filter((date): date is string => Boolean(date));
    const monthDates = dates.filter((date) => date.startsWith(`${monthKey}-`));
    if (monthDates.length) pieceCounts.push({ item, count: monthDates.length });
    totalWears += monthDates.length;
    monthDates.forEach((date) => activeDays.add(date));
    const category = item.mainCategory?.trim() || 'Uncategorized';
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + monthDates.length);

    const price = numberValue(item.price);
    const purchaseDate = normalizeWearDate(item.purchaseDate);
    if (price > 0 && (!purchaseDate || purchaseDate < monthStart)) valueAtStart += price;
    if (price > 0 && (!purchaseDate || purchaseDate <= monthEnd)) valueAtEnd += price;
    wearsAtStart += dates.filter((date) => date < monthStart).length;
    wearsAtEnd += dates.filter((date) => date <= monthEnd).length;
  }

  const costPerWearAtStart = valueAtStart > 0 && wearsAtStart > 0 ? valueAtStart / wearsAtStart : null;
  const costPerWearAtEnd = valueAtEnd > 0 && wearsAtEnd > 0 ? valueAtEnd / wearsAtEnd : null;
  const costPerWearChange = costPerWearAtStart !== null && costPerWearAtEnd !== null
    ? costPerWearAtEnd - costPerWearAtStart
    : null;

  return {
    monthKey,
    activeDays: activeDays.size,
    totalWears,
    uniquePieces: pieceCounts.length,
    topPieces: pieceCounts.sort((a, b) => b.count - a.count).slice(0, 5),
    categorySplit: [...categoryCounts.entries()]
      .filter(([, wears]) => wears > 0)
      .map(([name, wears]) => ({ name, wears, share: totalWears ? Math.round((wears / totalWears) * 100) : 0 }))
      .sort((a, b) => b.wears - a.wears),
    neglected: activeItems
      .filter((item) => !pieceCounts.some((entry) => entry.item.id === item.id))
      .sort((a, b) => (normalizeWearDate(a.lastWorn) ?? '').localeCompare(normalizeWearDate(b.lastWorn) ?? ''))
      .slice(0, 5),
    costPerWearAtStart,
    costPerWearAtEnd,
    costPerWearChange
  };
}
