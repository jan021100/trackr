import type { SessionSnapshot } from './surgerySchema';
import type { StudyPlanProgress } from './studyPlanSchema';

export type DailySurgerySnapshot = {
  date: string;
  averageMastery: number;
  assessedTopics: number;
  questions: number;
  imports: number;
  topicIds: string[];
};

function dateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** One chart point per local calendar day, represented by the final snapshot. */
export function groupSurgerySessionsByDay(sessions: SessionSnapshot[], timeZone = 'Europe/Prague'): DailySurgerySnapshot[] {
  const days = new Map<string, { final: SessionSnapshot; questions: number; imports: number; topicIds: Set<string> }>();
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const date = dateInTimeZone(session.date, timeZone);
    const day = days.get(date) ?? { final: session, questions: 0, imports: 0, topicIds: new Set<string>() };
    day.final = session;
    day.questions += session.questions;
    day.imports += 1;
    for (const id of session.topicIds ?? []) day.topicIds.add(id);
    days.set(date, day);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({
    date,
    averageMastery: day.final.averageMastery,
    assessedTopics: day.final.assessedTopics,
    questions: day.questions,
    imports: day.imports,
    topicIds: [...day.topicIds]
  }));
}

/** Explicit first-pass completions per date; assessment activity is deliberately ignored. */
export function firstPassCompletionsByDay(progress?: StudyPlanProgress | null) {
  const counts: Record<string, number> = {};
  if (!progress) return counts;
  for (const topic of Object.values(progress.topics)) {
    const date = topic.firstPassCompletedAt?.slice(0, 10);
    if (date) counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}
