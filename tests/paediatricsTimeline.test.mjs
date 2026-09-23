import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyDayTimeline } from '../src/lib/paediatrics/studyTimeline.ts';

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
