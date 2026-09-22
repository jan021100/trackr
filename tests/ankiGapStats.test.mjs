import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionCard } from '../src/lib/study/retentionSchema.ts';
import { selectLinkedAnkiGapCards, summarizeAnkiGapCards } from '../src/lib/study/ankiGapStats.ts';

let sequence = 0;

function linkedCard({
  id,
  topicId = 'TO1-01',
  gapId,
  retentionStatus = 'active',
  tags = [],
  updatedAt,
  anki = {}
} = {}) {
  sequence += 1;
  const cardId = id ?? `anki-gap-test-${sequence}`;
  const resolvedGapId = gapId ?? `gap-${sequence}`;
  const card = createRetentionCard({
    id: cardId,
    topicId,
    gapId: resolvedGapId,
    front: `Question ${sequence}`,
    back: `Answer ${sequence}`,
    tags
  }, updatedAt ?? '2026-09-06T08:00:00.000Z');
  return {
    ...card,
    status: retentionStatus,
    updatedAt: updatedAt ?? card.updatedAt,
    anki: {
      noteId: 10_000 + sequence,
      cardIds: [20_000 + sequence],
      deckName: 'Trackr::Surgery Gaps',
      modelName: 'Trackr Surgery Gap',
      linkedAt: '2026-09-06T08:00:00.000Z',
      ...anki
    }
  };
}

function bucket(distribution, key) {
  const result = distribution.buckets.find((candidate) => candidate.key === key);
  assert.ok(result, `Missing bucket ${key}`);
  return result;
}

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
}

test('selectLinkedAnkiGapCards keeps only one active, dedicated, usable link per gap', () => {
  const genericDuplicate = linkedCard({
    id: 'old-generic-card', gapId: 'same-gap', updatedAt: '2026-09-06T10:00:00.000Z'
  });
  const dedicated = linkedCard({
    id: 'anki-gap-preferred', gapId: 'same-gap', updatedAt: '2026-09-06T09:00:00.000Z'
  });
  const tagged = linkedCard({
    id: 'tagged-card', topicId: 'TO1-02', gapId: 'tagged-gap', tags: ['trackr::surgery-gap']
  });
  const archived = linkedCard({ id: 'anki-gap-archived', gapId: 'archived-gap', retentionStatus: 'archived' });
  const unlinked = createRetentionCard({
    id: 'anki-gap-unlinked', topicId: 'TO1-03', gapId: 'unlinked-gap', front: 'Q', back: 'A'
  }, '2026-09-06T08:00:00.000Z');
  const malformedLink = linkedCard({ id: 'anki-gap-malformed', gapId: 'malformed-gap', anki: { noteId: undefined, cardIds: [] } });
  const noGap = { ...linkedCard({ id: 'anki-gap-no-gap' }), gapId: null };

  const selected = selectLinkedAnkiGapCards([
    genericDuplicate, dedicated, tagged, archived, unlinked, malformedLink, noGap
  ]);

  assert.deepEqual(selected.map((card) => card.id).sort(), ['anki-gap-preferred', 'tagged-card']);
});

test('summarizeAnkiGapCards reports custom status and non-exclusive scheduler counts', () => {
  const cards = [
    linkedCard({ anki: { status: 'unseen', cardType: 0, reviewCount: 0, repetitions: 0, lapses: 0, due: true } }),
    linkedCard({ anki: { status: 'learning', cardType: 1, reviewCount: 1, repetitions: 1, lapses: 0, due: false } }),
    linkedCard({ anki: { status: 'fragile', cardType: 3, reviewCount: 3, repetitions: 3, lapses: 2, due: true } }),
    linkedCard({ anki: { status: 'stable', cardType: 2, reviewCount: 2, repetitions: 2, lapses: 0, due: false } }),
    linkedCard({ anki: { status: undefined, reviewCount: undefined, repetitions: undefined, lapses: undefined, due: undefined } }),
    linkedCard({ anki: { status: 'missing', reviewCount: 20, repetitions: 20, lapses: 4, due: true } })
  ];

  const stats = summarizeAnkiGapCards(cards);

  assert.equal(stats.total, 6);
  assert.equal(stats.status.known, 5);
  assert.equal(stats.status.unknown, 1);
  assert.equal(bucket(stats.status, 'unseen').count, 1);
  assert.equal(bucket(stats.status, 'learning').count, 1);
  assert.equal(bucket(stats.status, 'fragile').count, 1);
  assert.equal(bucket(stats.status, 'stable').count, 1);
  assert.equal(bucket(stats.status, 'missing').count, 1);

  assert.equal(stats.scheduler.state.known, 4);
  assert.equal(stats.scheduler.state.unknown, 2);
  assert.equal(bucket(stats.scheduler.state, 'new').count, 1);
  assert.equal(bucket(stats.scheduler.state, 'learning').count, 1);
  assert.equal(bucket(stats.scheduler.state, 'review').count, 1);
  assert.equal(bucket(stats.scheduler.state, 'relearning').count, 1);

  assert.deepEqual({ ...stats.scheduler.newOrUnseen, percentage: 0 }, { count: 1, unknown: 2, percentage: 0 });
  assertClose(stats.scheduler.newOrUnseen.percentage, 100 / 6);
  assert.deepEqual({ ...stats.scheduler.learning, percentage: 0 }, { count: 2, unknown: 2, percentage: 0 });
  assertClose(stats.scheduler.learning.percentage, 200 / 6);
  assert.deepEqual({ ...stats.scheduler.due, percentage: 0 }, { count: 2, unknown: 2, percentage: 0 });
  assertClose(stats.scheduler.due.percentage, 200 / 6);
  assert.deepEqual(stats.scheduler.reviewed, { count: 3, unknown: 2, percentage: 50 });
  assert.deepEqual({ ...stats.scheduler.lapsed, percentage: 0 }, { count: 1, unknown: 2, percentage: 0 });
  assertClose(stats.scheduler.lapsed.percentage, 100 / 6);
  assert.equal(stats.scheduler.totalReviews, 6);
  assert.equal(stats.scheduler.totalLapses, 2);
});

test('numeric FSRS distributions bucket valid values and retain unknown coverage', () => {
  const cards = [
    linkedCard({ anki: { status: 'unseen', retrievability: 0.5, difficulty: 0.1, stability: 0.5 } }),
    linkedCard({ anki: { status: 'learning', retrievability: 0.7, difficulty: 0.3, stability: 1 } }),
    linkedCard({ anki: { status: 'fragile', retrievability: 0.85, difficulty: 0.5, stability: 3 } }),
    linkedCard({ anki: { status: 'stable', retrievability: 0.9, difficulty: 0.7, stability: 7 } }),
    linkedCard({ anki: { status: 'reopened', retrievability: 0.95, difficulty: 0.9, stability: 21 } }),
    linkedCard({ anki: { status: 'stable', retrievability: Number.NaN, difficulty: Number.POSITIVE_INFINITY } }),
    linkedCard({ anki: { status: 'missing', retrievability: 0.99, difficulty: 2, stability: 30 } })
  ];

  const stats = summarizeAnkiGapCards(cards);

  assert.deepEqual(
    stats.retrievability.buckets.map(({ key, count }) => [key, count]),
    [['under-70', 1], ['70-85', 1], ['85-90', 1], ['90-95', 1], ['95-plus', 1]]
  );
  assert.equal(stats.retrievability.known, 5);
  assert.equal(stats.retrievability.unknown, 2);
  assertClose(stats.retrievability.average, 0.78);
  assert.equal(stats.retrievability.median, 0.85);
  assert.equal(stats.retrievability.min, 0.5);
  assert.equal(stats.retrievability.max, 0.95);
  assertClose(bucket(stats.retrievability, '95-plus').percentage, 100 / 7);
  assert.equal(bucket(stats.retrievability, '95-plus').knownPercentage, 20);

  assert.deepEqual(
    stats.difficulty.buckets.map(({ key, count }) => [key, count]),
    [['under-20', 1], ['20-40', 1], ['40-60', 1], ['60-80', 1], ['80-plus', 1]]
  );
  assertClose(stats.difficulty.average, 0.5);
  assert.equal(stats.difficulty.median, 0.5);
  assert.equal(stats.difficulty.min, 0.1);
  assert.equal(stats.difficulty.max, 0.9);

  assert.deepEqual(
    stats.stability.buckets.map(({ key, count }) => [key, count]),
    [['under-1-day', 1], ['1-3-days', 1], ['3-7-days', 1], ['7-21-days', 1], ['21-plus-days', 1]]
  );
  assert.equal(stats.stability.average, 6.5);
  assert.equal(stats.stability.median, 3);
  assert.equal(stats.stability.min, 0.5);
  assert.equal(stats.stability.max, 21);
});

test('difficulty accepts normalized prop:d and rejects ambiguous raw values', () => {
  const stats = summarizeAnkiGapCards([
    linkedCard({ anki: { difficulty: 0.25 } }),
    linkedCard({ anki: { difficulty: 10 } })
  ]);
  assert.equal(stats.difficulty.known, 1);
  assert.equal(stats.difficulty.unknown, 1);
  assert.equal(stats.difficulty.min, 0.25);
  assert.equal(stats.difficulty.max, 0.25);
  assert.equal(bucket(stats.difficulty, '20-40').count, 1);
  assert.equal(bucket(stats.difficulty, '80-plus').count, 0);
});

test('empty input produces zeroed buckets without fabricated numeric summaries', () => {
  const stats = summarizeAnkiGapCards([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.status.known, 0);
  assert.equal(stats.status.unknown, 0);
  assert.ok(stats.status.buckets.every((item) => item.count === 0 && item.percentage === 0));
  assert.equal(stats.retrievability.known, 0);
  assert.equal(stats.retrievability.unknown, 0);
  assert.equal(stats.retrievability.average, undefined);
  assert.equal(stats.retrievability.median, undefined);
  assert.equal(stats.retrievability.min, undefined);
  assert.equal(stats.retrievability.max, undefined);
  assert.deepEqual(stats.scheduler.due, { count: 0, unknown: 0, percentage: 0 });
});
