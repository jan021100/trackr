import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, validatePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress, nextTopicPass } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
import { buildReviewQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';

const now = '2026-09-18T12:00:00.000Z';
const template = prompt => validatePatch(JSON.parse(prompt.split('\n').find(line => line.startsWith('{"schemaVersion":1'))));

test('direct Pass 1 skips acquisition only on completed import and logs a single recall session', () => {
  const state = createEmptyPaediatricsState(now);
  const progress = createPlanProgress(state, [], now);
  const before = structuredClone({ state, progress });
  for (const entry of buildReviewQueue(state, progress, [], now.slice(0, 10))) {
    const normal = template(makeStudyChatPrompt(entry, state, progress));
    assert.equal(normal.session.planPass, 'first');
    const prompt = makeStudyChatPrompt(entry, state, progress, 'second');
    assert.ok(prompt.length < 4800);
    assert.match(prompt, /start with ONLY topic title/);
    assert.match(prompt, /Pass 0 then becomes unnecessary but was NOT performed/);
    assert.match(prompt, /Partial work: omit secondPassComplete/);
    assert.doesNotMatch(prompt, /PASS 0 WORKFLOW/);
    const patch = template(prompt);
    assert.equal(patch.topics.length, 1);
    assert.deepEqual(patch.topics[0].plan, { secondPassComplete: true });
    assert.equal(patch.topics[0].review.pass, 'second');
    assert.equal(patch.session.planPass, 'second');
    assert.equal(patch.session.mode, 'oral');
    assert.ok(patch.topics[0].oralAssessment);
    assert.deepEqual(patch.topics[0].addGaps, []);
    const imported = applyExplicitPlanPatch(progress, patch, now, 'direct-pass1');
    assert.equal(imported.progress.topics[entry.topicId].firstPassCompletedAt, undefined);
    assert.equal(nextTopicPass(imported.progress.topics[entry.topicId]), 'third');
    assert.equal(applyExplicitPlanPatch(imported.progress, patch, now, 'repeat').changed, false);
  }
  assert.deepEqual({ state, progress }, before);
});

test('legacy direct Pass 1 patches cannot fabricate Pass 0 completion', () => {
  const state = createEmptyPaediatricsState(now);
  const progress = createPlanProgress(state, [], now);
  const legacyPatch = validatePatch({
    schemaVersion: 1,
    topics: [{ id: '3b', plan: { firstPassComplete: true, secondPassComplete: true } }],
    session: { label: '3b Pass 1', questions: 12, mode: 'oral', planPass: 'second' }
  });
  const result = applyExplicitPlanPatch(progress, legacyPatch, now, 'legacy-direct-pass1').progress;
  assert.equal(result.topics['3b'].firstPassCompletedAt, undefined);
  assert.equal(result.topics['3b'].secondPassCompletedAt, now);
  assert.equal(result.topics['3b'].completionHistory.length, 1);
  assert.equal(result.topics['3b'].completionHistory[0].pass, 'second');
});

test('explicit Pass 1 remains selectable on advanced topics without changing prior completion', () => {
  const state = createEmptyPaediatricsState(now);
  const progress = createPlanProgress(state, [], now);
  const earlier = '2026-09-12T12:00:00.000Z';
  Object.assign(progress.topics['1a'], { firstPassCompletedAt: earlier, secondPassCompletedAt: earlier, thirdPassCompletedAt: earlier });
  const entry = buildReviewQueue(state, progress, [], now.slice(0, 10)).find(t => t.topicId === '1a');
  assert.equal(template(makeStudyChatPrompt(entry, state, progress)).session.planPass, 'review');
  const prompt = makeStudyChatPrompt(entry, state, progress, 'second');
  assert.doesNotMatch(prompt, /DIRECT PASS 1/);
  const patch = template(prompt);
  assert.deepEqual(patch.topics[0].plan, { secondPassComplete: true });
  assert.equal(patch.session.planPass, 'second');
  assert.deepEqual(applyExplicitPlanPatch(progress, patch, now).progress, progress);
});
