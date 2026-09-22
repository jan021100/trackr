import type { PaediatricsPatch } from './paediatricsSchema';
import { passCompletionKey, passSourceKey } from './studyPlanSchema';
import type { PlanPass, PlanTopicState, StudyPlanProgress } from './studyPlanSchema';

export function applyExplicitPlanPatch(progress: StudyPlanProgress, patch: PaediatricsPatch, occurredAt: string, sessionId?: string) {
  const next = structuredClone(progress);
  let changed = false;

  for (const change of patch.topics ?? []) {
    if (!change.plan) continue;
    const topic: PlanTopicState = next.topics[change.id] ?? {};
    const directPassOne = patch.session?.planPass === 'second' && change.plan.secondPassComplete === true && !topic.firstPassCompletedAt;

    const applyPass = (pass: PlanPass, complete: boolean | undefined, explicitAt?: string) => {
      if (complete === undefined) return;
      const key = passCompletionKey(pass);
      const sourceKey = passSourceKey(pass);
      const previous = topic[key];

      if (complete && !previous) {
        topic[key] = new Date(explicitAt ?? occurredAt).toISOString();
        topic[sourceKey] = sessionId ? `assistant:${sessionId}` : 'assistant';
        changed = true;
      } else if (!complete && previous) {
        delete topic[key];
        delete topic[sourceKey];
        changed = true;
      }

      if (changed && previous !== topic[key]) {
        topic.completionHistory = [...(topic.completionHistory ?? []), {
          pass, complete, changedAt: occurredAt, source: sessionId ? `assistant:${sessionId}` : 'assistant',
          ...(previous ? { previousCompletedAt: previous } : {})
        }];
      }
    };

    // Older direct-Pass-1 prompts supplied both flags. Pass 1 supersedes the
    // acquisition requirement, but must not fabricate a completed Pass 0.
    applyPass('first', directPassOne && change.plan.firstPassComplete === true ? undefined : change.plan.firstPassComplete, change.plan.firstPassCompletedAt);
    applyPass('second', change.plan.secondPassComplete, change.plan.secondPassCompletedAt);
    applyPass('third', change.plan.thirdPassComplete, change.plan.thirdPassCompletedAt);
    next.topics[change.id] = topic;
  }

  if (changed) next.updatedAt = new Date().toISOString();
  return { progress: next, changed };
}
