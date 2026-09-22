import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, validatePatch, mergePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { buildReviewQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';
import { scoreOralAssessment } from '../src/lib/paediatrics/oralAssessment.ts';
import { makePaediatricsAssessmentOnlyPrompt } from '../src/lib/paediatrics/studyApproach.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
const now = '2026-09-18T12:00:00.000Z';

test('normal and direct Pass 1 grade neutral follow-ups, separate repair, and leave caps to Trackr', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  const entry = buildReviewQueue(state, progress, [], now.slice(0,10)).find(t => t.topicId === '3b');
  const direct = makeStudyChatPrompt(entry, state, progress, 'second');
  progress.topics['3b'].firstPassCompletedAt = now;
  for (const prompt of [direct, makeStudyChatPrompt(entry, state, progress)]) {
    assert.match(prompt, /Grade ALL pre-teaching recall: cold answer \+ independently answered neutral examiner follow-ups/);
    assert.match(prompt, /Opening omission retrieved on neutral follow-up without hints ≠ gap/);
    assert.match(prompt, /Exclude recall after teaching\/correction\/content hints\/explanation; it cannot immediately resolve gaps/);
    assert.match(prompt, /never lower ratings to fit a cap/);
    assert.match(prompt, /separates independent pre-teaching recall from excluded post-teaching repair/);
    assert.doesNotMatch(prompt, /prompted=material help \(independence≤2\)/);
  }
  const backfill = makePaediatricsAssessmentOnlyPrompt();
  assert.match(backfill, /cold opening answer plus all independently answered neutral examiner follow-ups/);
  assert.match(backfill, /never lower individual ratings to satisfy an overall cap/);
});

test('3b correction preserves domain evidence under the safety cap without adding activity', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  const old = state.topics['3b'];
  Object.assign(old, { attempts: 14, correct: 8, lastReviewedAt: now, status: 'review', mastery: 1 });
  old.gaps = [{ id: 'keep', text: 'Existing gap', createdAt: now }];
  progress.topics['3b'].secondPassCompletedAt = now;
  const oralAssessment = { ratings: { coverage: 3, accuracy: 2, independence: 3, clinicalReasoning: 2, propedeutics: 2 }, safetyCriticalError: true, evidence: 'Independent pre-teaching opening and neutral follow-ups; post-teaching repair excluded.' };
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: '3b', oralAssessment }] });
  const before = structuredClone(oralAssessment);
  const result = scoreOralAssessment(oralAssessment);
  assert.equal(result.raw, 12);
  assert.equal(result.score, 7);
  assert.deepEqual(oralAssessment, before);
  const next = mergePatch(state, patch, now);
  assert.deepEqual(next.topics['3b'].oralAssessment.ratings, oralAssessment.ratings);
  for (const key of ['attempts', 'correct', 'lastReviewedAt', 'gaps', 'notes', 'confidence']) assert.deepEqual(next.topics['3b'][key], old[key]);
  assert.deepEqual(next.topics['3a'], state.topics['3a']);
  assert.equal(applyExplicitPlanPatch(progress, patch, now).changed, false);
  assert.equal(patch.session, undefined);
  assert.equal(patch.topics[0].review, undefined);
});
