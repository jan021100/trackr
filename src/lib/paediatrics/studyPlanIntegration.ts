import type { PaediatricsPatch, PaediatricsState } from './paediatricsSchema';
import { readStudyPlan, saveStudyPlanProgress } from './paediatricsRepository';
import { applyExplicitPlanPatch } from './studyPlanPatch';

export async function recordPatchPlanProgress(uid:string, _before:PaediatricsState, _after:PaediatricsState, patch:PaediatricsPatch, sessionId?:string) {
  const {progress}=await readStudyPlan(uid); if(!progress) return;
  const occurredAt=new Date(patch.session?.date??Date.now()).toISOString();
  const result=applyExplicitPlanPatch(progress,patch,occurredAt,sessionId);
  if(result.changed) await saveStudyPlanProgress(uid,result.progress);
}
