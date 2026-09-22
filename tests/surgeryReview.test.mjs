import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySurgeryState } from '../src/lib/study/surgerySchema.ts';
import { buildGapRepairBatch, buildGapRepairQueue, buildRapidGapRepairBatch, buildReviewQueue, filterReviewQueueForSecondPass, gapRepairCooldownSummary, makeGapRepairPrompt, makeRapidGapRepairPrompt, makeStudyChatPrompt, reviewCounts } from '../src/lib/study/surgeryReview.ts';

test('adaptive queue puts fail-critical and failed topics first', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  state.topics['TO1-02'].gaps.push({ id: 'g1', text: 'Unsafe omission', priority: 'critical', createdAt: '2026-08-31T08:00:00.000Z' });
  const events = [{ id: 'r1', topicId: 'TO1-02', reviewedAt: '2026-08-31T10:00:00.000Z', outcome: 'failed', pass: 'second', source: 'assistant', createdAt: '2026-08-31T10:00:00.000Z' }];
  const queue = buildReviewQueue(state, null, events, '2026-09-01');
  assert.equal(queue[0].topicId, 'TO1-02');
  assert.equal(queue[0].kind, 'critical');
  assert.equal(queue[0].dueDate, '2026-09-01');
});

test('study prompt distinguishes per-question and final topic patches', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  const entry = buildReviewQueue(state, null, [], '2026-09-01')[0];
  const prompt = makeStudyChatPrompt(entry, state, null);
  assert.match(prompt, /cold screen/i);
  assert.match(prompt, /ordinary patch/i);
  assert.match(prompt, /secondPassComplete/);
  assert.match(prompt, /exactly one raw JSON object/i);
});

test('unfinished mastery 2 screens precede mastery 3 screens unless urgency interrupts', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  state.topics['TO1-01'].mastery = 3;
  state.topics['TO1-02'].mastery = 2;
  const progress = { topics: {} };
  let queue = buildReviewQueue(state, progress, [], '2026-09-01');
  assert.ok(queue.findIndex((entry) => entry.topicId === 'TO1-02') < queue.findIndex((entry) => entry.topicId === 'TO1-01'));
  state.topics['TO1-01'].gaps.push({ id: 'critical', text: 'Unsafe omission', priority: 'critical', createdAt: '2026-09-01T08:00:00.000Z' });
  queue = buildReviewQueue(state, progress, [], '2026-09-01');
  assert.equal(queue[0].topicId, 'TO1-01');
});

test('unfinished mastery 2 precedes a due prompted retest already completed at mastery 2', () => {
  const state = createEmptySurgeryState('2026-09-04T08:00:00.000Z');
  state.topics['TO1-01'].mastery = 2;
  state.topics['TO1-02'].mastery = 2;
  const progress = { topics: {
    'TO1-01': { firstPassCompletedAt: '2026-08-10T12:00:00.000Z' },
    'TO1-02': { firstPassCompletedAt: '2026-08-10T12:00:00.000Z', secondPassCompletedAt: '2026-09-01T12:00:00.000Z' }
  } };
  const events = [{ id: 'prompted', topicId: 'TO1-02', reviewedAt: '2026-09-01T12:00:00.000Z', outcome: 'prompted', pass: 'second', source: 'assistant', createdAt: '2026-09-01T12:00:00.000Z' }];
  const queue = buildReviewQueue(state, progress, events, '2026-09-04');
  assert.ok(queue.findIndex((entry) => entry.topicId === 'TO1-01') < queue.findIndex((entry) => entry.topicId === 'TO1-02'));
});

test('a completed second-pass topic produces a repeatable third-pass review patch', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  state.topics['TO1-01'].mastery = 2;
  const progress = { topics: { 'TO1-01': { firstPassCompletedAt: '2026-08-10T12:00:00.000Z', secondPassCompletedAt: '2026-08-30T12:00:00.000Z' } } };
  const entry = buildReviewQueue(state, progress, [], '2026-09-01').find((item) => item.topicId === 'TO1-01');
  const prompt = makeStudyChatPrompt(entry, state, progress);
  assert.match(prompt, /third-pass targeted consolidation/i);
  assert.match(prompt, /"pass":"review"/);
  assert.match(prompt, /"planPass":"review"/);
  assert.doesNotMatch(prompt, /"plan":\{"secondPassComplete":true\}/);
});

test('review outcome counts are independent from topic completion', () => {
  const events = [
    { reviewedAt: '2026-09-01T09:00:00Z', outcome: 'passed' },
    { reviewedAt: '2026-09-01T10:00:00Z', outcome: 'prompted' },
    { reviewedAt: '2026-08-31T10:00:00Z', outcome: 'failed' }
  ];
  assert.deepEqual(reviewCounts(events, '2026-09-01'), { total: 2, failed: 0, prompted: 1, passed: 1, fluent: 0 });
});

test('otherwise equal topics prefer the oldest structured recall', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  const progress = { topics: {
    'TO1-01': { firstPassCompletedAt: '2026-08-18T12:00:00.000Z' },
    'TO1-02': { firstPassCompletedAt: '2026-08-29T12:00:00.000Z' }
  } };
  const queue = buildReviewQueue(state, progress, [], '2026-09-01');
  assert.ok(queue.findIndex((entry) => entry.topicId === 'TO1-01') < queue.findIndex((entry) => entry.topicId === 'TO1-02'));
  assert.equal(queue.find((entry) => entry.topicId === 'TO1-01').recallAgeDays, 14);
});

test('a structured second-pass review becomes the new recall anchor', () => {
  const state = createEmptySurgeryState('2026-09-01T08:00:00.000Z');
  const progress = { topics: { 'TO1-01': { firstPassCompletedAt: '2026-08-10T12:00:00.000Z' } } };
  const events = [{ id: 'r2', topicId: 'TO1-01', reviewedAt: '2026-08-31T12:00:00.000Z', outcome: 'passed', pass: 'second', source: 'assistant', createdAt: '2026-08-31T12:00:00.000Z' }];
  const entry = buildReviewQueue(state, progress, events, '2026-09-01').find((item) => item.topicId === 'TO1-01');
  assert.equal(entry.recallAgeDays, 1);
  assert.equal(entry.lastRecallAt, '2026-08-31T12:00:00.000Z');
});

test('ignore retests keeps the same queue order but removes completed second passes', () => {
  const queue = [
    { topicId: 'TO1-01', secondPassComplete: true },
    { topicId: 'TO1-02', secondPassComplete: false },
    { topicId: 'TO1-03', secondPassComplete: true },
    { topicId: 'TO1-04', secondPassComplete: false }
  ];
  assert.equal(filterReviewQueueForSecondPass(queue, false), queue);
  assert.deepEqual(filterReviewQueueForSecondPass(queue, true).map((entry) => entry.topicId), ['TO1-02', 'TO1-04']);
});

test('gap repair queue contains only open-gap topics and prioritizes critical weak knowledge', () => {
  const state = createEmptySurgeryState('2026-09-05T08:00:00.000Z');
  state.topics['TO1-01'].mastery = 3;
  state.topics['TO1-01'].confidence = 3;
  state.topics['TO1-01'].gaps.push({ id: 'normal', text: 'Normal gap', priority: 'normal', createdAt: '2026-09-01T08:00:00.000Z' });
  state.topics['TO1-02'].mastery = 2;
  state.topics['TO1-02'].confidence = 2;
  state.topics['TO1-02'].gaps.push({ id: 'critical', text: 'Critical gap', priority: 'critical', createdAt: '2026-09-01T08:00:00.000Z' });
  state.topics['TO1-03'].gaps.push({ id: 'resolved', text: 'Old gap', resolvedAt: '2026-09-04T08:00:00.000Z', createdAt: '2026-09-01T08:00:00.000Z' });
  const queue = buildGapRepairQueue(state, { topics: {} }, [], '2026-09-05');
  assert.deepEqual(queue.map((entry) => entry.topicId), ['TO1-02', 'TO1-01']);
  assert.equal(buildGapRepairBatch(queue, 3).length, 2);
});

test('new gaps cool down before both normal and rapid gap repair regardless of priority', () => {
  const state = createEmptySurgeryState('2026-09-06T10:00:00.000Z');
  state.topics['TO1-01'].gaps.push({ id: 'brand-new-critical', text: 'New critical gap', priority: 'critical', createdAt: '2026-09-06T10:59:00.000Z' });
  state.topics['TO1-02'].gaps.push({ id: 'older-normal', text: 'Older normal gap', priority: 'normal', createdAt: '2026-09-06T08:00:00.000Z' });
  const queue = buildGapRepairQueue(state, { topics: {} }, [], '2026-09-06', '2026-09-06T11:00:00.000Z');
  assert.deepEqual(queue.map((entry) => entry.topicId), ['TO1-02']);
  assert.deepEqual(buildRapidGapRepairBatch(queue, 8).flatMap((entry) => entry.openGaps.map((gap) => gap.id)), ['older-normal']);
  assert.deepEqual(gapRepairCooldownSummary(state, [], '2026-09-06T11:00:00.000Z'), {
    readyCount: 1,
    coolingDownCount: 1,
    nextEligibleAt: '2026-09-06T12:59:00.000Z'
  });
});

test('an unchanged tested gap receives a fresh two-hour cooldown', () => {
  const state = createEmptySurgeryState('2026-09-05T08:00:00.000Z');
  state.topics['TO1-01'].gaps.push({ id: 'tested-gap', text: 'Still weak', priority: 'important', createdAt: '2026-09-05T08:00:00.000Z' });
  const events = [{ id: 'review', topicId: 'TO1-01', reviewedAt: '2026-09-06T10:00:00.000Z', outcome: 'prompted', pass: 'review', source: 'assistant', createdAt: '2026-09-06T10:00:00.000Z', gapResults: [{ gapId: 'tested-gap', outcome: 'unchanged' }] }];
  assert.equal(buildGapRepairQueue(state, { topics: {} }, events, '2026-09-06', '2026-09-06T11:59:59.000Z').length, 0);
  assert.equal(buildGapRepairQueue(state, { topics: {} }, events, '2026-09-06', '2026-09-06T12:00:00.000Z').length, 1);
});

test('gap repair prompt uses exact gap IDs, non-leading questions, and review-only multi-topic logging', () => {
  const state = createEmptySurgeryState('2026-09-05T08:00:00.000Z');
  state.topics['TO1-01'].gaps.push({ id: 'gap-a', text: 'Specific hidden target', priority: 'important', createdAt: '2026-09-01T08:00:00.000Z' });
  state.topics['TO1-02'].gaps.push({ id: 'gap-b', text: 'Another hidden target', priority: 'normal', createdAt: '2026-09-01T08:00:00.000Z' });
  const queue = buildGapRepairQueue(state, { topics: {} }, [], '2026-09-05');
  const prompt = makeGapRepairPrompt(buildGapRepairBatch(queue, 2), state, { topics: {} });
  assert.match(prompt, /gap-a/);
  assert.match(prompt, /gap-b/);
  assert.match(prompt, /must NOT leak into the wording/i);
  assert.match(prompt, /Recognition prompted by the question does not count/i);
  assert.match(prompt, /gapResults/);
  assert.match(prompt, /"planPass":"review"/);
  assert.doesNotMatch(prompt, /secondPassComplete/);
});

test('rapid gap repair budgets by gap and limits how much of one topic enters the batch', () => {
  const queue = [
    { topicId: 'TO1-01', title: 'One', block: 'TO1', mastery: 2, confidence: 2, score: 100, criticalGapCount: 2, importantGapCount: 1, openGaps: [
      { id: 'normal-a', text: 'Normal A', priority: 'normal' },
      { id: 'critical-b', text: 'Critical B', priority: 'critical' },
      { id: 'important-c', text: 'Important C', priority: 'important' }
    ] },
    { topicId: 'TO1-02', title: 'Two', block: 'TO1', mastery: 2, confidence: 2, score: 90, criticalGapCount: 0, importantGapCount: 0, openGaps: [
      { id: 'normal-d', text: 'Normal D', priority: 'normal' },
      { id: 'normal-e', text: 'Normal E', priority: 'normal' }
    ] },
    { topicId: 'TO1-03', title: 'Three', block: 'TO1', mastery: 3, confidence: 3, score: 80, criticalGapCount: 0, importantGapCount: 0, openGaps: [
      { id: 'normal-f', text: 'Normal F', priority: 'normal' }
    ] }
  ];
  const batch = buildRapidGapRepairBatch(queue, 5);
  assert.equal(batch.reduce((sum, entry) => sum + entry.openGaps.length, 0), 5);
  assert.ok(batch.every((entry) => entry.openGaps.length <= 2));
  assert.deepEqual(batch[0].openGaps.map((gap) => gap.id), ['critical-b', 'important-c']);
});

test('rapid prompt is targeted, permits multiple questions per gap, and logs only tested gaps', () => {
  const state = createEmptySurgeryState('2026-09-06T08:00:00.000Z');
  state.topics['TO1-01'].gaps.push(
    { id: 'selected-a', text: 'First hidden target', priority: 'critical', createdAt: '2026-09-01T08:00:00.000Z' },
    { id: 'selected-b', text: 'Second hidden target', priority: 'important', createdAt: '2026-09-01T08:00:00.000Z' },
    { id: 'not-selected', text: 'Later target', priority: 'normal', createdAt: '2026-09-01T08:00:00.000Z' }
  );
  const queue = buildGapRepairQueue(state, { topics: {} }, [], '2026-09-06');
  const batch = buildRapidGapRepairBatch(queue, 2);
  const prompt = makeRapidGapRepairPrompt(batch, state, { topics: {} });
  assert.match(prompt, /RAPID GAP REPAIR/);
  assert.match(prompt, /1–3 short questions/);
  assert.match(prompt, /smallest fair examiner question/i);
  assert.match(prompt, /Do not ask me to present the complete topic/i);
  assert.match(prompt, /20–60 second answer/);
  assert.match(prompt, /selected-a/);
  assert.match(prompt, /selected-b/);
  assert.doesNotMatch(prompt, /not-selected/);
  assert.match(prompt, /"planPass":"review"/);
  assert.doesNotMatch(prompt, /secondPassComplete/);
});
