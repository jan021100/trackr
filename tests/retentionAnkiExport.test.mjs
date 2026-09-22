import test from 'node:test';
import assert from 'node:assert/strict';
import { cardsFromTsv, cardsToTsv } from '../src/lib/study/retentionSchema.ts';

const card = {
  id: 'card-1', topicId: 'TO1-02', gapId: 'gap-1', sourceSessionId: null,
  front: 'A < B & C\nNext line', back: 'Answer\twith tab', clinicalContext: '',
  tags: ['weakspot', 'oral follow-up'], status: 'active', createdAt: '2026-08-27T10:00:00.000Z',
  updatedAt: '2026-08-27T10:00:00.000Z', dueDate: '2026-08-27', dueAt: '2026-08-27T10:00:00.000Z',
  phase: 'new', learningStep: 0, intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, reviews: []
};

test('Anki export declares its format and does not emit a visible header note', () => {
  const text = cardsToTsv([card]);
  assert.ok(text.startsWith('#separator:Tab\n#html:true\n#tags column:3\n#columns:Front\tBack\tTags\tTopicID\tGapID\tCardID\n'));
  assert.match(text, /A &lt; B &amp; C<br>Next line/);
  assert.match(text, /trackr-id::card-1/);
  assert.match(text, /trackr-topic::TO1-02/);
  assert.match(text, /trackr-gap::gap-1/);
  assert.equal(text.split('\n').filter((line) => !line.startsWith('#')).length, 1);
});

test('Trackr re-import ignores Anki headers and restores metadata safely', () => {
  const [restored] = cardsFromTsv(cardsToTsv([card]), 'TO1-01');
  assert.equal(restored.id, 'card-1');
  assert.equal(restored.topicId, 'TO1-02');
  assert.equal(restored.gapId, 'gap-1');
  assert.equal(restored.front, card.front);
  assert.equal(restored.back, 'Answer with tab');
});
