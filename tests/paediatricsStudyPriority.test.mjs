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

test('after acquisition all topics compete irrespective of pass, including saved Ignore retests', () => {
  const state = createEmptyPaediatricsState(NOW), progress = createPlanProgress(state, [], NOW);
  for (const topic of Object.values(progress.topics)) topic.firstPassCompletedAt = EARLIER;
  progress.topics['1b'].secondPassCompletedAt = EARLIER;
  progress.topics['1c'].thirdPassCompletedAt = EARLIER;
  const queue = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  for (const pass of ['first', 'second', 'third', 'review']) {
    assert.deepEqual(buildStudyQueue(queue, pass), queue);
    assert.deepEqual(buildStudyQueue(queue, pass, true), queue);
  }
  assert.equal(queue.length, 120);
  assert.deepEqual(buildStudyQueue([], 'first'), []);
});

const assessment = (rating, assessedAt) => ({ratings:{coverage:rating,accuracy:rating,independence:rating,clinicalReasoning:rating,propedeutics:rating},safetyCriticalError:false,evidence:'Independent recall',assessedAt});

test('unscored topics precede scored safety-critical topics, oldest unscored first', () => {
  const state = createEmptyPaediatricsState(NOW), progress = createPlanProgress(state, [], NOW);
  for (const [id, topic] of Object.entries(progress.topics)) {
    topic.firstPassCompletedAt = EARLIER;
    state.topics[id].oralAssessment = assessment(4, EARLIER);
  }
  delete state.topics['1a'].oralAssessment;
  delete state.topics['1b'].oralAssessment;
  state.topics['1a'].mastery = 4; // Legacy score cannot substitute for the detailed assessment.
  progress.topics['1a'].firstPassCompletedAt = '2026-09-01T12:00:00.000Z';
  state.topics['1c'].oralAssessment = assessment(0, EARLIER);
  const queue = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  assert.deepEqual(queue.slice(0, 3).map(t=>t.topicId), ['1a', '1b', '1c']);
  assert.equal(queue[0].recallAgeDays, 15);
});

test('mastery and last study combine without pass-completion bias and use latest actual activity', () => {
  const state = createEmptyPaediatricsState(NOW), progress = createPlanProgress(state, [], NOW);
  for (const [id, topic] of Object.entries(progress.topics)) {
    topic.firstPassCompletedAt = NOW;
    state.topics[id].oralAssessment = assessment(4, NOW);
  }
  state.topics['1a'].oralAssessment = assessment(2, NOW); // 10/20, urgency 40.
  progress.topics['1a'].secondPassCompletedAt = NOW;
  state.topics['1b'].oralAssessment = assessment(3, '2026-08-20T12:00:00.000Z'); // 15/20 + 27 days, urgency 47.
  progress.topics['1b'].firstPassCompletedAt = '2026-08-20T12:00:00.000Z';
  let queue = buildReviewQueue(state, progress, [], NOW.slice(0, 10));
  assert.deepEqual(queue.slice(0,2).map(t=>t.topicId), ['1b','1a']);
  progress.topics['1a'].thirdPassCompletedAt = NOW;
  assert.deepEqual(buildReviewQueue(state, progress, [], NOW.slice(0,10)).map(t=>t.topicId), queue.map(t=>t.topicId));
  const events = [{id:'recent',topicId:'1b',reviewedAt:NOW,createdAt:NOW,outcome:'studied',pass:'first',source:'assistant'}];
  queue = buildReviewQueue(state, progress, events, NOW.slice(0,10));
  assert.equal(queue[0].topicId, '1a');
  assert.equal(queue.find(t=>t.topicId==='1b').recallAgeDays, 0);
  const randomized = buildStudyQueue(queue, 'second', false, 'seed');
  assert.deepEqual(randomized.slice(0,2).map(t=>t.topicId), ['1a','1b']);
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
