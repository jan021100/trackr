export type Fit = 'slim' | 'regular' | 'relaxed' | 'oversized' | string;
export type Pattern = 'plain' | 'graphic' | 'pattern' | string;
export type Weight = 'thin' | 'mid' | 'thick' | string;
export type Style = 'casual' | 'formal' | 'sporty' | string;

export type Item = {
  id?: string;
  product?: string;
  name?: string;
  brand?: string;
  imageUrl?: string;
  imageBase64?: string;
  color?: string;
  mainCategory?: string;
  lowerCategory?: string;
  season?: string;
  status?: string;
  outfitEligible?: boolean;
  fit?: Fit;
  pattern?: Pattern;
  weight?: Weight;
  style?: Style;
  worn?: number;
  lastWorn?: unknown;
};

export type Outfit = {
  base?: Item | null;
  mid?: Item | null;
  jacket?: Item | null;
  pants?: Item | null;
  shoes?: Item | null;
  accessory?: Item | null;
};

export type SeasonMode = 'summer' | 'warmSpringFall' | 'springFall' | 'winter';

const BASE = new Set(['T-Shirts', 'Thin Shirts', 'Polo Shirts', 'Base Layers', 'LS Shirts', 'SS Shirts', 'SS Jerseys', 'LS Jerseys']);
const MID = new Set(['Sweaters', 'Hoodies', 'Thick Shirts']);
const OUTER = new Set(['Jackets', 'Vests']);
const LONG_BOTTOMS = new Set(['Pants', 'Chinos', 'Jeans', 'Leggings']);
const SHOES = new Set(['Sneakers', 'Shoes', 'Running Shoes', 'Boots']);
const ACCESSORIES = new Set(['Gloves', 'Headwear', 'Socks', 'Bags', 'Backpacks', 'Glasses', 'Others', 'Leg Warmers']);

function eligible(item: Item): boolean {
  const status = String(item.status ?? 'active').trim().toLowerCase();
  return String(item.mainCategory ?? '').trim().toLowerCase() === 'casual'
    && !['sold', 'retired', 'archived', 'lent out', 'for sale'].includes(status)
    && item.outfitEligible !== false
    && !['Slides', 'Joggers'].includes(String(item.lowerCategory ?? ''));
}

function seasonMatches(item: Item, expected: '1/3' | '2/3' | '3/3'): boolean {
  const season = String(item.season ?? '').trim();
  return !season || season === 'X/3' || season === expected;
}

function randomItem(items: Item[]): Item | null {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function select(items: Item[], categories: Set<string>): Item | null {
  return randomItem(items.filter((item) => categories.has(String(item.lowerCategory ?? ''))));
}

function accessory(items: Item[]): Item | null {
  return select(items, ACCESSORIES);
}

/** Legacy seasonal helpers kept for existing callers; new suggestions use smartOutfitEngine. */
export function generateSummerOutfit(items: Item[]): Outfit {
  const pool = items.filter((item) => eligible(item) && seasonMatches(item, '1/3'));
  return {
    base: select(pool, BASE),
    pants: select(pool, new Set(['Shorts'])),
    shoes: select(pool, SHOES),
    accessory: accessory(pool)
  };
}

export function generateSpringOutfit(items: Item[]): Outfit {
  const pool = items.filter((item) => eligible(item) && seasonMatches(item, '2/3'));
  return {
    base: select(pool, BASE),
    mid: select(pool, MID),
    jacket: select(pool, OUTER),
    pants: select(pool, LONG_BOTTOMS),
    shoes: select(pool, SHOES),
    accessory: accessory(pool)
  };
}

export function generateWinterOutfit(items: Item[]): Outfit {
  const common = items.filter(eligible);
  const winterOuterwear = common.filter((item) => seasonMatches(item, '3/3'));
  return {
    base: select(common, BASE),
    mid: select(common, MID),
    jacket: select(winterOuterwear, OUTER),
    pants: select(common, LONG_BOTTOMS),
    shoes: select(common, SHOES),
    accessory: accessory(common)
  };
}
