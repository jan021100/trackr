import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,caseRequest,makePrompt,updateGaps,gapDueAt,gapDue,dueGaps,rankSpecialties,normalizeGap,finishPatchSession,pause} from '../src/lib/medicine/study.ts';
import {calendarBlocks,calendarFeed,foldCalendarLine,calendarLinks} from '../src/lib/medicine/calendar.ts';
import {manageCalendar,serveCalendar,tokenHash} from '../src/lib/server/medicine-calendar.ts';
const start='2026-10-23T10:00:00.000Z',later='2026-10-26T10:00:00.000Z';
const gap={id:'gap-one',specialtyId:'family',prompt:'Welche Entscheidung fehlt?',answer:'Quellengeprüfte Antwort',priority:'important',createdAt:start};
const p={id:'new-case',addGaps:[],gapResults:[]};
test('legacy and new gaps become due after three days, never immediately',()=>{
 assert.equal(gapDueAt(gap),later);assert.equal(gapDue(gap,Date.parse(later)-1),false);assert.equal(gapDue(gap,Date.parse(later)),true);
 const created=updateGaps([],{...p,addGaps:[{...gap,id:undefined,createdAt:undefined}]},start)[0];assert.equal(created.dueAt,later);
 assert.throws(()=>updateGaps([gap],{...p,gapResults:[{gapId:gap.id,outcome:'resolved'}]},start),/Fälligkeit|vorhandene/);
});
test('a failed delayed test retains ID and restarts the delay, a successful due test closes it',()=>{
 const failed=updateGaps([gap],{...p,gapResults:[{gapId:gap.id,outcome:'unchanged'}]},later)[0];
 assert.equal(failed.id,gap.id);assert.equal(failed.dueAt,'2026-10-29T10:00:00.000Z');assert.equal(failed.resolvedAt,undefined);
 const resolved=updateGaps([gap],{...p,gapResults:[{gapId:gap.id,outcome:'resolved'}]},later)[0];assert.equal(resolved.resolvedAt,later);assert.deepEqual(dueGaps([resolved],Date.parse(later)+999999999),[]);
 assert.throws(()=>updateGaps([gap],{...p,addGaps:[{...gap,gapId:gap.id}],gapResults:[{gapId:gap.id,outcome:'resolved'}]},later),/gleichzeitigen/);
});
test('rephrased gaps explicitly reuse IDs, closed gaps reopen, invalid specialties cannot hijack IDs',()=>{
 const closed={...gap,resolvedAt:later};const add={specialtyId:'family',prompt:'Anders formulierte gleiche Entscheidung?',answer:'Neu geprüft',priority:'critical',gapId:gap.id};
 const reopened=updateGaps([closed],{...p,addGaps:[add]},later);assert.equal(reopened.length,1);assert.equal(reopened[0].id,gap.id);assert.equal(reopened[0].resolvedAt,undefined);assert.equal(reopened[0].priority,'critical');
 assert.throws(()=>updateGaps([gap],{...p,addGaps:[{...add,specialtyId:'cardiology'}]},later),/Fach/);
 assert.equal(normalizeGap('Welche Entscheidung fehlt?'),normalizeGap(' WELCHE Entscheidung fehlt! '));
 assert.notEqual(normalizeGap('Kalium > 5'),normalizeGap('Kalium < 5'));
});
test('due gaps outrank unobserved specialties and early gaps do not force retests',()=>{
 const state=emptyState();state.specialties.family={cases:1,scores:[19],lastAt:start,lastRatings:{}};
 assert.notEqual(rankSpecialties(state,[gap],Date.parse(start))[0].id,'family');assert.equal(rankSpecialties(state,[gap],Date.parse(later))[0].id,'family');
});
test('prompt context is bounded and rapid mode preserves honest partial assessments and current IDs',()=>{
 const now=new Date(Date.now()-5*86400000).toISOString();const many=Array.from({length:1000},(_,i)=>({...gap,id:`gap-${i}`,createdAt:now,prompt:`Decision ${i} `+'x'.repeat(400),answer:'y'.repeat(1000)}));
 const request=caseRequest(emptyState(),'family','mixed','vignette-id','rapid');const prompt=makePrompt(emptyState(),many,request);
 assert.match(prompt,/VIGNETTEN-MODUS/);assert.match(prompt,/4–6/);assert.match(prompt,/durch die Korrektur verratenes Wissen/);assert.match(prompt,/aktuelle Trackr-Stand/);assert.match(prompt,/"mode":"rapid"/);
 const due=JSON.parse(prompt.split('PRIVATE LÜCKEN (nicht vor dem Abruf offenlegen): ')[1].split('\n')[0]);assert.equal(due.length,3);
 assert.ok(prompt.length<11000,prompt.length);assert.ok(!prompt.includes('y'.repeat(1000)));assert.match(makePrompt(emptyState(),[],{...request,mode:'case'}),/FALL-MODUS/);
});
const time=(id,start,end)=>({id,startedAt:`2026-10-23T${start}:00.000Z`,endedAt:`2026-10-23T${end}:00.000Z`});
test('calendar merges strictly under 15 minutes, chains, overlaps, deduplicates and ignores invalid sessions',()=>{
 const sessions=[time('b','10:44','11:00'),time('a','10:00','10:30'),time('c','11:15','11:30'),time('d','11:20','11:40'),time('bad','12:00','11:00'),time('a','10:00','10:30')];
 const blocks=calendarBlocks(sessions);assert.equal(blocks.length,2);assert.equal(blocks[0].count,2);assert.equal(blocks[0].end,Date.parse('2026-10-23T11:00:00Z'));assert.equal(blocks[1].count,2);
});
test('calendar is deterministic UTC with stable UIDs and contains no supplied case details',()=>{
 const sessions=[{...time('opaque-id','10:00','11:00'),caseSummary:'SECRET',specialtyId:'SECRET',score:7}];const ics=calendarFeed(sessions,'owner-namespace');
 assert.equal(calendarFeed(sessions,'owner-namespace'),ics);assert.match(ics,/DTSTART:20261023T100000Z\r\n/);assert.match(ics,/UID:owner-namespace-opaque-id@trackr.learning/);assert.ok(!ics.includes('SECRET'));assert.match(ics,/CLASS:PRIVATE/);assert.match(ics,/END:VCALENDAR\r\n$/);
 const folded=foldCalendarLine('DESCRIPTION:'+'ä🙂'.repeat(100));assert.ok(folded.split('\r\n').every(line=>Buffer.byteLength(line)<=75));assert.equal(folded.replace(/\r\n /g,''),'DESCRIPTION:'+'ä🙂'.repeat(100));
});
function fixture(){const owners=new Map(),tokens=new Map();const reads=[];return {owners,tokens,reads,deps:{verify:async token=>{if(token!=='signed-in')throw Error();return 'owner';},read:async uid=>owners.get(uid)??null,save:async(uid,config)=>{const old=owners.get(uid);if(old)tokens.delete(tokenHash(old.token));if(config){owners.set(uid,config);tokens.set(tokenHash(config.token),uid);}else owners.delete(uid);},owner:async hash=>tokens.get(hash)??null,times:async uid=>{reads.push(uid);return [time('completed-session','10:00','10:30')];}}};}
const req=method=>new Request('https://trackr.test/api/medicine/calendar',{method,headers:{Authorization:'Bearer signed-in'}});
test('calendar management requires auth, uses 256-bit links, is idempotent and revoke invalidates the feed',async()=>{
 const f=fixture();assert.equal((await manageCalendar(new Request('https://trackr.test'),f.deps)).status,401);
 assert.equal((await manageCalendar(new Request('https://trackr.test',{headers:{Authorization:'Bearer bad'}}),f.deps)).status,401);
 assert.equal((await manageCalendar(req('GET'),f.deps)).status,200);assert.equal(f.owners.size,0);
 const enabled=await (await manageCalendar(req('POST'),f.deps)).json();const token=enabled.path.split('/').at(-1);assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await (await manageCalendar(req('POST'),f.deps)).json()).path,enabled.path);
 const feed=await serveCalendar(token,f.deps);assert.equal(feed.status,200);assert.equal(feed.headers.get('cache-control'),'private, no-store');assert.deepEqual(f.reads,['owner']);
 await manageCalendar(req('DELETE'),f.deps);assert.equal((await serveCalendar(token,f.deps)).status,404);assert.equal((await serveCalendar('bad',f.deps)).status,404);assert.deepEqual(f.reads,['owner']);
 const rotated=await (await manageCalendar(req('POST'),f.deps)).json();assert.notEqual(rotated.path,enabled.path);
});
test('calendar fails closed when storage is unavailable',async()=>{
 const f=fixture();f.deps.owner=async()=>{throw Error('private credential detail');};const response=await serveCalendar('a'.repeat(64),f.deps);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('credential'));
});

test('patch completion stops only its own session, stores wall-clock bounds and active seconds, and cannot count time twice',()=>{
 const state=emptyState(),request=caseRequest(state,'family','mixed','active-case');
 state.timer={specialtyId:'family',request,startedAt:start,runningSince:start,seconds:0,status:'running'};
 state.timer=pause(state.timer,Date.parse(start)+60000);
 const end=new Date(Date.parse(start)+180000).toISOString();
 const wrong=finishPatchSession(state,{id:'old-case'},end);assert.equal(wrong.state.timer.request.id,'active-case');assert.equal(wrong.log,undefined);
 const own=finishPatchSession(state,{id:'active-case'},end);assert.equal(own.state.timer,undefined);assert.equal(own.log.durationSeconds,60);assert.equal(own.state.studySeconds,60);assert.equal(own.log.startedAt,start);assert.equal(own.log.endedAt,end);
 const repeated=finishPatchSession(own.state,{id:'active-case'},end);assert.equal(repeated.log,undefined);assert.equal(repeated.state.studySeconds,60);assert.ok(state.timer);
});

test('native calendar links use the actual IPv4 listener locally and preserve HTTPS hosts and secret paths remotely',()=>{
 for(const origin of ['http://localhost:5174','http://127.0.0.1:5174','http://[::1]:5174']){
  const links=calendarLinks(origin,'/api/medicine/calendar/feed/test-token');assert.equal(links.feed,'http://127.0.0.1:5174/api/medicine/calendar/feed/test-token');assert.equal(links.subscribe,'webcal://127.0.0.1:5174/api/medicine/calendar/feed/test-token');assert.equal(links.localOnly,true);
 }
 const remote=calendarLinks('https://example.test','/api/medicine/calendar/feed/test-token');assert.equal(remote.feed,'https://example.test/api/medicine/calendar/feed/test-token');assert.equal(remote.localOnly,false);
 assert.equal(calendarLinks('http://localhost:5174','').feed,'');
});
