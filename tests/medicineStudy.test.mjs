import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SPECIALTIES,DOMAINS} from '../src/lib/medicine/catalogue.ts';
import {emptyState,validatePatch,assessmentScore,applyPatch,specialtyScore,rankSpecialties,caseRequest,makePrompt,updateGaps,pause,resume,elapsed} from '../src/lib/medicine/study.ts';
const now='2026-10-22T12:00:00.000Z';
const source={kind:'guideline',title:'Test source, not clinical guidance',locator:'Section used in this test',url:'https://www.nice.org.uk/guidance',access:'opened',checkedAt:'2026-10-22',supports:'Validation fixture only'};
const patch=(id='test-case')=>({kind:'trackr-medicine-patch',schemaVersion:1,id,specialtyId:'family',scenarioIndex:0,caseTitle:'Fictitious test encounter',caseSummary:'Independent performance and subsequent teaching are distinguished.',assessments:[{specialtyId:'family',ratings:Object.fromEntries(DOMAINS.map(d=>[d,3])),safetyCriticalError:false,evidence:'All five domains independently tested in this fictional encounter'}],addGaps:[],gapResults:[],sources:[{...source}]});
test('clinical catalogue covers medical, operative, non-state-exam and diagnostic fields without population-health modules',()=>{
 assert.equal(new Set(SPECIALTIES.map(s=>s.id)).size,SPECIALTIES.length);
 for(const id of ['family','paediatrics','obstetrics','ophthalmology','ent','orthopaedics','urology','psychiatry','dermatology','geriatrics','palliative','rehabilitation','radiology','laboratory','genetics','forensic','occupational','nutrition'])assert.ok(SPECIALTIES.some(s=>s.id===id),id);
 assert.ok(!SPECIALTIES.some(s=>['public-health','hygiene','epidemiology'].includes(s.id)));
 assert.ok(SPECIALTIES.every(s=>s.presentations.length===3));
});
test('case scores use actual domain ratings with caps separately, never filling untested domains',()=>{
 const p=patch();assert.equal(assessmentScore(p.assessments[0]),15);
 const unsafe={...p.assessments[0],ratings:Object.fromEntries(DOMAINS.map(d=>[d,4])),safetyCriticalError:true};
 assert.equal(assessmentScore(unsafe),7);assert.ok(Object.values(unsafe.ratings).every(n=>n===4));
 assert.equal(assessmentScore({...p.assessments[0],ratings:{historyExam:4,differential:4}}),undefined);
 const zero={...p.assessments[0],ratings:{...p.assessments[0].ratings,investigations:0}};assert.equal(assessmentScore(zero),7);
});
test('missing current guideline blocks treatment and safety ratings but allows honest partial assessment',()=>{
 const p=patch();p.sources=[];assert.throws(()=>validatePatch(p),/Leitlinienquelle/);
 p.assessments[0].ratings={historyExam:3,differential:2};assert.doesNotThrow(()=>validatePatch(p));
 p.addGaps=[{specialtyId:'family',prompt:'A demonstrated recall target',answer:'A checked answer',priority:'important'}];assert.throws(()=>validatePatch(p),/Quellenzugriff/);
 p.sources=[{...source,access:'unavailable'}];assert.throws(()=>validatePatch(p),/Quellenzugriff/);
});
test('patch validation rejects unsafe URLs, fabricated field IDs, duplicate assessments and invalid ratings',()=>{
 for(const change of [p=>p.sources[0].url='javascript:alert(1)',p=>p.specialtyId='public-health',p=>p.assessments.push({...p.assessments[0]}),p=>p.assessments[0].ratings.safety=5,p=>p.assessments[0].evidence='',p=>p.plan={firstPassComplete:true},p=>p.id='../other']){const p=patch();change(p);assert.throws(()=>validatePatch(p));}
});
test('observations retain a bounded recent sample without declaring a specialty mastered',()=>{
 let s=emptyState();for(let i=0;i<8;i++)s=applyPatch(s,patch(`case-${i}`),now);
 assert.equal(s.caseCount,8);assert.equal(s.specialties.family.cases,8);assert.equal(s.specialties.family.scores.length,5);assert.equal(specialtyScore(s,'family'),15);
 assert.equal(specialtyScore(s,'ophthalmology'),undefined);assert.equal(specialtyScore(emptyState(),'family'),undefined);
 assert.equal(s.lastCaseId,'case-7');assert.equal(s.studySeconds,0);
});
test('balanced coverage rotates even partial unscored encounters and selects a fresh presentation',()=>{
 const before=emptyState();const first=rankSpecialties(before,[],Date.parse(now))[0];assert.equal(first.id,'family');
 const p=patch();p.sources=[];p.assessments[0].ratings={historyExam:2};const after=applyPatch(before,p,now);
 assert.notEqual(rankSpecialties(after,[],Date.parse(now))[0].id,'family');
 assert.equal(caseRequest(after,'family','primary-care','next-case').scenarioIndex,1);
 assert.deepEqual(before,emptyState());
});
test('specific gaps retain IDs, repair never auto-resolves and later tests update only real IDs',()=>{
 const p=patch();p.addGaps=[{specialtyId:'family',prompt:'Identify a missing decision',answer:'Checked corrected key point',priority:'critical'}];
 const gaps=updateGaps([],p,now);assert.equal(gaps.length,1);assert.equal(gaps[0].resolvedAt,undefined);
 const later='2026-10-26T12:00:00.000Z';const next=patch('second');next.addGaps=[{...p.addGaps[0],priority:'normal'}];
 const unchanged=updateGaps(gaps,next,later);assert.equal(unchanged.length,1);assert.equal(unchanged[0].priority,'critical');
 next.gapResults=[{gapId:gaps[0].id,outcome:'unchanged'}];assert.equal(updateGaps(gaps,next,later)[0].resolvedAt,undefined);
 next.addGaps=[];next.gapResults[0].outcome='resolved';assert.equal(updateGaps(gaps,next,later)[0].resolvedAt,later);
 next.gapResults=[{gapId:'not-found',outcome:'resolved'}];assert.throws(()=>updateGaps(gaps,next,later),/vorhandene/);
});
test('every specialty generates a valid patch contract and a case-based source-access prompt',()=>{
 const state=emptyState();for(const s of SPECIALTIES){const prompt=makePrompt(state,[],caseRequest(state,s.id,'primary-care','unique-case'));const template=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"kind"')));validatePatch(template);assert.match(prompt,/Ohne Zugriff/);assert.match(prompt,/fiktiv/);assert.match(prompt,/VOR Hilfe/);assert.match(prompt,/keine Pass-Abschlüsse/);assert.match(prompt,/ohne Bild keine visuelle Befundungskompetenz/);assert.equal(template.specialtyId,s.id);}
});
test('case timer excludes breaks and retains the original case identity',()=>{
 const request=caseRequest(emptyState(),'family','mixed','original-case');const timer={specialtyId:'family',request,startedAt:now,runningSince:now,seconds:0,status:'running'};
 const stopped=pause(timer,Date.parse(now)+60000);assert.equal(elapsed(stopped,Date.parse(now)+180000),60);
 const continued=resume(stopped,Date.parse(now)+180000);assert.equal(elapsed(continued,Date.parse(now)+240000),120);assert.equal(continued.request.id,'original-case');
});
