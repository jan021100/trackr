import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '$lib/firebase';
import {
  createEmptySurgeryState,
  hydrateState,
  type SessionSnapshot,
  type SurgeryBackup,
  type SurgeryState
} from './surgerySchema';
import { normalizeRetentionCard, type RetentionCard } from './retentionSchema';
import { migrateToExplicitCoverage, type StudyPlanConfig, type StudyPlanProgress } from './studyPlanSchema';
import { sanitizeForFirestore } from './firestoreData';

const stateRef = (uid: string) => doc(db, 'users', uid, 'surgeryTracker', 'state');
const sessionsRef = (uid: string) => collection(db, 'users', uid, 'surgerySessions');
const cardsRef = (uid: string) => collection(db, 'users', uid, 'retentionCards');
const planConfigRef = (uid: string) => doc(db, 'users', uid, 'surgeryPlan', 'config');
const planProgressRef = (uid: string) => doc(db, 'users', uid, 'surgeryPlan', 'progress');

export function subscribeToStudyPlan(uid:string, onValue:(config:StudyPlanConfig|null, progress:StudyPlanProgress|null)=>void, onError:(error:Error)=>void) {
  let config:StudyPlanConfig|null=null, progress:StudyPlanProgress|null=null;
  const emit=()=>onValue(config,progress);
  const a=onSnapshot(planConfigRef(uid),(s)=>{config=s.exists()?s.data() as StudyPlanConfig:null; emit();},onError);
  const b=onSnapshot(planProgressRef(uid),(s)=>{if(!s.exists()){progress=null;emit();return;}const stored=s.data() as StudyPlanProgress;progress=migrateToExplicitCoverage(stored);emit();if(progress!==stored) setDoc(planProgressRef(uid),sanitizeForFirestore(progress)).catch(onError);},onError);
  return ()=>{a();b();};
}
export async function saveStudyPlan(uid:string, config:StudyPlanConfig, progress?:StudyPlanProgress) { await setDoc(planConfigRef(uid),sanitizeForFirestore(config)); if(progress) await setDoc(planProgressRef(uid),sanitizeForFirestore(progress)); }
export async function saveStudyPlanProgress(uid:string, progress:StudyPlanProgress) { await setDoc(planProgressRef(uid),sanitizeForFirestore(progress)); }
export async function readStudyPlan(uid:string) { const [a,b]=await Promise.all([getDoc(planConfigRef(uid)),getDoc(planProgressRef(uid))]); return {config:a.exists()?a.data() as StudyPlanConfig:null,progress:b.exists()?b.data() as StudyPlanProgress:null}; }

export function subscribeToSurgeryState(
  uid: string,
  onValue: (state: SurgeryState) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    stateRef(uid),
    (snapshot) => onValue(snapshot.exists() ? hydrateState(snapshot.data() as SurgeryState) : createEmptySurgeryState()),
    (error) => onError(error)
  );
}

export function subscribeToSurgerySessions(
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

export async function saveSurgeryState(uid: string, state: SurgeryState) {
  await setDoc(stateRef(uid), sanitizeForFirestore(state));
}

export async function saveSession(uid: string, session: SessionSnapshot) {
  await setDoc(doc(db, 'users', uid, 'surgerySessions', session.id), sanitizeForFirestore(session));
}

export function subscribeToRetentionCards(uid: string, onValue: (cards: RetentionCard[]) => void, onError: (error: Error) => void) {
  return onSnapshot(cardsRef(uid), (snapshot) => onValue(snapshot.docs.map((item) => normalizeRetentionCard(item.data() as RetentionCard))), onError);
}

export async function saveRetentionCard(uid: string, card: RetentionCard) {
  await setDoc(doc(db, 'users', uid, 'retentionCards', card.id), sanitizeForFirestore(card));
}

export async function deleteRetentionCard(uid: string, cardId: string) {
  await deleteDoc(doc(db, 'users', uid, 'retentionCards', cardId));
}

export async function saveRetentionCards(uid: string, cards: RetentionCard[]) {
  for (let offset = 0; offset < cards.length; offset += 450) {
    const batch = writeBatch(db);
    for (const card of cards.slice(offset, offset + 450)) batch.set(doc(db, 'users', uid, 'retentionCards', card.id), sanitizeForFirestore(card));
    await batch.commit();
  }
}

export async function readBackup(uid: string, state: SurgeryState): Promise<SurgeryBackup> {
  const snapshot = await getDocs(sessionsRef(uid));
  const plan = await readStudyPlan(uid);
  return {
    kind: 'trackr-surgery-backup',
    exportedAt: new Date().toISOString(),
    state,
    sessions: snapshot.docs.map((item) => item.data() as SessionSnapshot),
    ...(plan.config && plan.progress ? { studyPlan: { config: plan.config, progress: plan.progress } } : {})
  };
}

export async function restoreBackup(uid: string, backup: SurgeryBackup) {
  const existing = await getDocs(sessionsRef(uid));
  const batch = writeBatch(db);
  batch.set(stateRef(uid), sanitizeForFirestore(backup.state));
  for (const item of existing.docs) batch.delete(item.ref);
  for (const session of backup.sessions) batch.set(doc(db, 'users', uid, 'surgerySessions', session.id), sanitizeForFirestore(session));
  if (backup.studyPlan) { batch.set(planConfigRef(uid), sanitizeForFirestore(backup.studyPlan.config)); batch.set(planProgressRef(uid), sanitizeForFirestore(backup.studyPlan.progress)); }
  await batch.commit();
}
