import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecentStudyTimeline, buildStudyDayTimeline, buildStudyWeekTimeline } from '../src/lib/paediatrics/studyTimeline.ts';

const session = (id, extra = {}) => ({
  id,
  date: '2026-09-22T12:00:00.000Z',
  createdAt: '2026-09-22T12:00:00.000Z',
  label: id,
  questions: 0,
  averageMastery: 0,
  assessedTopics: 0,
  ...extra
});

test('timeline places completed timers at Prague clock time and keeps active time separate from the session window', () => {
  const result = buildStudyDayTimeline([session('1a', {
    topicIds: ['1a'],
    durationSeconds: 1800,
    studyStartedAt: '2026-09-22T08:00:00.000Z',
    studyEndedAt: '2026-09-22T09:00:00.000Z',
    studySource: 'trackr'
  })], '2026-09-22', 'Europe/Prague');
  assert.equal(result.totalSeconds, 1800);
  assert.equal(result.timed[0].clockLabel, '10:00–11:00');
  assert.equal(result.timed[0].startMinute, 600);
  assert.equal(result.timed[0].endMinute, 660);
  assert.equal(result.timed[0].durationSeconds, 1800, 'a one-hour window can contain only 30 active minutes after pauses');
  assert.equal(result.timed[0].unlocatedPauseSeconds, 1800, 'older sessions retain their pause total even without interval details');
});

test('timeline exposes exact break intervals and weekly totals', () => {
  const timed = session('1a', {
    topicIds: ['1a'],
    durationSeconds: 1500,
    studyStartedAt: '2026-09-22T08:00:00.000Z',
    studyEndedAt: '2026-09-22T08:45:00.000Z',
    studySource: 'trackr',
    pauseIntervals: [
      { startedAt: '2026-09-22T08:10:00.000Z', endedAt: '2026-09-22T08:25:00.000Z' },
      { startedAt: '2026-09-22T08:40:00.000Z', endedAt: '2026-09-22T08:45:00.000Z' }
    ]
  });
  const day = buildStudyDayTimeline([timed], '2026-09-22', 'Europe/Prague');
  assert.deepEqual(day.timed[0].pauses.map((pause) => pause.clockLabel), ['10:10–10:25', '10:40–10:45']);
  assert.equal(day.timed[0].totalPauseSeconds, 1200);
  assert.equal(day.timed[0].unlocatedPauseSeconds, 0);
  const week = buildStudyWeekTimeline([timed], '2026-09-23', 'Europe/Prague');
  assert.equal(week.startDate, '2026-09-21');
  assert.equal(week.endDate, '2026-09-27');
  assert.equal(week.days.length, 7);
  assert.equal(week.totalSeconds, 1500);
  assert.equal(week.timedBlocks, 1);
  const recent = buildRecentStudyTimeline([timed], '2026-09-23', 'Europe/Prague');
  assert.equal(recent.startDate, '2026-09-17');
  assert.equal(recent.endDate, '2026-09-23');
  assert.deepEqual(recent.days.map((day) => day.date), ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
});

test('AnkiConnect time replaces legacy Anki timer rows without hiding Trackr study', () => {
  const result = buildStudyDayTimeline([
    session('guided', { durationSeconds: 1200, studyStartedAt: '2026-09-22T07:00:00.000Z', studyEndedAt: '2026-09-22T07:20:00.000Z', studySource: 'trackr' }),
    session('legacy-anki', { durationSeconds: 600, studyStartedAt: '2026-09-22T08:00:00.000Z', studyEndedAt: '2026-09-22T08:10:00.000Z', studySource: 'anki', studyTimeOrigin: 'timer' }),
    session('connected-anki', { durationSeconds: 900, studyStartedAt: '2026-09-22T08:00:00.000Z', studyEndedAt: '2026-09-22T10:00:00.000Z', studySource: 'anki', studyTimeOrigin: 'anki-connect', studyDay: '2026-09-22' })
  ], '2026-09-22', 'Europe/Prague');
  assert.deepEqual(result.timed.map((entry) => entry.id), ['guided', 'connected-anki']);
  assert.equal(result.totalSeconds, 2100);
});

test('sessions without timer metadata remain visible as log markers on their assigned day', () => {
  const result = buildStudyDayTimeline([session('patch-only', { topicIds: ['3c'] })], '2026-09-22', 'Europe/Prague');
  assert.equal(result.timed.length, 0);
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].clockLabel, 'Logged 14:00');
  assert.equal(buildStudyDayTimeline([session('patch-only')], '2026-09-21', 'Europe/Prague').markers.length, 0);
});
