import {getAdminDb,verifyFirebaseUser} from './firebase-admin';
import {tokenHash,type CalendarDependencies,type CalendarConfig} from './medicine-calendar';
import type {StudyTime} from '../medicine/calendar';
// Root collections are server-only under the existing default-deny rules.
export const calendarDependencies:CalendarDependencies={
 verify:verifyFirebaseUser,
 async read(uid){const s=await getAdminDb().collection('medicineCalendarOwners').doc(uid).get();return s.exists?s.data() as CalendarConfig:null;},
 async save(uid,config){
  const db=getAdminDb(),owner=db.collection('medicineCalendarOwners').doc(uid);
  await db.runTransaction(async tx=>{const old=await tx.get(owner);const prior=old.data()?.token as string|undefined;
   // Read previous mapping before writes; do not allow a corrupted owner record to revoke another owner's feed.
   const priorRef=prior?db.collection('medicineCalendarFeeds').doc(tokenHash(prior)):null;
   const mapping=priorRef?await tx.get(priorRef):null;
   if(priorRef&&mapping?.data()?.uid===uid)tx.delete(priorRef);
   if(config){tx.set(owner,config);tx.set(db.collection('medicineCalendarFeeds').doc(tokenHash(config.token)),{uid});}else tx.delete(owner);
  });
 },
 async owner(hash){const s=await getAdminDb().collection('medicineCalendarFeeds').doc(hash).get();const uid=s.data()?.uid;return typeof uid==='string'?uid:null;},
 async times(uid){const s=await getAdminDb().collection('users').doc(uid).collection('studyLogs').where('kind','in',['medicine-time','czech-time']).get();return s.docs.map(d=>({id:d.id,subject:d.data().kind==='czech-time'?'czech':'medicine',startedAt:d.data().startedAt,endedAt:d.data().endedAt})).filter(s=>typeof s.startedAt==='string'&&typeof s.endedAt==='string') as StudyTime[];}
};
