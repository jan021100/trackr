import type { SurgeryPatch } from './surgerySchema';
import type { PlanPass, PlanTopicState, StudyPlanProgress } from './studyPlanSchema';

export function applyExplicitPlanPatch(progress: StudyPlanProgress, patch: SurgeryPatch, occurredAt: string, sessionId?: string) {
  const next = structuredClone(progress);
  let changed = false;

  for (const change of patch.topics ?? []) {
    if (!change.plan) continue;
    const topic: PlanTopicState = next.topics[change.id] ?? {};

    const applyPass = (pass: PlanPass, complete: boolean | undefined, explicitAt?: string) => {
      if (complete === undefined) return;
      const key = pass === 'first' ? 'firstPassCompletedAt' : 'secondPassCompletedAt';
      const sourceKey = pass === 'first' ? 'firstPassSource' : 'secondPassSource';
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

    applyPass('first', change.plan.firstPassComplete, change.plan.firstPassCompletedAt);
    applyPass('second', change.plan.secondPassComplete, change.plan.secondPassCompletedAt);
    next.topics[change.id] = topic;
  }

  if (changed) next.updatedAt = new Date().toISOString();
  return { progress: next, changed };
}
