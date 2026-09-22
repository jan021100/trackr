import type { AnkiGapStatus, RetentionCard } from './retentionSchema';

export type AnkiGapStatusBucketKey = AnkiGapStatus;
export type AnkiSchedulerStateKey = 'new' | 'learning' | 'review' | 'relearning' | 'paused';
export type RetrievabilityBucketKey = 'under-70' | '70-85' | '85-90' | '90-95' | '95-plus';
export type DifficultyBucketKey = 'under-20' | '20-40' | '40-60' | '60-80' | '80-plus';
export type StabilityBucketKey = 'under-1-day' | '1-3-days' | '3-7-days' | '7-21-days' | '21-plus-days';

export type DistributionBucket<Key extends string> = {
  key: Key;
  label: string;
  count: number;
  /** Percentage of every linked Anki gap card, including cards with unknown data. */
  percentage: number;
  /** Percentage among cards for which this particular value is known. */
  knownPercentage: number;
};

export type CategoricalDistribution<Key extends string> = {
  known: number;
  unknown: number;
  buckets: DistributionBucket<Key>[];
};

export type NumericDistribution<Key extends string> = CategoricalDistribution<Key> & {
  average?: number;
  median?: number;
  min?: number;
  max?: number;
};

export type SchedulerMetric = {
  count: number;
  unknown: number;
  /** Percentage of all linked cards. Unknown cards remain in the denominator. */
  percentage: number;
};

export type AnkiGapCardStats = {
  total: number;
  status: CategoricalDistribution<AnkiGapStatusBucketKey>;
  /** The state distribution is exclusive. The remaining card-level counts may
   * overlap: a reviewed card can also be due and have at least one lapse. */
  scheduler: {
    state: CategoricalDistribution<AnkiSchedulerStateKey>;
    newOrUnseen: SchedulerMetric;
    learning: SchedulerMetric;
    due: SchedulerMetric;
    reviewed: SchedulerMetric;
    lapsed: SchedulerMetric;
    totalReviews: number;
    totalLapses: number;
  };
  retrievability: NumericDistribution<RetrievabilityBucketKey>;
  difficulty: NumericDistribution<DifficultyBucketKey>;
  stability: NumericDistribution<StabilityBucketKey>;
};

const STATUS_SPECS: ReadonlyArray<{ key: AnkiGapStatusBucketKey; label: string }> = [
  { key: 'unseen', label: 'New' },
  { key: 'learning', label: 'Learning' },
  { key: 'fragile', label: 'Fragile' },
  { key: 'stable', label: 'Stable' },
  { key: 'reopened', label: 'Reopened' },
  { key: 'missing', label: 'Missing in Anki' }
];

const SCHEDULER_STATE_SPECS: ReadonlyArray<{ key: AnkiSchedulerStateKey; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'learning', label: 'Learning' },
  { key: 'review', label: 'Review' },
  { key: 'relearning', label: 'Relearning' },
  { key: 'paused', label: 'Suspended / buried' }
];

const RETRIEVABILITY_SPECS: ReadonlyArray<{ key: RetrievabilityBucketKey; label: string; upper: number }> = [
  { key: 'under-70', label: '<70%', upper: 0.7 },
  { key: '70-85', label: '70–84%', upper: 0.85 },
  { key: '85-90', label: '85–89%', upper: 0.9 },
  { key: '90-95', label: '90–94%', upper: 0.95 },
  { key: '95-plus', label: '95–100%', upper: Number.POSITIVE_INFINITY }
];

const DIFFICULTY_SPECS: ReadonlyArray<{ key: DifficultyBucketKey; label: string; upper: number }> = [
  { key: 'under-20', label: '0–19%', upper: 0.2 },
  { key: '20-40', label: '20–39%', upper: 0.4 },
  { key: '40-60', label: '40–59%', upper: 0.6 },
  { key: '60-80', label: '60–79%', upper: 0.8 },
  { key: '80-plus', label: '80–100%', upper: Number.POSITIVE_INFINITY }
];

const STABILITY_SPECS: ReadonlyArray<{ key: StabilityBucketKey; label: string; upper: number }> = [
  { key: 'under-1-day', label: '<1 day', upper: 1 },
  { key: '1-3-days', label: '1–<3 days', upper: 3 },
  { key: '3-7-days', label: '3–<7 days', upper: 7 },
  { key: '7-21-days', label: '7–<21 days', upper: 21 },
  { key: '21-plus-days', label: '21+ days', upper: Number.POSITIVE_INFINITY }
];

const STATUS_KEYS = new Set<AnkiGapStatus>(STATUS_SPECS.map((bucket) => bucket.key));

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function percentage(count: number, total: number) {
  return total > 0 ? count / total * 100 : 0;
}

function linkIsUsable(card: RetentionCard) {
  const noteId = finiteNumber(card.anki?.noteId);
  const cardIds = card.anki?.cardIds ?? [];
  return (noteId !== undefined && Number.isInteger(noteId) && noteId > 0)
    || cardIds.some((id) => Number.isInteger(id) && id > 0);
}

function isDedicatedGapCard(card: RetentionCard) {
  if (!card.gapId || card.status === 'archived' || !card.anki || !linkIsUsable(card)) return false;
  return card.id.startsWith('anki-gap-')
    || card.tags.includes('trackr::surgery-gap')
    || (typeof card.anki.modelName === 'string' && card.anki.modelName.length > 0);
}

function cardPreference(card: RetentionCard) {
  const dedicatedId = card.id.startsWith('anki-gap-') ? 2 : 0;
  const dedicatedTag = card.tags.includes('trackr::surgery-gap') ? 1 : 0;
  const timestamp = Date.parse(card.anki?.lastSyncedAt ?? card.updatedAt);
  return [dedicatedId + dedicatedTag, Number.isFinite(timestamp) ? timestamp : 0] as const;
}

/**
 * Selects one active, linked Anki card per topic/gap pair. Older accidental
 * duplicates do not inflate the statistics.
 */
export function selectLinkedAnkiGapCards(cards: RetentionCard[]) {
  const byGap = new Map<string, RetentionCard>();
  for (const card of cards) {
    if (!isDedicatedGapCard(card)) continue;
    const key = `${card.topicId}\u0000${card.gapId}`;
    const current = byGap.get(key);
    if (!current) {
      byGap.set(key, card);
      continue;
    }
    const preferred = cardPreference(card);
    const previous = cardPreference(current);
    if (preferred[0] > previous[0] || (preferred[0] === previous[0] && preferred[1] > previous[1])) byGap.set(key, card);
  }
  return [...byGap.values()];
}

function statusDistribution(cards: RetentionCard[]): CategoricalDistribution<AnkiGapStatusBucketKey> {
  const counts = new Map<AnkiGapStatusBucketKey, number>();
  let unknown = 0;
  for (const card of cards) {
    const status = card.anki?.status;
    if (!status || !STATUS_KEYS.has(status)) unknown += 1;
    else counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const known = cards.length - unknown;
  return {
    known,
    unknown,
    buckets: STATUS_SPECS.map(({ key, label }) => ({
      key,
      label,
      count: counts.get(key) ?? 0,
      percentage: percentage(counts.get(key) ?? 0, cards.length),
      knownPercentage: percentage(counts.get(key) ?? 0, known)
    }))
  };
}

function schedulerMetric(cards: RetentionCard[], valueFor: (card: RetentionCard) => boolean | undefined): SchedulerMetric {
  let count = 0;
  let unknown = 0;
  for (const card of cards) {
    const value = card.anki?.status === 'missing' ? undefined : valueFor(card);
    if (value === undefined) unknown += 1;
    else if (value) count += 1;
  }
  return { count, unknown, percentage: percentage(count, cards.length) };
}

function reviewCount(card: RetentionCard) {
  const reviews = finiteNumber(card.anki?.reviewCount);
  if (reviews !== undefined) return Math.max(0, Math.trunc(reviews));
  const repetitions = finiteNumber(card.anki?.repetitions);
  return repetitions === undefined ? undefined : Math.max(0, Math.trunc(repetitions));
}

function schedulerCardType(card: RetentionCard) {
  const value = finiteNumber(card.anki?.cardType);
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined;
}

function schedulerStateDistribution(cards: RetentionCard[]): CategoricalDistribution<AnkiSchedulerStateKey> {
  const counts = new Map<AnkiSchedulerStateKey, number>();
  let unknown = 0;
  for (const card of cards) {
    let state: AnkiSchedulerStateKey | undefined;
    const queue = finiteNumber(card.anki?.queue);
    const type = schedulerCardType(card);
    if (card.anki?.status !== 'missing' && queue !== undefined && queue < 0) state = 'paused';
    else if (card.anki?.status !== 'missing' && type === 0) state = 'new';
    else if (card.anki?.status !== 'missing' && type === 1) state = 'learning';
    else if (card.anki?.status !== 'missing' && type === 2) state = 'review';
    else if (card.anki?.status !== 'missing' && type === 3) state = 'relearning';
    if (!state) unknown += 1;
    else counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const known = cards.length - unknown;
  return {
    known,
    unknown,
    buckets: SCHEDULER_STATE_SPECS.map(({ key, label }) => ({
      key,
      label,
      count: counts.get(key) ?? 0,
      percentage: percentage(counts.get(key) ?? 0, cards.length),
      knownPercentage: percentage(counts.get(key) ?? 0, known)
    }))
  };
}

function schedulerStats(cards: RetentionCard[]): AnkiGapCardStats['scheduler'] {
  const state = schedulerStateDistribution(cards);
  const newOrUnseen = schedulerMetric(cards, (card) => {
    const type = schedulerCardType(card);
    if (type !== undefined) return type === 0;
    if (card.anki?.status === 'unseen') return true;
    const count = reviewCount(card);
    return count === undefined ? undefined : count === 0;
  });
  const learning = schedulerMetric(cards, (card) => {
    const type = schedulerCardType(card);
    if (type !== undefined) return type === 1 || type === 3;
    const status = card.anki?.status;
    return status === undefined ? undefined : status === 'learning';
  });
  const due = schedulerMetric(cards, (card) => typeof card.anki?.due === 'boolean' ? card.anki.due : undefined);
  const reviewed = schedulerMetric(cards, (card) => {
    const count = reviewCount(card);
    return count === undefined ? undefined : count > 0;
  });
  const lapsed = schedulerMetric(cards, (card) => {
    const lapses = finiteNumber(card.anki?.lapses);
    return lapses === undefined ? undefined : lapses > 0;
  });
  let totalReviews = 0;
  let totalLapses = 0;
  for (const card of cards) {
    if (card.anki?.status === 'missing') continue;
    totalReviews += reviewCount(card) ?? 0;
    totalLapses += Math.max(0, Math.trunc(finiteNumber(card.anki?.lapses) ?? 0));
  }
  return { state, newOrUnseen, learning, due, reviewed, lapsed, totalReviews, totalLapses };
}

function numericDistribution<Key extends string>(
  cards: RetentionCard[],
  specs: ReadonlyArray<{ key: Key; label: string; upper: number }>,
  read: (card: RetentionCard) => unknown,
  normalize: (value: number) => number | undefined
): NumericDistribution<Key> {
  const counts = new Map<Key, number>();
  const values: number[] = [];
  for (const card of cards) {
    // A deleted/missing Anki note may retain stale values from an older sync.
    // Treat those values as unknown until the note is reconciled again.
    const raw = card.anki?.status === 'missing' ? undefined : finiteNumber(read(card));
    if (raw === undefined) continue;
    const value = normalize(raw);
    if (value === undefined || !Number.isFinite(value)) continue;
    values.push(value);
    const bucket = specs.find((candidate) => value < candidate.upper) ?? specs.at(-1);
    if (bucket) counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }
  const known = values.length;
  const result: NumericDistribution<Key> = {
    known,
    unknown: cards.length - known,
    buckets: specs.map(({ key, label }) => ({
      key,
      label,
      count: counts.get(key) ?? 0,
      percentage: percentage(counts.get(key) ?? 0, cards.length),
      knownPercentage: percentage(counts.get(key) ?? 0, known)
    }))
  };
  if (known) {
    result.average = values.reduce((sum, value) => sum + value, 0) / known;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    result.median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    result.min = sorted[0];
    result.max = sorted.at(-1);
  }
  return result;
}

function normalizedProbability(value: number) {
  return value >= 0 && value <= 1 ? value : undefined;
}

function normalizedDifficulty(value: number) {
  // Trackr persists Anki's `prop:d`, which is the normalized 0–1 form of the
  // internal FSRS 1–10 difficulty. Raw internal values are intentionally not
  // guessed here, because 1 is ambiguous between both representations.
  return value >= 0 && value <= 1 ? value : undefined;
}

function positiveDays(value: number) {
  return value > 0 && value <= 36_500 ? value : undefined;
}

/** Pure aggregate used by the Anki study dashboard. */
export function summarizeAnkiGapCards(allCards: RetentionCard[]): AnkiGapCardStats {
  const cards = selectLinkedAnkiGapCards(allCards);
  return {
    total: cards.length,
    status: statusDistribution(cards),
    scheduler: schedulerStats(cards),
    retrievability: numericDistribution(cards, RETRIEVABILITY_SPECS, (card) => card.anki?.retrievability, normalizedProbability),
    difficulty: numericDistribution(cards, DIFFICULTY_SPECS, (card) => card.anki?.difficulty, normalizedDifficulty),
    stability: numericDistribution(cards, STABILITY_SPECS, (card) => card.anki?.stability, positiveDays)
  };
}
