import { SURGERY_TOPIC_IDS } from './surgerySyllabus';
import type { GapPriority } from './surgeryReview';
import type { SurgeryState } from './surgerySchema';

export const ANKI_GAP_IMPORT_KIND = 'trackr-anki-gap-cards' as const;
export const ANKI_GAP_SCHEMA_VERSION = 1 as const;
export const ANKI_RECALL_WINDOW_MS = 2 * 60 * 60 * 1000;

export type AnkiGapSelection = {
  topicId: string;
  topicTitle: string;
  gapId: string;
  gapText: string;
  priority?: GapPriority;
};

export type GeneratedAnkiGapCard = {
  id: string;
  topicId: string;
  gapId: string;
  front: string;
  back: string;
  tags: string[];
};

export type AnkiGapCardImport = {
  kind: typeof ANKI_GAP_IMPORT_KIND;
  schemaVersion: typeof ANKI_GAP_SCHEMA_VERSION;
  batchId: string;
  cards: GeneratedAnkiGapCard[];
};

/**
 * One Anki review-log entry as returned by AnkiConnect. `id` is Anki's
 * millisecond review timestamp. Type 4 is a manual reschedule rather than a
 * recall attempt and is deliberately excluded from learning evidence.
 */
export type AnkiReviewEntry = {
  id: number;
  ease: number;
  type?: number;
  cardId?: number;
  ivl?: number;
  lastIvl?: number;
  time?: number;
  interval?: number;
  lastInterval?: number;
  factor?: number;
  answerTimeMs?: number;
};

export type AnkiRecallWindow = {
  startedAt: string;
  timestamp: number;
  rating: 1 | 2 | 3 | 4;
  reviewId: number;
};

export type AnkiGapStudyStatus = 'unseen' | 'learning' | 'fragile' | 'stable' | 'reopened' | 'missing';

export type AnkiGapClassification = {
  status: AnkiGapStudyStatus;
  recallWindows: AnkiRecallWindow[];
  successfulWindowsAfterReset: number;
  ignoredReviewCount: number;
  latestRating?: AnkiRecallWindow['rating'];
  latestReviewAt?: string;
};

export type AnkiGapClassificationUpdate = {
  topicId: string;
  gapId: string;
  classification: AnkiGapClassification;
};

export type AnkiGapStateChange = {
  topicId: string;
  gapId: string;
  previousStatus?: AnkiGapStudyStatus;
  status: AnkiGapStudyStatus;
  gapChange: 'none' | 'resolved' | 'reopened';
  reviewAt?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keysOnly = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const pairKey = (topicId: string, gapId: string) => `${topicId}\u0000${gapId}`;

// FNV-1a gives a compact deterministic identifier without relying on browser
// crypto or Node-only APIs. The readable topic prefix remains useful in logs.
function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36).padStart(13, '0');
}

function tagSegment(value: string) {
  const normalized = value.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  return normalized || stableHash(value);
}

function normalizedPriority(priority?: GapPriority): GapPriority {
  return priority ?? 'normal';
}

function validateSelections(selections: AnkiGapSelection[]) {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 200) {
    throw new Error('Anki gap-card selection must contain 1 to 200 gaps.');
  }
  const pairs = new Set<string>();
  for (const [index, selection] of selections.entries()) {
    if (!selection || typeof selection !== 'object') throw new Error(`Selected gap ${index + 1} is invalid.`);
    if (!SURGERY_TOPIC_IDS.has(selection.topicId)) throw new Error(`Selected gap ${index + 1} has an unknown topicId.`);
    if (!selection.topicTitle?.trim()) throw new Error(`Selected gap ${index + 1} needs its official topic title.`);
    if (!selection.gapId?.trim()) throw new Error(`Selected gap ${index + 1} needs a gapId.`);
    if (!selection.gapText?.trim()) throw new Error(`Selected gap ${index + 1} needs gap text.`);
    if (selection.priority !== undefined && !['critical', 'important', 'normal'].includes(selection.priority)) {
      throw new Error(`Selected gap ${index + 1} has an invalid priority.`);
    }
    const key = pairKey(selection.topicId, selection.gapId);
    if (pairs.has(key)) throw new Error(`Duplicate selected gap: ${selection.topicId}/${selection.gapId}.`);
    pairs.add(key);
  }
}

export function stableAnkiGapCardId(topicId: string, gapId: string) {
  return `anki-gap-${topicId.toLowerCase()}-${stableHash(pairKey(topicId, gapId))}`;
}

/** Stable for the same selected set even if the queue order changes. */
export function stableAnkiGapBatchId(selections: AnkiGapSelection[]) {
  validateSelections(selections);
  const identity = selections.map((selection) => pairKey(selection.topicId, selection.gapId)).sort().join('\u0001');
  return `anki-gap-batch-${stableHash(identity)}`;
}

export function ankiGapTags(topicId: string, gapId: string, priority?: GapPriority) {
  const cardId = stableAnkiGapCardId(topicId, gapId);
  return [
    'trackr',
    'trackr::surgery',
    `trackr::topic::${tagSegment(topicId)}`,
    `trackr::gap::${tagSegment(gapId)}`,
    `trackr::card::${tagSegment(cardId)}`,
    `trackr::priority::${normalizedPriority(priority)}`
  ];
}

export function makeAnkiGapCardPrompt(selections: AnkiGapSelection[]) {
  validateSelections(selections);
  const batchId = stableAnkiGapBatchId(selections);
  const privateContext = selections.map((selection, index) => {
    const id = stableAnkiGapCardId(selection.topicId, selection.gapId);
    return `${index + 1}. Topic: ${selection.topicId} — ${selection.topicTitle.trim()}\nGap ID: ${selection.gapId}\nGap: ${selection.gapText.trim()}\nPriority: ${normalizedPriority(selection.priority)}\nRequired card ID: ${id}`;
  }).join('\n\n');
  const exactShape: AnkiGapCardImport = {
    kind: ANKI_GAP_IMPORT_KIND,
    schemaVersion: ANKI_GAP_SCHEMA_VERSION,
    batchId,
    cards: selections.map((selection) => ({
      id: stableAnkiGapCardId(selection.topicId, selection.gapId),
      topicId: selection.topicId,
      gapId: selection.gapId,
      front: 'REPLACE WITH THE FINAL QUESTION',
      back: 'REPLACE WITH THE CONCISE PASS-LEVEL ANSWER',
      tags: ankiGapTags(selection.topicId, selection.gapId, selection.priority)
    }))
  };

  return `SURGERY TRACKR — CREATE ANKI GAP CARDS

Create exactly one Basic-style Anki card for every selected gap below. Do not omit a gap, add a gap, merge gaps, or create multiple cards for one gap. Trackr supplied every identity field; copy every id, topicId, gapId, batchId and tag exactly. Never invent or alter an identifier.

CARD QUALITY
- Front: write the smallest fair examiner-style retrieval question that targets the gap without revealing its answer. It may identify the official topic or clinical setting needed to locate the problem, but it must not quote or paraphrase the stored gap, contain a partial answer, name the sought sign/drug/threshold/classification item, reveal the number of required items, or use multiple choice, yes/no, cloze, or leading wording.
- Keep the front focused enough for a roughly 20–60 second answer. Do not ask for the entire topic and do not make it so vague that a complete oral presentation is required.
- Back: give the concise, complete, pass-level answer needed to repair that exact gap. Prefer a short sentence or compact bullets. Include essential safety qualifiers, but do not expand into a whole-topic essay.
- Each card must stand alone. One card must not reveal the answer to another card in the batch.
- The stored gap is private examiner context. Do not reproduce it on the front merely to create a question.

PRIVATE GAP CONTEXT
${privateContext}

OUTPUT CONTRACT
Return exactly one raw JSON object and nothing else: no Markdown fence, explanation, heading, or trailing text. The object must match the exact skeleton below. Replace only the front and back placeholder strings. Preserve the array order and every other value exactly. Use valid JSON strings and never emit null or undefined.

${JSON.stringify(exactShape, null, 2)}`;
}

export function validateAnkiGapCardImport(input: unknown, selections: AnkiGapSelection[]): AnkiGapCardImport {
  validateSelections(selections);
  if (!isObject(input) || !keysOnly(input, ['kind', 'schemaVersion', 'batchId', 'cards'])) {
    throw new Error('Expected a Trackr Anki gap-card JSON object.');
  }
  if (input.kind !== ANKI_GAP_IMPORT_KIND || input.schemaVersion !== ANKI_GAP_SCHEMA_VERSION) {
    throw new Error(`Expected ${ANKI_GAP_IMPORT_KIND} schemaVersion ${ANKI_GAP_SCHEMA_VERSION}.`);
  }
  const expectedBatchId = stableAnkiGapBatchId(selections);
  if (input.batchId !== expectedBatchId) throw new Error('The generated cards belong to a different Anki gap batch.');
  if (!Array.isArray(input.cards) || input.cards.length !== selections.length) {
    throw new Error(`Expected exactly ${selections.length} generated gap ${selections.length === 1 ? 'card' : 'cards'}.`);
  }

  const expected = new Map(selections.map((selection) => [pairKey(selection.topicId, selection.gapId), selection]));
  const selectedTopicsByGap = new Map<string, Set<string>>();
  for (const selection of selections) {
    const topics = selectedTopicsByGap.get(selection.gapId) ?? new Set<string>();
    topics.add(selection.topicId);
    selectedTopicsByGap.set(selection.gapId, topics);
  }
  const seen = new Set<string>();
  const cards = input.cards.map((raw, index): GeneratedAnkiGapCard => {
    if (!isObject(raw) || !keysOnly(raw, ['id', 'topicId', 'gapId', 'front', 'back', 'tags'])) {
      throw new Error(`Generated card ${index + 1} contains unknown or missing fields.`);
    }
    if (typeof raw.topicId !== 'string' || typeof raw.gapId !== 'string') {
      throw new Error(`Generated card ${index + 1} needs string topicId and gapId values.`);
    }
    const key = pairKey(raw.topicId, raw.gapId);
    const selection = expected.get(key);
    if (!selection) {
      const expectedTopics = selectedTopicsByGap.get(raw.gapId);
      if (expectedTopics?.size === 1) {
        throw new Error(`Gap ${raw.gapId} belongs to ${[...expectedTopics][0]}, not ${raw.topicId}.`);
      }
      throw new Error(`Generated card ${index + 1} is not one of the selected topic/gap pairs.`);
    }
    if (seen.has(key)) throw new Error(`More than one card was generated for ${raw.topicId}/${raw.gapId}.`);
    seen.add(key);

    const expectedId = stableAnkiGapCardId(selection.topicId, selection.gapId);
    if (raw.id !== expectedId) throw new Error(`Generated card ${index + 1} changed its Trackr card ID.`);
    if (typeof raw.front !== 'string' || !raw.front.trim() || typeof raw.back !== 'string' || !raw.back.trim()) {
      throw new Error(`Generated card ${index + 1} needs a front and back.`);
    }
    if (raw.front.length > 2000 || raw.back.length > 5000) throw new Error(`Generated card ${index + 1} is too long.`);
    if (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 120)) {
      throw new Error(`Generated card ${index + 1} has invalid tags.`);
    }
    const tags = [...new Set(raw.tags.map((tag) => tag.trim()))];
    const requiredTags = ankiGapTags(selection.topicId, selection.gapId, selection.priority);
    const missingTag = requiredTags.find((tag) => !tags.includes(tag));
    if (missingTag) throw new Error(`Generated card ${index + 1} is missing required tag ${missingTag}.`);
    return { id: expectedId, topicId: selection.topicId, gapId: selection.gapId, front: raw.front.trim(), back: raw.back.trim(), tags };
  });

  for (const selection of selections) {
    if (!seen.has(pairKey(selection.topicId, selection.gapId))) {
      throw new Error(`No card was generated for ${selection.topicId}/${selection.gapId}.`);
    }
  }
  return { kind: ANKI_GAP_IMPORT_KIND, schemaVersion: ANKI_GAP_SCHEMA_VERSION, batchId: expectedBatchId, cards };
}

/**
 * Collapses repeated attempts into independent two-hour recall windows. The
 * first valid rating in a window is retained: an immediate retry after seeing
 * the answer cannot turn an initial failure into independent success.
 */
export function collapseAnkiReviewsIntoRecallWindows(reviews: AnkiReviewEntry[]): {
  windows: AnkiRecallWindow[];
  ignoredReviewCount: number;
} {
  const valid = reviews
    .filter((review) => review?.type !== 4 && Number.isFinite(review?.id) && [1, 2, 3, 4].includes(review?.ease))
    .sort((a, b) => a.id - b.id);
  const ignoredReviewCount = reviews.length - valid.length;
  const windows: AnkiRecallWindow[] = [];
  for (const review of valid) {
    const current = windows.at(-1);
    if (current && review.id - current.timestamp < ANKI_RECALL_WINDOW_MS) continue;
    windows.push({ startedAt: new Date(review.id).toISOString(), timestamp: review.id, rating: review.ease as AnkiRecallWindow['rating'], reviewId: review.id });
  }
  return { windows, ignoredReviewCount };
}

export function classifyAnkiGapProgress(reviews: AnkiReviewEntry[]): AnkiGapClassification {
  const { windows, ignoredReviewCount } = collapseAnkiReviewsIntoRecallWindows(reviews);
  const latest = windows.at(-1);
  if (!latest) return { status: 'unseen', recallWindows: [], successfulWindowsAfterReset: 0, ignoredReviewCount };

  let latestResetIndex = -1;
  for (let index = 0; index < windows.length; index += 1) {
    if (windows[index].rating <= 2) latestResetIndex = index;
  }
  const successfulWindowsAfterReset = windows.slice(latestResetIndex + 1).filter((window) => window.rating >= 3).length;
  const shared = {
    recallWindows: windows,
    successfulWindowsAfterReset,
    ignoredReviewCount,
    latestRating: latest.rating,
    latestReviewAt: latest.startedAt
  };

  if (latest.rating === 1) return { status: 'reopened', ...shared };
  if (latest.rating === 2) return { status: 'fragile', ...shared };
  if (successfulWindowsAfterReset >= 2) return { status: 'stable', ...shared };
  return { status: 'learning', ...shared };
}

/**
 * Applies classified Anki evidence only to the linked gap fields. Topic
 * mastery, confidence, assessment totals and study-plan completion are never
 * changed by narrow card performance.
 *
 * Reapplying the same latest review is idempotent. Stable evidence resolves an
 * open gap once; a later independent Again reopens it. Hard and learning
 * states remain visible but do not reopen an already resolved gap.
 */
export function applyAnkiGapClassifications(
  current: SurgeryState,
  updates: AnkiGapClassificationUpdate[],
  changedAt = new Date().toISOString()
): { state: SurgeryState; changes: AnkiGapStateChange[] } {
  if (Number.isNaN(Date.parse(changedAt))) throw new Error('Anki gap sync timestamp must be a valid ISO date.');
  const state = structuredClone(current);
  const changes: AnkiGapStateChange[] = [];
  const seen = new Set<string>();

  for (const update of updates) {
    const key = pairKey(update.topicId, update.gapId);
    if (seen.has(key)) throw new Error(`Duplicate Anki gap classification: ${update.topicId}/${update.gapId}.`);
    seen.add(key);
    const topic = state.topics[update.topicId];
    if (!topic) throw new Error(`Unknown Anki gap topic: ${update.topicId}.`);
    const gap = topic.gaps.find((candidate) => candidate.id === update.gapId);
    if (!gap) throw new Error(`Unknown Anki gap: ${update.topicId}/${update.gapId}.`);

    const classification = update.classification;
    const reviewAt = classification.latestReviewAt;
    if (reviewAt !== undefined && Number.isNaN(Date.parse(reviewAt))) {
      throw new Error(`Anki classification for ${update.topicId}/${update.gapId} has an invalid latestReviewAt.`);
    }
    const alreadyApplied = gap.ankiStatus === classification.status && (
      (reviewAt === undefined && gap.ankiLastReviewAt === undefined)
      || (reviewAt !== undefined
        && gap.ankiLastReviewAt !== undefined
        && Date.parse(reviewAt) <= Date.parse(gap.ankiLastReviewAt))
    );
    if (alreadyApplied) continue;

    const previousStatus = gap.ankiStatus as AnkiGapStudyStatus | undefined;
    let gapChange: AnkiGapStateChange['gapChange'] = 'none';
    gap.ankiStatus = classification.status;
    gap.ankiStatusUpdatedAt = changedAt;
    if (reviewAt !== undefined) gap.ankiLastReviewAt = reviewAt;

    if (classification.status === 'stable' && !gap.resolvedAt) {
      gap.resolvedAt = changedAt;
      gap.ankiResolvedAt = changedAt;
      gapChange = 'resolved';
    } else if (
      classification.status === 'reopened'
      && gap.resolvedAt
      && reviewAt !== undefined
      && Date.parse(reviewAt) > Date.parse(gap.resolvedAt)
    ) {
      delete gap.resolvedAt;
      gap.ankiReopenedAt = changedAt;
      gapChange = 'reopened';
    }

    changes.push({
      topicId: update.topicId,
      gapId: update.gapId,
      ...(previousStatus ? { previousStatus } : {}),
      status: classification.status,
      gapChange,
      ...(reviewAt ? { reviewAt } : {})
    });
  }

  if (changes.length) state.updatedAt = changedAt;
  return { state, changes };
}
