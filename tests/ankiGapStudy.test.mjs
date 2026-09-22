import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANKI_RECALL_WINDOW_MS,
  applyAnkiGapClassifications,
  ankiGapTags,
  classifyAnkiGapProgress,
  collapseAnkiReviewsIntoRecallWindows,
  makeAnkiGapCardPrompt,
  stableAnkiGapBatchId,
  stableAnkiGapCardId,
  validateAnkiGapCardImport
} from '../src/lib/study/ankiGapStudy.ts';
import { createEmptySurgeryState } from '../src/lib/study/surgerySchema.ts';

const selections = [
  { topicId: 'TO2-53', topicTitle: 'Tumors of the pancreas', gapId: 'gap-pancreas-1', gapText: 'Missed the relevant resectability criterion', priority: 'important' },
  { topicId: 'TO2-72', topicTitle: 'Surgery on the thyroid and parathyroid bodies', gapId: 'gap-thyroid-2', gapText: 'Could not recall the complication pattern', priority: 'normal' }
];

const generatedImport = (selected = selections) => ({
  kind: 'trackr-anki-gap-cards',
  schemaVersion: 1,
  batchId: stableAnkiGapBatchId(selected),
  cards: selected.map((selection) => ({
    id: stableAnkiGapCardId(selection.topicId, selection.gapId),
    topicId: selection.topicId,
    gapId: selection.gapId,
    front: `Focused question for ${selection.topicId}?`,
    back: 'Concise pass-level answer.',
    tags: ankiGapTags(selection.topicId, selection.gapId, selection.priority)
  }))
});

const review = (hours, ease, type = 1) => ({ id: Date.parse('2026-09-06T08:00:00.000Z') + hours * 60 * 60 * 1000, ease, type });

test('gap card and batch identities are deterministic and safe', () => {
  const cardId = stableAnkiGapCardId('TO2-53', 'gap / with spaces');
  assert.equal(cardId, stableAnkiGapCardId('TO2-53', 'gap / with spaces'));
  assert.notEqual(cardId, stableAnkiGapCardId('TO2-53', 'different'));
  assert.doesNotMatch(cardId, /[\s/]/);
  assert.equal(stableAnkiGapBatchId(selections), stableAnkiGapBatchId([...selections].reverse()));
});

test('Anki tags carry stable Trackr, topic, gap and card identities', () => {
  const tags = ankiGapTags('TO2-53', 'gap-pancreas-1', 'critical');
  assert.deepEqual(tags.slice(0, 2), ['trackr', 'trackr::surgery']);
  assert.ok(tags.includes('trackr::topic::TO2-53'));
  assert.ok(tags.includes('trackr::gap::gap-pancreas-1'));
  assert.ok(tags.some((tag) => tag.startsWith('trackr::card::anki-gap-to2-53-')));
  assert.ok(tags.includes('trackr::priority::critical'));
});

test('card-writing prompt fixes every identity and demands exactly one non-leading card per gap', () => {
  const prompt = makeAnkiGapCardPrompt(selections);
  assert.match(prompt, /exactly one Basic-style Anki card for every selected gap/i);
  assert.match(prompt, /must not quote or paraphrase the stored gap/i);
  assert.match(prompt, /Do not ask for the entire topic/i);
  assert.match(prompt, /20–60 second answer/i);
  assert.match(prompt, /Return exactly one raw JSON object/i);
  for (const selection of selections) {
    assert.match(prompt, new RegExp(selection.topicId));
    assert.match(prompt, new RegExp(selection.gapId));
    assert.match(prompt, new RegExp(stableAnkiGapCardId(selection.topicId, selection.gapId)));
  }
});

test('generated card validation accepts one exact card per selected topic/gap pair', () => {
  const result = validateAnkiGapCardImport(generatedImport(), selections);
  assert.equal(result.cards.length, 2);
  assert.deepEqual(result.cards.map((card) => [card.topicId, card.gapId]), selections.map((item) => [item.topicId, item.gapId]));
});

test('generated card validation rejects missing, duplicate, altered and unrelated identities', () => {
  const missing = generatedImport();
  missing.cards.pop();
  assert.throws(() => validateAnkiGapCardImport(missing, selections), /exactly 2 generated gap cards/i);

  const duplicate = generatedImport();
  duplicate.cards[1] = structuredClone(duplicate.cards[0]);
  assert.throws(() => validateAnkiGapCardImport(duplicate, selections), /more than one card/i);

  const alteredId = generatedImport();
  alteredId.cards[0].id = 'invented-by-chatgpt';
  assert.throws(() => validateAnkiGapCardImport(alteredId, selections), /changed its Trackr card ID/i);

  const unrelated = generatedImport();
  unrelated.cards[0].gapId = 'not-selected';
  assert.throws(() => validateAnkiGapCardImport(unrelated, selections), /not one of the selected/i);
});

test('generated card validation reports when a selected gap is assigned to the wrong topic', () => {
  const wrongTopic = generatedImport();
  wrongTopic.cards[0].topicId = 'TO2-54';
  assert.throws(() => validateAnkiGapCardImport(wrongTopic, selections), /belongs to TO2-53, not TO2-54/i);
});

test('generated card validation requires Trackr identity tags and valid card content', () => {
  const missingTag = generatedImport();
  missingTag.cards[0].tags = ['trackr'];
  assert.throws(() => validateAnkiGapCardImport(missingTag, selections), /missing required tag/i);

  const blank = generatedImport();
  blank.cards[0].front = '   ';
  assert.throws(() => validateAnkiGapCardImport(blank, selections), /needs a front and back/i);
});

test('recall attempts within two hours collapse to the first rating in the window', () => {
  const result = collapseAnkiReviewsIntoRecallWindows([
    review(0, 1), review(0.25, 4), review(1.99, 4), review(2, 3), review(4, 4)
  ]);
  assert.deepEqual(result.windows.map((window) => window.rating), [1, 3, 4]);
  assert.equal(result.windows[1].timestamp - result.windows[0].timestamp, ANKI_RECALL_WINDOW_MS);
});

test('manual-reschedule entries and malformed review rows do not become recall evidence', () => {
  const result = collapseAnkiReviewsIntoRecallWindows([
    review(0, 4, 4),
    { id: Number.NaN, ease: 3, type: 1 },
    review(3, 3)
  ]);
  assert.deepEqual(result.windows.map((window) => window.rating), [3]);
  assert.equal(result.ignoredReviewCount, 2);
});

test('no recall is unseen and one independent Good or Easy remains learning', () => {
  assert.equal(classifyAnkiGapProgress([]).status, 'unseen');
  const result = classifyAnkiGapProgress([review(0, 3)]);
  assert.equal(result.status, 'learning');
  assert.equal(result.successfulWindowsAfterReset, 1);
});

test('the latest independent Again reopens and Hard marks the gap fragile', () => {
  assert.equal(classifyAnkiGapProgress([review(0, 3), review(3, 3), review(6, 1)]).status, 'reopened');
  assert.equal(classifyAnkiGapProgress([review(0, 3), review(3, 3), review(6, 2)]).status, 'fragile');
});

test('two independent Good or Easy windows after the latest reset become stable', () => {
  const stable = classifyAnkiGapProgress([review(0, 1), review(3, 3), review(6, 4)]);
  assert.equal(stable.status, 'stable');
  assert.equal(stable.successfulWindowsAfterReset, 2);

  const reset = classifyAnkiGapProgress([review(0, 3), review(3, 3), review(6, 2), review(9, 4)]);
  assert.equal(reset.status, 'learning');
  assert.equal(reset.successfulWindowsAfterReset, 1);
});

test('rapid successful retries inside one window cannot falsely stabilize a gap', () => {
  const result = classifyAnkiGapProgress([review(0, 3), review(0.1, 4), review(1, 4)]);
  assert.equal(result.status, 'learning');
  assert.equal(result.recallWindows.length, 1);
});

test('classification sorts out-of-order Anki review logs chronologically', () => {
  const result = classifyAnkiGapProgress([review(6, 4), review(0, 1), review(3, 3)]);
  assert.equal(result.status, 'stable');
  assert.deepEqual(result.recallWindows.map((window) => window.rating), [1, 3, 4]);
});

test('applying stable Anki evidence resolves only its linked gap and preserves topic metrics', () => {
  const state = createEmptySurgeryState('2026-09-06T08:00:00.000Z');
  state.topics['TO2-53'].mastery = 2;
  state.topics['TO2-53'].confidence = 1;
  state.topics['TO2-53'].attempts = 7;
  state.topics['TO2-53'].gaps.push({ id: 'gap-pancreas-1', text: 'Weak criterion', priority: 'important', createdAt: '2026-09-05T08:00:00.000Z' });
  const classification = classifyAnkiGapProgress([review(0, 3), review(3, 4)]);
  const result = applyAnkiGapClassifications(state, [{ topicId: 'TO2-53', gapId: 'gap-pancreas-1', classification }], '2026-09-06T15:00:00.000Z');
  const gap = result.state.topics['TO2-53'].gaps[0];
  assert.equal(gap.resolvedAt, '2026-09-06T15:00:00.000Z');
  assert.equal(gap.ankiStatus, 'stable');
  assert.equal(result.changes[0].gapChange, 'resolved');
  assert.equal(result.state.topics['TO2-53'].mastery, 2);
  assert.equal(result.state.topics['TO2-53'].confidence, 1);
  assert.equal(result.state.topics['TO2-53'].attempts, 7);
  assert.equal(state.topics['TO2-53'].gaps[0].resolvedAt, undefined);
});

test('a later independent Again reopens an Anki-resolved gap without erasing its history fields', () => {
  const state = createEmptySurgeryState('2026-09-06T08:00:00.000Z');
  state.topics['TO2-53'].gaps.push({
    id: 'gap-pancreas-1', text: 'Weak criterion', createdAt: '2026-09-05T08:00:00.000Z',
    resolvedAt: '2026-09-06T12:00:00.000Z', ankiResolvedAt: '2026-09-06T12:00:00.000Z',
    ankiStatus: 'stable', ankiLastReviewAt: '2026-09-06T11:00:00.000Z'
  });
  const classification = classifyAnkiGapProgress([review(0, 3), review(3, 3), review(6, 1)]);
  const result = applyAnkiGapClassifications(state, [{ topicId: 'TO2-53', gapId: 'gap-pancreas-1', classification }], '2026-09-06T15:30:00.000Z');
  const gap = result.state.topics['TO2-53'].gaps[0];
  assert.equal(gap.resolvedAt, undefined);
  assert.equal(gap.ankiResolvedAt, '2026-09-06T12:00:00.000Z');
  assert.equal(gap.ankiReopenedAt, '2026-09-06T15:30:00.000Z');
  assert.equal(result.changes[0].gapChange, 'reopened');
});

test('an older Again cannot undo a later manual or assistant gap resolution', () => {
  const state = createEmptySurgeryState();
  state.topics['TO2-53'].gaps = [{
    id: 'gap-pancreas-1',
    text: 'A gap',
    createdAt: '2026-09-05T08:00:00.000Z',
    resolvedAt: '2026-09-06T12:00:00.000Z'
  }];
  const classification = classifyAnkiGapProgress([
    { id: Date.parse('2026-09-06T08:00:00.000Z'), ease: 1, type: 1 }
  ]);
  const result = applyAnkiGapClassifications(state, [{ topicId: 'TO2-53', gapId: 'gap-pancreas-1', classification }], '2026-09-06T13:00:00.000Z');
  assert.equal(result.state.topics['TO2-53'].gaps[0].resolvedAt, '2026-09-06T12:00:00.000Z');
  assert.equal(result.changes[0].gapChange, 'none');
});

test('reapplying the same Anki review is idempotent and Hard does not reopen a resolved gap', () => {
  const state = createEmptySurgeryState('2026-09-06T08:00:00.000Z');
  state.topics['TO2-53'].gaps.push({
    id: 'gap-pancreas-1', text: 'Weak criterion', createdAt: '2026-09-05T08:00:00.000Z',
    resolvedAt: '2026-09-06T12:00:00.000Z', ankiStatus: 'fragile', ankiLastReviewAt: '2026-09-06T14:00:00.000Z'
  });
  const classification = classifyAnkiGapProgress([review(6, 2)]);
  const repeated = applyAnkiGapClassifications(state, [{ topicId: 'TO2-53', gapId: 'gap-pancreas-1', classification }], '2026-09-06T16:00:00.000Z');
  assert.equal(repeated.changes.length, 0);
  assert.equal(repeated.state.topics['TO2-53'].gaps[0].resolvedAt, '2026-09-06T12:00:00.000Z');
});

test('applying Anki classifications rejects unknown and duplicate gap mappings', () => {
  const state = createEmptySurgeryState('2026-09-06T08:00:00.000Z');
  state.topics['TO2-53'].gaps.push({ id: 'known', text: 'Known gap', createdAt: '2026-09-05T08:00:00.000Z' });
  const classification = classifyAnkiGapProgress([review(0, 3)]);
  assert.throws(() => applyAnkiGapClassifications(state, [{ topicId: 'TO2-53', gapId: 'missing', classification }]), /unknown Anki gap/i);
  assert.throws(() => applyAnkiGapClassifications(state, [
    { topicId: 'TO2-53', gapId: 'known', classification },
    { topicId: 'TO2-53', gapId: 'known', classification }
  ]), /duplicate Anki gap classification/i);
});
