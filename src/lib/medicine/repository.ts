import {collection,doc,getDocs,onSnapshot,query,runTransaction,where} from 'firebase/firestore';
import {db} from '$lib/firebase';
import {applyPatch,validatePatch,updateGaps,emptyState,pause,resume,normalizeGap,finishSession,finishPatchSession,type State,type Gap,type Patch,type Request,type CaseLog} from './study';
const ref=(uid:string)=>doc(db,'users',uid,'meta','medicineStudy');
export function subscribeMedicine(uid:string,onState:(s:State)=>void,onGaps:(g:Gap[])=>void,onError:(e:Error)=>void){const a=onSnapshot(ref(uid),s=>onState(s.exists()?s.data() as State:emptyState()),onError);const b=onSnapshot(query(collection(db,'users',uid,'studyLogs'),where('kind','==','medicine-gap')),s=>onGaps(s.docs.map(d=>d.data() as Gap)),onError);return()=>{a();b();};}
export async function importCase(uid:string,input:Patch,knownGaps:Gap[]){
 const p=validatePatch(input);
 // Stable exact-question index prevents concurrent imports creating duplicate gaps.
 // Semantic equivalence is explicit via gapId, never guessed by fuzzy medical-text matching.
 const gapKeys=await Promise.all(p.addGaps.map(async g=>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${g.specialtyId}:${normalizeGap(g.prompt)}`));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}));
 return runTransaction(db,async tx=>{
  const caseRef=doc(db,'users',uid,'studyLogs',`medicine-case-${p.id}`);
  const indexRefs=gapKeys.map(key=>doc(db,'users',uid,'studyLogs',`medicine-gap-key-${key}`));
  const [s,already,...indexes]=await Promise.all([tx.get(ref(uid)),tx.get(caseRef),...indexRefs.map(r=>tx.get(r))]);
  if(already.exists())return false;
  const effective=structuredClone(p);
  for(const [i,g] of effective.addGaps.entries()){
   const indexed=indexes[i].data()?.gapId as string|undefined;
   const legacy=knownGaps.find(old=>old.specialtyId===g.specialtyId&&normalizeGap(old.prompt)===normalizeGap(g.prompt));
   g.gapId??=indexed??legacy?.id;
  }
  const ids=[...new Set([...effective.addGaps.flatMap(g=>g.gapId?[g.gapId]:[]),...p.gapResults.map(r=>r.gapId)])];
  const gapDocs=await Promise.all(ids.map(id=>tx.get(doc(db,'users',uid,'studyLogs',`medicine-gap-${id}`))));
  const now=new Date().toISOString(),state=s.exists()?s.data() as State:emptyState();
  const gaps=updateGaps(gapDocs.filter(d=>d.exists()).map(d=>d.data() as Gap),effective,now);
  const finished=finishPatchSession(applyPatch(state,p,now),p,now);
  tx.set(ref(uid),finished.state);tx.set(caseRef,{kind:'medicine-case',createdAt:now,patch:p});
  if(finished.log)tx.set(doc(db,'users',uid,'studyLogs',finished.id!),finished.log);
  for(const g of gaps)tx.set(doc(db,'users',uid,'studyLogs',`medicine-gap-${g.id}`),{kind:'medicine-gap',...g});
  for(const [i,g] of effective.addGaps.entries()){
   const target=g.gapId??gaps.find(old=>old.specialtyId===g.specialtyId&&normalizeGap(old.prompt)===normalizeGap(g.prompt))?.id;
   if(target)tx.set(indexRefs[i],{kind:'medicine-gap-key',gapId:target});
  }
  return true;
 });
}
export async function changeTimer(uid:string,action:'start'|'pause'|'resume'|'finish'|'cancel',request?:Request){return runTransaction(db,async tx=>{
 const snap=await tx.get(ref(uid)),state=snap.exists()?snap.data() as State:emptyState(),now=Date.now(),stamp=new Date(now).toISOString();
 if(action==='start'){
  if(!request)throw new Error('Zuerst einen Fall auswählen.');
  if(state.timer&&state.timer.request.id!==request.id)throw new Error('Den laufenden Fall-Timer zuerst beenden oder abbrechen.');
  state.timer=state.timer?resume(state.timer,now):{specialtyId:request.specialtyId,request,startedAt:stamp,runningSince:stamp,seconds:0,status:'running'};
 }else{
  if(!state.timer)return;
  if(action==='pause')state.timer=pause(state.timer,now);else if(action==='resume')state.timer=resume(state.timer,now);else{
   if(action==='finish'){const finished=finishSession(state,stamp);state.studySeconds=finished.state.studySeconds;tx.set(doc(db,'users',uid,'studyLogs',finished.id!),finished.log!);}
   delete state.timer;
  }
 }
 tx.set(ref(uid),state);
});}
export async function readCases(uid:string){const s=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','==','medicine-case')));return s.docs.map(d=>({id:d.id,...d.data()})) as CaseLog[];}
export async function backupMedicine(uid:string,state:State,gaps:Gap[]){const s=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','in',['medicine-case','medicine-time'])));return {kind:'trackr-medicine-backup',exportedAt:new Date().toISOString(),state,gaps,history:s.docs.map(d=>({id:d.id,...d.data()}))};}
