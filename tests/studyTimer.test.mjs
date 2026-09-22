import test from 'node:test';
import assert from 'node:assert/strict';
import { finishStudyTimer, formatStudyDurationCompact, isAnkiStudyTimer, pauseStudyTimer, resumeStudyTimer, startAnkiStudyTimer, startStudyTimer, timerElapsedSeconds } from '../src/lib/study/studyTimer.ts';

test('timer counts only running time across pause and resume', () => {
  const started = startStudyTimer('TO1-01', new Date('2026-08-27T10:00:00Z'));
  const paused = pauseStudyTimer(started, new Date('2026-08-27T10:10:30Z'));
  assert.equal(paused.accumulatedSeconds, 630);
  assert.equal(timerElapsedSeconds(paused, new Date('2026-08-27T11:00:00Z').getTime()), 630);
  const resumed = resumeStudyTimer(paused, new Date('2026-08-27T11:00:00Z'));
  assert.equal(timerElapsedSeconds(resumed, new Date('2026-08-27T11:04:00Z').getTime()), 870);
});

test('finishing clears active timer without changing topic progress', () => {
  const topic = { mastery: 2 };
  const state = { updatedAt: '', topics: { 'TO1-01': topic }, activeStudyTimer: startStudyTimer('TO1-01', new Date('2026-08-27T10:00:00Z')) };
  const result = finishStudyTimer(state, new Date('2026-08-27T10:25:00Z'));
  assert.equal(result.durationSeconds, 1500);
  assert.equal(result.state.activeStudyTimer, undefined);
  assert.deepEqual(result.state.topics['TO1-01'], topic);
});

test('compact durations remain readable in dashboard metrics', () => {
  assert.equal(formatStudyDurationCompact(35), '35s');
  assert.equal(formatStudyDurationCompact(750), '12m');
  assert.equal(formatStudyDurationCompact(3930), '1h 5m');
});

test('Anki gap timer preserves its batch metadata across pause and resume', () => {
  const started = startAnkiStudyTimer(['gap-a', 'gap-b'], ['TO1-01', 'TO1-02'], new Date('2026-09-06T10:00:00Z'));
  const paused = pauseStudyTimer(started, new Date('2026-09-06T10:12:00Z'));
  const resumed = resumeStudyTimer(paused, new Date('2026-09-06T10:30:00Z'));
  assert.equal(isAnkiStudyTimer(resumed), true);
  assert.deepEqual(resumed.gapIds, ['gap-a', 'gap-b']);
  assert.deepEqual(resumed.topicIds, ['TO1-01', 'TO1-02']);
  assert.equal(timerElapsedSeconds(resumed, new Date('2026-09-06T10:35:00Z').getTime()), 1020);
});
