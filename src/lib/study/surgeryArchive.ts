import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { createEmptySurgeryState, hydrateState, type SurgeryState, type SessionSnapshot } from './surgerySchema';
import type { StudyPlanConfig, StudyPlanProgress } from './studyPlanSchema';
import { normalizeRetentionCard, type RetentionCard } from './retentionSchema';
import type { SurgeryReviewEvent, SurgerySimulation } from './surgeryReview';

export type SurgeryArchive = {
  state: SurgeryState; sessions: SessionSnapshot[]; cards: RetentionCard[];
  config: StudyPlanConfig | null; progress: StudyPlanProgress | null;
  reviews: SurgeryReviewEvent[]; simulations: SurgerySimulation[];
};
// Read only, on explicit archive navigation. No listeners, migrations or writes.
// Cache only the current authenticated user's snapshot for this browser session.
let cachedUid = '';
let cached: Promise<SurgeryArchive> | undefined;
export function clearSurgeryArchive() { cachedUid=''; cached=undefined; }
export function readSurgeryArchive(uid:string):Promise<SurgeryArchive> {
  if(cachedUid===uid&&cached)return cached;
  cachedUid=uid;
  const document=(group:string,id:string)=>getDoc(doc(db,'users',uid,group,id));
  const records=(group:string)=>getDocs(collection(db,'users',uid,group));
  const pending=Promise.all([
    document('surgeryTracker','state'),records('surgerySessions'),records('retentionCards'),
    document('surgeryPlan','config'),document('surgeryPlan','progress'),records('surgeryReviewEvents'),records('surgerySimulations')
  ]).then(([state,sessions,cards,config,progress,reviews,simulations])=>({
    state:state.exists()?hydrateState(state.data() as SurgeryState):createEmptySurgeryState('2026-09-08T00:00:00.000Z'),
    sessions:sessions.docs.map(d=>d.data() as SessionSnapshot).sort((a,b)=>a.date.localeCompare(b.date)),
    cards:cards.docs.map(d=>normalizeRetentionCard(d.data() as RetentionCard)),
    config:config.exists()?config.data() as StudyPlanConfig:null,
    progress:progress.exists()?progress.data() as StudyPlanProgress:null,
    reviews:reviews.docs.map(d=>d.data() as SurgeryReviewEvent),
    simulations:simulations.docs.map(d=>d.data() as SurgerySimulation)
  }));
  cached=pending;
  void pending.catch(()=>{if(cached===pending)clearSurgeryArchive();});
  return pending;
}
