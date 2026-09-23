import type { SessionSnapshot } from './paediatricsSchema';
import { shiftDateKey } from './ankiStudyTime';

export type StudyTimelinePause = {
  clockLabel: string;
  durationSeconds: number;
  startMinute?: number;
  endMinute?: number;
  exactDayPlacement: boolean;
};

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
  pauses: StudyTimelinePause[];
  totalPauseSeconds: number;
  unlocatedPauseSeconds: number;
};

export type StudyDayTimeline = {
  date: string;
  timed: StudyTimelineEntry[];
  markers: StudyTimelineEntry[];
  totalSeconds: number;
};

export type StudyWeekTimeline = {
  startDate: string;
  endDate: string;
  days: StudyDayTimeline[];
  totalSeconds: number;
  timedBlocks: number;
  markers: number;
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

function pauseFor(startedAt: string, endedAt: string | undefined, date: string, timeZone: string): StudyTimelinePause | undefined {
  if (!endedAt || Date.parse(endedAt) < Date.parse(startedAt)) return undefined;
  const start = localStamp(startedAt, timeZone);
  const end = localStamp(endedAt, timeZone);
  if (!start || !end) return undefined;
  const exactDayPlacement = start.date === date && end.date === date;
  return {
    clockLabel: start.date === end.date ? `${start.clock}–${end.clock}` : `${start.date} ${start.clock}–${end.date} ${end.clock}`,
    durationSeconds: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
    ...(exactDayPlacement ? { startMinute: start.minutes, endMinute: Math.max(start.minutes + 1, end.minutes) } : {}),
    exactDayPlacement
  };
}

function entryFor(session: SessionSnapshot, date: string, timeZone: string): StudyTimelineEntry | undefined {
  if (assignedDay(session, timeZone) !== date) return undefined;
  const start = localStamp(session.studyStartedAt, timeZone);
  const end = localStamp(session.studyEndedAt, timeZone);
  const logged = localStamp(session.date, timeZone);
  const source: StudyTimelineEntry['source'] = session.studySource === 'anki' ? 'anki' : 'trackr';
  const pauses = (session.pauseIntervals ?? [])
    .map((pause) => pauseFor(pause.startedAt, pause.endedAt, date, timeZone))
    .filter((pause): pause is StudyTimelinePause => Boolean(pause));
  const recordedPauseSeconds = pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0);
  const base = {
    id: session.id,
    label: session.label,
    topicIds: session.topicIds ?? [],
    durationSeconds: Math.max(0, session.durationSeconds ?? 0),
    source,
    ...(session.studyTimeOrigin ? { origin: session.studyTimeOrigin } : {}),
    pauses
  };
  if (!start || !end || new Date(session.studyEndedAt!).getTime() < new Date(session.studyStartedAt!).getTime()) {
    return { ...base, clockLabel: logged ? `Logged ${logged.clock}` : 'Logged', exactDayPlacement: false, totalPauseSeconds: recordedPauseSeconds, unlocatedPauseSeconds: 0 };
  }
  const exactDayPlacement = start.date === date && end.date === date;
  const clockLabel = start.date === end.date
    ? `${start.clock}–${end.clock}`
    : `${start.date} ${start.clock}–${end.date} ${end.clock}`;
  const inferLegacyPauses = source === 'trackr' || session.studyTimeOrigin === 'timer';
  const windowSeconds = Math.max(0, Math.round((Date.parse(session.studyEndedAt!) - Date.parse(session.studyStartedAt!)) / 1000));
  const totalPauseSeconds = inferLegacyPauses ? Math.max(recordedPauseSeconds, windowSeconds - base.durationSeconds) : recordedPauseSeconds;
  const missingPauseSeconds = Math.max(0, totalPauseSeconds - recordedPauseSeconds);
  return {
    ...base,
    clockLabel,
    ...(exactDayPlacement ? { startMinute: start.minutes, endMinute: Math.max(start.minutes + 1, end.minutes) } : {}),
    exactDayPlacement,
    totalPauseSeconds,
    unlocatedPauseSeconds: missingPauseSeconds > 2 ? missingPauseSeconds : 0
  };
}

/** AnkiConnect is authoritative for Anki time on a day, so manual Anki timer rows are hidden when imported review time exists. */
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

export function weekStartFor(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return date;
  return shiftDateKey(date, -((value.getUTCDay() + 6) % 7));
}

export function buildStudyWeekTimeline(sessions: SessionSnapshot[], weekStart: string, timeZone = 'Europe/Prague'): StudyWeekTimeline {
  const startDate = weekStartFor(weekStart);
  const days = Array.from({ length: 7 }, (_, index) => buildStudyDayTimeline(sessions, shiftDateKey(startDate, index), timeZone));
  return {
    startDate,
    endDate: shiftDateKey(startDate, 6),
    days,
    totalSeconds: days.reduce((sum, day) => sum + day.totalSeconds, 0),
    timedBlocks: days.reduce((sum, day) => sum + day.timed.length, 0),
    markers: days.reduce((sum, day) => sum + day.markers.length, 0)
  };
}
