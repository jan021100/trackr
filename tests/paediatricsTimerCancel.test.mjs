import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { cancelStudyTimer, pauseStudyTimer, startStudyTimer } from '../src/lib/paediatrics/studyTimer.ts';

const started = new Date('2026-09-12T21:00:00.000Z');
const ended = new Date('2026-09-13T07:00:00.000Z');

for (const status of ['running', 'paused']) {
  test(`cancelling a ${status} timer removes only the unfinished timer, including overnight`, () => {
    const state = createEmptyPaediatricsState(started.toISOString());
    state.topics['1a'].mastery = 3;
    state.topics['1a'].attempts = 4;
    state.topics['1a'].notes = 'Keep existing study progress';
    state.activeStudyTimer = startStudyTimer('1a', started);
    if (status === 'paused') state.activeStudyTimer = pauseStudyTimer(state.activeStudyTimer, new Date('2026-09-12T21:12:00.000Z'));
    const before = structuredClone(state);
    const result = cancelStudyTimer(state, state.activeStudyTimer, ended);
    const expected = { ...before, updatedAt: ended.toISOString() };
    delete expected.activeStudyTimer;
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.state, expected);
    assert.deepEqual(state, before, 'the original state stays intact until the save succeeds');
    assert.equal(Object.hasOwn(result.state, 'activeStudyTimer'), false);
    assert.equal(cancelStudyTimer(result.state, before.activeStudyTimer, ended).cancelled, false);
  });
}

test('a stale Cancel cannot discard a replacement session for the same or another topic', () => {
  const state = createEmptyPaediatricsState(started.toISOString());
  const expected = startStudyTimer('1a', started);
  for (const timer of [startStudyTimer('1a', ended), startStudyTimer('1b', started)]) {
    state.activeStudyTimer = timer;
    const result = cancelStudyTimer(state, expected, ended);
    assert.equal(result.cancelled, false);
    assert.equal(result.state, state);
    assert.equal(result.state.activeStudyTimer, timer);
  }
});

test('legacy Anki cancellation only accepts the matching batch and creates no recorded activity', () => {
  const state = createEmptyPaediatricsState(started.toISOString());
  const timer = { kind: 'anki-gap', batchId: 'batch-1', gapIds: ['gap-1'], topicIds: ['1a'], startedAt: started.toISOString(), accumulatedSeconds: 300, status: 'paused' };
  state.activeStudyTimer = timer;
  assert.equal(cancelStudyTimer(state, { ...timer, batchId: 'batch-2' }, ended).cancelled, false);
  assert.equal(cancelStudyTimer(state, startStudyTimer('1a', started), ended).cancelled, false);
  const result = cancelStudyTimer(state, timer, ended);
  assert.equal(result.cancelled, true);
  assert.deepEqual(Object.keys(result).sort(), ['cancelled', 'state']);
  assert.deepEqual(result.state.topics, state.topics);
  assert.equal(result.state.activeStudyTimer, undefined);
});
