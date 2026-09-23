import { validateOralAssessment, oralLegacyMastery, scoreOralAssessment, type OralAssessment } from './oralAssessment';
import { PAEDIATRICS_EXAM_DATE, PAEDIATRICS_TOPIC_IDS } from './paediatricsSyllabus';
import { normalizeStudyPlan } from './studyPlanSchema';
import type { EvidenceMode, PlanPass } from './studyPlanSchema';
import type { GapPriority, GapReviewResult, ReviewOutcome, PaediatricsReviewEvent, PaediatricsSimulation } from './paediatricsReview';

export const PAEDIATRICS_SCHEMA_VERSION = 1 as const;
export type Mastery = 0 | 1 | 2 | 3 | 4;
export type TopicStatus = 'unassessed' | 'learning' | 'review' | 'solid';

export type StudyPauseInterval = {
  startedAt: string;
  endedAt?: string;
};

type StudyTimerBase = {
  startedAt: string;
  accumulatedSeconds: number;
  status: 'running' | 'paused';
  runningSince?: string;
  pauseIntervals?: StudyPauseInterval[];
};

export type TopicStudyTimer = StudyTimerBase & {
  kind?: 'topic';
  topicId: string;
};

export type AnkiStudyTimer = StudyTimerBase & {
  kind: 'anki-gap';
  batchId: string;
  topicIds: string[];
  gapIds: string[];
};

// Missing `kind` remains a legacy topic timer, so existing Firestore state and
// backups continue to load without migration.
export type ActiveStudyTimer = TopicStudyTimer | AnkiStudyTimer;

export type KnowledgeGap = {
  id: string;
  text: string;
  createdAt: string;
  resolvedAt?: string;
  priority?: GapPriority;
  ankiStatus?: import('./retentionSchema').AnkiGapStatus;
  ankiStatusUpdatedAt?: string;
  ankiLastReviewAt?: string;
  ankiResolvedAt?: string;
  ankiReopenedAt?: string;
};

export type TopicProgress = {
  oralAssessment?: OralAssessment;
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

export type PaediatricsState = {
  schemaVersion: typeof PAEDIATRICS_SCHEMA_VERSION;
  examDate: string;
  createdAt: string;
  updatedAt: string;
  topics: Record<string, TopicProgress>;
  activeStudyTimer?: ActiveStudyTimer;
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
  durationSeconds?: number;
  studyStartedAt?: string;
  studyEndedAt?: string;
  pauseIntervals?: StudyPauseInterval[];
  studySource?: 'trackr' | 'anki';
  studyTimeOrigin?: 'timer' | 'anki-connect';
  studyDay?: string;
  ankiDeckName?: string;
  ankiReviewCount?: number;
  ankiDayStartHour?: number;
  syncedAt?: string;
  gapIds?: string[];
};

export type PaediatricsPatch = {
  schemaVersion: typeof PAEDIATRICS_SCHEMA_VERSION;
  topics?: Array<{
    id: string;
    oralAssessment?: OralAssessment;
    mastery?: Mastery;
    confidence?: Mastery;
    status?: TopicStatus;
    attemptsDelta?: number;
    correctDelta?: number;
    lastReviewedAt?: string;
    notes?: string;
    addGaps?: Array<{ id?: string; text: string; priority?: GapPriority }>;
    resolveGapIds?: string[];
    addCards?: Array<{ id?: string; gapId?: string; front: string; back: string; clinicalContext?: string; tags?: string[] }>;
    plan?: {
      firstPassComplete?: boolean;
      firstPassCompletedAt?: string;
      secondPassComplete?: boolean;
      secondPassCompletedAt?: string;
      thirdPassComplete?: boolean;
      thirdPassCompletedAt?: string;
    };
    review?: { outcome: ReviewOutcome; pass: PlanPass | 'review'; reviewedAt?: string; notes?: string; gapResults?: GapReviewResult[] };
  }>;
  session?: { date?: string; label?: string; questions: number; mode?: EvidenceMode; planPass?: PlanPass | 'review' | 'none' };
};

export type PaediatricsBackup = {
  kind: 'trackr-paediatrics-backup';
  exportedAt: string;
  state: PaediatricsState;
  sessions: SessionSnapshot[];
  retentionCards?: import('./retentionSchema').RetentionCard[];
  studyPlan?: { config: import('./studyPlanSchema').StudyPlanConfig; progress: import('./studyPlanSchema').StudyPlanProgress };
  reviews?: PaediatricsReviewEvent[];
  simulations?: PaediatricsSimulation[];
};

const statuses: TopicStatus[] = ['unassessed', 'learning', 'review', 'solid'];
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isoDate = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const validPauseIntervals = (value: unknown) => value === undefined || (Array.isArray(value) && value.every((pause) =>
  isObject(pause)
  && isoDate(pause.startedAt)
  && (pause.endedAt === undefined || (isoDate(pause.endedAt) && Date.parse(pause.endedAt as string) >= Date.parse(pause.startedAt as string)))
));
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

export function createEmptyPaediatricsState(now = new Date().toISOString()): PaediatricsState {
  return {
    schemaVersion: PAEDIATRICS_SCHEMA_VERSION,
    examDate: PAEDIATRICS_EXAM_DATE,
    createdAt: now,
    updatedAt: now,
    topics: Object.fromEntries([...PAEDIATRICS_TOPIC_IDS].map((id) => [id, emptyTopic()]))
  };
}

export function validatePatch(input: unknown): PaediatricsPatch {
  if (!isObject(input)) throw new Error('Patch must be a JSON object.');
  if (!keysOnly(input, ['schemaVersion', 'topics', 'session'])) throw new Error('Patch contains unknown top-level fields.');
  if (input.schemaVersion !== PAEDIATRICS_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${PAEDIATRICS_SCHEMA_VERSION}.`);
  if (input.topics === undefined && input.session === undefined) throw new Error('Patch contains no changes.');
  if (input.topics !== undefined && !Array.isArray(input.topics)) throw new Error('topics must be an array.');

  const seen = new Set<string>();
  for (const raw of (input.topics ?? []) as unknown[]) {
    if (!isObject(raw)) throw new Error('Each topic update must be an object.');
    if (!keysOnly(raw, ['id', 'oralAssessment', 'mastery', 'confidence', 'status', 'attemptsDelta', 'correctDelta', 'lastReviewedAt', 'notes', 'addGaps', 'resolveGapIds', 'addCards', 'plan', 'review'])) throw new Error(`Topic ${String(raw.id ?? '')} contains unknown fields.`);
    if (typeof raw.id !== 'string' || !PAEDIATRICS_TOPIC_IDS.has(raw.id)) throw new Error(`Unknown topic ID: ${String(raw.id)}.`);
    if (seen.has(raw.id)) throw new Error(`Duplicate topic update: ${raw.id}.`);
    seen.add(raw.id);
    for (const key of ['mastery', 'confidence'] as const) {
      if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 4)) throw new Error(`${raw.id}.${key} must be an integer from 0 to 4.`);
    }
    if (raw.oralAssessment !== undefined) {
      const assessment = validateOralAssessment(raw.oralAssessment);
      if (raw.mastery !== undefined && raw.mastery !== oralLegacyMastery(assessment)) throw new Error(`${raw.id}: mastery conflicts with oralAssessment; omit mastery.`);
      if (isObject(raw.review)) {
        const outcome = raw.review.outcome;
        const score = scoreOralAssessment(assessment).score;
        // Pass 0 records the pre-teaching cold assessment while its review
        // outcome remains "studied" to describe the guided acquisition session.
        // Recall-round outcome checks therefore apply only after Pass 0.
        if (raw.review.pass !== 'first') {
          // Domain ratings describe the entire pre-teaching performance; later help
          // can make the session prompted without forcing the independence rating down.
          if (assessment.safetyCriticalError && outcome !== 'failed') throw new Error('A safety-critical error requires a failed review outcome.');
          if ((outcome === 'passed' && score < 12) || (outcome === 'fluent' && score < 19) || (outcome === 'failed' && score >= 12)) throw new Error('Review outcome conflicts with the oral assessment evidence.');
        }
      }
    }
    if (raw.status !== undefined && !statuses.includes(raw.status as TopicStatus)) throw new Error(`${raw.id}.status is invalid.`);
    for (const key of ['attemptsDelta', 'correctDelta'] as const) {
      if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 1000)) throw new Error(`${raw.id}.${key} must be an integer from 0 to 1000.`);
    }
    if (raw.lastReviewedAt !== undefined && !isoDate(raw.lastReviewedAt)) throw new Error(`${raw.id}.lastReviewedAt must be an ISO date.`);
    if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 5000)) throw new Error(`${raw.id}.notes must be at most 5000 characters.`);
    if (raw.addGaps !== undefined) {
      if (!Array.isArray(raw.addGaps) || raw.addGaps.length > 50) throw new Error(`${raw.id}.addGaps must be an array of at most 50 gaps.`);
      for (const gap of raw.addGaps) if (!isObject(gap) || !keysOnly(gap, ['id', 'text', 'priority']) || (gap.id !== undefined && typeof gap.id !== 'string') || typeof gap.text !== 'string' || !gap.text.trim() || gap.text.length > 500 || (gap.priority !== undefined && !['critical','important','normal'].includes(String(gap.priority)))) throw new Error(`${raw.id} contains an invalid gap.`);
    }
    if (raw.resolveGapIds !== undefined && (!Array.isArray(raw.resolveGapIds) || raw.resolveGapIds.some((id) => typeof id !== 'string'))) throw new Error(`${raw.id}.resolveGapIds must be a string array.`);
    if (raw.addCards !== undefined) {
      if (!Array.isArray(raw.addCards) || raw.addCards.length > 100) throw new Error(`${raw.id}.addCards must be an array of at most 100 cards.`);
      for (const card of raw.addCards) if (!isObject(card) || !keysOnly(card, ['id', 'gapId', 'front', 'back', 'clinicalContext', 'tags']) || typeof card.front !== 'string' || !card.front.trim() || typeof card.back !== 'string' || !card.back.trim() || (card.tags !== undefined && (!Array.isArray(card.tags) || card.tags.some((tag) => typeof tag !== 'string')))) throw new Error(`${raw.id} contains an invalid retention card.`);
    }
    if (raw.plan !== undefined) {
      if (!isObject(raw.plan) || !keysOnly(raw.plan, ['firstPassComplete', 'firstPassCompletedAt', 'secondPassComplete', 'secondPassCompletedAt', 'thirdPassComplete', 'thirdPassCompletedAt'])) throw new Error(`${raw.id}.plan is invalid.`);
      for (const key of ['firstPassComplete', 'secondPassComplete', 'thirdPassComplete'] as const) if (raw.plan[key] !== undefined && typeof raw.plan[key] !== 'boolean') throw new Error(`${raw.id}.plan.${key} must be a boolean.`);
      for (const key of ['firstPassCompletedAt', 'secondPassCompletedAt', 'thirdPassCompletedAt'] as const) if (raw.plan[key] !== undefined && !isoDate(raw.plan[key])) throw new Error(`${raw.id}.plan.${key} must be an ISO date.`);
      if (raw.plan.firstPassCompletedAt !== undefined && raw.plan.firstPassComplete !== true) throw new Error(`${raw.id}.plan.firstPassCompletedAt requires firstPassComplete=true.`);
      if (raw.plan.secondPassCompletedAt !== undefined && raw.plan.secondPassComplete !== true) throw new Error(`${raw.id}.plan.secondPassCompletedAt requires secondPassComplete=true.`);
      if (raw.plan.thirdPassCompletedAt !== undefined && raw.plan.thirdPassComplete !== true) throw new Error(`${raw.id}.plan.thirdPassCompletedAt requires thirdPassComplete=true.`);
      if (raw.plan.thirdPassComplete === undefined && raw.plan.firstPassComplete === undefined && raw.plan.secondPassComplete === undefined) throw new Error(`${raw.id}.plan contains no completion change.`);
    }
    if (raw.review !== undefined) {
      if (!isObject(raw.review) || !keysOnly(raw.review, ['outcome','pass','reviewedAt','notes','gapResults'])) throw new Error(`${raw.id}.review is invalid.`);
      if (!['studied','failed','prompted','passed','fluent'].includes(String(raw.review.outcome))) throw new Error(`${raw.id}.review.outcome is invalid.`);
      if (!['first','second','third','review'].includes(String(raw.review.pass))) throw new Error(`${raw.id}.review.pass is invalid.`);
      if (raw.review.outcome === 'studied' && raw.review.pass !== 'first') throw new Error('The studied outcome is only valid for Pass 0.');
      if (raw.review.pass === 'first' && raw.review.outcome !== 'studied') throw new Error('Pass 0 uses the studied review outcome; oralAssessment stores the pre-teaching score.');
      if (raw.review.reviewedAt !== undefined && !isoDate(raw.review.reviewedAt)) throw new Error(`${raw.id}.review.reviewedAt must be an ISO date.`);
      if (raw.review.notes !== undefined && (typeof raw.review.notes !== 'string' || raw.review.notes.length > 5000)) throw new Error(`${raw.id}.review.notes must be at most 5000 characters.`);
      if (raw.review.gapResults !== undefined) {
        if (!Array.isArray(raw.review.gapResults) || raw.review.gapResults.length > 100) throw new Error(`${raw.id}.review.gapResults must be an array of at most 100 results.`);
        for (const result of raw.review.gapResults) if (!isObject(result) || !keysOnly(result, ['gapId','outcome','note']) || typeof result.gapId !== 'string' || !result.gapId.trim() || !['resolved','unchanged'].includes(String(result.outcome)) || (result.note !== undefined && (typeof result.note !== 'string' || result.note.length > 500))) throw new Error(`${raw.id}.review contains an invalid gap result.`);
        const resultIds = new Set<string>();
        for (const result of raw.review.gapResults as unknown as GapReviewResult[]) {
          if (resultIds.has(result.gapId)) throw new Error(`${raw.id}.review.gapResults contains duplicate gapId ${result.gapId}.`);
          resultIds.add(result.gapId);
        }
        const resolvedIds = new Set((raw.resolveGapIds ?? []) as string[]);
        for (const result of raw.review.gapResults as unknown as GapReviewResult[]) {
          if (result.outcome === 'resolved' && !resolvedIds.has(result.gapId)) throw new Error(`${raw.id}.review gap ${result.gapId} is resolved but missing from resolveGapIds.`);
          if (result.outcome === 'unchanged' && resolvedIds.has(result.gapId)) throw new Error(`${raw.id}.review gap ${result.gapId} cannot be unchanged and resolved.`);
        }
      }
    }
  }
  if (input.session !== undefined) {
    const session = input.session;
    if (!isObject(session) || !keysOnly(session, ['date', 'label', 'questions', 'mode', 'planPass'])) throw new Error('session is invalid.');
    if (session.date !== undefined && !isoDate(session.date)) throw new Error('session.date must be an ISO date.');
    if (session.label !== undefined && (typeof session.label !== 'string' || session.label.length > 200)) throw new Error('session.label is invalid.');
    if (!Number.isInteger(session.questions) || Number(session.questions) < 0 || Number(session.questions) > 1000) throw new Error('session.questions must be an integer from 0 to 1000.');
    if (session.mode !== undefined && !['oral','clinical-vignette','rapid-recall','classification','short-recall','multiple-choice','retention','mixed'].includes(session.mode as string)) throw new Error('session.mode is invalid.');
    if (session.planPass !== undefined && !['first','second','third','review','none'].includes(session.planPass as string)) throw new Error('session.planPass is invalid.');
  }
  return input as PaediatricsPatch;
}

export function mergePatch(current: PaediatricsState, patch: PaediatricsPatch, now = new Date().toISOString()): PaediatricsState {
  const next: PaediatricsState = structuredClone(current);
  for (const change of patch.topics ?? []) {
    const topic = next.topics[change.id] ?? emptyTopic();
    if (change.mastery !== undefined && change.mastery !== topic.mastery) {
      topic.mastery = change.mastery;
      if (!change.oralAssessment) delete topic.oralAssessment;
    }
    if (change.oralAssessment !== undefined) {
      topic.oralAssessment = { ...structuredClone(change.oralAssessment), assessedAt: change.oralAssessment.assessedAt ?? change.lastReviewedAt ?? now };
      topic.mastery = oralLegacyMastery(topic.oralAssessment);
      topic.status = scoreOralAssessment(topic.oralAssessment).score >= 19 ? 'solid' : 'review';
    }
    if (change.confidence !== undefined) topic.confidence = change.confidence;
    if (change.status !== undefined) topic.status = change.status;
    if (change.attemptsDelta !== undefined) topic.attempts += change.attemptsDelta;
    if (change.correctDelta !== undefined) topic.correct = Math.min(topic.attempts, topic.correct + change.correctDelta);
    if (change.lastReviewedAt !== undefined) topic.lastReviewedAt = new Date(change.lastReviewedAt).toISOString();
    if (change.notes !== undefined) topic.notes = change.notes;
    for (const gap of change.addGaps ?? []) {
      const id = gap.id?.trim() || crypto.randomUUID();
      if (!topic.gaps.some((existing) => existing.id === id)) topic.gaps.push({ id, text: gap.text.trim(), createdAt: now, ...(gap.priority ? { priority: gap.priority } : {}) });
    }
    const resolved = new Set(change.resolveGapIds ?? []);
    topic.gaps = topic.gaps.map((gap) => resolved.has(gap.id) && !gap.resolvedAt ? { ...gap, resolvedAt: now } : gap);
    next.topics[change.id] = topic;
  }
  next.updatedAt = now;
  return next;
}

export function normalizeState(input: unknown): PaediatricsState {
  if (!isObject(input) || input.schemaVersion !== PAEDIATRICS_SCHEMA_VERSION || !isObject(input.topics)) throw new Error('Backup state has an unsupported schema.');
  const base = createEmptyPaediatricsState();
  for (const [id, raw] of Object.entries(input.topics)) {
    if (!PAEDIATRICS_TOPIC_IDS.has(id) || !isObject(raw)) throw new Error(`Backup contains invalid topic ${id}.`);
    const candidate = raw as Partial<TopicProgress>;
    if (!Number.isInteger(candidate.mastery) || Number(candidate.mastery) < 0 || Number(candidate.mastery) > 4 || !Number.isInteger(candidate.confidence) || Number(candidate.confidence) < 0 || Number(candidate.confidence) > 4 || !statuses.includes(candidate.status as TopicStatus) || !Number.isInteger(candidate.attempts) || Number(candidate.attempts) < 0 || !Number.isInteger(candidate.correct) || Number(candidate.correct) < 0 || Number(candidate.correct) > Number(candidate.attempts) || (candidate.lastReviewedAt !== null && !isoDate(candidate.lastReviewedAt)) || typeof candidate.notes !== 'string' || !Array.isArray(candidate.gaps) || (candidate.ankiReviews !== undefined && (!Array.isArray(candidate.ankiReviews) || candidate.ankiReviews.some((date) => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)))) ) throw new Error(`Backup topic ${id} is invalid.`);
    if (candidate.oralAssessment !== undefined) validateOralAssessment(candidate.oralAssessment);
    base.topics[id] = { ...structuredClone(candidate as TopicProgress), ankiReviews: [...(candidate.ankiReviews ?? [])] };
  }
  base.createdAt = isoDate(input.createdAt) ? input.createdAt as string : base.createdAt;
  base.updatedAt = new Date().toISOString();
  base.examDate = typeof input.examDate==='string' && (input.examDate===''||/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) ? input.examDate : PAEDIATRICS_EXAM_DATE;
  if (isObject(input.activeStudyTimer)) {
    const timer = input.activeStudyTimer;
    const validBase = isoDate(timer.startedAt) && Number.isInteger(timer.accumulatedSeconds) && Number(timer.accumulatedSeconds) >= 0 && ['running', 'paused'].includes(String(timer.status)) && (timer.runningSince === undefined || isoDate(timer.runningSince)) && (timer.status !== 'running' || timer.runningSince !== undefined) && validPauseIntervals(timer.pauseIntervals);
    const validTopic = (timer.kind === undefined || timer.kind === 'topic') && typeof timer.topicId === 'string' && PAEDIATRICS_TOPIC_IDS.has(timer.topicId);
    const validAnki = timer.kind === 'anki-gap' && typeof timer.batchId === 'string' && Array.isArray(timer.topicIds) && timer.topicIds.every((id) => typeof id === 'string' && PAEDIATRICS_TOPIC_IDS.has(id)) && Array.isArray(timer.gapIds) && timer.gapIds.every((id) => typeof id === 'string');
    if (!validBase || (!validTopic && !validAnki)) throw new Error('Backup contains an invalid active study timer.');
    base.activeStudyTimer = structuredClone(timer) as ActiveStudyTimer;
  }
  return base;
}

// Firestore documents created before Anki logging do not contain ankiReviews.
// Hydrate them in memory without requiring a one-off database migration.
export function hydrateState(input: PaediatricsState): PaediatricsState {
  const next = structuredClone(input);
  for (const id of PAEDIATRICS_TOPIC_IDS) {
    next.topics[id] = { ...(next.topics[id] ?? emptyTopic()), ankiReviews: [...(next.topics[id]?.ankiReviews ?? [])] };
  }
  return next;
}

const validDocumentId = (id:unknown) => typeof id==='string' && !!id.trim() && !id.includes('/') && id!=='.' && id!=='..';
export function validateBackup(input: unknown): PaediatricsBackup {
  if (!isObject(input) || input.kind !== 'trackr-paediatrics-backup' || !Array.isArray(input.sessions)) throw new Error('This is not a Trackr Paediatrics backup.');
  const topicId=(id:unknown)=>{if(typeof id!=='string'||!PAEDIATRICS_TOPIC_IDS.has(id))throw new Error(`Backup contains an invalid Paediatrics topic: ${String(id)}.`);};
  const topicIds=(ids:unknown)=>{if(!Array.isArray(ids))throw new Error('Backup topic IDs must be an array.');ids.forEach(topicId);};
  const records=(key:string)=>{const value=input[key]??[];if(!Array.isArray(value))throw new Error(`Backup ${key} must be an array.`);const seen=new Set<string>();for(const row of value){if(!isObject(row)||!validDocumentId(row.id)||seen.has(row.id as string))throw new Error(`Backup ${key} contains an invalid or duplicate record ID.`);seen.add(row.id as string);}return value as Record<string,unknown>[];};
  for(const session of records('sessions')) { if(!isoDate(session.date)||!isoDate(session.createdAt)||typeof session.label!=='string'||!Number.isInteger(session.questions)||Number(session.questions)<0||!validPauseIntervals(session.pauseIntervals))throw new Error('Backup contains an invalid session.');if(session.topicIds!==undefined)topicIds(session.topicIds); }
  for(const review of records('reviews')) { topicId(review.topicId);if(review.oralAssessment!==undefined)validateOralAssessment(review.oralAssessment);if(!isoDate(review.reviewedAt)||!['studied','failed','prompted','passed','fluent'].includes(String(review.outcome)) || (review.outcome==='studied' && review.pass!=='first'))throw new Error('Backup contains an invalid review.'); }
  for(const simulation of records('simulations')) { topicIds(simulation.topicIds);if(!isoDate(simulation.date)||!['failed','prompted','passed','fluent'].includes(String(simulation.outcome)))throw new Error('Backup contains an invalid simulation.'); }
  for(const card of records('retentionCards')) { topicId(card.topicId);if(typeof card.front!=='string'||typeof card.back!=='string'||!Array.isArray(card.tags)||!Array.isArray(card.reviews)||!['active','suspended','archived'].includes(String(card.status))||!isoDate(card.dueAt)||!isoDate(card.createdAt))throw new Error('Backup contains an invalid retention card.'); }
  if(input.studyPlan!==undefined) {
    if(!isObject(input.studyPlan)||!isObject(input.studyPlan.config)||!isObject(input.studyPlan.progress)||!isObject(input.studyPlan.progress.topics))throw new Error('Backup contains an invalid Paediatrics study plan.');
    const config=input.studyPlan.config; topicIds(config.topicIds);Object.keys(input.studyPlan.progress.topics).forEach(topicId);
    if(!Array.isArray(config.phases)||!Array.isArray(config.dayOverrides)||!Array.isArray(config.bufferObjectives)||!Array.isArray(config.history)||typeof config.examDate!=='string'||typeof config.planStartDate!=='string')throw new Error('Backup contains an invalid Paediatrics study plan configuration.');
  }
  return { kind: 'trackr-paediatrics-backup', exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(), state: normalizeState(input.state), sessions: input.sessions as SessionSnapshot[], ...(isObject(input.studyPlan) ? { studyPlan: { ...(input.studyPlan as NonNullable<PaediatricsBackup['studyPlan']>), config: normalizeStudyPlan(input.studyPlan.config as import('./studyPlanSchema').StudyPlanConfig) } } : {}), ...(Array.isArray(input.reviews) ? { reviews: input.reviews as PaediatricsReviewEvent[] } : {}), ...(Array.isArray(input.simulations) ? { simulations: input.simulations as PaediatricsSimulation[] } : {}), ...(Array.isArray(input.retentionCards) ? { retentionCards: input.retentionCards as PaediatricsBackup['retentionCards'] } : {}) };
}
