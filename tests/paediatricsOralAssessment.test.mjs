import test from 'node:test';
import assert from 'node:assert/strict';
import { ORAL_DOMAINS, oralSummary, oralLegacyMastery, scoreOralAssessment, validateOralAssessment } from '../src/lib/paediatrics/oralAssessment.ts';
import { createEmptyPaediatricsState, validatePatch, mergePatch, validateBackup } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
import { buildReviewQueue, buildGapRepairQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';
import { makePaediatricsAssessmentOnlyPrompt } from '../src/lib/paediatrics/studyApproach.ts';
import { startStudyTimer } from '../src/lib/paediatrics/studyTimer.ts';

const now = '2026-09-14T12:00:00.000Z';
const assessment = (ratings = {}, safetyCriticalError = false) => ({ ratings: { coverage: 4, accuracy: 4, independence: 4, clinicalReasoning: 4, propedeutics: 4, ...ratings }, safetyCriticalError, evidence: 'Ratings reflect the actual uncued answer and follow-ups before teaching.' });

test('mastery distinguishes unassessed, assessed zero, intermediate performance and secure recall', () => {
  const topic = createEmptyPaediatricsState(now).topics['1a'];
  assert.equal(oralSummary(topic).short, '—');
  assert.equal(oralSummary(topic).score, undefined);
  const zero = assessment(Object.fromEntries(ORAL_DOMAINS.map(d => [d.key, 0])));
  assert.equal(oralSummary({ ...topic, oralAssessment: zero }).short, '0/20');
  for (const [input, score, band] of [
    [assessment(), 20, 'secure'],
    [assessment({ coverage: 3 }), 19, 'secure'],
    [assessment({ coverage: 3, accuracy: 3 }), 18, 'solid'],
    [assessment({ coverage: 2 }), 15, 'passable'],
    [assessment({ coverage: 3, accuracy: 3, independence: 3, clinicalReasoning: 2, propedeutics: 2 }), 13, 'passable']
  ]) {
    assert.equal(scoreOralAssessment(input).score, score);
    assert.equal(scoreOralAssessment(input).band.key, band);
  }
  assert.equal(oralSummary({ ...topic, mastery: 3 }).short, '3/4');
  assert.equal(oralSummary({ ...topic, mastery: 3 }).score, undefined, 'old values are not fabricated /20 measurements');
});

test('strong areas cannot average away unsafe errors or dependence on help', () => {
  assert.equal(scoreOralAssessment(assessment({}, true)).score, 7);
  assert.equal(scoreOralAssessment(assessment({ independence: 1 })).score, 7);
  assert.equal(scoreOralAssessment(assessment({ accuracy: 0 })).score, 7);
  assert.equal(scoreOralAssessment(assessment({ independence: 2 })).score, 11);
  assert.equal(scoreOralAssessment(assessment({ propedeutics: 1 })).score, 11);
  assert.equal(scoreOralAssessment(assessment({ propedeutics: 2 })).score, 15);
  assert.ok(scoreOralAssessment(assessment({}, true)).limits.includes('Safety-critical error'));
});

test('oral assessment validation rejects incomplete ratings, scores outside the scale and contradictory grades', () => {
  const missing = assessment(); delete missing.ratings.accuracy;
  for (const invalid of [missing, assessment({ coverage: 5 }), assessment({ coverage: 2.5 }), { ...assessment(), evidence: '' }, { ...assessment(), surprise: true }]) assert.throws(() => validateOralAssessment(invalid));
  const topicPatch = (oralAssessment, review, mastery) => ({ schemaVersion: 1, topics: [{ id: '1a', oralAssessment, ...(review ? { review } : {}), ...(mastery === undefined ? {} : { mastery }) }] });
  assert.doesNotThrow(() => validatePatch(topicPatch(assessment(), { outcome: 'studied', pass: 'first' })));
  assert.doesNotThrow(() => validatePatch(topicPatch(assessment({}, true), { outcome: 'studied', pass: 'first' })), 'Pass 0 keeps studied while the assessment stores unsafe pre-teaching performance');
  assert.throws(() => validatePatch(topicPatch(assessment(), { outcome: 'passed', pass: 'first' })), /Pass 0 uses the studied/);
  assert.doesNotThrow(() => validatePatch(topicPatch(assessment({ coverage: 3, accuracy: 2, independence: 3, clinicalReasoning: 2, propedeutics: 2 }), { outcome: 'prompted', pass: 'second' })));
  assert.throws(() => validatePatch(topicPatch(assessment({}, true), { outcome: 'passed', pass: 'second' })), /safety-critical/);
  assert.throws(() => validatePatch(topicPatch(assessment({ independence: 2 }), { outcome: 'passed', pass: 'second' })), /conflicts/);
  assert.throws(() => validatePatch(topicPatch(assessment(), undefined, 2)), /mastery conflicts/);
});

test('assessment-only backfill changes the score without repeating time, questions, coverage or gaps', () => {
  const state = createEmptyPaediatricsState(now);
  state.activeStudyTimer = startStudyTimer('1a', new Date(now));
  Object.assign(state.topics['1a'], { attempts: 14, correct: 9, notes: 'Already logged', confidence: 2 });
  state.topics['1a'].gaps.push({ id: 'keep', text: 'Keep this gap', createdAt: now });
  const progress = createPlanProgress(state, [], now);
  progress.topics['1a'].firstPassCompletedAt = now;
  progress.topics['1a'].secondPassCompletedAt = now;
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: '1a', oralAssessment: assessment({ independence: 2 }) }] });
  const next = mergePatch(state, patch, now);
  assert.equal(oralSummary(next.topics['1a']).score, 11);
  assert.equal(next.topics['1a'].mastery, 2);
  assert.equal(next.topics['1a'].oralAssessment.assessedAt, now);
  for (const key of ['attempts', 'correct', 'notes', 'confidence', 'gaps']) assert.deepEqual(next.topics['1a'][key], state.topics['1a'][key]);
  assert.deepEqual(next.activeStudyTimer, state.activeStudyTimer);
  assert.equal(applyExplicitPlanPatch(progress, patch, now).changed, false);
  assert.equal(patch.session, undefined);
  assert.equal(patch.topics[0].review, undefined);
  const notesOnly = mergePatch(next, validatePatch({ schemaVersion: 1, topics: [{ id: '1a', mastery: next.topics['1a'].mastery, notes: 'Edited note' }] }), now);
  assert.deepEqual(notesOnly.topics['1a'].oralAssessment, next.topics['1a'].oralAssessment);
  const restored = validateBackup({ kind: 'trackr-paediatrics-backup', state: next, exportedAt: now, sessions: [] });
  assert.deepEqual(restored.state.topics['1a'].oralAssessment, next.topics['1a'].oralAssessment);
});

test('queues distinguish weaker topics within the same old mastery band', () => {
  let state = createEmptyPaediatricsState(now);
  const weak = assessment({ coverage: 3, accuracy: 3, independence: 3, clinicalReasoning: 2, propedeutics: 2 });
  const stronger = assessment({ coverage: 3, accuracy: 3, independence: 3, clinicalReasoning: 3, propedeutics: 3 });
  assert.equal(oralLegacyMastery(weak), oralLegacyMastery(stronger));
  state = mergePatch(state, validatePatch({ schemaVersion: 1, topics: [{ id: '1a', oralAssessment: stronger }, { id: '1b', oralAssessment: weak }] }), now);
  for (const id of ['1a', '1b']) state.topics[id].gaps.push({ id: `gap-${id}`, text: 'One gap', createdAt: '2026-09-10T12:00:00.000Z' });
  const progress = createPlanProgress(state, [], now);
  const ids = queue => queue.filter(e => ['1a', '1b'].includes(e.topicId)).map(e => e.topicId);
  assert.deepEqual(ids(buildReviewQueue(state, progress, [], '2026-09-14')), ['1b', '1a']);
  assert.deepEqual(ids(buildGapRepairQueue(state, progress, [], '2026-09-14', now)), ['1b', '1a']);
});

test('every full-topic prompt includes assessment fields and backfill supports Pass 0', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  const make = () => makeStudyChatPrompt(buildReviewQueue(state, progress, [], '2026-09-14').find(e => e.topicId === '1a'), state, progress);
  const shape = prompt => JSON.parse(prompt.split('\n').find(line => line.startsWith('{"schemaVersion":1')));
  assert.deepEqual(Object.keys(shape(make()).topics[0].oralAssessment.ratings).sort(), ORAL_DOMAINS.map(d => d.key).sort());
  progress.topics['1a'].firstPassCompletedAt = now;
  assert.deepEqual(Object.keys(shape(make()).topics[0].oralAssessment.ratings).sort(), ORAL_DOMAINS.map(d => d.key).sort());
  assert.equal(shape(make()).topics[0].mastery, undefined);
  assert.match(makePaediatricsAssessmentOnlyPrompt(), /actual cold answer and neutral follow-ups/);
  assert.match(makePaediatricsAssessmentOnlyPrompt(), /Pass 0-or-later/);
  assert.match(makePaediatricsAssessmentOnlyPrompt(), /Omit session, review, plan/);
});
