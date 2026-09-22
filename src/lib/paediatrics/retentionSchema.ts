import { PAEDIATRICS_TOPIC_IDS } from './paediatricsSyllabus';

export type CardRating = 'again' | 'hard' | 'good' | 'easy';
export type RetentionCardStatus = 'active' | 'suspended' | 'mastered' | 'archived';
export type SchedulingPhase = 'new' | 'learning' | 'review' | 'relearning';
export type AnkiGapStatus = 'unseen' | 'learning' | 'fragile' | 'stable' | 'reopened' | 'missing';

export type AnkiCardLink = {
  noteId?: number;
  cardIds: number[];
  deckName: string;
  modelName: string;
  linkedAt: string;
  lastSyncedAt?: string;
  status?: AnkiGapStatus;
  reviewCount?: number;
  strongRecallWindows?: number;
  lastReviewAt?: string;
  lastEase?: number;
  intervalDays?: number;
  repetitions?: number;
  lapses?: number;
  cardType?: number;
  queue?: number;
  due?: boolean;
  retrievability?: number;
  stability?: number;
  difficulty?: number;
  lastStatusChangedAt?: string;
};

export type CardReview = {
  id: string;
  reviewedAt: string;
  rating: CardRating;
  previousDue: string;
  nextDue: string;
  intervalDays: number;
};

export type RetentionCard = {
  id: string;
  topicId: string;
  gapId: string | null;
  sourceSessionId: string | null;
  front: string;
  back: string;
  clinicalContext: string;
  tags: string[];
  status: RetentionCardStatus;
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  dueAt: string;
  phase: SchedulingPhase;
  learningStep: number;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  reviews: CardReview[];
  ankiExportedAt?: string;
  ankiExportBatchId?: string;
  anki?: AnkiCardLink;
};

export type NewRetentionCard = Pick<RetentionCard, 'topicId' | 'front' | 'back'> &
  Partial<Pick<RetentionCard, 'id' | 'gapId' | 'sourceSessionId' | 'clinicalContext' | 'tags'>>;

export type RetentionCardImport = {
  kind: 'trackr-retention-cards';
  schemaVersion: 1;
  cards: NewRetentionCard[];
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateCardImport(input: unknown): RetentionCardImport {
  if (!isObject(input) || input.kind !== 'trackr-retention-cards' || input.schemaVersion !== 1 || !Array.isArray(input.cards)) throw new Error('Expected a Trackr retention-card JSON object with schemaVersion 1.');
  if (!Object.keys(input).every((key) => ['kind', 'schemaVersion', 'cards'].includes(key))) throw new Error('Card import contains unknown top-level fields.');
  if (input.cards.length === 0 || input.cards.length > 200) throw new Error('Card import must contain 1 to 200 cards.');
  const seen = new Set<string>();
  const cards = input.cards.map((raw, index): NewRetentionCard => {
    if (!isObject(raw) || !Object.keys(raw).every((key) => ['id', 'topicId', 'gapId', 'sourceSessionId', 'front', 'back', 'clinicalContext', 'tags'].includes(key))) throw new Error(`Card ${index + 1} contains unknown fields.`);
    if (typeof raw.topicId !== 'string' || !PAEDIATRICS_TOPIC_IDS.has(raw.topicId)) throw new Error(`Card ${index + 1} has an unknown topicId.`);
    if (typeof raw.front !== 'string' || !raw.front.trim() || typeof raw.back !== 'string' || !raw.back.trim()) throw new Error(`Card ${index + 1} needs a front and back.`);
    if (raw.front.length > 2000 || raw.back.length > 5000) throw new Error(`Card ${index + 1} is too long.`);
    for (const key of ['id', 'gapId', 'sourceSessionId', 'clinicalContext'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Card ${index + 1}.${key} must be a string.`);
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 30 || raw.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) throw new Error(`Card ${index + 1}.tags is invalid.`);
    const suppliedId = typeof raw.id === 'string' ? raw.id : '';
    if (suppliedId && seen.has(suppliedId)) throw new Error(`Duplicate card id: ${suppliedId}.`);
    if (suppliedId) seen.add(suppliedId);
    return raw as NewRetentionCard;
  });
  return { kind: 'trackr-retention-cards', schemaVersion: 1, cards };
}

export function todayLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createRetentionCard(input: NewRetentionCard, now = new Date().toISOString()): RetentionCard {
  if (!PAEDIATRICS_TOPIC_IDS.has(input.topicId)) throw new Error(`Unknown card topic ID: ${input.topicId}.`);
  const front = input.front.trim();
  const back = input.back.trim();
  if (!front || !back) throw new Error('Every retention card needs both a front and a back.');
  if (front.length > 2000 || back.length > 5000) throw new Error('Retention card text is too long.');
  const id = input.id?.trim() || crypto.randomUUID();
  const gapId = input.gapId?.trim() || null;
  const identityTags = ['trackr', `trackr-id::${id}`, `trackr-topic::${input.topicId}`, ...(gapId ? [`trackr-gap::${gapId}`, 'trackr::paediatrics-gap'] : [])];
  return {
    id, topicId: input.topicId,
    gapId, sourceSessionId: input.sourceSessionId?.trim() || null,
    front, back, clinicalContext: input.clinicalContext?.trim() || '',
    tags: [...new Set([input.topicId, 'retention', ...(gapId ? ['weakspot'] : []), ...identityTags, ...(input.tags ?? [])].map((tag) => tag.trim()).filter(Boolean))],
    status: 'active', createdAt: now, updatedAt: now, dueDate: todayLocal(), dueAt: now,
    phase: 'new', learningStep: 0,
    intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, reviews: []
  };
}

const normalizeCardText = (value: string) => value.toLowerCase().replace(/<br\s*\/?\s*>/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function retentionCardFingerprint(card: Pick<RetentionCard, 'topicId' | 'front' | 'back'> | NewRetentionCard) {
  return `${card.topicId}|${normalizeCardText(card.front)}|${normalizeCardText(card.back)}`;
}

export function removeDuplicateCardInputs(inputs: NewRetentionCard[], existing: RetentionCard[]) {
  const fingerprints = new Set(existing.map(retentionCardFingerprint));
  const ids = new Set(existing.map((card) => card.id));
  const unique: NewRetentionCard[] = [];
  let skipped = 0;
  for (const input of inputs) {
    const fingerprint = retentionCardFingerprint(input);
    if (fingerprints.has(fingerprint) || (input.id && ids.has(input.id))) { skipped += 1; continue; }
    fingerprints.add(fingerprint);
    if (input.id) ids.add(input.id);
    unique.push(input);
  }
  return { unique, skipped };
}

export function normalizeRetentionCard(card: RetentionCard): RetentionCard {
  return { ...card, dueAt: card.dueAt ?? `${card.dueDate}T00:00:00.000Z`, phase: card.phase ?? (card.repetitions > 0 ? 'review' : 'new'), learningStep: card.learningStep ?? 0 };
}

export type IntervalPreview = { milliseconds: number; label: string };
const MINUTE = 60_000; const DAY = 86_400_000;
const intervalLabel = (ms: number) => ms < 60 * MINUTE ? `${Math.round(ms / MINUTE)}m` : ms < DAY ? `${Math.round(ms / (60 * MINUTE))}h` : `${Math.round(ms / DAY)}d`;

export function cardIntervalPreviews(rawCard: RetentionCard): Record<CardRating, IntervalPreview> {
  const card = normalizeRetentionCard(rawCard);
  let values: Record<CardRating, number>;
  if (card.phase === 'new' || card.phase === 'learning') {
    values = card.learningStep === 0
      ? { again: MINUTE, hard: 6 * MINUTE, good: 10 * MINUTE, easy: 4 * DAY }
      : { again: MINUTE, hard: 10 * MINUTE, good: DAY, easy: 4 * DAY };
  } else if (card.phase === 'relearning') {
    values = { again: MINUTE, hard: 6 * MINUTE, good: DAY, easy: Math.max(2, Math.round(card.intervalDays * .5)) * DAY };
  } else {
    const base = Math.max(1, card.intervalDays);
    values = { again: 10 * MINUTE, hard: Math.max(base + 1, Math.round(base * 1.2)) * DAY, good: Math.max(base + 1, Math.round(base * card.ease)) * DAY, easy: Math.max(base + 2, Math.round(base * card.ease * 1.3)) * DAY };
  }
  return Object.fromEntries(Object.entries(values).map(([rating, milliseconds]) => [rating, { milliseconds, label: intervalLabel(milliseconds) }])) as Record<CardRating, IntervalPreview>;
}

export function reviewCard(card: RetentionCard, rating: CardRating, reviewedAt = new Date()): RetentionCard {
  const next = normalizeRetentionCard(structuredClone(card));
  const preview = cardIntervalPreviews(next)[rating];
  const wasReview = next.phase === 'review';
  if (rating === 'again') {
    if (wasReview) next.lapses += 1;
    next.phase = wasReview ? 'relearning' : 'learning'; next.learningStep = 0; next.ease = Math.max(1.3, next.ease - .2);
  } else if (next.phase === 'new' || next.phase === 'learning') {
    if (rating === 'easy' || (rating === 'good' && next.learningStep >= 1)) { next.phase = 'review'; next.learningStep = 0; next.repetitions += 1; }
    else if (rating === 'good') { next.phase = 'learning'; next.learningStep = 1; }
    else { next.phase = 'learning'; }
  } else if (next.phase === 'relearning') {
    if (rating === 'good' || rating === 'easy') { next.phase = 'review'; next.learningStep = 0; next.repetitions += 1; }
  } else {
    next.repetitions += 1;
    if (rating === 'hard') next.ease = Math.max(1.3, next.ease - .15);
    if (rating === 'easy') next.ease += .15;
  }
  const due = new Date(reviewedAt.getTime() + preview.milliseconds);
  const nextDue = todayLocal(due); const now = reviewedAt.toISOString();
  const interval = preview.milliseconds / DAY;
  next.reviews.push({ id: crypto.randomUUID(), reviewedAt: now, rating, previousDue: next.dueAt, nextDue: due.toISOString(), intervalDays: interval });
  next.intervalDays = interval; next.dueDate = nextDue; next.dueAt = due.toISOString(); next.updatedAt = now;
  return next;
}

const cleanCell = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\t/g, ' ').replace(/[\r\n]+/g, '<br>');
const cleanTag = (value: string) => value.trim().replace(/\s+/g, '-');
export function cardsToTsv(cards: RetentionCard[]) {
  const headers = ['#separator:Tab', '#html:true', '#tags column:3', '#columns:Front\tBack\tTags\tTopicID\tGapID\tCardID'];
  const rows = cards.map((card) => [
    cleanCell(card.front), cleanCell(card.back),
    [...new Set([...card.tags, card.topicId, 'trackr', `trackr-id::${card.id}`, `trackr-topic::${card.topicId}`, ...(card.gapId ? [`trackr-gap::${card.gapId}`, 'trackr::paediatrics-gap'] : [])].map(cleanTag).filter(Boolean))].join(' '),
    card.topicId, card.gapId ?? '', card.id
  ]);
  return [...headers, ...rows.map((row) => row.join('\t'))].join('\n');
}

export function cardsFromTsv(text: string, fallbackTopicId: string): NewRetentionCard[] {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((row) => row.trim() && !row.startsWith('#')).map((row) => row.split('\t'));
  if (!rows.length) return [];
  const normalized = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = normalized[0] === 'front' && normalized[1] === 'back';
  const header = hasHeader ? normalized : ['front', 'back', 'tags', 'topicid', 'gapid', 'cardid'];
  return rows.slice(hasHeader ? 1 : 0).map((cells, index) => {
    const get = (name: string) => cells[header.indexOf(name)] ?? '';
    const topicId = get('topicid').trim() || fallbackTopicId;
    if (!PAEDIATRICS_TOPIC_IDS.has(topicId)) throw new Error(`Row ${index + 1} has unknown topic ID ${topicId}.`);
    if (!get('front').trim() || !get('back').trim()) throw new Error(`Row ${index + 1} is missing Front or Back.`);
    const restore = (value: string) => value.replace(/<br>/gi, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return { id: get('cardid').trim() || undefined, topicId, gapId: get('gapid').trim() || undefined,
      front: restore(get('front')), back: restore(get('back')),
      tags: get('tags').split(/\s+/).filter(Boolean) };
  });
}
