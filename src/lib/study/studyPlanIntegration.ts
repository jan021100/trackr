import type { SurgeryPatch, SurgeryState } from './surgerySchema';
import { readStudyPlan, saveStudyPlanProgress } from './surgeryRepository';
import { applyExplicitPlanPatch } from './studyPlanPatch';

export async function recordPatchPlanProgress(uid:string, _before:SurgeryState, _after:SurgeryState, patch:SurgeryPatch, sessionId?:string) {
  const {progress}=await readStudyPlan(uid); if(!progress) return;
  const occurredAt=new Date(patch.session?.date??Date.now()).toISOString();
  const result=applyExplicitPlanPatch(progress,patch,occurredAt,sessionId);
  if(result.changed) await saveStudyPlanProgress(uid,result.progress);
}
