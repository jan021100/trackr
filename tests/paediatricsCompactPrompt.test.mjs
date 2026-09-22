import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, validatePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { buildReviewQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';

const now = '2026-09-14T12:00:00.000Z';

test('normal prompts for all 120 topics and all four stages stay compact with valid patch contracts', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  for (const [index, pass] of ['first', 'second', 'third', 'review'].entries()) {
    if (index) for (const topic of Object.values(progress.topics)) topic[['firstPassCompletedAt', 'secondPassCompletedAt', 'thirdPassCompletedAt'][index - 1]] = now;
    for (const entry of buildReviewQueue(state, progress, [], '2026-09-14')) {
      const prompt = makeStudyChatPrompt(entry, state, progress);
      assert.ok(prompt.length <= (index ? 4300 : 2850), `${entry.topicId} ${pass} exceeds compact budget: ${prompt.length}`);
      assert.equal(prompt.split('PAEDIATRICS LEARNING AGREEMENT').length - 1, 1);
      assert.doesNotMatch(prompt, /Available project resource names:|TASK AND OUTPUT CONTRACT|ORAL MASTERY — EVIDENCE-BASED/);
      assert.match(prompt, /actually read Paeds_iBook \+ exam-specific Pädiatrie Notes/);
      assert.match(prompt, /No|no/);
      assert.match(prompt, /Never invent citations/);
      const patch = validatePatch(JSON.parse(prompt.split('\n').find(line => line.startsWith('{"schemaVersion":1'))));
      assert.equal(patch.topics[0].id, entry.topicId);
      assert.equal(patch.topics[0].review.pass, pass);
      assert.equal(patch.session.planPass, pass);
      assert.equal(patch.topics[0].mastery, undefined);
      assert.ok(patch.topics[0].oralAssessment);
      if (pass === 'first') {
        assert.equal(patch.topics[0].addGaps, undefined);
      } else {
        assert.deepEqual(patch.topics[0].addGaps, []);
        assert.deepEqual(patch.topics[0].review.gapResults, []);
        assert.match(prompt, /any0\/independence≤1→7; any1\/independence2→11; any2→15/);
        assert.match(prompt, /later uncued success before help → resolveGapIds AND review.gapResults/);
      }
      assert.match(prompt, /Never repeat (?:exported )?deltas\/session\/completion/);
      if (pass === 'review') assert.equal(patch.topics[0].plan, undefined);
    }
  }
});

test('compression preserves every open and resolved gap verbatim, including quotes and newlines', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  progress.topics['1a'].firstPassCompletedAt = now;
  state.topics['1a'].gaps = Array.from({ length: 20 }, (_, i) => ({ id: `gap-${i}`, text: `Exact recall target ${i}: "quoted"\nsecond line`, priority: i % 2 ? 'important' : 'normal', createdAt: now, ...(i < 3 ? { resolvedAt: now } : {}) }));
  const before = structuredClone({ state, progress });
  const prompt = makeStudyChatPrompt(buildReviewQueue(state, progress, [], '2026-09-14').find(entry => entry.topicId === '1a'), state, progress);
  const open = JSON.parse(prompt.split('Open gaps [id,priority,text,createdAt]:')[1].split('\n')[0]);
  const resolved = JSON.parse(prompt.split('Resolved history [id,text,resolvedAt]:')[1].split('\n')[0]);
  assert.deepEqual(open, state.topics['1a'].gaps.filter(g => !g.resolvedAt).map(g => [g.id, g.priority, g.text, g.createdAt]));
  assert.deepEqual(resolved, state.topics['1a'].gaps.filter(g => g.resolvedAt).map(g => [g.id, g.text, g.resolvedAt]));
  assert.deepEqual({ state, progress }, before);
});

test('Pass 0 begins with fair cold recall, then teaches or upgrades without inventing Pass 0', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  const entry = buildReviewQueue(state, progress, [], '2026-09-14').find(item => item.topicId === '1a');
  const prompt = makeStudyChatPrompt(entry, state, progress);
  const fallback = validatePatch(JSON.parse(prompt.split('\n').find(line => line.startsWith('{"schemaVersion":1'))));
  assert.match(prompt, /Start with ONLY the topic title and invite a 60–120s free cold answer/);
  assert.match(prompt, /Before teaching ask bundled neutral, non-leading examiner follow-ups/);
  assert.match(prompt, /PRE-TEACHING SCORE/);
  assert.match(prompt, /Exclude post-teaching\/correction\/content cues/);
  assert.match(prompt, /Low scores are expected and valid/);
  assert.match(prompt, /NORMAL PASS 0 if teaching is needed/);
  assert.match(prompt, /UPGRADE only if recall was already broad, accurate, independent and safe at Pass 1 level before teaching/);
  assert.match(prompt, /Credit omissions retrieved without hints/);
  assert.match(prompt, /oralAssessment rates coverage, accuracy, independence, clinicalReasoning, propedeutics/);
  assert.match(prompt, /Output secondPassComplete only/);
  assert.match(prompt, /becomes unnecessary, not performed/);
  assert.doesNotMatch(prompt, /No cold exam of untaught content/);
  assert.deepEqual(fallback.topics[0].plan, { firstPassComplete: true });
  assert.equal(fallback.topics[0].review.pass, 'first');
  assert.equal(fallback.topics[0].review.outcome, 'studied');
  assert.ok(fallback.topics[0].oralAssessment);
});
