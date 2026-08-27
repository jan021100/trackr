import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForFirestore } from '../src/lib/study/firestoreData.ts';

test('legacy session snapshots omit absent optional evidence metadata', () => {
  const session = sanitizeForFirestore({
    id: 'legacy-session',
    date: '2026-08-14T12:00:00.000Z',
    label: 'Legacy oral block',
    questions: 8,
    mode: undefined,
    planPass: undefined
  });

  assert.deepEqual(session, {
    id: 'legacy-session',
    date: '2026-08-14T12:00:00.000Z',
    label: 'Legacy oral block',
    questions: 8
  });
  assert.equal('mode' in session, false);
  assert.equal('planPass' in session, false);
});

test('sanitizer recursively removes undefined without fabricating values', () => {
  const date = new Date('2026-08-14T12:00:00.000Z');
  const result = sanitizeForFirestore({ nested: { keep: 0, remove: undefined }, values: ['oral', undefined, { mode: undefined, score: 2 }], date });
  assert.deepEqual(result.nested, { keep: 0 });
  assert.deepEqual(result.values, ['oral', { score: 2 }]);
  assert.equal(result.date, date);
});
