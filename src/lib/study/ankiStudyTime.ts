export type TimedAnkiReview = {
  id: number;
  time: number;
  type: number;
  ease?: number;
};

export type AnkiDailyStudyTime = {
  date: string;
  durationSeconds: number;
  reviewCount: number;
  firstReviewAt: string;
  lastReviewAt: string;
};

export const DEFAULT_ANKI_DAY_START_HOUR = 4;
export const ANKI_TIME_SESSION_PREFIX = 'anki-connect-surgery-gaps-';

export function normalizeAnkiDayStartHour(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : DEFAULT_ANKI_DAY_START_HOUR;
}

function localDateAndHour(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

export function shiftDateKey(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Maps a review to Anki's civil study day. Comparing the local wall-clock hour
 * before shifting the date keeps the boundary correct across DST changes.
 */
export function ankiStudyDayKey(timestamp: number, rolloverHour = DEFAULT_ANKI_DAY_START_HOUR, timeZone = 'Europe/Prague') {
  const local = localDateAndHour(timestamp, timeZone);
  return local.hour < normalizeAnkiDayStartHour(rolloverHour) ? shiftDateKey(local.date, -1) : local.date;
}

/** Absolute daily totals derived from Anki's revlog. Repeated revlog IDs are
 * discarded and manual-reschedule rows are not study evidence. */
export function summarizeAnkiReviewTime(reviews: TimedAnkiReview[], rolloverHour = DEFAULT_ANKI_DAY_START_HOUR, timeZone = 'Europe/Prague'): AnkiDailyStudyTime[] {
  const seen = new Set<number>();
  const days = new Map<string, { milliseconds: number; count: number; first: number; last: number }>();
  for (const review of reviews) {
    if (!Number.isFinite(review.id) || review.id <= 0 || seen.has(review.id) || review.type === 4) continue;
    if (review.ease !== undefined && (!Number.isInteger(review.ease) || review.ease < 1 || review.ease > 4)) continue;
    if (!Number.isFinite(review.time) || review.time < 0) continue;
    seen.add(review.id);
    const date = ankiStudyDayKey(review.id, rolloverHour, timeZone);
    const day = days.get(date) ?? { milliseconds: 0, count: 0, first: review.id, last: review.id };
    day.milliseconds += review.time;
    day.count += 1;
    day.first = Math.min(day.first, review.id);
    day.last = Math.max(day.last, review.id);
    days.set(date, day);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({
    date,
    durationSeconds: Math.round(day.milliseconds / 1000),
    reviewCount: day.count,
    firstReviewAt: new Date(day.first).toISOString(),
    lastReviewAt: new Date(day.last).toISOString()
  }));
}

export function ankiTimeSessionId(date: string) {
  return `${ANKI_TIME_SESSION_PREFIX}${date}`;
}
