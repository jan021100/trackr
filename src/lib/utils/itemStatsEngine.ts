/* =========================================================
   FILE: src/lib/utils/itemStatsEngine.ts

   Purpose:
   Central analysis engine for Trackr item statistics.
   Keeps ItemStatsModal.svelte clean and makes item evaluation
   more cautious, personalized and data-quality aware.
========================================================= */

export type ExpectedUse =
  | 'auto'
  | 'daily'
  | 'regular'
  | 'seasonal'
  | 'rare'
  | 'archive';

export type EvaluationMode =
  | 'auto'
  | 'performance'
  | 'sentimental'
  | 'archive'
  | 'utility';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export type ItemStatsInput = {
  id?: string;

  product?: string;
  name?: string;
  brand?: string;

  mainCategory?: string;
  lowerCategory?: string;
  status?: string;
  condition?: string;

  price?: number | string | null;
  purchaseDate?: string | Date | any | null;
  lastWorn?: string | Date | any | null;
  worn?: number | string | null;
  wearLog?: any[];

  labels?: string[];

  // Optional advanced characteristics
  ratingOverall?: number | string | null;
  ratingPerformance?: number | string | null;
  ratingQuality?: number | string | null;
  ratingComfort?: number | string | null;
  ratingStyle?: number | string | null;

  wouldBuyAgain?: boolean | null;
  sentimentalValue?: boolean;
  expectedUse?: ExpectedUse;
  evaluationMode?: EvaluationMode;
  valueOverrideNote?: string;
  durabilityNote?: string;
  personalNote?: string;
};

export type ItemStatsAnalysis = {
  metrics: {
    price: number | null;
    wornCount: number;
    recordedWearCount: number;
    costPerWear: number | null;
    purchaseDate: string | null;
    firstWearDate: string | null;
    lastWorn: string | null;
    daysOwned: number;
    monthsOwned: number;
    daysSinceLastWorn: number | null;
    wearsPerMonth: number;
    wearsPerYear: number;
    daysPerWear: number | null;
  };

  dataQuality: {
    confidence: ConfidenceLevel;
    score: number;
    reasons: string[];
    trackingCompleteness: 'complete-enough' | 'partial' | 'weak';
    historicalWarning: boolean;
  };

  classification: {
    itemName: string;
    brand: string;
    mainCategory: string;
    lowerCategory: string;
    labels: string[];
    expectedUse: ExpectedUse;
    evaluationMode: EvaluationMode;
    acquisitionType: 'normal' | 'second-hand' | 'gift' | 'inherited' | 'legacy';
    isSportsItem: boolean;
    isSeasonal: boolean;
    isArchiveOrSentimental: boolean;
  };

  scores: {
    usageScore: number;
    costScore: number;
    recencyScore: number;
    ratingScore: number | null;
    durabilityScore: number | null;
    valueScore: number;
    adjustedValueScore: number;
  };

  verdict: {
    label: string;
    tone: 'positive' | 'neutral' | 'caution' | 'archive';
    recommendedAction: string;
  };

  texts: {
    headline: string;
    interpretation: string;
    caveat: string | null;
    usageText: string;
    valueText: string;
    durabilityText: string | null;
  };

  warnings: string[];
};

/* -----------------------------------
   Date helpers
----------------------------------- */

export function normalizeDateKey(value: any): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const key = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (value?.seconds) {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }

  return null;
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetweenKeys(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);

  const start = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);

  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );
}

function monthsBetweenKeys(a: string, b: string) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);

  return Math.max(1, (by - ay) * 12 + (bm - am) + 1);
}

/* -----------------------------------
   Generic helpers
----------------------------------- */

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min = 0, max = 10) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeLabel(label: string) {
  return String(label ?? '').trim().toLowerCase();
}

function hasLabel(item: ItemStatsInput, label: string) {
  const labels = Array.isArray(item.labels) ? item.labels : [];
  return labels.map(normalizeLabel).includes(normalizeLabel(label));
}

function getLabels(item: ItemStatsInput) {
  return Array.isArray(item.labels) ? item.labels.filter(Boolean).map(String) : [];
}

function lower(s: any) {
  return String(s ?? '').toLowerCase();
}

/* -----------------------------------
   Classification
----------------------------------- */

function inferAcquisitionType(item: ItemStatsInput): ItemStatsAnalysis['classification']['acquisitionType'] {
  if (hasLabel(item, 'Legacy')) return 'legacy';
  if (hasLabel(item, 'Inherited')) return 'inherited';
  if (hasLabel(item, 'Gift')) return 'gift';
  if (hasLabel(item, 'Second-Hand')) return 'second-hand';
  return 'normal';
}

function inferExpectedUse(item: ItemStatsInput): ExpectedUse {
  if (item.expectedUse && item.expectedUse !== 'auto') return item.expectedUse;

  const l = lower(item.lowerCategory);
  const main = lower(item.mainCategory);

  if (item.sentimentalValue || hasLabel(item, 'Legacy')) return 'archive';

  if (l.includes('base layer')) return 'regular';
  if (l.includes('bib') || l.includes('shorts')) return main === 'cycling' ? 'regular' : 'seasonal';
  if (l.includes('shoes') || l.includes('running shoes')) return 'regular';
  if (l.includes('socks')) return 'regular';

  if (l.includes('jersey') || l.includes('shirt')) return 'seasonal';
  if (l.includes('jacket') || l.includes('vest')) return 'seasonal';
  if (l.includes('gloves') || l.includes('headwear') || l.includes('leg warmer')) return 'seasonal';
  if (l.includes('glasses')) return 'regular';

  if (main === 'casual') return 'regular';

  return 'regular';
}

function inferEvaluationMode(item: ItemStatsInput): EvaluationMode {
  if (item.evaluationMode && item.evaluationMode !== 'auto') return item.evaluationMode;

  if (item.sentimentalValue || hasLabel(item, 'Legacy') || hasLabel(item, 'Inherited')) {
    return 'sentimental';
  }

  if (lower(item.status) === 'retired') return 'archive';
  if (lower(item.mainCategory) === 'cycling' || lower(item.mainCategory) === 'running') return 'performance';

  return 'utility';
}

function expectedMonthlyUse(expectedUse: ExpectedUse) {
  switch (expectedUse) {
    case 'daily':
      return 12;
    case 'regular':
      return 4;
    case 'seasonal':
      return 1.4;
    case 'rare':
      return 0.5;
    case 'archive':
      return 0.15;
    case 'auto':
    default:
      return 2;
  }
}

/* -----------------------------------
   Data quality
----------------------------------- */

function evaluateDataQuality(args: {
  purchaseDate: string | null;
  firstWearDate: string | null;
  wearLogLength: number;
  acquisitionType: ItemStatsAnalysis['classification']['acquisitionType'];
  expectedUse: ExpectedUse;
}) {
  const reasons: string[] = [];
  let score = 10;

  const reliableTrackingStart = '2024-03-01';

  if (!args.purchaseDate) {
    score -= 2;
    reasons.push('No purchase date is saved, so ownership duration is estimated from first recorded wear.');
  }

  if (args.purchaseDate && args.purchaseDate < reliableTrackingStart) {
    score -= 3;
    reasons.push('The item predates the reliable tracking period, so lifetime usage is probably underestimated.');
  }

  if (args.firstWearDate && args.firstWearDate < reliableTrackingStart) {
    score -= 2;
    reasons.push('Some historical wear entries are reconstructed from photos and may be incomplete.');
  }

  if (args.wearLogLength === 0) {
    score -= 3;
    reasons.push('No wear log entries are recorded.');
  }

  if (args.acquisitionType === 'legacy' || args.acquisitionType === 'inherited') {
    score -= 1.5;
    reasons.push('Legacy or inherited items should not be evaluated purely like recent purchases.');
  }

  if (args.expectedUse === 'archive') {
    score -= 1;
    reasons.push('This item appears to have archive or sentimental value, so low wear frequency may be intentional.');
  }

  score = clamp(score, 0, 10);

  const confidence: ConfidenceLevel =
    score >= 7.5 ? 'High' : score >= 4.5 ? 'Medium' : 'Low';

  const trackingCompleteness =
    score >= 7.5 ? 'complete-enough' : score >= 4.5 ? 'partial' : 'weak';

  return {
    confidence,
    score: round1(score),
    reasons,
    trackingCompleteness: trackingCompleteness as 'complete-enough' | 'partial' | 'weak',
    historicalWarning:
      Boolean(args.purchaseDate && args.purchaseDate < reliableTrackingStart) ||
      Boolean(args.firstWearDate && args.firstWearDate < reliableTrackingStart)
  };
}

/* -----------------------------------
   Scores
----------------------------------- */

function computeCostScore(costPerWear: number | null, acquisitionType: string) {
  if (acquisitionType === 'gift' || acquisitionType === 'inherited') return 8;
  if (costPerWear === null) return 5;

  if (costPerWear <= 1) return 10;
  if (costPerWear <= 2.5) return 9;
  if (costPerWear <= 5) return 8;
  if (costPerWear <= 10) return 6.5;
  if (costPerWear <= 20) return 4.5;
  if (costPerWear <= 40) return 3;
  return 2;
}

function computeRecencyScore(daysSinceLastWorn: number | null, expectedUse: ExpectedUse) {
  if (expectedUse === 'archive') return 7;
  if (daysSinceLastWorn === null) return 2;

  if (expectedUse === 'rare') {
    if (daysSinceLastWorn <= 180) return 8;
    if (daysSinceLastWorn <= 365) return 6;
    return 4;
  }

  if (expectedUse === 'seasonal') {
    if (daysSinceLastWorn <= 90) return 10;
    if (daysSinceLastWorn <= 180) return 8;
    if (daysSinceLastWorn <= 365) return 6;
    return 3.5;
  }

  if (daysSinceLastWorn <= 14) return 10;
  if (daysSinceLastWorn <= 30) return 8;
  if (daysSinceLastWorn <= 60) return 6;
  if (daysSinceLastWorn <= 120) return 4;
  return 2;
}

function computeRatingScore(item: ItemStatsInput) {
  const values = [
    toNumber(item.ratingOverall),
    toNumber(item.ratingPerformance),
    toNumber(item.ratingQuality),
    toNumber(item.ratingComfort),
    toNumber(item.ratingStyle)
  ].filter((v): v is number => v !== null);

  if (!values.length) return null;

  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function computeDurabilityScore(item: ItemStatsInput) {
  const condition = lower(item.condition);

  if (!condition) return null;

  if (condition.includes('new')) return 9;
  if (condition.includes('like new')) return 8.5;
  if (condition.includes('good')) return 7;
  if (condition.includes('worn')) return 5;
  if (condition.includes('damaged')) return 2.5;

  return null;
}

/* -----------------------------------
   Main analysis
----------------------------------- */

export function analyzeItemStats(item: ItemStatsInput): ItemStatsAnalysis {
  const labels = getLabels(item);
  const acquisitionType = inferAcquisitionType(item);
  const expectedUse = inferExpectedUse(item);
  const evaluationMode = inferEvaluationMode(item);

  const mainCategory = String(item.mainCategory ?? '');
  const lowerCategory = String(item.lowerCategory ?? '');
  const brand = String(item.brand ?? '');
  const itemName = String(item.product ?? item.name ?? '');

  const price = toNumber(item.price);

  const wearDates = Array.isArray(item.wearLog)
    ? item.wearLog
        .map(normalizeDateKey)
        .filter((d): d is string => Boolean(d))
        .sort((a, b) => a.localeCompare(b))
    : [];

  const recordedWearCount = wearDates.length;
  const wornFromField = toNumber(item.worn);
  const wornCount = Math.max(recordedWearCount, wornFromField ?? 0);

  const purchaseDate = normalizeDateKey(item.purchaseDate);
  const firstWearDate = wearDates[0] ?? null;
  const lastWearFromLog = wearDates[wearDates.length - 1] ?? null;
  const lastWorn = normalizeDateKey(item.lastWorn) ?? lastWearFromLog;

  const today = todayKey();
  const startDate = purchaseDate ?? firstWearDate ?? today;

  const daysOwned = daysBetweenKeys(startDate, today) || 1;
  const monthsOwned = monthsBetweenKeys(startDate, today) || 1;
  const daysSinceLastWorn = lastWorn ? daysBetweenKeys(lastWorn, today) : null;

  const costPerWear = price !== null && wornCount > 0 ? price / wornCount : null;
  const wearsPerMonth = wornCount / monthsOwned;
  const wearsPerYear = wearsPerMonth * 12;
  const daysPerWear = wornCount > 0 ? daysOwned / wornCount : null;

  const dataQuality = evaluateDataQuality({
    purchaseDate,
    firstWearDate,
    wearLogLength: recordedWearCount,
    acquisitionType,
    expectedUse
  });

  const expectedMonthly = expectedMonthlyUse(expectedUse);
  const usageScore = clamp((wearsPerMonth / expectedMonthly) * 7);

  const costScore = computeCostScore(costPerWear, acquisitionType);
  const recencyScore = computeRecencyScore(daysSinceLastWorn, expectedUse);
  const ratingScore = computeRatingScore(item);
  const durabilityScore = computeDurabilityScore(item);

  let valueScore =
    usageScore * 0.4 +
    costScore * 0.3 +
    recencyScore * 0.2 +
    (ratingScore ?? 6) * 0.1;

  if (evaluationMode === 'sentimental') {
    valueScore =
      usageScore * 0.2 +
      costScore * 0.15 +
      recencyScore * 0.15 +
      (ratingScore ?? 8) * 0.25 +
      2.5;
  }

  if (evaluationMode === 'archive') {
    valueScore =
      usageScore * 0.15 +
      costScore * 0.15 +
      recencyScore * 0.1 +
      (ratingScore ?? 7) * 0.25 +
      2.5;
  }

  valueScore = clamp(valueScore);

  // Reduce assertiveness when data quality is weak, but do not destroy the score.
  const confidenceFactor = dataQuality.score / 10;
  const adjustedValueScore = clamp(valueScore * (0.75 + confidenceFactor * 0.25));

  const warnings: string[] = [];

  if (dataQuality.historicalWarning) {
    warnings.push('Historical tracking is incomplete. Lifetime usage is probably underestimated.');
  }

  if (price !== null && wornCount === 0) {
    warnings.push('This item has a price but no recorded wear.');
  }

  if (daysSinceLastWorn !== null && daysSinceLastWorn > 180 && expectedUse !== 'archive') {
    warnings.push('This item has not been worn for a long time.');
  }

  if (lower(item.condition).includes('damaged') && !item.sentimentalValue) {
    warnings.push('The item is marked as damaged. Evaluation should include whether it is still usable.');
  }

  const isSportsItem = ['cycling', 'running', 'other sports'].includes(lower(mainCategory));
  const isSeasonal = expectedUse === 'seasonal' || expectedUse === 'rare';
  const isArchiveOrSentimental =
    evaluationMode === 'archive' ||
    evaluationMode === 'sentimental' ||
    Boolean(item.sentimentalValue);

  const verdict = buildVerdict({
    adjustedValueScore,
    wornCount,
    dataQuality,
    evaluationMode,
    expectedUse,
    acquisitionType,
    daysSinceLastWorn,
    wouldBuyAgain: item.wouldBuyAgain
  });

  const texts = buildTexts({
    itemName,
    brand,
    mainCategory,
    lowerCategory,
    acquisitionType,
    expectedUse,
    evaluationMode,
    dataQuality,
    adjustedValueScore,
    usageScore,
    costScore,
    recencyScore,
    ratingScore,
    durabilityScore,
    costPerWear,
    wearsPerMonth,
    daysSinceLastWorn,
    wornCount,
    valueOverrideNote: item.valueOverrideNote,
    durabilityNote: item.durabilityNote,
    personalNote: item.personalNote,
    condition: item.condition
  });

  return {
    metrics: {
      price,
      wornCount,
      recordedWearCount,
      costPerWear: costPerWear === null ? null : round2(costPerWear),
      purchaseDate,
      firstWearDate,
      lastWorn,
      daysOwned,
      monthsOwned,
      daysSinceLastWorn,
      wearsPerMonth: round2(wearsPerMonth),
      wearsPerYear: round1(wearsPerYear),
      daysPerWear: daysPerWear === null ? null : round1(daysPerWear)
    },

    dataQuality,

    classification: {
      itemName,
      brand,
      mainCategory,
      lowerCategory,
      labels,
      expectedUse,
      evaluationMode,
      acquisitionType,
      isSportsItem,
      isSeasonal,
      isArchiveOrSentimental
    },

    scores: {
      usageScore: round1(usageScore),
      costScore: round1(costScore),
      recencyScore: round1(recencyScore),
      ratingScore,
      durabilityScore,
      valueScore: round1(valueScore),
      adjustedValueScore: round1(adjustedValueScore)
    },

    verdict,
    texts,
    warnings
  };
}

/* -----------------------------------
   Text generation
----------------------------------- */

function buildVerdict(args: {
  adjustedValueScore: number;
  wornCount: number;
  dataQuality: ItemStatsAnalysis['dataQuality'];
  evaluationMode: EvaluationMode;
  expectedUse: ExpectedUse;
  acquisitionType: string;
  daysSinceLastWorn: number | null;
  wouldBuyAgain?: boolean | null;
}): ItemStatsAnalysis['verdict'] {
  if (args.evaluationMode === 'sentimental' || args.expectedUse === 'archive') {
    return {
      label: 'Sentimental / archive value',
      tone: 'archive',
      recommendedAction:
        'Keep if it still has personal meaning, but do not judge it only by wear frequency.'
    };
  }

  if (args.wornCount === 0) {
    return {
      label: 'Not used yet',
      tone: 'caution',
      recommendedAction: 'Wear it soon or reconsider why it is still in the wardrobe.'
    };
  }

  if (args.wouldBuyAgain === false && args.adjustedValueScore < 6.5) {
    return {
      label: 'Probably not a repeat buy',
      tone: 'caution',
      recommendedAction: 'Keep the lesson: avoid similar purchases unless the use case changes.'
    };
  }

  if (args.adjustedValueScore >= 8) {
    return {
      label: 'Excellent item',
      tone: 'positive',
      recommendedAction: 'Keep using it. This looks like one of the stronger purchases.'
    };
  }

  if (args.adjustedValueScore >= 6.5) {
    return {
      label: 'Good item',
      tone: 'positive',
      recommendedAction: 'Worth keeping. Usage and value look healthy.'
    };
  }

  if (args.adjustedValueScore >= 5) {
    return {
      label: 'Mixed value',
      tone: 'neutral',
      recommendedAction:
        'Keep for now, but watch whether it continues to earn its place.'
    };
  }

  return {
    label: 'Questionable value',
    tone: 'caution',
    recommendedAction:
      'Consider whether this is a niche item, a backup piece, or something to sell/retire.'
  };
}

function buildTexts(args: {
  itemName: string;
  brand: string;
  mainCategory: string;
  lowerCategory: string;
  acquisitionType: string;
  expectedUse: ExpectedUse;
  evaluationMode: EvaluationMode;
  dataQuality: ItemStatsAnalysis['dataQuality'];
  adjustedValueScore: number;
  usageScore: number;
  costScore: number;
  recencyScore: number;
  ratingScore: number | null;
  durabilityScore: number | null;
  costPerWear: number | null;
  wearsPerMonth: number;
  daysSinceLastWorn: number | null;
  wornCount: number;
  valueOverrideNote?: string;
  durabilityNote?: string;
  personalNote?: string;
  condition?: string;
}): ItemStatsAnalysis['texts'] {
  const caveat =
    args.dataQuality.reasons.length > 0
      ? args.dataQuality.reasons.join(' ')
      : null;

  let headline = '';

  if (args.evaluationMode === 'sentimental') {
    headline = 'This item should be evaluated partly by personal meaning, not only by usage.';
  } else if (args.dataQuality.confidence === 'Low') {
    headline = 'This evaluation is useful, but the data is incomplete.';
  } else if (args.adjustedValueScore >= 8) {
    headline = 'This looks like one of the stronger items in your wardrobe.';
  } else if (args.adjustedValueScore >= 6.5) {
    headline = 'This looks like a solid item with real practical value.';
  } else if (args.adjustedValueScore >= 5) {
    headline = 'This item has mixed value and needs context.';
  } else {
    headline = 'This item has weak recorded value so far, unless there is a special reason to keep it.';
  }

  let usageText = `It is recorded ${args.wornCount} time${args.wornCount === 1 ? '' : 's'}, averaging ${args.wearsPerMonth.toFixed(2)} wears per month.`;

  if (args.expectedUse === 'seasonal') {
    usageText += ' Because it appears to be seasonal, lower monthly usage can still be reasonable.';
  }

  if (args.expectedUse === 'rare') {
    usageText += ' This looks like a rare-use item, so it should not be judged like a daily piece.';
  }

  if (args.daysSinceLastWorn !== null && args.daysSinceLastWorn > 120 && args.expectedUse !== 'archive') {
    usageText += ` It has not been worn for ${args.daysSinceLastWorn} days, so it may currently be underused.`;
  }

  let valueText = '';

  if (args.acquisitionType === 'gift' || args.acquisitionType === 'inherited') {
    valueText =
      'Because this was not a normal self-funded purchase, cost-per-wear is less important than usefulness and whether you actually like keeping it.';
  } else if (args.acquisitionType === 'second-hand') {
    valueText =
      'Because this was marked as second-hand, the value threshold is more forgiving than for a full-price purchase.';
  } else if (args.costPerWear !== null) {
    valueText = `The recorded cost per wear is about ${args.costPerWear.toFixed(2)} €.`;
  } else {
    valueText = 'No reliable cost-per-wear can be calculated because price or wear data is missing.';
  }

  if (args.valueOverrideNote?.trim()) {
    valueText += ` Your note adds context: ${args.valueOverrideNote.trim()}`;
  }

  let durabilityText: string | null = null;

  if (args.durabilityScore !== null) {
    durabilityText = `The current condition suggests a durability score of about ${args.durabilityScore}/10.`;
  }

  if (args.durabilityNote?.trim()) {
    durabilityText = durabilityText
      ? `${durabilityText} ${args.durabilityNote.trim()}`
      : args.durabilityNote.trim();
  }

  if (lower(args.condition).includes('damaged')) {
    durabilityText =
      (durabilityText ? `${durabilityText} ` : '') +
      'Because it is marked as damaged, the practical value depends on whether the damage limits real use.';
  }

  let interpretation = `${headline} ${usageText} ${valueText}`;

  if (args.personalNote?.trim()) {
    interpretation += ` Personal context: ${args.personalNote.trim()}`;
  }

  return {
    headline,
    interpretation,
    caveat,
    usageText,
    valueText,
    durabilityText
  };
}