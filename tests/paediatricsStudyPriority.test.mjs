import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { buildStudyQueue, buildReviewQueue, buildGapRepairQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';

const NOW = '2026-09-16T12:00:00.000Z';
const EARLIER = '2026-09-12T12:00:00.000Z';

test('four learned topics and a failed Pass 1 do not crowd out the remaining 116 Pass 0 topics', () => {
  const state = createEmptyPaediatricsState(NOW);
  const progress = createPlanProgress(state, [], NOW);
  for (const id of ['1a', '1b', '1c', '2a']) progress.topics[id].firstPassCompletedAt = EARLIER;
  for (const id of ['1a', '1b']) progress.topics[id].secondPassCompletedAt = EARLIER;
  state.topics['1b'].mastery = 1;
  state.topics['1b'].gaps = [1, 2].map(i => ({ id: `gap-${i}`, text: `Missing point ${i}`, priority: 'critical', createdAt: EARLIER }));
  const events = [{ id: 'failed-1b', topicId: '1b', reviewedAt: EARLIER, createdAt: EARLIER, outcome: 'failed', pass: 'second', source: 'assistant' }];
  const originalData = structuredClone({ state, progress, events });
  const urgent = buildReviewQueue(state, progress, events, NOW.slice(0, 10));
  const originalQueue = structuredClone(urgent);
  assert.equal(urgent[0].topicId, '1b');
  const study = buildStudyQueue(urgent, 'first');
  assert.equal(study[0].topicId, '2b');
  assert.ok(study.slice(0, 116).every(entry => entry.nextPass === 'first'));
  assert.equal(study[116].topicId, '1b');
  assert.equal(buildGapRepairQueue(state, progress, events, NOW.slice(0, 10), NOW)[0].topicId, '1b');
  assert.match(makeStudyChatPrompt(study[0], state, progress), /Pass 0/);
  assert.match(makeStudyChatPrompt(urgent[0], state, progress), /Pass 2/);
  assert.equal(buildStudyQueue(urgent, 'first', true).length, 116);
  assert.deepEqual(urgent, originalQueue);
  assert.deepEqual({ state, progress, events }, originalData);
});

test('each learning round precedes later retests while preserving urgency within that round', () => {
  const state = createEmptyPaediatricsState(NOW);
  const progress = createPlanProgress(state, [], NOW);
  for (const entry of Object.values(progress.topics)) entry.firstPassCompletedAt = EARLIER;
  progress.topics['1b'].secondPassCompletedAt = EARLIER;
  state.topics['1b'].gaps = [{ id: 'b', text: 'Critical later gap', priority: 'critical', createdAt: EARLIER }];
  state.topics['2a'].gaps = [{ id: 'a', text: 'Critical current gap', priority: 'critical', createdAt: EARLIER }];
  let urgent = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  const current = urgent.filter(entry => entry.nextPass === 'second');
  assert.equal(current[0].topicId, '2a');
  assert.deepEqual(buildStudyQueue(urgent, 'second').slice(0, 119), current);
  assert.deepEqual(buildStudyQueue(urgent, 'second', true), current);
  for (const entry of Object.values(progress.topics)) entry.secondPassCompletedAt = EARLIER;
  urgent = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  assert.deepEqual(buildStudyQueue(urgent, 'third'), urgent);
  assert.ok(buildStudyQueue(urgent, 'third').every(entry => entry.nextPass === 'third'));
});

test('ongoing review retains the full urgency queue and respects Ignore retests', () => {
  const state = createEmptyPaediatricsState(NOW);
  const progress = createPlanProgress(state, [], NOW);
  for (const entry of Object.values(progress.topics)) Object.assign(entry, {
    firstPassCompletedAt: EARLIER, secondPassCompletedAt: EARLIER, thirdPassCompletedAt: EARLIER
  });
  const queue = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  assert.deepEqual(buildStudyQueue(queue, 'review'), queue);
  assert.notEqual(buildStudyQueue(queue, 'review'), queue);
  assert.deepEqual(buildStudyQueue(queue, 'review', true), []);
  assert.deepEqual(buildStudyQueue([], 'first'), []);
});

test('random order is stable and only shuffles topics with identical priority', () => {
  const state = createEmptyPaediatricsState(NOW);
  const progress = createPlanProgress(state, [], NOW);
  progress.topics['40c'].redZonePinned = true;
  const queue = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  const natural = buildStudyQueue(queue, 'first', true).map(entry => entry.topicId);
  const randomized = buildStudyQueue(queue, 'first', true, 'test-seed').map(entry => entry.topicId);
  assert.equal(natural[0], '40c');
  assert.equal(randomized[0], '40c', 'higher-priority topic must remain first');
  assert.deepEqual(buildStudyQueue(queue, 'first', true, 'test-seed').map(entry => entry.topicId), randomized, 'same seed must remain stable');
  assert.notDeepEqual(randomized.slice(1), natural.slice(1), 'equal-priority new topics should be mixed');
  assert.deepEqual([...randomized].sort(), [...natural].sort(), 'random order must not add or remove topics');
});
