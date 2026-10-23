import { collection, doc, getDocs, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { applyPatch, emptyState, pause, resume, startPracticeTimer, finishPracticeTimer, finishPracticePatch, type CzechState, type Patch } from './study';
const stateRef=(uid:string)=>doc(db,'users',uid,'meta','czechStudy');
export function subscribeCzech(uid:string,onState:(s:CzechState)=>void,onError:(e:Error)=>void){return onSnapshot(stateRef(uid),s=>onState(s.exists()?s.data() as CzechState:emptyState()),onError);}
export async function importPractice(uid:string,patch:Patch){
 return runTransaction(db,async tx=>{
  const ref=stateRef(uid), log=doc(db,'users',uid,'studyLogs',`czech-patch-${patch.id}`);
  const [state,existing]=await Promise.all([tx.get(ref),tx.get(log)]);
  if(existing.exists())return false;
  const now=new Date().toISOString(),next=applyPatch(state.exists()?state.data() as CzechState:emptyState(),patch,now);
  // Vocabulary is reconstructed from practice logs; keep the state document small as it grows.
  const finished=finishPracticePatch(next,patch,now);
  const {vocabulary:_vocabulary,...stored}=finished.state;
  if(finished.log)tx.set(doc(db,'users',uid,'studyLogs',finished.id!),finished.log);
  tx.set(ref,stored);tx.set(log,{kind:'czech-review',createdAt:now,patch});return true;
 });
}
export async function changeTimer(uid:string,action:'start'|'pause'|'resume'|'finish'|'cancel',lessonId:string,patchId?:string){
 return runTransaction(db,async tx=>{
  const ref=stateRef(uid),snap=await tx.get(ref),state=snap.exists()?snap.data() as CzechState:emptyState();
  const now=Date.now(),stamp=new Date(now).toISOString();
  if(action==='start'){
   state.timer=startPracticeTimer(state.timer,lessonId,patchId??state.timer?.patchId??`czech-${crypto.randomUUID()}`,stamp);
  }else{
   if(!state.timer)return;
   if(action==='pause')state.timer=pause(state.timer,now);
   else if(action==='resume')state.timer=resume(state.timer,now);
   else{
    if(action==='finish'){
     const finished=finishPracticeTimer(state,stamp);state.studySeconds=finished.state.studySeconds;
     tx.set(doc(db,'users',uid,'studyLogs',finished.id!),finished.log!);
    }
    delete state.timer;
   }
  }
  tx.set(ref,state);
 });
}
export async function exportCzech(uid:string,state:CzechState){const logs=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','in',['czech-review','czech-time'])));return {kind:'trackr-czech-backup',exportedAt:new Date().toISOString(),state,history:logs.docs.map(d=>({id:d.id,...d.data()}))};}
export async function readPracticeHistory(uid:string){const logs=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','==','czech-review')));return logs.docs.map(d=>({id:d.id,...d.data()})) as import('./progress').PracticeLog[];}
