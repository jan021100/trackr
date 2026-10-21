import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { createEmptyPaediatricsState, hydrateState, type PaediatricsState, type SessionSnapshot } from './paediatricsSchema';
import type { StudyPlanConfig, StudyPlanProgress } from './studyPlanSchema';
import { normalizeRetentionCard, type RetentionCard } from './retentionSchema';
import type { PaediatricsReviewEvent, PaediatricsSimulation } from './paediatricsReview';

export type PaediatricsArchive = {
  state: PaediatricsState; sessions: SessionSnapshot[]; cards: RetentionCard[];
  config: StudyPlanConfig | null; progress: StudyPlanProgress | null;
  reviews: PaediatricsReviewEvent[]; simulations: PaediatricsSimulation[];
};
// Read only, on explicit archive navigation. No listeners, migrations or writes.
// Cache only the current authenticated user's snapshot for this browser session.
let cachedUid = '';
let cached: Promise<PaediatricsArchive> | undefined;
export function clearPaediatricsArchive() { cachedUid=''; cached=undefined; }
export function readPaediatricsArchive(uid:string):Promise<PaediatricsArchive> {
  if(cachedUid===uid&&cached)return cached;
  cachedUid=uid;
  const document=(group:string,id:string)=>getDoc(doc(db,'users',uid,group,id));
  const records=(group:string)=>getDocs(collection(db,'users',uid,group));
  const pending=Promise.all([
    document('paediatricsTracker','state'),records('paediatricsSessions'),records('paediatricsRetentionCards'),
    document('paediatricsPlan','config'),document('paediatricsPlan','progress'),records('paediatricsReviewEvents'),records('paediatricsSimulations')
  ]).then(([state,sessions,cards,config,progress,reviews,simulations])=>({
    state:state.exists()?hydrateState(state.data() as PaediatricsState):createEmptyPaediatricsState('2026-10-20T00:00:00.000Z'),
    sessions:sessions.docs.map(d=>d.data() as SessionSnapshot).sort((a,b)=>a.date.localeCompare(b.date)),
    cards:cards.docs.map(d=>normalizeRetentionCard(d.data() as RetentionCard)),
    config:config.exists()?config.data() as StudyPlanConfig:null,
    progress:progress.exists()?progress.data() as StudyPlanProgress:null,
    reviews:reviews.docs.map(d=>d.data() as PaediatricsReviewEvent),
    simulations:simulations.docs.map(d=>d.data() as PaediatricsSimulation)
  }));
  cached=pending;
  void pending.catch(()=>{if(cached===pending)clearPaediatricsArchive();});
  return pending;
}
