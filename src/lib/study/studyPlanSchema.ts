import { SURGERY_SYLLABUS } from './surgerySyllabus';
import type { SurgeryState } from './surgerySchema';

export type EvidenceMode = 'oral' | 'clinical-vignette' | 'rapid-recall' | 'classification' | 'short-recall' | 'multiple-choice' | 'retention' | 'mixed';
export type PlanPass = 'first' | 'second';
export type PhaseType = 'first-pass' | 'second-pass' | 'buffer';

export type StudyPlanPhase = { id: string; name: string; startDate: string; endDate: string; type: PhaseType; target: number; usesDailyPacing: boolean; includedBlocks: string[]; notes: string };
export type DayOverride = { date: string; weight: number; note?: string };
export type BufferObjective = { id: string; title: string; order: number; completedAt?: string; notes?: string };
export type PlanHistoryEntry = { updatedAt: string; summary: string };
export type StudyPlanConfig = {
  schemaVersion: 1; name: string; examDate: string; planStartDate: string; topicIds: string[];
  phases: StudyPlanPhase[]; dayOverrides: DayOverride[]; bufferObjectives: BufferObjective[];
  forecastWindowDays: number; createdAt: string; updatedAt: string; history: PlanHistoryEntry[];
};
export type PlanTopicState = {
  firstPassCompletedAt?: string; secondPassCompletedAt?: string; lastPlanReviewAt?: string;
  firstPassSource?: string; secondPassSource?: string; firstPassManual?: boolean; secondPassManual?: boolean;
  redZonePinned?: boolean; shortReviewDates?: string[];
  completionHistory?: Array<{ pass: PlanPass; complete: boolean; changedAt: string; source: string; previousCompletedAt?: string }>;
};
export type StudyPlanProgress = { schemaVersion: 1; coverageSemanticsVersion?: 2; initializedAt: string; baselineCapturedAt: string; baselineFirstPassCount: number; topics: Record<string, PlanTopicState>; updatedAt: string };

const bufferTitles = ['Acute abdomen / abdominal examination','Appendicitis / peritonitis / obstruction / mesenteric ischemia','Shock','Bleeding','Sepsis','Blood transfusion','ATLS / polytrauma','Open fractures','Compartment syndrome','Acute vascular emergencies','Surgical physical examination / propedeutics','Radiology practice','Instruments / clinical skills','Random full oral tickets','Final weak-topic list'];

export function createDefaultStudyPlan(now = new Date().toISOString()): StudyPlanConfig {
  const blocks = ['TO1','TO2','TO3','TO4'];
  return { schemaVersion: 1, name: 'Surgery State Exam', examDate: '2026-09-08', planStartDate: '2026-08-14', topicIds: SURGERY_SYLLABUS.map((t) => t.id),
    phases: [
      { id:'first-pass', name:'First-pass completion', startDate:'2026-08-14', endDate:'2026-08-27', type:'first-pass', target:196, usesDailyPacing:true, includedBlocks:blocks, notes:'Actively study and retrieve every theoretical topic.' },
      { id:'second-pass', name:'Second pass / active recall', startDate:'2026-08-28', endDate:'2026-09-04', type:'second-pass', target:196, usesDailyPacing:true, includedBlocks:blocks, notes:'Genuine active-recall review of every topic.' },
      { id:'buffer', name:'Buffer / exam mode', startDate:'2026-09-05', endDate:'2026-09-07', type:'buffer', target:0, usesDailyPacing:false, includedBlocks:blocks, notes:'Failure prevention, simulations and practical skills.' }
    ], dayOverrides: [], bufferObjectives: bufferTitles.map((title, order) => ({ id: crypto.randomUUID(), title, order })), forecastWindowDays:5, createdAt:now, updatedAt:now, history:[] };
}

export function baselineCandidates(state: SurgeryState) {
  return SURGERY_SYLLABUS.filter((topic) => { const p = state.topics[topic.id]; return p && (p.status !== 'unassessed' || p.attempts > 0 || !!p.lastReviewedAt); }).map((t) => t.id);
}

export function createPlanProgress(state: SurgeryState, selectedIds: string[] = [], now = new Date().toISOString()): StudyPlanProgress {
  const selected = new Set(selectedIds);
  const topics = Object.fromEntries(SURGERY_SYLLABUS.map((t) => { const reviewed = state.topics[t.id]?.lastReviewedAt; return [t.id, selected.has(t.id) ? { firstPassCompletedAt: reviewed || now, firstPassSource:'manual-confirmed', firstPassManual:true } : {}]; }));
  return { schemaVersion:1, coverageSemanticsVersion:2, initializedAt:now, baselineCapturedAt:now, baselineFirstPassCount:selected.size, topics, updatedAt:now };
}

/** One-time correction from inferred assessment coverage to explicit coverage. */
export function migrateToExplicitCoverage(progress: StudyPlanProgress, changedAt = new Date().toISOString()): StudyPlanProgress {
  if (progress.coverageSemanticsVersion === 2) return progress;
  const next = structuredClone(progress);
  for (const [id, topic] of Object.entries(next.topics)) {
    if (topic.firstPassCompletedAt) topic.completionHistory = [...(topic.completionHistory ?? []), { pass:'first', complete:false, changedAt, source:'explicit-coverage-migration', previousCompletedAt:topic.firstPassCompletedAt }];
    if (topic.secondPassCompletedAt) topic.completionHistory = [...(topic.completionHistory ?? []), { pass:'second', complete:false, changedAt, source:'explicit-coverage-migration', previousCompletedAt:topic.secondPassCompletedAt }];
    delete topic.firstPassCompletedAt; delete topic.firstPassSource; delete topic.firstPassManual;
    delete topic.secondPassCompletedAt; delete topic.secondPassSource; delete topic.secondPassManual;
    next.topics[id] = topic;
  }
  const explicitAt = '2026-08-14T12:00:00.000Z';
  const confirmed = next.topics['TO1-02'] ?? {};
  confirmed.firstPassCompletedAt = explicitAt;
  confirmed.firstPassSource = 'explicit-baseline-correction';
  confirmed.firstPassManual = true;
  confirmed.completionHistory = [...(confirmed.completionHistory ?? []), { pass:'first', complete:true, changedAt, source:'explicit-baseline-correction' }];
  next.topics['TO1-02'] = confirmed;
  next.baselineFirstPassCount = 0;
  next.coverageSemanticsVersion = 2;
  next.updatedAt = changedAt;
  return next;
}
