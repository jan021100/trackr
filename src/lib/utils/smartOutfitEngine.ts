import type { Item, Outfit, SeasonMode } from './outfitGenerator';

export type OutfitScope = 'casual' | 'sports';
export type SmartSuggestionMode = 'auto' | 'summer' | 'warmSpringFall' | 'springFall' | 'winter' | 'rotation' | 'discovery';
export type OutfitFeedbackKind = 'like' | 'dislike' | 'saved';

export type OutfitLearningNetwork = {
  inputSize: number;
  hiddenSize: number;
  inputWeights: number[];
  hiddenBias: number[];
  outputWeights: number[];
  outputBias: number;
};

export type PersonalOutfitModel = {
  version: 1;
  feedbackCount: number;
  itemAffinity: Record<string, number>;
  pairAffinity: Record<string, number>;
  recentOutfits: string[];
  network: OutfitLearningNetwork;
};

export type SmartOutfitSuggestion = {
  outfit: Outfit;
  score: number;
  confidence: number;
  metadataCoverage: number;
  reasons: string[];
  key: string;
  features: number[];
  mode: SmartSuggestionMode;
  scope: OutfitScope;
};

export type SmartOutfitOptions = {
  mode?: SmartSuggestionMode;
  scope?: OutfitScope;
  model?: PersonalOutfitModel | null;
  seed?: number;
};

type OutfitRole = 'base' | 'mid' | 'jacket' | 'pants' | 'shoes' | 'accessory';
type Candidate = Outfit & { accessory?: Item | null };

const FEATURE_COUNT = 16;
const HIDDEN_COUNT = 7;
const BASE = new Set(['T-Shirts', 'Thin Shirts', 'Polo Shirts', 'Base Layers', 'LS Shirts', 'SS Shirts', 'SS Jerseys', 'LS Jerseys']);
const MID = new Set(['Sweaters', 'Hoodies', 'Thick Shirts']);
const OUTER = new Set(['Jackets', 'Vests']);
const BOTTOM = new Set(['Pants', 'Shorts', 'Chinos', 'Joggers', 'Leggings', 'Jeans']);
const SHOES = new Set(['Shoes', 'Running Shoes', 'Sneakers', 'Slides']);
const ACCESSORY = new Set(['Gloves', 'Headwear', 'Socks', 'Bags', 'Backpacks', 'Glasses', 'Others', 'Leg Warmers']);

const NEUTRAL = new Set(['black', 'charcoal', 'grey', 'dark-grey', 'light-grey', 'white', 'off-white', 'stone', 'taupe', 'beige', 'sand', 'cream', 'slate']);
const COOL = new Set(['navy', 'mid-blue', 'royal-blue', 'light-blue', 'denim', 'cyan', 'forest-green']);
const WARM = new Set(['red', 'burgundy', 'wine', 'orange', 'pink', 'purple', 'yellow', 'olive', 'brown', 'dark-brown']);
const BRIGHT = new Set(['neon-green', 'fluorescent-yellow']);

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function sigmoid(value: number) { return 1 / (1 + Math.exp(-clamp(value, -20, 20))); }
function itemId(item: Item | null | undefined) { return String(item?.id ?? '').trim(); }
function itemList(outfit: Candidate): Item[] {
  return [outfit.base, outfit.mid, outfit.jacket, outfit.pants, outfit.shoes, outfit.accessory].filter(Boolean) as Item[];
}
function keyFor(outfit: Candidate) { return itemList(outfit).map(itemId).filter(Boolean).sort().join('|'); }
function pairKey(a: string, b: string) { return [a, b].sort().join('~'); }
function label(item: Item) { return item.product || item.name || item.lowerCategory || 'piece'; }
function normalized(value: unknown) { return String(value ?? '').trim().toLowerCase(); }

function boundedAffinity(input: Record<string, unknown> | null | undefined, limit: number): Record<string, number> {
  return Object.fromEntries(Object.entries(input ?? {})
    .map(([key, value]) => [key, clamp(Number(value) || 0, -3, 3)] as const)
    .filter(([key, value]) => Boolean(key) && value !== 0)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, limit));
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function deterministicPool<T extends Item>(items: T[], seed: number, limit: number): T[] {
  return items.slice().sort((a, b) => hash(`${itemId(a)}:${seed}`) - hash(`${itemId(b)}:${seed}`)).slice(0, limit);
}

function autoSeason(): SeasonMode {
  const month = new Date().getMonth() + 1;
  if ([11, 12, 1, 2].includes(month)) return 'winter';
  if ([3, 4, 10].includes(month)) return 'springFall';
  if ([5, 9].includes(month)) return 'warmSpringFall';
  return 'summer';
}

function seasonFor(mode: SmartSuggestionMode): SeasonMode {
  if (mode === 'auto' || mode === 'rotation' || mode === 'discovery') return autoSeason();
  return mode;
}

function roleFor(item: Item): OutfitRole | null {
  const lower = String(item.lowerCategory ?? '').trim();
  if (BASE.has(lower)) return 'base';
  if (MID.has(lower)) return 'mid';
  if (OUTER.has(lower)) return 'jacket';
  if (BOTTOM.has(lower)) return 'pants';
  if (SHOES.has(lower)) return 'shoes';
  if (ACCESSORY.has(lower)) return 'accessory';
  return null;
}

function eligible(item: Item, scope: OutfitScope): boolean {
  const status = normalized(item.status);
  if (['sold', 'retired', 'archived', 'lent out', 'for sale'].includes(status) || item.outfitEligible === false) return false;
  const main = normalized(item.mainCategory);
  return scope === 'casual' ? main === 'casual' : Boolean(main) && main !== 'casual';
}

function inferredStyle(item: Item): 'casual' | 'formal' | 'sporty' {
  const explicit = normalized(item.style);
  if (explicit === 'formal' || explicit === 'sporty' || explicit === 'casual') return explicit;
  const lower = String(item.lowerCategory ?? '');
  if (/(Jersey|Base Layer|Running|Legging|Jogger)/i.test(lower) || normalized(item.mainCategory) !== 'casual') return 'sporty';
  if (/(Chino|Thin Shirt|Polo|Shoes)/i.test(lower)) return 'formal';
  return 'casual';
}

function warmth(item: Item): number {
  const explicit = normalized(item.weight);
  if (explicit === 'thin') return -1;
  if (explicit === 'thick') return 1;
  if (explicit === 'mid') return 0;
  const lower = String(item.lowerCategory ?? '');
  if (/(Shorts|T-Shirts|SS |Slides)/i.test(lower)) return -.8;
  if (/(Jackets|Sweaters|Hoodies|Thick Shirts|Gloves)/i.test(lower)) return .8;
  if (/(Vests|LS |Pants|Jeans|Chinos)/i.test(lower)) return .25;
  return 0;
}

function family(color: unknown): 'neutral' | 'cool' | 'warm' | 'bright' | 'unknown' {
  const value = normalized(color);
  if (NEUTRAL.has(value)) return 'neutral';
  if (COOL.has(value)) return 'cool';
  if (WARM.has(value)) return 'warm';
  if (BRIGHT.has(value)) return 'bright';
  return 'unknown';
}

function colorPair(a: Item, b: Item): number {
  const first = normalized(a.color);
  const second = normalized(b.color);
  if (!first || !second) return 0;
  if (first === second) return .75;
  const af = family(first);
  const bf = family(second);
  if (af === 'neutral' || bf === 'neutral') return af === 'bright' || bf === 'bright' ? .35 : .7;
  if (af === 'bright' || bf === 'bright') return -.75;
  if (af === bf && af !== 'unknown') return .55;
  if ((af === 'cool' && bf === 'warm') || (af === 'warm' && bf === 'cool')) return -.2;
  return .1;
}

function colorFeatures(items: Item[]) {
  const colors = items.map((item) => normalized(item.color)).filter(Boolean);
  const unique = [...new Set(colors)];
  let pairTotal = 0;
  let pairs = 0;
  for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) {
    pairTotal += colorPair(items[left], items[right]);
    pairs++;
  }
  const palette = unique.length <= 1 ? .35 : unique.length <= 3 ? 1 : unique.length === 4 ? 0 : -.7;
  const neutralFoundation = unique.some((color) => family(color) === 'neutral') ? .8 : .15;
  return { harmony: pairs ? pairTotal / pairs : 0, palette, neutralFoundation };
}

function knownCoherence(items: Item[], field: 'style' | 'pattern' | 'fit'): { score: number; coverage: number } {
  const known = items.map((item) => normalized(item[field])).filter(Boolean);
  if (!known.length) return { score: 0, coverage: 0 };
  const counts = new Map<string, number>();
  for (const value of known) counts.set(value, (counts.get(value) ?? 0) + 1);
  const majority = Math.max(...counts.values());
  const distinct = counts.size;
  let score = (majority / known.length) * 2 - 1;
  if (field === 'pattern') {
    const loud = known.filter((value) => value === 'graphic' || value === 'pattern').length;
    score = loud <= 1 ? .8 : loud === 2 ? 0 : -.8;
  }
  if (field === 'fit' && known.filter((value) => value === 'oversized').length >= 3) score -= .5;
  return { score: clamp(score - Math.max(0, distinct - 2) * .15, -1, 1), coverage: known.length / items.length };
}

function inferredStyleCoherence(items: Item[]): number {
  const values = items.map(inferredStyle);
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return clamp((Math.max(...counts.values()) / values.length) * 2 - 1, -1, 1);
}

function seasonCompatibility(items: Item[], mode: SeasonMode): { score: number; coverage: number } {
  const known = items.map((item) => normalized(item.season)).filter(Boolean);
  if (!known.length) return { score: 0, coverage: 0 };
  const expected = mode === 'summer' ? '1/3' : mode === 'winter' ? '3/3' : '2/3';
  const values = known.map((value) => value === 'x/3' || value === expected ? 1 : value === '2/3' ? .2 : -.65);
  return { score: values.reduce((sum, value) => sum + value, 0) / values.length, coverage: known.length / items.length };
}

function targetWarmth(mode: SeasonMode) {
  return mode === 'summer' ? -.75 : mode === 'warmSpringFall' ? -.15 : mode === 'springFall' ? .35 : .85;
}

function rotationScore(items: Item[]): number {
  const known = items.map((item) => Number(item.worn)).filter(Number.isFinite);
  if (!known.length) return 0;
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  return clamp(1 - Math.log1p(average) / Math.log(101), -1, 1);
}

function affinity(items: Item[], model: PersonalOutfitModel) {
  const ids = items.map(itemId).filter(Boolean);
  const itemValue = ids.length ? ids.reduce((sum, id) => sum + (model.itemAffinity[id] ?? 0), 0) / ids.length / 3 : 0;
  const pairValues: number[] = [];
  for (let left = 0; left < ids.length; left++) for (let right = left + 1; right < ids.length; right++) {
    pairValues.push(model.pairAffinity[pairKey(ids[left], ids[right])] ?? 0);
  }
  return {
    item: clamp(itemValue, -1, 1),
    pair: pairValues.length ? clamp(pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length / 3, -1, 1) : 0
  };
}

function recentItemExposure(items: Item[], model: PersonalOutfitModel): number {
  if (!items.length || !model.recentOutfits.length) return 0;
  const recentSets = model.recentOutfits.slice(0, 8).map((key) => new Set(key.split('|').filter(Boolean)));
  const exposure = items.reduce((sum, item) => {
    const id = itemId(item);
    if (!id) return sum;
    let itemExposure = 0;
    for (let index = 0; index < recentSets.length; index++) {
      if (recentSets[index].has(id)) itemExposure += Math.pow(.58, index);
    }
    return sum + clamp(itemExposure, 0, 1);
  }, 0);
  return clamp(exposure / items.length, 0, 1);
}

function featureVector(outfit: Candidate, mode: SmartSuggestionMode, scope: OutfitScope, model: PersonalOutfitModel): { values: number[]; coverage: number; recentExposure: number } {
  const items = itemList(outfit);
  const colors = colorFeatures(items);
  const style = knownCoherence(items, 'style');
  const pattern = knownCoherence(items, 'pattern');
  const fit = knownCoherence(items, 'fit');
  const season = seasonCompatibility(items, seasonFor(mode));
  const warm = items.reduce((sum, item) => sum + warmth(item), 0) / Math.max(1, items.length);
  const warmthMatch = 1 - Math.min(2, Math.abs(warm - targetWarmth(seasonFor(mode)))) / 2;
  const personal = affinity(items, model);
  const recentExposure = recentItemExposure(items, model);
  const novelty = 1 - recentExposure * 2;
  const optionalCoverage = (style.coverage + pattern.coverage + fit.coverage + season.coverage) / 4;
  const completeCore = outfit.base && outfit.pants && outfit.shoes ? 1 : -.8;
  const values = [
    colors.harmony, colors.palette, colors.neutralFoundation, inferredStyleCoherence(items),
    style.score * style.coverage, pattern.score * pattern.coverage, fit.score * fit.coverage,
    warmthMatch, season.score * season.coverage, optionalCoverage, rotationScore(items),
    personal.item, personal.pair, novelty, completeCore, outfit.accessory ? .2 : 0
  ].map((value) => clamp(value, -1, 1));
  return { values, coverage: optionalCoverage, recentExposure };
}

function initializeNetwork(): OutfitLearningNetwork {
  const inputWeights = Array.from({ length: FEATURE_COUNT * HIDDEN_COUNT }, (_, index) => Math.sin(index * 12.9898) * .025);
  return { inputSize: FEATURE_COUNT, hiddenSize: HIDDEN_COUNT, inputWeights, hiddenBias: Array(HIDDEN_COUNT).fill(0), outputWeights: Array(HIDDEN_COUNT).fill(0), outputBias: 0 };
}

export function createPersonalOutfitModel(input?: Partial<PersonalOutfitModel> | null): PersonalOutfitModel {
  const network = input?.network;
  const validNetwork = network?.inputSize === FEATURE_COUNT && network.hiddenSize === HIDDEN_COUNT
    && network.inputWeights?.length === FEATURE_COUNT * HIDDEN_COUNT
    && network.hiddenBias?.length === HIDDEN_COUNT && network.outputWeights?.length === HIDDEN_COUNT;
  return {
    version: 1,
    feedbackCount: Math.max(0, Number(input?.feedbackCount) || 0),
    itemAffinity: boundedAffinity(input?.itemAffinity, 500),
    pairAffinity: boundedAffinity(input?.pairAffinity, 1200),
    recentOutfits: Array.isArray(input?.recentOutfits) ? input.recentOutfits.filter((value): value is string => typeof value === 'string').slice(0, 24) : [],
    network: validNetwork ? {
      inputSize: FEATURE_COUNT,
      hiddenSize: HIDDEN_COUNT,
      inputWeights: network.inputWeights.map(Number),
      hiddenBias: network.hiddenBias.map(Number),
      outputWeights: network.outputWeights.map(Number),
      outputBias: Number(network.outputBias) || 0
    } : initializeNetwork()
  };
}

function networkForward(network: OutfitLearningNetwork, features: number[]) {
  const hidden = Array.from({ length: network.hiddenSize }, (_, node) => {
    let sum = network.hiddenBias[node];
    for (let input = 0; input < network.inputSize; input++) sum += features[input] * network.inputWeights[node * network.inputSize + input];
    return Math.tanh(sum);
  });
  const output = sigmoid(network.outputBias + hidden.reduce((sum, value, index) => sum + value * network.outputWeights[index], 0));
  return { hidden, output };
}

function trainNetwork(network: OutfitLearningNetwork, features: number[], target: number): OutfitLearningNetwork {
  const next = { ...network, inputWeights: [...network.inputWeights], hiddenBias: [...network.hiddenBias], outputWeights: [...network.outputWeights] };
  const learningRate = .035;
  for (let step = 0; step < 10; step++) {
    const { hidden, output } = networkForward(next, features);
    const outputDelta = (output - target) * output * (1 - output);
    const oldOutputWeights = [...next.outputWeights];
    for (let node = 0; node < next.hiddenSize; node++) next.outputWeights[node] -= learningRate * outputDelta * hidden[node];
    next.outputBias -= learningRate * outputDelta;
    for (let node = 0; node < next.hiddenSize; node++) {
      const hiddenDelta = outputDelta * oldOutputWeights[node] * (1 - hidden[node] * hidden[node]);
      next.hiddenBias[node] -= learningRate * hiddenDelta;
      for (let input = 0; input < next.inputSize; input++) {
        const index = node * next.inputSize + input;
        next.inputWeights[index] -= learningRate * hiddenDelta * features[input];
      }
    }
  }
  return next;
}

function candidateScore(outfit: Candidate, mode: SmartSuggestionMode, scope: OutfitScope, model: PersonalOutfitModel) {
  const data = featureVector(outfit, mode, scope, model);
  const weights = [2.5, 1.7, .7, 1.2, .9, .75, .55, 1.6, 1.1, .15, mode === 'rotation' ? 2.3 : .55, 1.8, 2.1, mode === 'discovery' ? 2.2 : .65, 2.4, .15];
  const rules = data.values.reduce((sum, value, index) => sum + value * weights[index], 0);
  const learned = networkForward(model.network, data.values).output * 2 - 1;
  const learnedWeight = Math.min(2.5, model.feedbackCount / 12);
  const repetitionPenalty = data.recentExposure * (mode === 'discovery' ? 6 : mode === 'rotation' ? 5 : 4.5);
  return { score: rules + learned * learnedWeight - repetitionPenalty, ...data };
}

function optionalItem(pool: Item[], key: string, probability: number): Item | null {
  if (!pool.length || (hash(key) % 100) / 100 > probability) return null;
  return pool[hash(`${key}:item`) % pool.length] ?? null;
}

function buildCandidates(items: Item[], mode: SmartSuggestionMode, scope: OutfitScope, seed: number): Candidate[] {
  const available = items.filter((item) => eligible(item, scope) && roleFor(item));
  const pool = (role: OutfitRole, limit = 18) => deterministicPool(available.filter((item) => roleFor(item) === role), seed, limit);
  const bases = pool('base', 20);
  const bottoms = pool('pants', 20);
  const footwear = pool('shoes', 18);
  const mids = pool('mid', 12);
  const outerwear = pool('jacket', 12);
  const accessories = pool('accessory', 14);
  if (!bases.length || !bottoms.length || !footwear.length) return [];

  const season = seasonFor(mode);
  const preferredBottoms = season === 'summer' ? bottoms.filter((item) => item.lowerCategory === 'Shorts') : bottoms.filter((item) => item.lowerCategory !== 'Shorts');
  const bottomPool = preferredBottoms.length ? preferredBottoms : bottoms;
  const candidates: Candidate[] = [];
  for (const base of bases) for (const pants of bottomPool) for (const shoes of footwear) {
    const core = `${itemId(base)}:${itemId(pants)}:${itemId(shoes)}:${seed}`;
    const midChance = season === 'summer' ? .05 : season === 'warmSpringFall' ? .42 : .78;
    const outerChance = season === 'summer' ? .03 : season === 'warmSpringFall' ? .3 : season === 'springFall' ? .72 : .92;
    candidates.push({
      base,
      pants,
      shoes,
      mid: optionalItem(mids, `${core}:mid`, midChance),
      jacket: optionalItem(outerwear, `${core}:outer`, outerChance),
      accessory: optionalItem(accessories, `${core}:accessory`, scope === 'sports' ? .55 : .34)
    });
    if (candidates.length >= 6200) return candidates;
  }
  return candidates;
}

function reasonsFor(outfit: Candidate, mode: SmartSuggestionMode, scope: OutfitScope, model: PersonalOutfitModel, features: number[]): string[] {
  const reasons: string[] = [];
  if (features[0] > .42 || features[1] > .7) reasons.push('The colour palette is especially coherent.');
  if (features[7] > .72) reasons.push(`The layers suit the ${seasonFor(mode) === 'warmSpringFall' ? 'mild transition weather' : seasonFor(mode)} setting.`);
  if (mode === 'rotation' && features[10] > .25) reasons.push('It brings less-worn pieces back into rotation.');
  if (features[13] > .4) reasons.push('It rotates in pieces that have not appeared in the latest suggestions.');
  if ((features[11] + features[12]) > .25) reasons.push('It reflects combinations you have previously liked.');
  if (model.feedbackCount < 3) reasons.push('Trackr is starting with category and colour logic; feedback will personalize future picks.');
  if (!reasons.length) reasons.push(`${label(outfit.base!)} anchors a balanced ${scope === 'sports' ? 'sports' : 'casual'} outfit.`);
  return reasons.slice(0, 3);
}

export function generateSmartOutfit(items: Item[], options: SmartOutfitOptions = {}): SmartOutfitSuggestion | null {
  const mode = options.mode ?? 'auto';
  const scope = options.scope ?? 'casual';
  const model = createPersonalOutfitModel(options.model);
  const candidates = buildCandidates(items, mode, scope, options.seed ?? 0);
  if (!candidates.length) return null;
  const ranked = candidates.map((outfit) => ({ outfit, ...candidateScore(outfit, mode, scope, model) })).sort((a, b) => b.score - a.score);
  const chosen = ranked[0];
  const outfit: Outfit = { ...chosen.outfit };
  const key = keyFor(chosen.outfit);
  const learnedConfidence = Math.min(.22, model.feedbackCount / 100);
  return {
    outfit,
    score: chosen.score,
    confidence: clamp(.55 + chosen.coverage * .2 + learnedConfidence, .55, .96),
    metadataCoverage: chosen.coverage,
    reasons: reasonsFor(chosen.outfit, mode, scope, model, chosen.values),
    key,
    features: chosen.values,
    mode,
    scope
  };
}

export function applyOutfitFeedback(modelInput: PersonalOutfitModel | null | undefined, suggestion: SmartOutfitSuggestion, kind: OutfitFeedbackKind): PersonalOutfitModel {
  const model = createPersonalOutfitModel(modelInput);
  const positive = kind === 'dislike' ? -1 : kind === 'saved' ? .8 : .65;
  const itemDelta = positive * .34;
  const pairDelta = positive * .24;
  const items = itemList(suggestion.outfit as Candidate);
  const ids = items.map(itemId).filter(Boolean);
  const itemAffinity = { ...model.itemAffinity };
  const pairAffinity = { ...model.pairAffinity };
  for (const id of ids) itemAffinity[id] = clamp((itemAffinity[id] ?? 0) + itemDelta, -3, 3);
  for (let left = 0; left < ids.length; left++) for (let right = left + 1; right < ids.length; right++) {
    const key = pairKey(ids[left], ids[right]);
    pairAffinity[key] = clamp((pairAffinity[key] ?? 0) + pairDelta, -3, 3);
  }
  return {
    ...model,
    feedbackCount: model.feedbackCount + 1,
    itemAffinity: boundedAffinity(itemAffinity, 500),
    pairAffinity: boundedAffinity(pairAffinity, 1200),
    recentOutfits: [suggestion.key, ...model.recentOutfits.filter((key) => key !== suggestion.key)].slice(0, 24),
    network: trainNetwork(model.network, suggestion.features, kind === 'dislike' ? 0 : 1)
  };
}

export function markSuggestionSeen(modelInput: PersonalOutfitModel | null | undefined, suggestion: SmartOutfitSuggestion): PersonalOutfitModel {
  const model = createPersonalOutfitModel(modelInput);
  return { ...model, recentOutfits: [suggestion.key, ...model.recentOutfits.filter((key) => key !== suggestion.key)].slice(0, 24) };
}
