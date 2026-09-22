import { coverageFromReviews } from './reviewCoverage';
import type { SessionSnapshot } from './paediatricsSchema';
import { passCompletionKey, type PlanPass } from './studyPlanSchema';
import type { StudyPlanProgress } from './studyPlanSchema';
import type { PaediatricsReviewEvent } from './paediatricsReview';

export type DailyPaediatricsSnapshot = {
  date: string;
  averageMastery: number;
  assessedTopics: number;
  questions: number;
  imports: number;
  topicIds: string[];
  durationSeconds: number;
  guidedDurationSeconds: number;
  ankiDurationSeconds: number;
};

function dateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** One chart point per local calendar day, represented by the final snapshot. */
export function groupPaediatricsSessionsByDay(sessions: SessionSnapshot[], timeZone = 'Europe/Prague'): DailyPaediatricsSnapshot[] {
  const days = new Map<string, {
    final: SessionSnapshot;
    questions: number;
    imports: number;
    topicIds: Set<string>;
    guidedDurationSeconds: number;
    legacyAnkiDurationSeconds: number;
    connectedAnkiDurationSeconds?: number;
  }>();
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(session.studyDay ?? '') ? session.studyDay! : dateInTimeZone(session.date, timeZone);
    const day = days.get(date) ?? { final: session, questions: 0, imports: 0, topicIds: new Set<string>(), guidedDurationSeconds: 0, legacyAnkiDurationSeconds: 0 };
    day.final = session;
    day.questions += session.questions;
    day.imports += 1;
    if (session.studySource === 'anki') {
      if (session.studyTimeOrigin === 'anki-connect') day.connectedAnkiDurationSeconds = session.durationSeconds ?? 0;
      else day.legacyAnkiDurationSeconds += session.durationSeconds ?? 0;
    } else day.guidedDurationSeconds += session.durationSeconds ?? 0;
    for (const id of session.topicIds ?? []) day.topicIds.add(id);
    days.set(date, day);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => {
    // Once AnkiConnect has supplied an absolute total, it is authoritative for
    // that Anki day. Legacy manual Anki timers remain as fallback history only.
    const ankiDurationSeconds = day.connectedAnkiDurationSeconds ?? day.legacyAnkiDurationSeconds;
    return {
      date,
      averageMastery: day.final.averageMastery,
      assessedTopics: day.final.assessedTopics,
      questions: day.questions,
      imports: day.imports,
      topicIds: [...day.topicIds],
      durationSeconds: day.guidedDurationSeconds + ankiDurationSeconds,
      guidedDurationSeconds: day.guidedDurationSeconds,
      ankiDurationSeconds
    };
  });
}

/** Explicit pass completions per date; assessment activity is deliberately ignored. */
export function passCompletionsByDay(progress: StudyPlanProgress | null | undefined, pass: PlanPass) {
  const counts: Record<string, number> = {};
  if (!progress) return counts;
  for (const topic of Object.values(progress.topics)) {
    const date = topic[passCompletionKey(pass)]?.slice(0, 10);
    if (date) counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}

export const firstPassCompletionsByDay = (progress?: StudyPlanProgress | null) => passCompletionsByDay(progress, 'first');
export const secondPassCompletionsByDay = (progress?: StudyPlanProgress | null) => passCompletionsByDay(progress, 'second');

export type DailyStructuredActivity = {
  date: string;
  firstPasses: number;
  secondPasses: number;
  thirdPasses: number;
  gapRepairTopics: number;
  gapRepairEquivalent: number;
  gapsTested: number;
  gapsResolved: number;
};

// A focused gap check samples only a narrow part of an official topic. It is
// therefore visualized as one quarter of a full-pass topic, while the tooltip
// retains the unweighted topic and gap counts.
export const GAP_REPAIR_TOPIC_WEIGHT = 0.25;

/**
 * Counts unique topics, not patch uploads. A topic already counted in any full round on a date is deliberately not added again as Gap Repair on
 * that date, so stacked bars cannot be inflated by multiple patch events.
 */
export function structuredActivityByDay(progress:StudyPlanProgress|null|undefined,reviews:PaediatricsReviewEvent[]):DailyStructuredActivity[] {
  const days=new Map<string,{first:Set<string>;second:Set<string>;third:Set<string>;gapRepair:Set<string>;gapsTested:number;gapsResolved:number}>();
  const getDay=(date:string)=>{
    const existing=days.get(date);
    if(existing) return existing;
    const created={first:new Set<string>(),second:new Set<string>(),third:new Set<string>(),gapRepair:new Set<string>(),gapsTested:0,gapsResolved:0};
    days.set(date,created);
    return created;
  };
  const coveredProgress=coverageFromReviews(progress??null,reviews);
  if(coveredProgress) for(const [topicId,topic] of Object.entries(coveredProgress.topics)) {
    const firstDate=topic.firstPassCompletedAt?.slice(0,10);
    const secondDate=topic.secondPassCompletedAt?.slice(0,10);
    if(firstDate) getDay(firstDate).first.add(topicId);
    if(secondDate) getDay(secondDate).second.add(topicId);
    const thirdDate=topic.thirdPassCompletedAt?.slice(0,10);
    if(thirdDate) getDay(thirdDate).third.add(topicId);
  }
  for(const review of reviews) {
    if(review.pass!=='review'||!review.gapResults?.length) continue;
    const date=review.reviewedAt.slice(0,10);
    const day=getDay(date);
    day.gapRepair.add(review.topicId);
    day.gapsTested+=review.gapResults.length;
    day.gapsResolved+=review.gapResults.filter((result)=>result.outcome==='resolved').length;
  }
  return [...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,day])=>{
    for(const topicId of [...day.gapRepair]) if(day.first.has(topicId)||day.second.has(topicId)||day.third.has(topicId)) day.gapRepair.delete(topicId);
    return {date,firstPasses:day.first.size,secondPasses:day.second.size,thirdPasses:day.third.size,gapRepairTopics:day.gapRepair.size,gapRepairEquivalent:day.gapRepair.size*GAP_REPAIR_TOPIC_WEIGHT,gapsTested:day.gapsTested,gapsResolved:day.gapsResolved};
  });
}
