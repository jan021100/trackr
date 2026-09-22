import { PAEDIATRICS_SYLLABUS } from './paediatricsSyllabus';
import type { PaediatricsState } from './paediatricsSchema';

export type EvidenceMode = 'oral' | 'clinical-vignette' | 'rapid-recall' | 'classification' | 'short-recall' | 'multiple-choice' | 'retention' | 'mixed';
// Keep stored field meanings stable: legacy first = acquisition (Pass 0), second = Recall 1.
export type PlanPass = 'first' | 'second' | 'third';
export type PhaseType = 'first-pass' | 'second-pass' | 'third-pass' | 'buffer';
export const PLAN_PASSES: PlanPass[] = ['first', 'second', 'third'];
export const PASS_DETAILS = {
  first: { label: 'Pass 0', name: 'Pass 0 · Learn & understand', type: 'first-pass', notes: 'Work through every complete topic with the iBook and Notes. Guided learning and short understanding checks; no tracked gaps yet. Coverage is separate from independent recall.' },
  second: { label: 'Pass 1', name: 'Pass 1 · Recall & consolidate', type: 'second-pass', notes: 'Independent recall of every topic, followed by targeted explanations and clinical application. Record specific gaps from this round onward for Anki and delayed retesting.' },
  third: { label: 'Pass 2', name: 'Pass 2 · Exam-level recall', type: 'third-pass', notes: 'A further complete round of independent oral answers, examiner follow-ups and age-appropriate cases. Keep recording and retesting gaps; completion alone does not establish readiness.' }
} as const;
export const passCompletionKey = (pass: PlanPass): 'firstPassCompletedAt' | 'secondPassCompletedAt' | 'thirdPassCompletedAt' => `${pass}PassCompletedAt`;
export const passSourceKey = (pass: PlanPass): 'firstPassSource' | 'secondPassSource' | 'thirdPassSource' => `${pass}PassSource`;
export const passManualKey = (pass: PlanPass): 'firstPassManual' | 'secondPassManual' | 'thirdPassManual' => `${pass}PassManual`;
export const passForPhase = (type?: PhaseType): PlanPass => type === 'third-pass' ? 'third' : type === 'second-pass' ? 'second' : 'first';
// A later recall makes acquisition unnecessary, but it never means Pass 0 was performed.
export const acquisitionCoveredByRecall = (topic?: PlanTopicState): boolean => !!(topic?.secondPassCompletedAt || topic?.thirdPassCompletedAt);
export function passCoverageAt(topic: PlanTopicState | undefined, pass: PlanPass): string | undefined {
  if (pass !== 'first') return topic?.[passCompletionKey(pass)];
  return [topic?.firstPassCompletedAt, topic?.secondPassCompletedAt, topic?.thirdPassCompletedAt]
    .filter((date): date is string => !!date).sort()[0];
}
export const nextTopicPass = (topic?: PlanTopicState): PlanPass | 'review' => PLAN_PASSES.find(pass => !passCoverageAt(topic, pass)) ?? 'review';

export type StudyPlanPhase = { id: string; name: string; startDate: string; endDate: string; type: PhaseType; target: number; usesDailyPacing: boolean; includedBlocks: string[]; notes: string };
export type DayOverride = { date: string; weight: number; note?: string };
export type BufferObjective = { id: string; title: string; order: number; completedAt?: string; notes?: string };
export type PlanHistoryEntry = { updatedAt: string; summary: string };
export type StudyPlanConfig = {
  schemaVersion: 1; learningModelVersion?: 2; name: string; examDate: string; planStartDate: string; topicIds: string[];
  phases: StudyPlanPhase[]; dayOverrides: DayOverride[]; bufferObjectives: BufferObjective[];
  forecastWindowDays: number; createdAt: string; updatedAt: string; history: PlanHistoryEntry[];
  previousRoundPhases?: StudyPlanPhase[];
};
export type PlanTopicState = {
  firstPassCompletedAt?: string; secondPassCompletedAt?: string; thirdPassCompletedAt?: string; lastPlanReviewAt?: string;
  firstPassSource?: string; secondPassSource?: string; thirdPassSource?: string;
  firstPassManual?: boolean; secondPassManual?: boolean; thirdPassManual?: boolean;
  redZonePinned?: boolean; shortReviewDates?: string[];
  completionHistory?: Array<{ pass: PlanPass; complete: boolean; changedAt: string; source: string; previousCompletedAt?: string }>;
};
export type StudyPlanProgress = { schemaVersion: 1; coverageSemanticsVersion?: 2; initializedAt: string; baselineCapturedAt: string; baselineFirstPassCount: number; topics: Record<string, PlanTopicState>; updatedAt: string };

const bufferTitles = ['Random full oral tickets (a + b + c)', 'Final weak-topic list', 'Paediatric examination and practical skills', 'Imaging: head, chest, abdomen and skeleton'];
const localDay = (value: string) => { const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export function scheduleStudyPlan(config:StudyPlanConfig):StudyPlanConfig {
  if(!config.examDate) return config;
  const start=new Date(config.planStartDate+'T12:00:00'), exam=new Date(config.examDate+'T12:00:00');
  const days=Math.round((exam.getTime()-start.getTime())/86400000);
  if(!Number.isFinite(days)||days<1) throw new Error('The exam date must be after the plan start.');
  const offset=(n:number)=>{const d=new Date(start);d.setDate(d.getDate()+Math.max(0,Math.min(days-1,n)));return localDay(d.toISOString());};
  const bufferDays=days>=7?2:0, learningDays=days-bufferDays;
  // Acquisition receives most time. Very short plans may share deadlines; never date work after the exam.
  const edges=[0,Math.max(1,Math.ceil(learningDays*.5)),Math.max(2,Math.ceil(learningDays*.8)),learningDays];
  return {...config,phases:config.phases.map(p=>{
    if(p.type==='buffer')return {...p,startDate:offset(learningDays),endDate:offset(days-1)};
    const index=PLAN_PASSES.indexOf(passForPhase(p.type));
    return {...p,startDate:offset(Math.min(learningDays-1,edges[index])),endDate:offset(Math.min(learningDays-1,Math.max(edges[index],edges[index+1]-1)))};
  })};
}
export function createDefaultStudyPlan(now = new Date().toISOString()): StudyPlanConfig {
  const blocks=['A','B','C'], start=localDay(now);
  return {schemaVersion:1,learningModelVersion:2,name:'Paediatrics State Exam',examDate:'',planStartDate:start,topicIds:PAEDIATRICS_SYLLABUS.map(t=>t.id),
    phases:[
      ...PLAN_PASSES.map(pass=>({id:PASS_DETAILS[pass].type,name:PASS_DETAILS[pass].name,startDate:pass==='first'?start:'',endDate:'',type:PASS_DETAILS[pass].type,target:120,usesDailyPacing:true,includedBlocks:blocks,notes:PASS_DETAILS[pass].notes})),
      {id:'buffer',name:'Ongoing review / exam mode',startDate:'',endDate:'',type:'buffer',target:0,usesDailyPacing:false,includedBlocks:blocks,notes:'Delayed gap repair, broader retests, fixed a/b/c tickets and regular imaging.'}
    ],dayOverrides:[],bufferObjectives:bufferTitles.map((title,order)=>({id:`paediatrics-buffer-${order}`,title,order})),forecastWindowDays:5,createdAt:now,updatedAt:now,history:[]};
}

/** Add Recall 2 without moving or inventing existing completion records. Pure and idempotent. */
export function normalizeStudyPlan(config:StudyPlanConfig):StudyPlanConfig {
  if(config.learningModelVersion===2)return config;
  const defaults=createDefaultStudyPlan(config.createdAt);
  const phases=defaults.phases.map(fallback=>{
    const prior=config.phases.find(p=>p.type===fallback.type);
    return prior?{...prior,name:fallback.name,notes:fallback.notes}:fallback;
  });
  const imagingObjective=defaults.bufferObjectives.at(-1)!;
  const bufferObjectives=config.bufferObjectives.some(item=>item.title.toLowerCase().includes('imaging'))?config.bufferObjectives:[...config.bufferObjectives,{...imagingObjective,order:config.bufferObjectives.length}];
  const migrated={...config,bufferObjectives,learningModelVersion:2 as const,previousRoundPhases:structuredClone(config.phases),phases};
  return config.examDate?scheduleStudyPlan(migrated):migrated;
}

export function baselineCandidates(state: PaediatricsState) {
  return PAEDIATRICS_SYLLABUS.filter((topic) => { const p = state.topics[topic.id]; return p && (p.status !== 'unassessed' || p.attempts > 0 || !!p.lastReviewedAt); }).map((t) => t.id);
}
export function createPlanProgress(state: PaediatricsState, selectedIds: string[] = [], now = new Date().toISOString()): StudyPlanProgress {
  const selected = new Set(selectedIds);
  const topics = Object.fromEntries(PAEDIATRICS_SYLLABUS.map((t) => { const reviewed = state.topics[t.id]?.lastReviewedAt; return [t.id, selected.has(t.id) ? { firstPassCompletedAt: reviewed || now, firstPassSource:'manual-confirmed', firstPassManual:true } : {}]; }));
  return { schemaVersion:1, coverageSemanticsVersion:2, initializedAt:now, baselineCapturedAt:now, baselineFirstPassCount:selected.size, topics, updatedAt:now };
}

/** Remove the old direct-Pass-1 artefact that recorded Pass 0 and Pass 1 as the same assistant session. */
export function normalizeRecallSupersession(progress: StudyPlanProgress): { progress: StudyPlanProgress; changed: boolean } {
  let next = progress;
  for (const [topicId, topic] of Object.entries(progress.topics)) {
    const source = topic.firstPassSource;
    const synthetic = !!topic.firstPassCompletedAt
      && topic.firstPassCompletedAt === topic.secondPassCompletedAt
      && !!source
      && source === topic.secondPassSource
      && (source === 'assistant' || source.startsWith('assistant:'));
    if (!synthetic) continue;
    if (next === progress) next = structuredClone(progress);
    const corrected = next.topics[topicId];
    const removedAt = corrected.firstPassCompletedAt;
    delete corrected.firstPassCompletedAt;
    delete corrected.firstPassSource;
    delete corrected.firstPassManual;
    corrected.completionHistory = corrected.completionHistory?.filter(entry => !(
      entry.pass === 'first' && entry.complete && entry.source === source && entry.changedAt === removedAt
    ));
    if (!corrected.completionHistory?.length) delete corrected.completionHistory;
  }
  return { progress: next, changed: next !== progress };
}
// Explicit Paediatrics coverage remains untouched; legacy first/second records keep their meanings.
export function migrateToExplicitCoverage(progress:StudyPlanProgress):StudyPlanProgress { return progress; }
