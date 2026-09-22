import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '$lib/firebase';
import {
  createEmptyPaediatricsState,
  hydrateState,
  validateBackup,
  type ActiveStudyTimer,
  type SessionSnapshot,
  type PaediatricsBackup,
  type PaediatricsState
} from './paediatricsSchema';
import { normalizeRetentionCard, type RetentionCard } from './retentionSchema';
import { createDefaultStudyPlan, createPlanProgress, normalizeRecallSupersession, normalizeStudyPlan, type StudyPlanConfig, type StudyPlanProgress } from './studyPlanSchema';
import { sanitizeForFirestore } from './firestoreData';
import type { PaediatricsReviewEvent, PaediatricsSimulation } from './paediatricsReview';
import { cancelStudyTimer } from './studyTimer';

const stateRef = (uid: string) => doc(db, 'users', uid, 'paediatricsTracker', 'state');
const sessionsRef = (uid: string) => collection(db, 'users', uid, 'paediatricsSessions');
const cardsRef = (uid: string) => collection(db, 'users', uid, 'paediatricsRetentionCards');
const planConfigRef = (uid: string) => doc(db, 'users', uid, 'paediatricsPlan', 'config');
const planProgressRef = (uid: string) => doc(db, 'users', uid, 'paediatricsPlan', 'progress');
const reviewsRef = (uid: string) => collection(db, 'users', uid, 'paediatricsReviewEvents');
const simulationsRef = (uid: string) => collection(db, 'users', uid, 'paediatricsSimulations');

export function subscribeToStudyPlan(uid:string, onValue:(config:StudyPlanConfig|null, progress:StudyPlanProgress|null)=>void, onError:(error:Error)=>void) {
  let config:StudyPlanConfig|null=createDefaultStudyPlan(), progress:StudyPlanProgress|null=createPlanProgress(createEmptyPaediatricsState());
  const emit=()=>onValue(config,progress);
  const a=onSnapshot(planConfigRef(uid),(s)=>{config=s.exists()?normalizeStudyPlan(s.data() as StudyPlanConfig):createDefaultStudyPlan(); emit();},onError);
  const b=onSnapshot(planProgressRef(uid),(s)=>{
    const raw=s.exists()?s.data() as StudyPlanProgress:createPlanProgress(createEmptyPaediatricsState());
    const normalized=normalizeRecallSupersession(raw);
    progress=normalized.progress; emit();
    if(normalized.changed) void setDoc(planProgressRef(uid),sanitizeForFirestore(normalized.progress)).catch(onError);
  },onError);
  return ()=>{a();b();};
}
export async function saveStudyPlan(uid:string, config:StudyPlanConfig, progress?:StudyPlanProgress) { await setDoc(planConfigRef(uid),sanitizeForFirestore(normalizeStudyPlan(config))); if(progress) await setDoc(planProgressRef(uid),sanitizeForFirestore(normalizeRecallSupersession(progress).progress)); }
export async function saveStudyPlanProgress(uid:string, progress:StudyPlanProgress) { await setDoc(planProgressRef(uid),sanitizeForFirestore(normalizeRecallSupersession(progress).progress)); }
export async function readStudyPlan(uid:string) { const [a,b]=await Promise.all([getDoc(planConfigRef(uid)),getDoc(planProgressRef(uid))]); const raw=b.exists()?b.data() as StudyPlanProgress:createPlanProgress(createEmptyPaediatricsState()); return {config:a.exists()?normalizeStudyPlan(a.data() as StudyPlanConfig):createDefaultStudyPlan(),progress:normalizeRecallSupersession(raw).progress}; }

export function subscribeToPaediatricsState(
  uid: string,
  onValue: (state: PaediatricsState) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    stateRef(uid),
    (snapshot) => onValue(snapshot.exists() ? hydrateState(snapshot.data() as PaediatricsState) : createEmptyPaediatricsState()),
    (error) => onError(error)
  );
}

export function subscribeToPaediatricsSessions(
  uid: string,
  onValue: (sessions: SessionSnapshot[]) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    sessionsRef(uid),
    (snapshot) => onValue(snapshot.docs.map((item) => item.data() as SessionSnapshot).sort((a, b) => a.date.localeCompare(b.date))),
    (error) => onError(error)
  );
}

export async function savePaediatricsState(uid: string, state: PaediatricsState) {
  await setDoc(stateRef(uid), sanitizeForFirestore(state));
}

export async function discardActiveStudyTimer(uid: string, expected: ActiveStudyTimer) {
  return runTransaction(db, async (transaction) => {
    const ref = stateRef(uid);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return false;
    const result = cancelStudyTimer(snapshot.data() as PaediatricsState, expected);
    if (!result.cancelled) return false;
    transaction.update(ref, { activeStudyTimer: deleteField(), updatedAt: result.state.updatedAt });
    return true;
  });
}

export async function saveSession(uid: string, session: SessionSnapshot) {
  await setDoc(doc(db, 'users', uid, 'paediatricsSessions', session.id), sanitizeForFirestore(session));
}

export async function saveSessions(uid: string, sessions: SessionSnapshot[]) {
  for (let offset = 0; offset < sessions.length; offset += 450) {
    const batch = writeBatch(db);
    for (const session of sessions.slice(offset, offset + 450)) batch.set(doc(db, 'users', uid, 'paediatricsSessions', session.id), sanitizeForFirestore(session));
    await batch.commit();
  }
}

export function subscribeToPaediatricsReviews(uid:string,onValue:(events:PaediatricsReviewEvent[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(reviewsRef(uid),(snapshot)=>onValue(snapshot.docs.map(item=>item.data() as PaediatricsReviewEvent).sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt))),onError);
}
export async function savePaediatricsReview(uid:string,event:PaediatricsReviewEvent) { await setDoc(doc(db,'users',uid,'paediatricsReviewEvents',event.id),sanitizeForFirestore(event)); }
export async function savePaediatricsReviews(uid:string,events:PaediatricsReviewEvent[]) { for(const event of events) await savePaediatricsReview(uid,event); }

export function subscribeToPaediatricsSimulations(uid:string,onValue:(events:PaediatricsSimulation[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(simulationsRef(uid),(snapshot)=>onValue(snapshot.docs.map(item=>item.data() as PaediatricsSimulation).sort((a,b)=>a.date.localeCompare(b.date))),onError);
}
export async function savePaediatricsSimulation(uid:string,event:PaediatricsSimulation) { await setDoc(doc(db,'users',uid,'paediatricsSimulations',event.id),sanitizeForFirestore(event)); }

export function subscribeToRetentionCards(uid: string, onValue: (cards: RetentionCard[]) => void, onError: (error: Error) => void) {
  return onSnapshot(cardsRef(uid), (snapshot) => onValue(snapshot.docs.map((item) => normalizeRetentionCard(item.data() as RetentionCard))), onError);
}

export async function saveRetentionCard(uid: string, card: RetentionCard) {
  await setDoc(doc(db, 'users', uid, 'paediatricsRetentionCards', card.id), sanitizeForFirestore(card));
}

export async function deleteRetentionCard(uid: string, cardId: string) {
  await deleteDoc(doc(db, 'users', uid, 'paediatricsRetentionCards', cardId));
}

export async function saveRetentionCards(uid: string, cards: RetentionCard[]) {
  for (let offset = 0; offset < cards.length; offset += 450) {
    const batch = writeBatch(db);
    for (const card of cards.slice(offset, offset + 450)) batch.set(doc(db, 'users', uid, 'paediatricsRetentionCards', card.id), sanitizeForFirestore(card));
    await batch.commit();
  }
}

export async function readBackup(uid: string, state: PaediatricsState): Promise<PaediatricsBackup> {
  const [snapshot,reviews,simulations,cards] = await Promise.all([getDocs(sessionsRef(uid)),getDocs(reviewsRef(uid)),getDocs(simulationsRef(uid)),getDocs(cardsRef(uid))]);
  const plan = await readStudyPlan(uid);
  return {
    kind: 'trackr-paediatrics-backup',
    exportedAt: new Date().toISOString(),
    state,
    retentionCards: cards.docs.map(item=>normalizeRetentionCard(item.data() as RetentionCard)),
    sessions: snapshot.docs.map((item) => item.data() as SessionSnapshot),
    reviews: reviews.docs.map((item)=>item.data() as PaediatricsReviewEvent),
    simulations: simulations.docs.map((item)=>item.data() as PaediatricsSimulation),
    ...(plan.config && plan.progress ? { studyPlan: { config: plan.config, progress: plan.progress } } : {})
  };
}

export async function restoreBackup(uid: string, candidate: PaediatricsBackup) {
  const backup=validateBackup(candidate);
  const [existing,existingReviews,existingSimulations,existingCards] = await Promise.all([getDocs(sessionsRef(uid)),getDocs(reviewsRef(uid)),getDocs(simulationsRef(uid)),backup.retentionCards?getDocs(cardsRef(uid)):Promise.resolve(null)]);
  const operations:Array<(batch:ReturnType<typeof writeBatch>)=>void>=[];
  const replace=(current:typeof existing,rows:Array<{id:string}>,group:string)=>{
    const ids=new Set(rows.map(row=>row.id));
    for(const item of current.docs)if(!ids.has(item.id))operations.push(batch=>{batch.delete(item.ref);});
    for(const row of rows)operations.push(batch=>{batch.set(doc(db,'users',uid,group,row.id),sanitizeForFirestore(row));});
  };
  replace(existing,backup.sessions,'paediatricsSessions');replace(existingReviews,backup.reviews??[],'paediatricsReviewEvents');replace(existingSimulations,backup.simulations??[],'paediatricsSimulations');
  if(existingCards)replace(existingCards,backup.retentionCards??[],'paediatricsRetentionCards');
  if(backup.studyPlan){operations.push(batch=>{batch.set(planConfigRef(uid),sanitizeForFirestore(backup.studyPlan!.config));});operations.push(batch=>{batch.set(planProgressRef(uid),sanitizeForFirestore(backup.studyPlan!.progress));});}
  operations.push(batch=>{batch.set(stateRef(uid),sanitizeForFirestore(backup.state));});
  for(let offset=0;offset<operations.length;offset+=450){const batch=writeBatch(db);operations.slice(offset,offset+450).forEach(operation=>operation(batch));await batch.commit();}
}
