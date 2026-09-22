import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress, nextTopicPass } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { passCount } from '../src/lib/paediatrics/studyPlanEngine.ts';
import { coverageFromReviews } from '../src/lib/paediatrics/reviewCoverage.ts';
import { structuredActivityByDay } from '../src/lib/paediatrics/paediatricsChart.ts';
const now='2026-09-18T15:15:20.000Z';
const assessment={ratings:{coverage:2,accuracy:1,independence:2,clinicalReasoning:1,propedeutics:1},safetyCriticalError:true,evidence:'Full-topic recall before teaching.'};
const fullReview={id:'original-3b',topicId:'3b',pass:'second',outcome:'failed',source:'assistant',reviewedAt:now,createdAt:now,oralAssessment:assessment};
const fresh=()=>createPlanProgress(createEmptyPaediatricsState(now),[],now);

test('3b full Pass 1 review without plan flags gets a check mark and one Pass 1 graph unit on the original date',()=>{
 const progress=fresh(), before=structuredClone(progress);
 progress.topics['3a'].firstPassCompletedAt=now;
 progress.topics['3c'].firstPassCompletedAt=now;
 const reviews=[fullReview];
 const snapshot=structuredClone({progress,reviews});
 const covered=coverageFromReviews(progress,reviews);
 assert.equal(passCount(covered,'first'),3);
 assert.equal(passCount(covered,'second'),1);
 assert.equal(nextTopicPass(covered.topics['3b']),'third');
 assert.equal(covered.topics['3b'].secondPassCompletedAt,now);
 assert.equal(covered.topics['3b'].firstPassCompletedAt,undefined);
 const day=structuredActivityByDay(progress,reviews)[0];
 assert.equal(day.date,'2026-09-18');assert.equal(day.firstPasses,2);assert.equal(day.secondPasses,1);
 assert.deepEqual(coverageFromReviews(covered,reviews),covered);
 assert.deepEqual({progress,reviews},snapshot);
 assert.deepEqual(progress.topics['3b'],before.topics['3b']);
});

test('review and stored completion are not double-counted, including repeated patches on later dates',()=>{
 const progress=fresh();progress.topics['3b'].secondPassCompletedAt=now;
 const reviews=[fullReview,{...fullReview,id:'duplicate'},{...fullReview,id:'later',reviewedAt:'2026-09-19T12:00:00.000Z'}];
 assert.equal(coverageFromReviews(progress,reviews),progress);
 const days=structuredActivityByDay(progress,reviews);
 assert.equal(days.length,1);assert.equal(days[0].secondPasses,1);
 const inferred=coverageFromReviews(fresh(),reviews);
 assert.equal(inferred.topics['3b'].secondPassCompletedAt,now);
});

test('partial, narrow, score-only and undated activity cannot create completion; full session can corroborate old review',()=>{
 const progress=fresh();
 const {oralAssessment,...withoutAssessment}=fullReview;
 for(const reviews of [[],[withoutAssessment],[{...fullReview,pass:'review'}],[{...fullReview,pass:'first'}],[{...fullReview,reviewedAt:'bad'}]]) assert.equal(coverageFromReviews(progress,reviews),progress);
 const linked={...withoutAssessment,sourceSessionId:'session'};
 const session={id:'session',date:now,createdAt:now,label:'3b Pass 1',questions:12,topicIds:['3b'],planPass:'second',mode:'oral',averageMastery:1,assessedTopics:1};
 assert.equal(nextTopicPass(coverageFromReviews(progress,[linked],[session]).topics['3b']),'third');
 assert.equal(coverageFromReviews(progress,[linked],[{...session,mode:'rapid-recall'}]),progress);
 assert.equal(coverageFromReviews(progress,[linked],[{...session,topicIds:['3c']}]),progress);
 assert.equal(coverageFromReviews(null,[fullReview]),null);
});

test('manual completion corrections override older evidence, while a genuinely later full review counts',()=>{
 const progress=fresh();
 progress.topics['3b'].completionHistory=[{pass:'second',complete:false,changedAt:'2026-09-18T16:00:00.000Z',source:'manual'}];
 assert.equal(coverageFromReviews(progress,[fullReview]),progress);
 const later={...fullReview,id:'later',reviewedAt:'2026-09-19T12:00:00.000Z'};
 assert.equal(coverageFromReviews(progress,[fullReview,later]).topics['3b'].secondPassCompletedAt,later.reviewedAt);
});
