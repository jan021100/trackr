import {collection,doc,getDocs,onSnapshot,query,runTransaction,where} from 'firebase/firestore';
import {db} from '$lib/firebase';
import {applyPatch,validatePatch,updateGaps,emptyState,elapsed,pause,resume,type State,type Gap,type Patch,type Request,type CaseLog} from './study';
const ref=(uid:string)=>doc(db,'users',uid,'meta','medicineStudy');
export function subscribeMedicine(uid:string,onState:(s:State)=>void,onGaps:(g:Gap[])=>void,onError:(e:Error)=>void){const a=onSnapshot(ref(uid),s=>onState(s.exists()?s.data() as State:emptyState()),onError);const b=onSnapshot(query(collection(db,'users',uid,'studyLogs'),where('kind','==','medicine-gap')),s=>onGaps(s.docs.map(d=>d.data() as Gap)),onError);return()=>{a();b();};}
export async function importCase(uid:string,input:Patch,knownGaps:Gap[]){
 const p=validatePatch(input);
 const duplicateIds=knownGaps.filter(old=>!old.resolvedAt&&p.addGaps.some(g=>g.specialtyId===old.specialtyId&&g.prompt.trim().toLowerCase()===old.prompt.trim().toLowerCase())).map(g=>g.id);
 return runTransaction(db,async tx=>{
  const caseRef=doc(db,'users',uid,'studyLogs',`medicine-case-${p.id}`);
  const ids=[...new Set([...duplicateIds,...p.gapResults.map(r=>r.gapId)])];
  const [s,already,...gapDocs]=await Promise.all([tx.get(ref(uid)),tx.get(caseRef),...ids.map(id=>tx.get(doc(db,'users',uid,'studyLogs',`medicine-gap-${id}`)))]);
  if(already.exists())return false;
  const now=new Date().toISOString(),state=s.exists()?s.data() as State:emptyState();
  const gaps=updateGaps(gapDocs.filter(d=>d.exists()).map(d=>d.data() as Gap),p,now);
  tx.set(ref(uid),applyPatch(state,p,now));tx.set(caseRef,{kind:'medicine-case',createdAt:now,patch:p});
  for(const g of gaps)tx.set(doc(db,'users',uid,'studyLogs',`medicine-gap-${g.id}`),{kind:'medicine-gap',...g});
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
   if(action==='finish'){const seconds=elapsed(state.timer,now);state.studySeconds+=seconds;tx.set(doc(db,'users',uid,'studyLogs',`medicine-time-${state.timer.request.id}-${state.timer.startedAt}`),{kind:'medicine-time',createdAt:stamp,request:state.timer.request,startedAt:state.timer.startedAt,endedAt:stamp,durationSeconds:seconds});}
   delete state.timer;
  }
 }
 tx.set(ref(uid),state);
});}
export async function readCases(uid:string){const s=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','==','medicine-case')));return s.docs.map(d=>({id:d.id,...d.data()})) as CaseLog[];}
export async function backupMedicine(uid:string,state:State,gaps:Gap[]){const s=await getDocs(query(collection(db,'users',uid,'studyLogs'),where('kind','in',['medicine-case','medicine-time'])));return {kind:'trackr-medicine-backup',exportedAt:new Date().toISOString(),state,gaps,history:s.docs.map(d=>({id:d.id,...d.data()}))};}
