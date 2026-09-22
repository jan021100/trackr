import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, mergePatch, validatePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { buildReviewQueue, buildGapRepairQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';
import { makePaediatricsLearningBrief, makePaediatricsGapOnlyPrompt } from '../src/lib/paediatrics/studyApproach.ts';
import { startStudyTimer } from '../src/lib/paediatrics/studyTimer.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
import { makeAnkiGapCardPrompt, validateAnkiGapCardImport } from '../src/lib/paediatrics/ankiGapStudy.ts';

const now = '2026-09-14T12:00:00.000Z';
const later = '2026-09-17T12:00:00.000Z';
const promptFor = (state, progress) => makeStudyChatPrompt(buildReviewQueue(state, progress, [], '2026-09-14').find(entry => entry.topicId === '1a'), state, progress);
const finalShape = prompt => JSON.parse(prompt.split('\n').find(line => line.startsWith('{"schemaVersion":1')));

test('gap-only prompt produces a valid narrow template without repeating session activity', () => {
  const prompt = makePaediatricsGapOnlyPrompt();
  const patch = validatePatch(finalShape(prompt));
  assert.deepEqual(Object.keys(patch).sort(), ['schemaVersion', 'topics']);
  assert.deepEqual(Object.keys(patch.topics[0]).sort(), ['addGaps', 'id']);
  assert.match(prompt, /Its study activity is already logged/);
  assert.match(prompt, /Do not create gaps from Pass 0/);
  assert.match(prompt, /Apply this update once/);
  assert.match(prompt, /exact supplied open-gap IDs/);
  assert.match(makePaediatricsLearningBrief(), /at any point after Pass 0/);
  assert.match(makePaediatricsLearningBrief(), /narrower contract takes precedence/);
});

test('retrospective add/keep/resolve patch preserves assessment, timer and completed passes', () => {
  const state = createEmptyPaediatricsState(now);
  state.activeStudyTimer = startStudyTimer('1a', new Date(now));
  Object.assign(state.topics['1a'], { mastery: 2, confidence: 2, status: 'learning', attempts: 8, correct: 5, lastReviewedAt: now, notes: 'Already logged session' });
  state.topics['1a'].gaps = [
    { id: 'keep', text: 'Still unreliable', createdAt: now },
    { id: 'resolve', text: 'Independently recalled in a later session', createdAt: now }
  ];
  const progress = createPlanProgress(state, [], now);
  progress.topics['1a'].firstPassCompletedAt = now;
  progress.topics['1a'].secondPassCompletedAt = now;
  const before = structuredClone({ state, progress });
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: '1a', addGaps: [{ text: 'Missing from the logged session', priority: 'important' }], resolveGapIds: ['resolve'] }] });
  const next = mergePatch(state, patch, later);
  const gaps = next.topics['1a'].gaps;
  assert.deepEqual(gaps.find(g => g.id === 'keep'), before.state.topics['1a'].gaps[0]);
  assert.equal(gaps.find(g => g.id === 'resolve').resolvedAt, later);
  assert.equal(gaps.length, 3);
  const expected = structuredClone(before.state);
  expected.topics['1a'].gaps = gaps;
  expected.updatedAt = later;
  assert.deepEqual(next, expected);
  const planResult = applyExplicitPlanPatch(progress, patch, later);
  assert.equal(planResult.changed, false);
  assert.deepEqual(planResult.progress, before.progress);
  assert.deepEqual({ state, progress }, before);
  assert.equal(patch.session, undefined);
  assert.equal(patch.topics[0].review, undefined);
  assert.equal(patch.topics[0].plan, undefined);
});

test('Pass 0 excludes gap mutations and keeps existing gaps intact', () => {
  const state = createEmptyPaediatricsState(now);
  state.topics['1a'].gaps.push({ id: 'existing', text: 'Previously recorded weakness', createdAt: now });
  const before = structuredClone(state);
  const prompt = promptFor(state, createPlanProgress(state, [], now));
  const patch = validatePatch(finalShape(prompt));
  assert.match(prompt, /Do not create tracked gaps during Pass 0/);
  assert.match(prompt, /summary\/review.notes only; omit addGaps/);
  assert.equal(patch.topics[0].review.pass, 'first');
  assert.equal(patch.topics[0].review.outcome, 'studied');
  assert.ok(patch.topics[0].oralAssessment);
  for (const field of ['addGaps', 'resolveGapIds', 'addCards']) assert.equal(Object.hasOwn(patch.topics[0], field), false);
  assert.equal(Object.hasOwn(patch.topics[0].review, 'gapResults'), false);
  assert.deepEqual(mergePatch(state, patch, now).topics['1a'].gaps, before.topics['1a'].gaps);
  assert.deepEqual(state, before);
});

for (const [pass, completed] of [['second', 1], ['third', 2], ['review', 3]]) {
  test(`${pass} prompt requires structured gap tracking even when other topics remain in Pass 0`, () => {
    const state = createEmptyPaediatricsState(now);
    const progress = createPlanProgress(state, [], now);
    for (const key of ['firstPassCompletedAt', 'secondPassCompletedAt', 'thirdPassCompletedAt'].slice(0, completed)) progress.topics['1a'][key] = now;
    const prompt = promptFor(state, progress);
    const patch = validatePatch(finalShape(prompt));
    assert.match(prompt, /GAPS \(mandatory from Pass 1, anytime\)/);
    assert.match(prompt, /record demonstrated wrong\/incomplete\/prompted recall across full topic \+ propedeutics/);
    assert.match(prompt, /Teaching does not remove a gap/);
    assert.match(prompt, /Untested stay open/);
    assert.equal(patch.topics[0].review.pass, pass);
    assert.deepEqual(patch.topics[0].addGaps, []);
    assert.deepEqual(patch.topics[0].review.gapResults, []);
    assert.equal(patch.topics[0].resolveGapIds, undefined);
    assert.deepEqual(progress.topics['1b'], {});
    if (pass === 'review') assert.equal(patch.topics[0].plan, undefined);
  });
}

test('copied policy and recall context support existing and recurring gaps without changing history', () => {
  const state = createEmptyPaediatricsState(now);
  state.topics['1a'].gaps = [
    { id: 'open-id', text: 'Specific open recall target', createdAt: now },
    { id: 'old-id', text: 'Previously resolved target', createdAt: now, resolvedAt: later }
  ];
  const progress = createPlanProgress(state, [], now);
  progress.topics['1a'].firstPassCompletedAt = now;
  const before = structuredClone({ state, progress });
  const prompt = promptFor(state, progress);
  const open = JSON.parse(prompt.split('Open gaps [id,priority,text,createdAt]:')[1].split('\n')[0]);
  const resolved = JSON.parse(prompt.split('Resolved history [id,text,resolvedAt]:')[1].split('\n')[0]);
  assert.deepEqual(open, [['open-id', 'normal', 'Specific open recall target', now]]);
  assert.deepEqual(resolved, [['old-id', 'Previously resolved target', later]]);
  const brief = makePaediatricsLearningBrief();
  assert.match(brief, /recording and managing demonstrated gaps is mandatory/);
  assert.match(brief, /do not duplicate them or invent IDs for new gaps/);
  assert.match(brief, /If a previously resolved weakness recurs, record a new gap/);
  assert.match(brief, /Never substitute prose or review.notes for these structured fields/);
  assert.deepEqual({ state, progress }, before);
});

test('Pass 1 gap output flows into later gap repair and Anki while preserving untested gaps', () => {
  const state = createEmptyPaediatricsState(now);
  state.topics['1a'].gaps = [
    { id: 'tested', text: 'Old target retrieved independently', createdAt: '2026-09-10T12:00:00.000Z' },
    { id: 'untested', text: 'Old target not tested today', createdAt: '2026-09-10T12:00:00.000Z' }
  ];
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: '1a',
    addGaps: [{ text: 'Could not explain the age-specific interpretation of the finding', priority: 'important' }],
    resolveGapIds: ['tested'],
    review: { pass: 'second', outcome: 'prompted', gapResults: [{ gapId: 'tested', outcome: 'resolved' }] }
  }] });
  const next = mergePatch(state, patch, now);
  assert.equal(next.topics['1a'].gaps.find(g => g.id === 'tested').resolvedAt, now);
  assert.deepEqual(next.topics['1a'].gaps.find(g => g.id === 'untested'), state.topics['1a'].gaps[1]);
  const added = next.topics['1a'].gaps.find(g => !['tested', 'untested'].includes(g.id));
  assert.ok(added.id);
  assert.equal(added.resolvedAt, undefined);
  const queue = buildGapRepairQueue(next, createPlanProgress(next, [], now), [], '2026-09-17', later);
  const entry = queue.find(item => item.topicId === '1a');
  assert.ok(entry.openGaps.some(g => g.id === added.id));
  assert.ok(!entry.openGaps.some(g => g.id === 'tested'));
  const selections = [{ topicId: entry.topicId, topicTitle: entry.title, gapId: added.id, gapText: added.text, priority: added.priority }];
  const cardPrompt = makeAnkiGapCardPrompt(selections);
  const cardPatch = JSON.parse(cardPrompt.slice(cardPrompt.indexOf('{\n  "kind"')));
  cardPatch.cards[0].front = 'Explain how age changes the interpretation of the finding.';
  cardPatch.cards[0].back = 'Source-verified correction goes here.';
  assert.equal(validateAnkiGapCardImport(cardPatch, selections).cards[0].gapId, added.id);
  assert.equal(next.topics['1a'].gaps.find(g => g.id === added.id).resolvedAt, undefined);
});
