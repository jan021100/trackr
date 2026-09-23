import type { SessionSnapshot } from './paediatricsSchema';

export type StudyTimelineEntry = {
  id: string;
  label: string;
  topicIds: string[];
  durationSeconds: number;
  source: 'trackr' | 'anki';
  origin?: 'timer' | 'anki-connect';
  clockLabel: string;
  startMinute?: number;
  endMinute?: number;
  exactDayPlacement: boolean;
};

export type StudyDayTimeline = {
  date: string;
  timed: StudyTimelineEntry[];
  markers: StudyTimelineEntry[];
  totalSeconds: number;
};

type LocalStamp = { date: string; minutes: number; clock: string };

function localStamp(value: string | undefined, timeZone: string): LocalStamp | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if (![hour, minute].every(Number.isFinite)) return undefined;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + minute, clock: `${get('hour')}:${get('minute')}` };
}

function assignedDay(session: SessionSnapshot, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(session.studyDay ?? '')) return session.studyDay!;
  return localStamp(session.date, timeZone)?.date;
}

function entryFor(session: SessionSnapshot, date: string, timeZone: string): StudyTimelineEntry | undefined {
  if (assignedDay(session, timeZone) !== date) return undefined;
  const start = localStamp(session.studyStartedAt, timeZone);
  const end = localStamp(session.studyEndedAt, timeZone);
  const logged = localStamp(session.date, timeZone);
  const source: StudyTimelineEntry['source'] = session.studySource === 'anki' ? 'anki' : 'trackr';
  const base = {
    id: session.id,
    label: session.label,
    topicIds: session.topicIds ?? [],
    durationSeconds: Math.max(0, session.durationSeconds ?? 0),
    source,
    ...(session.studyTimeOrigin ? { origin: session.studyTimeOrigin } : {})
  };
  if (!start || !end || new Date(session.studyEndedAt!).getTime() < new Date(session.studyStartedAt!).getTime()) {
    return { ...base, clockLabel: logged ? `Logged ${logged.clock}` : 'Logged', exactDayPlacement: false };
  }
  const exactDayPlacement = start.date === date && end.date === date;
  const clockLabel = start.date === end.date
    ? `${start.clock}–${end.clock}`
    : `${start.date} ${start.clock}–${end.date} ${end.clock}`;
  return {
    ...base,
    clockLabel,
    ...(exactDayPlacement ? { startMinute: start.minutes, endMinute: Math.max(start.minutes + 1, end.minutes) } : {}),
    exactDayPlacement
  };
}

/**
 * Builds one study-day timeline using the same day assignment as the progress
 * chart. AnkiConnect is authoritative for Anki time on a day, so older manual
 * Anki timer rows are hidden when an imported review-time window exists.
 */
export function buildStudyDayTimeline(sessions: SessionSnapshot[], date: string, timeZone = 'Europe/Prague'): StudyDayTimeline {
  let entries = sessions.map((session) => entryFor(session, date, timeZone)).filter((entry): entry is StudyTimelineEntry => Boolean(entry));
  const hasConnectedAnki = entries.some((entry) => entry.source === 'anki' && entry.origin === 'anki-connect');
  if (hasConnectedAnki) entries = entries.filter((entry) => entry.source !== 'anki' || entry.origin === 'anki-connect');
  entries.sort((a, b) => (a.startMinute ?? 1441) - (b.startMinute ?? 1441) || a.clockLabel.localeCompare(b.clockLabel));
  return {
    date,
    timed: entries.filter((entry) => entry.durationSeconds > 0 || entry.exactDayPlacement),
    markers: entries.filter((entry) => entry.durationSeconds === 0 && !entry.exactDayPlacement),
    totalSeconds: entries.reduce((sum, entry) => sum + entry.durationSeconds, 0)
  };
}
