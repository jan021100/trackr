import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState,validatePatch,applyPatch,rankedLessons,studyPrompt,SKILLS,LESSONS,pause,resume,elapsed,gapsTsv} from '../src/lib/czech/study.ts';
const now='2026-10-21T12:00:00.000Z';
const patch=()=>({kind:'trackr-czech-patch',schemaVersion:1,id:'session-1',assessments:[{lessonId:'hello',skill:'speaking',score:2,evidence:'Independent short introduction; needed help with a follow-up'}],addGaps:[{lessonId:'hello',skill:'speaking',prompt:'Say: I live in Prague',answer:'Bydlím v Praze.',priority:'normal'}],resolveGapIds:[]});
test('Czech patch changes only demonstrated skills; separate language skills stay unassessed',()=>{
 const before=emptyState();const state=applyPatch(before,patch(),now);
 assert.equal(state.assessments.hello.speaking.score,2);
 assert.equal(state.assessments.hello.listening,undefined);
 assert.equal(before.gaps.length,0);
 assert.equal(state.practiceCount,1);
 assert.equal(state.studySeconds,0);
 assert.equal(state.gaps[0].id,'session-1-0');
 assert.match(gapsTsv(state),/Say: I live in Prague\tBydlím v Praze\.\tCzech::hello Czech::speaking/);
 const second=patch();second.id='session-2';const next=applyPatch(state,second,now);
 assert.equal(next.gaps.length,1);
 second.resolveGapIds=['unknown'];assert.throws(()=>applyPatch(state,second,now),/does not exist/);
 second.resolveGapIds=[state.gaps[0].id];assert.equal(applyPatch(state,second,now).gaps[0].resolvedAt,now);
});
test('patch validation rejects foreign topics, invented skill, invalid rating, injected fields and empty evidence',()=>{
 for(const mutate of [p=>p.assessments[0].score=5,p=>p.assessments[0].lessonId='1a',p=>p.assessments[0].skill='mastery',p=>p.assessments[0].evidence='',p=>p.addGaps[0].resolvedAt=now,p=>p.timer={},p=>p.id='../bad']){const p=patch();mutate(p);assert.throws(()=>validatePatch(p));}
});
test('priority is specific to selected language skill and area',()=>{
 const s=applyPatch(emptyState(),patch(),now);
 assert.notEqual(rankedLessons(s,'All','speaking',Date.parse(now))[0].id,'hello');
 assert.equal(rankedLessons(s,'All','listening',Date.parse(now))[0].id,'hello');
 assert.ok(rankedLessons(s,'Clinic','speaking').every(l=>l.track==='Clinic'));
});
test('all lesson/skill prompts have valid patch templates and avoid fabricated listening assessment',()=>{
 for(const l of LESSONS)for(const skill of SKILLS){const prompt=studyPrompt(emptyState(),l.id,skill,'unique-session');validatePatch(JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"kind"'))));assert.match(prompt,/do NOT score listening/);assert.match(prompt,/BEFORE correction/);assert.ok(prompt.length<3500);}
});
test('timer excludes pauses, preserves elapsed on resume and does not double resume',()=>{
 const t={lessonId:'hello',startedAt:now,runningSince:now,seconds:0,status:'running'};
 const stopped=pause(t,Date.parse(now)+60000);assert.equal(elapsed(stopped,Date.parse(now)+180000),60);
 const restarted=resume(stopped,Date.parse(now)+180000);assert.equal(elapsed(restarted,Date.parse(now)+240000),120);assert.deepEqual(resume(restarted,Date.parse(now)+220000),restarted);
});
test('archives are read-only and old active routes redirect before subscriptions mount',()=>{
 const archive=fs.readFileSync('src/lib/paediatrics/paediatricsArchive.ts','utf8');assert.doesNotMatch(archive,/\b(?:onSnapshot|setDoc|updateDoc|runTransaction)\b/);assert.match(archive,/cachedUid===uid/);assert.match(archive,/paediatricsRetentionCards/);
 for(const route of ['','/plan','/review'])assert.match(fs.readFileSync('src/routes/(app)/study'+route+'/+page.ts','utf8'),/redirect\(307/);
 assert.doesNotMatch(fs.readFileSync('src/routes/(app)/dashboard/+page.svelte','utf8'),/paediatricsTracker|paediatricsSessions|paediatricsRetentionCards/);
});
