import type { SessionSnapshot } from './paediatricsSchema';
import type { PaediatricsReviewEvent } from './paediatricsReview';
import { passCompletionKey, passSourceKey, type StudyPlanProgress } from './studyPlanSchema';

/** Recover missing coverage from a recorded full-topic recall, without another session or write. */
export function coverageFromReviews(progress: StudyPlanProgress | null, reviews: PaediatricsReviewEvent[], sessions: SessionSnapshot[] = []): StudyPlanProgress | null {
  if (!progress) return null;
  let result = progress;
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  for (const review of [...reviews].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))) {
    if (review.pass !== 'second' && review.pass !== 'third') continue;
    if (review.outcome === 'studied' || !Number.isFinite(Date.parse(review.reviewedAt))) continue;
    const session = review.sourceSessionId ? sessionsById.get(review.sourceSessionId) : undefined;
    const fullSession = session?.planPass === review.pass && session.topicIds?.includes(review.topicId)
      && ['oral', 'clinical-vignette', 'mixed'].includes(session.mode ?? '');
    if (!review.oralAssessment && !fullSession) continue;
    const topic = result.topics[review.topicId];
    if (!topic || topic[passCompletionKey(review.pass)]) continue;
    // An explicit correction made after this review takes precedence over inferred coverage.
    if (topic.completionHistory?.some(change => change.pass === review.pass && !change.complete && change.changedAt >= review.reviewedAt)) continue;
    if (result === progress) result = structuredClone(progress);
    result.topics[review.topicId][passCompletionKey(review.pass)] = review.reviewedAt;
    result.topics[review.topicId][passSourceKey(review.pass)] = `full-review:${review.id}`;
  }
  return result;
}
