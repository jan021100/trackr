import { SURGERY_EXAM_DATE, SURGERY_TOPIC_IDS } from './surgerySyllabus';
import type { EvidenceMode, PlanPass } from './studyPlanSchema';

export const SURGERY_SCHEMA_VERSION = 1 as const;
export type Mastery = 0 | 1 | 2 | 3 | 4;
export type TopicStatus = 'unassessed' | 'learning' | 'review' | 'solid';

export type KnowledgeGap = {
  id: string;
  text: string;
  createdAt: string;
  resolvedAt?: string;
};

export type TopicProgress = {
  mastery: Mastery;
  confidence: Mastery;
  status: TopicStatus;
  attempts: number;
  correct: number;
  lastReviewedAt: string | null;
  notes: string;
  gaps: KnowledgeGap[];
  ankiReviews: string[];
};

export type SurgeryState = {
  schemaVersion: typeof SURGERY_SCHEMA_VERSION;
  examDate: string;
  createdAt: string;
  updatedAt: string;
  topics: Record<string, TopicProgress>;
};

export type SessionSnapshot = {
  id: string;
  date: string;
  label: string;
  questions: number;
  averageMastery: number;
  assessedTopics: number;
  createdAt: string;
  mode?: EvidenceMode;
  planPass?: PlanPass | 'review' | 'none';
  topicIds?: string[];
};

export type SurgeryPatch = {
  schemaVersion: typeof SURGERY_SCHEMA_VERSION;
  topics?: Array<{
    id: string;
    mastery?: Mastery;
    confidence?: Mastery;
    status?: TopicStatus;
    attemptsDelta?: number;
    correctDelta?: number;
    lastReviewedAt?: string;
    notes?: string;
    addGaps?: Array<{ id?: string; text: string }>;
    resolveGapIds?: string[];
    addCards?: Array<{ id?: string; gapId?: string; front: string; back: string; clinicalContext?: string; tags?: string[] }>;
    plan?: {
      firstPassComplete?: boolean;
      firstPassCompletedAt?: string;
      secondPassComplete?: boolean;
      secondPassCompletedAt?: string;
    };
  }>;
  session?: { date?: string; label?: string; questions: number; mode?: EvidenceMode; planPass?: PlanPass | 'review' | 'none' };
};

export type SurgeryBackup = {
  kind: 'trackr-surgery-backup';
  exportedAt: string;
  state: SurgeryState;
  sessions: SessionSnapshot[];
  studyPlan?: { config: import('./studyPlanSchema').StudyPlanConfig; progress: import('./studyPlanSchema').StudyPlanProgress };
};

const statuses: TopicStatus[] = ['unassessed', 'learning', 'review', 'solid'];
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isoDate = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const keysOnly = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export function emptyTopic(): TopicProgress {
  return {
    mastery: 0,
    confidence: 0,
    status: 'unassessed',
    attempts: 0,
    correct: 0,
    lastReviewedAt: null,
    notes: '',
    gaps: [],
    ankiReviews: []
  };
}

export function createEmptySurgeryState(now = new Date().toISOString()): SurgeryState {
  return {
    schemaVersion: SURGERY_SCHEMA_VERSION,
    examDate: SURGERY_EXAM_DATE,
    createdAt: now,
    updatedAt: now,
    topics: Object.fromEntries([...SURGERY_TOPIC_IDS].map((id) => [id, emptyTopic()]))
  };
}

export function validatePatch(input: unknown): SurgeryPatch {
  if (!isObject(input)) throw new Error('Patch must be a JSON object.');
  if (!keysOnly(input, ['schemaVersion', 'topics', 'session'])) throw new Error('Patch contains unknown top-level fields.');
  if (input.schemaVersion !== SURGERY_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${SURGERY_SCHEMA_VERSION}.`);
  if (input.topics === undefined && input.session === undefined) throw new Error('Patch contains no changes.');
  if (input.topics !== undefined && !Array.isArray(input.topics)) throw new Error('topics must be an array.');

  const seen = new Set<string>();
  for (const raw of (input.topics ?? []) as unknown[]) {
    if (!isObject(raw)) throw new Error('Each topic update must be an object.');
    if (!keysOnly(raw, ['id', 'mastery', 'confidence', 'status', 'attemptsDelta', 'correctDelta', 'lastReviewedAt', 'notes', 'addGaps', 'resolveGapIds', 'addCards', 'plan'])) throw new Error(`Topic ${String(raw.id ?? '')} contains unknown fields.`);
    if (typeof raw.id !== 'string' || !SURGERY_TOPIC_IDS.has(raw.id)) throw new Error(`Unknown topic ID: ${String(raw.id)}.`);
    if (seen.has(raw.id)) throw new Error(`Duplicate topic update: ${raw.id}.`);
    seen.add(raw.id);
    for (const key of ['mastery', 'confidence'] as const) {
      if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 4)) throw new Error(`${raw.id}.${key} must be an integer from 0 to 4.`);
    }
    if (raw.status !== undefined && !statuses.includes(raw.status as TopicStatus)) throw new Error(`${raw.id}.status is invalid.`);
    for (const key of ['attemptsDelta', 'correctDelta'] as const) {
      if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 1000)) throw new Error(`${raw.id}.${key} must be an integer from 0 to 1000.`);
    }
    if (raw.lastReviewedAt !== undefined && !isoDate(raw.lastReviewedAt)) throw new Error(`${raw.id}.lastReviewedAt must be an ISO date.`);
    if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 5000)) throw new Error(`${raw.id}.notes must be at most 5000 characters.`);
    if (raw.addGaps !== undefined) {
      if (!Array.isArray(raw.addGaps) || raw.addGaps.length > 50) throw new Error(`${raw.id}.addGaps must be an array of at most 50 gaps.`);
      for (const gap of raw.addGaps) if (!isObject(gap) || !keysOnly(gap, ['id', 'text']) || (gap.id !== undefined && typeof gap.id !== 'string') || typeof gap.text !== 'string' || !gap.text.trim() || gap.text.length > 500) throw new Error(`${raw.id} contains an invalid gap.`);
    }
    if (raw.resolveGapIds !== undefined && (!Array.isArray(raw.resolveGapIds) || raw.resolveGapIds.some((id) => typeof id !== 'string'))) throw new Error(`${raw.id}.resolveGapIds must be a string array.`);
    if (raw.addCards !== undefined) {
      if (!Array.isArray(raw.addCards) || raw.addCards.length > 100) throw new Error(`${raw.id}.addCards must be an array of at most 100 cards.`);
      for (const card of raw.addCards) if (!isObject(card) || !keysOnly(card, ['id', 'gapId', 'front', 'back', 'clinicalContext', 'tags']) || typeof card.front !== 'string' || !card.front.trim() || typeof card.back !== 'string' || !card.back.trim() || (card.tags !== undefined && (!Array.isArray(card.tags) || card.tags.some((tag) => typeof tag !== 'string')))) throw new Error(`${raw.id} contains an invalid retention card.`);
    }
    if (raw.plan !== undefined) {
      if (!isObject(raw.plan) || !keysOnly(raw.plan, ['firstPassComplete', 'firstPassCompletedAt', 'secondPassComplete', 'secondPassCompletedAt'])) throw new Error(`${raw.id}.plan is invalid.`);
      for (const key of ['firstPassComplete', 'secondPassComplete'] as const) if (raw.plan[key] !== undefined && typeof raw.plan[key] !== 'boolean') throw new Error(`${raw.id}.plan.${key} must be a boolean.`);
      for (const key of ['firstPassCompletedAt', 'secondPassCompletedAt'] as const) if (raw.plan[key] !== undefined && !isoDate(raw.plan[key])) throw new Error(`${raw.id}.plan.${key} must be an ISO date.`);
      if (raw.plan.firstPassCompletedAt !== undefined && raw.plan.firstPassComplete !== true) throw new Error(`${raw.id}.plan.firstPassCompletedAt requires firstPassComplete=true.`);
      if (raw.plan.secondPassCompletedAt !== undefined && raw.plan.secondPassComplete !== true) throw new Error(`${raw.id}.plan.secondPassCompletedAt requires secondPassComplete=true.`);
      if (raw.plan.firstPassComplete === undefined && raw.plan.secondPassComplete === undefined) throw new Error(`${raw.id}.plan contains no completion change.`);
    }
  }
  if (input.session !== undefined) {
    const session = input.session;
    if (!isObject(session) || !keysOnly(session, ['date', 'label', 'questions', 'mode', 'planPass'])) throw new Error('session is invalid.');
    if (session.date !== undefined && !isoDate(session.date)) throw new Error('session.date must be an ISO date.');
    if (session.label !== undefined && (typeof session.label !== 'string' || session.label.length > 200)) throw new Error('session.label is invalid.');
    if (!Number.isInteger(session.questions) || Number(session.questions) < 0 || Number(session.questions) > 1000) throw new Error('session.questions must be an integer from 0 to 1000.');
    if (session.mode !== undefined && !['oral','clinical-vignette','rapid-recall','classification','short-recall','multiple-choice','retention','mixed'].includes(session.mode as string)) throw new Error('session.mode is invalid.');
    if (session.planPass !== undefined && !['first','second','review','none'].includes(session.planPass as string)) throw new Error('session.planPass is invalid.');
  }
  return input as SurgeryPatch;
}

export function mergePatch(current: SurgeryState, patch: SurgeryPatch, now = new Date().toISOString()): SurgeryState {
  const next: SurgeryState = structuredClone(current);
  for (const change of patch.topics ?? []) {
    const topic = next.topics[change.id] ?? emptyTopic();
    if (change.mastery !== undefined) topic.mastery = change.mastery;
    if (change.confidence !== undefined) topic.confidence = change.confidence;
    if (change.status !== undefined) topic.status = change.status;
    if (change.attemptsDelta !== undefined) topic.attempts += change.attemptsDelta;
    if (change.correctDelta !== undefined) topic.correct = Math.min(topic.attempts, topic.correct + change.correctDelta);
    if (change.lastReviewedAt !== undefined) topic.lastReviewedAt = new Date(change.lastReviewedAt).toISOString();
    if (change.notes !== undefined) topic.notes = change.notes;
    for (const gap of change.addGaps ?? []) {
      const id = gap.id?.trim() || crypto.randomUUID();
      if (!topic.gaps.some((existing) => existing.id === id)) topic.gaps.push({ id, text: gap.text.trim(), createdAt: now });
    }
    const resolved = new Set(change.resolveGapIds ?? []);
    topic.gaps = topic.gaps.map((gap) => resolved.has(gap.id) && !gap.resolvedAt ? { ...gap, resolvedAt: now } : gap);
    next.topics[change.id] = topic;
  }
  next.updatedAt = now;
  return next;
}

export function normalizeState(input: unknown): SurgeryState {
  if (!isObject(input) || input.schemaVersion !== SURGERY_SCHEMA_VERSION || !isObject(input.topics)) throw new Error('Backup state has an unsupported schema.');
  const base = createEmptySurgeryState();
  for (const [id, raw] of Object.entries(input.topics)) {
    if (!SURGERY_TOPIC_IDS.has(id) || !isObject(raw)) throw new Error(`Backup contains invalid topic ${id}.`);
    const candidate = raw as Partial<TopicProgress>;
    if (!Number.isInteger(candidate.mastery) || Number(candidate.mastery) < 0 || Number(candidate.mastery) > 4 || !Number.isInteger(candidate.confidence) || Number(candidate.confidence) < 0 || Number(candidate.confidence) > 4 || !statuses.includes(candidate.status as TopicStatus) || !Number.isInteger(candidate.attempts) || Number(candidate.attempts) < 0 || !Number.isInteger(candidate.correct) || Number(candidate.correct) < 0 || Number(candidate.correct) > Number(candidate.attempts) || (candidate.lastReviewedAt !== null && !isoDate(candidate.lastReviewedAt)) || typeof candidate.notes !== 'string' || !Array.isArray(candidate.gaps) || (candidate.ankiReviews !== undefined && (!Array.isArray(candidate.ankiReviews) || candidate.ankiReviews.some((date) => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)))) ) throw new Error(`Backup topic ${id} is invalid.`);
    base.topics[id] = { ...structuredClone(candidate as TopicProgress), ankiReviews: [...(candidate.ankiReviews ?? [])] };
  }
  base.createdAt = isoDate(input.createdAt) ? input.createdAt as string : base.createdAt;
  base.updatedAt = new Date().toISOString();
  base.examDate = SURGERY_EXAM_DATE;
  return base;
}

// Firestore documents created before Anki logging do not contain ankiReviews.
// Hydrate them in memory without requiring a one-off database migration.
export function hydrateState(input: SurgeryState): SurgeryState {
  const next = structuredClone(input);
  for (const id of SURGERY_TOPIC_IDS) {
    next.topics[id] = { ...(next.topics[id] ?? emptyTopic()), ankiReviews: [...(next.topics[id]?.ankiReviews ?? [])] };
  }
  return next;
}

export function validateBackup(input: unknown): SurgeryBackup {
  if (!isObject(input) || input.kind !== 'trackr-surgery-backup' || !Array.isArray(input.sessions)) throw new Error('This is not a Trackr Surgery backup.');
  return { kind: 'trackr-surgery-backup', exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(), state: normalizeState(input.state), sessions: input.sessions as SessionSnapshot[], ...(isObject(input.studyPlan) ? { studyPlan: input.studyPlan as SurgeryBackup['studyPlan'] } : {}) };
}
