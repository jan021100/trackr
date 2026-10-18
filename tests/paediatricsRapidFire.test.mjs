import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, validatePatch, mergePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { scoreOralAssessment, validateOralAssessment, oralSummary } from '../src/lib/paediatrics/oralAssessment.ts';
import { buildReviewQueue } from '../src/lib/paediatrics/paediatricsReview.ts';
import { rapidFireQueue, makeRapidFirePrompt } from '../src/lib/paediatrics/rapidFire.ts';
import { createPlanProgress } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
const now='2026-10-18T12:00:00.000Z';
const assessment=(n,rapid=false)=>({ratings:{coverage:n,accuracy:n,independence:n,clinicalReasoning:n,propedeutics:n},safetyCriticalError:false,evidence:'Independent evidence',...(rapid?{scope:'rapid',scoreCeiling:15}:{})});
test('rapid sample has its own label and enforced ceiling while full assessments retain their scale',()=>{
  const rapid=validateOralAssessment(assessment(4,true));
  assert.equal(scoreOralAssessment(rapid).score,15);
  assert.equal(scoreOralAssessment(assessment(4)).score,20);
  assert.match(oralSummary({mastery:3,oralAssessment:rapid}).label,/Rapid sample/);
  assert.throws(()=>validateOralAssessment({...rapid,scoreCeiling:20}));
  assert.throws(()=>validateOralAssessment({...assessment(4),scoreCeiling:15}));
  assert.equal(scoreOralAssessment({...rapid,safetyCriticalError:true}).score,7);
});
test('merge cannot raise prior weak knowledge from a narrow rapid sample',()=>{
 const state=createEmptyPaediatricsState(now);
 state.topics['1a'].oralAssessment=assessment(1);
 const patch=validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(4,true)}]});
 const merged=mergePatch(state,patch,now);
 assert.equal(scoreOralAssessment(merged.topics['1a'].oralAssessment).score,5);
 assert.equal(scoreOralAssessment(state.topics['1a'].oralAssessment).score,5);
});
test('rapid import advances only attempted topics, preserves order, and never completes a regular pass',()=>{
 const state=createEmptyPaediatricsState(now),progress=createPlanProgress(state,[],now);
 const queue=buildReviewQueue(state,progress,[],now.slice(0,10));
 const prompt=makeRapidFirePrompt(queue.slice(0,4),state,'2026-10-20');
 const patch=validatePatch(JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"schemaVersion":1'))));
 assert.equal(patch.topics.length,1); // Compact structural example; instructions require all attempted topics.
 assert.match(prompt,/one entry per actually tested topic/);
 const context=JSON.parse(prompt.split("PRIVATE context; keep hidden before testing:\n")[1].split("\n")[0]);
 assert.deepEqual(context.map(t=>t.id),queue.slice(0,4).map(t=>t.topicId));
 assert.equal(patch.session.mode,'rapid-recall');
 assert.equal(patch.session.planPass,'review');
 assert.ok(patch.topics.every(t=>!t.plan&&t.review.pass==='review'&&t.oralAssessment.scope==='rapid'));
 assert.equal(applyExplicitPlanPatch(progress,patch,now,'rapid').changed,false);
 const events=[{topicId:queue[0].topicId,reviewedAt:now,pass:'review',mode:'rapid-recall',notes:'[RAPID FIRE] actual attempted topic'}];
 assert.deepEqual(rapidFireQueue(queue,events,'2026-10-18'),queue.slice(1));
 assert.deepEqual(rapidFireQueue(queue,events,'2026-10-19'),queue);
 assert.deepEqual(rapidFireQueue(queue,[{...events[0],notes:'Ordinary gap review'}],'2026-10-18'),queue);
 assert.match(prompt,/STRICT 5min\/topic/);
 assert.match(prompt,/OMIT oralAssessment/);
 assert.match(prompt,/Teaching\/immediate repetition never resolves gaps/);
});
test('a positive rapid sample preserves a strong full assessment; demonstrated weakness can lower it',()=>{
 const state=createEmptyPaediatricsState(now);
 state.topics['1a'].oralAssessment=assessment(4);
 let merged=mergePatch(state,validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(4,true)}]}),now);
 assert.equal(scoreOralAssessment(merged.topics['1a'].oralAssessment).score,20);
 assert.equal(merged.topics['1a'].oralAssessment.scope,undefined);
 merged=mergePatch(state,validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(2,true)}]}),now);
 assert.equal(scoreOralAssessment(merged.topics['1a'].oralAssessment).score,10);
 assert.equal(merged.topics['1a'].oralAssessment.scope,'rapid');
 merged=mergePatch(merged,validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(4)}]}),now);
 assert.equal(scoreOralAssessment(merged.topics['1a'].oralAssessment).score,20);
});

test('sample patches reject normal-pass completion even if the chat outputs it accidentally',()=>{
 assert.throws(()=>validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(2,true),plan:{secondPassComplete:true}}]}),/cannot complete/);
 assert.throws(()=>validatePatch({schemaVersion:1,topics:[{id:'1a',oralAssessment:assessment(2,true),review:{pass:'second',outcome:'prompted'}}]}),/cannot complete/);
});
