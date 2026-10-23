import {createHash,randomBytes} from 'node:crypto';
import {calendarFeed,type StudyTime} from '../medicine/calendar';
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const validCalendarToken=(token:unknown):token is string=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
export type CalendarConfig={token:string};
export type CalendarDependencies={
 verify:(token:string)=>Promise<string>;
 read:(uid:string)=>Promise<CalendarConfig|null>;
 save:(uid:string,config:CalendarConfig|null)=>Promise<void>;
 owner:(hash:string)=>Promise<string|null>;
 times:(uid:string)=>Promise<StudyTime[]>;
};
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
export async function manageCalendar(request:Request,deps:CalendarDependencies){
 const auth=request.headers.get('authorization')??'';if(!auth.startsWith('Bearer '))return json({error:'Bitte anmelden.'},401);
 let uid:string;try{uid=await deps.verify(auth.slice(7));if(!uid)throw Error();}catch{return json({error:'Anmeldung konnte nicht bestätigt werden.'},401);}
 try{
  if(request.method==='DELETE'){await deps.save(uid,null);return json({enabled:false});}
  if(!['GET','POST'].includes(request.method))return json({error:'Methode nicht erlaubt.'},405);
  // POST is idempotent. Disable and enable again to explicitly rotate the private link.
  let config=await deps.read(uid);if(request.method==='POST'&&!config){config={token:randomBytes(32).toString('hex')};await deps.save(uid,config);config=await deps.read(uid);}
  if(!config||!validCalendarToken(config.token))return json({enabled:false});
  return json({enabled:true,path:`/api/medicine/calendar/feed/${config.token}`});
 }catch{return json({error:'Kalender momentan nicht verfügbar. Bitte erneut versuchen.'},503);}
}
export async function serveCalendar(token:string,deps:CalendarDependencies){
 if(!validCalendarToken(token))return new Response('Nicht gefunden',{status:404,headers});
 try{const hash=tokenHash(token),uid=await deps.owner(hash);if(!uid)return new Response('Nicht gefunden',{status:404,headers});
  const sessions=await deps.times(uid);return new Response(calendarFeed(sessions,hash.slice(0,16)),{headers:{...headers,'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="trackr-lernzeiten.ics"'}});
 }catch{return new Response('Kalender vorübergehend nicht verfügbar',{status:503,headers});}
}
