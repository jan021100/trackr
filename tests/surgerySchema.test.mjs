import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptySurgeryState,
  mergePatch,
  validatePatch
} from '../src/lib/study/surgerySchema.ts';

test('surgery state contains every stable topic ID', () => {
  const state = createEmptySurgeryState('2026-08-10T10:00:00.000Z');
  assert.equal(Object.keys(state.topics).length, 196);
  assert.ok(state.topics['TO1-01']);
  assert.ok(state.topics['TO4-45']);
});

test('patch validation rejects unknown fields and invalid topic IDs', () => {
  assert.throws(
    () => validatePatch({ schemaVersion: 1, topics: [], overwriteEverything: true }),
    /unknown top-level fields/i
  );
  assert.throws(
    () => validatePatch({ schemaVersion: 1, topics: [{ id: 'TO9-99', mastery: 4 }] }),
    /unknown topic id/i
  );
});

test('patch merge changes only targeted progress and preserves all other topics', () => {
  const state = createEmptySurgeryState('2026-08-10T10:00:00.000Z');
  const untouchedBefore = structuredClone(state.topics['TO2-01']);
  const patch = validatePatch({
    schemaVersion: 1,
    topics: [{ id: 'TO1-01', mastery: 3, confidence: 2, attemptsDelta: 5, correctDelta: 4 }]
  });
  const merged = mergePatch(state, patch, '2026-08-10T11:00:00.000Z');

  assert.equal(merged.topics['TO1-01'].mastery, 3);
  assert.equal(merged.topics['TO1-01'].attempts, 5);
  assert.equal(merged.topics['TO1-01'].correct, 4);
  assert.deepEqual(merged.topics['TO2-01'], untouchedBefore);
  assert.equal(state.topics['TO1-01'].mastery, 0);
});

test('legacy sessions remain valid and optional review metadata stays optional', () => {
  const legacy = validatePatch({ schemaVersion: 1, session: { date: '2026-09-01T10:00:00.000Z', label: 'Legacy', questions: 1 } });
  assert.equal(legacy.session.mode, undefined);
  assert.equal(legacy.session.planPass, undefined);
  const reviewed = validatePatch({ schemaVersion: 1, topics: [{ id: 'TO1-01', review: { outcome: 'passed', pass: 'second' }, plan: { secondPassComplete: true } }] });
  assert.equal(reviewed.topics[0].review.outcome, 'passed');
});

test('gap repair results are optional, validated, and consistent with resolved IDs', () => {
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: 'TO1-01', resolveGapIds: ['gap-a'], review: { outcome: 'passed', pass: 'review', gapResults: [{ gapId: 'gap-a', outcome: 'resolved' }, { gapId: 'gap-b', outcome: 'unchanged' }] } }] });
  assert.equal(patch.topics[0].review.gapResults.length, 2);
  assert.throws(() => validatePatch({ schemaVersion: 1, topics: [{ id: 'TO1-01', review: { outcome: 'passed', pass: 'review', gapResults: [{ gapId: 'gap-a', outcome: 'resolved' }] } }] }), /missing from resolveGapIds/);
  assert.throws(() => validatePatch({ schemaVersion: 1, topics: [{ id: 'TO1-01', resolveGapIds: ['gap-a'], review: { outcome: 'prompted', pass: 'review', gapResults: [{ gapId: 'gap-a', outcome: 'unchanged' }] } }] }), /cannot be unchanged and resolved/);
});
