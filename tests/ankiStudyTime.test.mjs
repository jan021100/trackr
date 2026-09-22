import test from 'node:test';
import assert from 'node:assert/strict';
import { ankiStudyDayKey, ankiTimeSessionId, normalizeAnkiDayStartHour, summarizeAnkiReviewTime } from '../src/lib/study/ankiStudyTime.ts';

const review = (iso, time, extra = {}) => ({ id: Date.parse(iso), time, type: 1, ease: 3, ...extra });

test('Anki review time is deduplicated and summed once per rollover day', () => {
  const repeated = review('2026-09-07T01:00:00.000Z', 61_000);
  const days = summarizeAnkiReviewTime([
    review('2026-09-06T22:30:00.000Z', 30_000), // 00:30 in Prague on Sep 7
    repeated,
    repeated,
    review('2026-09-07T02:00:00.000Z', 45_500), // exactly 04:00 in Prague
    review('2026-09-07T02:10:00.000Z', 99_000, { type: 4, ease: 0 }),
    review('2026-09-07T02:20:00.000Z', -1),
    review('2026-09-07T02:30:00.000Z', 10_000, { ease: 0 })
  ], 4, 'Europe/Prague');
  assert.deepEqual(days.map(({ date, durationSeconds, reviewCount }) => ({ date, durationSeconds, reviewCount })), [
    { date: '2026-09-06', durationSeconds: 91, reviewCount: 2 },
    { date: '2026-09-07', durationSeconds: 46, reviewCount: 1 }
  ]);
});

test('the 04:00 boundary uses Prague civil time, including the DST transition', () => {
  assert.equal(ankiStudyDayKey(Date.parse('2026-09-07T01:59:00.000Z'), 4, 'Europe/Prague'), '2026-09-06');
  assert.equal(ankiStudyDayKey(Date.parse('2026-09-07T02:00:00.000Z'), 4, 'Europe/Prague'), '2026-09-07');
  assert.equal(ankiStudyDayKey(Date.parse('2026-03-29T01:59:00.000Z'), 4, 'Europe/Prague'), '2026-03-28');
  assert.equal(ankiStudyDayKey(Date.parse('2026-03-29T02:00:00.000Z'), 4, 'Europe/Prague'), '2026-03-29');
});

test('rollover setting and daily Firestore identity remain deterministic', () => {
  assert.equal(normalizeAnkiDayStartHour(7), 7);
  assert.equal(normalizeAnkiDayStartHour(24), 4);
  assert.equal(ankiTimeSessionId('2026-09-07'), 'anki-connect-surgery-gaps-2026-09-07');
  assert.equal(ankiTimeSessionId('2026-09-07'), ankiTimeSessionId('2026-09-07'));
});
