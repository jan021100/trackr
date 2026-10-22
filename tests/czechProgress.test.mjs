import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,applyPatch,validatePatch,studyPrompt,rankedLessons,topicScore,scoreBand} from '../src/lib/czech/study.ts';
import {progressHistory} from '../src/lib/czech/progress.ts';
const date='2026-10-21T12:00:00.000Z';
const base=()=>({kind:'trackr-czech-patch',schemaVersion:1,id:'practice-1',assessments:[],addGaps:[],resolveGapIds:[]});
const item=(status='introduced')=>({term:'Dům',meaning:'Haus',lessonId:'home',kind:'word',status,evidence:'Actually introduced in the conversation'});
test('mixed is an open-ended prompt and leaves individual untested skills blank',()=>{
 assert.equal(emptyState().level,undefined);
 const prompt=studyPrompt(emptyState(),'hello','mixed','session');
 assert.match(prompt,/MIXED MODE/);assert.match(prompt,/without a fixed level ceiling/);assert.match(prompt,/increase vocabulary, grammar and scenario complexity/);assert.match(prompt,/do NOT score listening/);assert.doesNotMatch(prompt,/refresh A1\/A2/);
 const template=validatePatch(JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"kind"'))));
 assert.equal(template.assessments[0].skill,'speaking');
 const legacy={...emptyState(),level:'A1/A2'};
 assert.match(studyPrompt(legacy,'hello','mixed','session'),/Open-ended Czech/);
 const s=applyPatch(legacy,template,date);assert.equal(s.assessments.hello.listening,undefined);
 assert.notEqual(rankedLessons(s,'All','mixed',Date.parse(date))[0].id,'hello');
 assert.equal(topicScore(s,'hello'),0);assert.equal(scoreBand(undefined),'unassessed');
});
test('vocabulary counts real unique Czech items and distinguishes introduction, recall and forgetting',()=>{
 let p={...base(),vocabulary:[item()]};let state=applyPatch(emptyState(),p,date);
 assert.equal(state.vocabulary.length,1);assert.equal(state.vocabulary[0].status,'introduced');
 p={...base(),id:'practice-2',vocabulary:[{...item('recalled'),term:' dům ',lessonId:'hello',evidence:'Produced independently before help'}]};
 state=applyPatch(state,p,'2026-10-22T12:00:00.000Z');assert.equal(state.vocabulary.length,1);assert.equal(state.vocabulary[0].firstSeenAt,date);assert.equal(state.vocabulary[0].status,'recalled');
 state=applyPatch(state,{...base(),vocabulary:[item()]},date);assert.equal(state.vocabulary[0].status,'recalled','re-exposure does not fabricate a loss of previously observed recall');
 state=applyPatch(state,{...base(),vocabulary:[item('needs-review')]},date);assert.equal(state.vocabulary[0].status,'needs-review');
 assert.throws(()=>validatePatch({...base(),vocabulary:[item(),{...item(),term:'dům'}]}),/Duplicate/);
 assert.throws(()=>validatePatch({...base(),vocabulary:[{...item(),evidence:''}]}),/evidence/);
 const noWords=applyPatch(emptyState(),{...base(),assessments:[{lessonId:'home',skill:'reading',score:4,evidence:'Read a short text independently'}]},date);assert.equal(noWords.vocabulary.length,0,'high scores never invent vocabulary');
});
test('history reconstructs real daily skill and vocabulary growth without assigning untested skills',()=>{
 const a={...base(),assessments:[{lessonId:'home',skill:'reading',score:2,evidence:'Independent attempt'}],vocabulary:[item()]};
 const b={...base(),id:'practice-2',assessments:[{lessonId:'home',skill:'speaking',score:4,evidence:'Independent answer'}],vocabulary:[item('recalled'),{...item(),term:'Dobrý den',meaning:'Guten Tag',kind:'phrase'}]};
 const history=progressHistory([{id:'2',createdAt:'2026-10-23T12:00:00Z',patch:b},{id:'1',createdAt:date,patch:a}]);
 assert.equal(history.length,2);assert.equal(history[0].words,1);assert.equal(history[0].recalled,0);assert.equal(history[1].words,1);assert.equal(history[1].phrases,1);assert.equal(history[1].recalled,1);assert.equal(history[1].average,3);assert.equal(history[1].assessed,2);
});
