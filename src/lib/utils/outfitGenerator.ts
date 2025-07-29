interface ClothingItem {
  id: string;
  product: string;
  brand: string;
  imageUrl?: string;
  color?: string;
  mainCategory?: string;
  lowerCategory?: string;
  season?: string;
  status?: string;
}

interface Outfit {
  top: ClothingItem | null;
  bottom: ClothingItem | null;
  shoes: ClothingItem | null;
}

interface LayeredOutfit extends Outfit {
  layer?: ClothingItem | null;
  jacket?: ClothingItem | null;
}

// Category mappings (cleaned from your full list)
const forbiddenItems = ['Slides', 'Joggers'];

const summerCategories = {
  tops: ['T-Shirts', 'Polo Shirts', 'SS Shirts', 'SS Jerseys'],
  bottoms: ['Shorts'],
  shoes: ['Sneakers', 'Shoes', 'Running Shoes']
};

const springFallCategories = {
  baseTops: ['T-Shirts', 'Base Layers'],
  outerTops: ['Sweaters', 'Hoodies', 'LS Shirts', 'LS Jerseys', 'Shirts'],
  bottoms: ['Pants', 'Chinos', 'Jeans', 'Leggings'],
  shoes: ['Sneakers', 'Shoes', 'Running Shoes', 'Boots']
};

const winterCategories = {
  jackets: ['Jackets', 'Vests']
};

const summerSeasons = ['1/3', 'X/3', ''];
const springFallSeasons = ['2/3', 'X/3', ''];
const winterSeasons = ['3/3', 'X/3', ''];

const colorPalettes = [
  ['black', 'white', 'beige'],
  ['navy', 'white', 'gray'],
  ['khaki', 'olive', 'white'],
  ['blue', 'white', 'gray'],
  ['brown', 'white', 'cream']
];

function getCompatiblePalette(color?: string): string[] {
  if (!color) return [];
  for (const palette of colorPalettes) {
    if (palette.includes(color)) return palette;
  }
  return [];
}

function shuffle<T>(array: T[]): T[] {
  return array.slice().sort(() => Math.random() - 0.5);
}

function pickWithPalette<T extends ClothingItem>(items: T[], palette: string[]): T | null {
  if (palette.length === 0) return items[0] ?? null;
  return items.find((item) => palette.includes(item.color ?? '')) ?? items[0] ?? null;
}

function isAllowed(item: ClothingItem): boolean {
  return !forbiddenItems.includes(item.lowerCategory ?? '');
}

export function generateSummerOutfit(items: ClothingItem[]): Outfit {
  const pool = items.filter(
    (item) =>
      item.mainCategory === 'Casual' &&
      (!item.season || summerSeasons.includes(item.season)) &&
      (item.status ?? 'active') === 'active' &&
      isAllowed(item)
  );

  const tops = shuffle(pool.filter((i) => summerCategories.tops.includes(i.lowerCategory ?? '')));
  const bottoms = shuffle(pool.filter((i) => summerCategories.bottoms.includes(i.lowerCategory ?? '')));
  const shoes = shuffle(pool.filter((i) => summerCategories.shoes.includes(i.lowerCategory ?? '')));

  const top = tops[0] ?? null;
  const palette = getCompatiblePalette(top?.color);
  const bottom = pickWithPalette(bottoms, palette);
  const shoe = pickWithPalette(shoes, palette);

  return { top, bottom, shoes: shoe };
}

export function generateSpringOutfit(items: ClothingItem[]): LayeredOutfit {
  const pool = items.filter(
    (item) =>
      item.mainCategory === 'Casual' &&
      (!item.season || springFallSeasons.includes(item.season)) &&
      (item.status ?? 'active') === 'active' &&
      isAllowed(item)
  );

  const baseTops = shuffle(pool.filter((i) => springFallCategories.baseTops.includes(i.lowerCategory ?? '')));
  const outerTops = shuffle(pool.filter((i) => springFallCategories.outerTops.includes(i.lowerCategory ?? '')));
  const bottoms = shuffle(pool.filter((i) => springFallCategories.bottoms.includes(i.lowerCategory ?? '')));
  const shoes = shuffle(pool.filter((i) => springFallCategories.shoes.includes(i.lowerCategory ?? '')));

  const top = baseTops[0] ?? null;
  const layer = outerTops[0] ?? null;
  const palette = getCompatiblePalette(top?.color);

  const bottom = pickWithPalette(bottoms, palette);
  const shoe = pickWithPalette(shoes, palette);

  return { top, layer, bottom, shoes: shoe };
}

export function generateWinterOutfit(items: ClothingItem[]): LayeredOutfit {
  const pool = items.filter(
    (item) =>
      item.mainCategory === 'Casual' &&
      (!item.season || winterSeasons.includes(item.season)) &&
      (item.status ?? 'active') === 'active' &&
      isAllowed(item)
  );

  const baseTops = shuffle(pool.filter((i) => springFallCategories.baseTops.includes(i.lowerCategory ?? '')));
  const outerTops = shuffle(pool.filter((i) => springFallCategories.outerTops.includes(i.lowerCategory ?? '')));
  const jackets = shuffle(pool.filter((i) => winterCategories.jackets.includes(i.lowerCategory ?? '')));
  const bottoms = shuffle(pool.filter((i) => springFallCategories.bottoms.includes(i.lowerCategory ?? '')));
  const shoes = shuffle(pool.filter((i) => springFallCategories.shoes.includes(i.lowerCategory ?? '')));

  const top = baseTops[0] ?? null;
  const layer = outerTops[0] ?? null;
  const jacket = jackets[0] ?? null;
  const palette = getCompatiblePalette(top?.color);

  const bottom = pickWithPalette(bottoms, palette);
  const shoe = pickWithPalette(shoes, palette);

  return { top, layer, jacket, bottom, shoes: shoe };
}
