import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPaediatricsState, validatePatch } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createPlanProgress, createDefaultStudyPlan, nextTopicPass, normalizeRecallSupersession, passCoverageAt } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { passCount, phaseForProgress } from '../src/lib/paediatrics/studyPlanEngine.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
import { buildReviewQueue, buildStudyQueue, makeStudyChatPrompt } from '../src/lib/paediatrics/paediatricsReview.ts';
import { structuredActivityByDay } from '../src/lib/paediatrics/paediatricsChart.ts';
const now = '2026-09-18T12:00:00.000Z';

test('existing Pass 1 completion covers Pass 0 in counters, queue and prompts without a fabricated session', () => {
  const state = createEmptyPaediatricsState(now), progress = createPlanProgress(state, [], now);
  for (const id of ['1a','1b','1c','2a','2b','2c','3a']) progress.topics[id].firstPassCompletedAt = now;
  progress.topics['3b'].secondPassCompletedAt = now;
  state.topics['3b'].gaps = [{id:'critical',text:'Existing critical gap',priority:'critical',createdAt:now}];
  const events = [{id:'failed',topicId:'3b',pass:'second',outcome:'failed',reviewedAt:now,createdAt:now,source:'assistant'}];
  const before = structuredClone({state,progress,events});
  assert.equal(passCount(progress,'first'),8);
  assert.equal(passCount(progress,'second'),1);
  assert.equal(nextTopicPass(progress.topics['3b']),'third');
  const queue = buildReviewQueue(state,progress,events,'2026-09-18');
  const entry = queue.find(e=>e.topicId==='3b');
  assert.equal(entry.nextPass,'third');
  assert.equal(entry.kind,'critical');
  assert.equal(buildStudyQueue(queue,'first')[0].topicId,'3c');
  assert.ok(!buildStudyQueue(queue,'first',true).some(e=>e.topicId==='3b'));
  const prompt = makeStudyChatPrompt(entry,state,progress);
  assert.match(prompt,/Pass 2/);
  assert.doesNotMatch(prompt,/PASS 0 WORKFLOW/);
  assert.equal(structuredActivityByDay(progress,events)[0].firstPasses,7);
  assert.equal(structuredActivityByDay(progress,events)[0].secondPasses,1);
  assert.deepEqual({state,progress,events},before);
});

test('new second-only patches immediately establish acquisition coverage; removing recall reverses inferred coverage', () => {
  const state=createEmptyPaediatricsState(now), progress=createPlanProgress(state,[],now);
  const patch=validatePatch({schemaVersion:1,topics:[{id:'3b',plan:{secondPassComplete:true}}]});
  const next=applyExplicitPlanPatch(progress,patch,now).progress;
  assert.equal(next.topics['3b'].firstPassCompletedAt,undefined);
  assert.equal(passCount(next,'first'),1);
  assert.equal(passCount(next,'second'),1);
  assert.equal(nextTopicPass(next.topics['3b']),'third');
  const reset=applyExplicitPlanPatch(next,validatePatch({schemaVersion:1,topics:[{id:'3b',plan:{secondPassComplete:false}}]}),now).progress;
  assert.equal(nextTopicPass(reset.topics['3b']),'first');
  assert.equal(passCount(reset,'first'),0);
});

test('coverage uses real completion dates, counts a topic once, and advances the global phase', () => {
  const state=createEmptyPaediatricsState(now), progress=createPlanProgress(state,[],now);
  for(const topic of Object.values(progress.topics)) topic.secondPassCompletedAt=now;
  assert.equal(passCount(progress,'first','2026-09-17'),0);
  assert.equal(passCount(progress,'first','2026-09-18'),120);
  assert.equal(phaseForProgress(createDefaultStudyPlan(now),progress,'2026-09-18').type,'third-pass');
  progress.topics['1a'].firstPassCompletedAt='2026-09-10T12:00:00.000Z';
  assert.equal(passCount(progress,'first'),120);
  assert.equal(passCount(progress,'first','2026-09-17'),1);
  assert.equal(passCoverageAt(progress.topics['1a'],'first'),'2026-09-10T12:00:00.000Z');
  assert.equal(passCoverageAt({thirdPassCompletedAt:now},'first'),now);
  assert.equal(passCoverageAt({},'first'),undefined);
});

test('old direct Pass 1 data loses only its synthetic Pass 0 record', () => {
  const progress=createPlanProgress(createEmptyPaediatricsState(now),[],now);
  Object.assign(progress.topics['3b'], {
    firstPassCompletedAt: now, secondPassCompletedAt: now,
    firstPassSource: 'assistant:one-session', secondPassSource: 'assistant:one-session',
    completionHistory: [
      { pass:'first', complete:true, changedAt:now, source:'assistant:one-session' },
      { pass:'second', complete:true, changedAt:now, source:'assistant:one-session' }
    ], redZonePinned:true
  });
  const normalized=normalizeRecallSupersession(progress);
  assert.equal(normalized.changed,true);
  assert.equal(normalized.progress.topics['3b'].firstPassCompletedAt,undefined);
  assert.equal(normalized.progress.topics['3b'].firstPassSource,undefined);
  assert.equal(normalized.progress.topics['3b'].secondPassCompletedAt,now);
  assert.equal(normalized.progress.topics['3b'].redZonePinned,true);
  assert.deepEqual(normalized.progress.topics['3b'].completionHistory.map(item=>item.pass),['second']);
  assert.equal(passCount(normalized.progress,'first'),1,'Pass 0 requirement is covered by recall');
  assert.equal(structuredActivityByDay(normalized.progress,[])[0].firstPasses,0,'no Pass 0 activity is invented');
  assert.equal(structuredActivityByDay(normalized.progress,[])[0].secondPasses,1);
  assert.equal(normalizeRecallSupersession(normalized.progress).changed,false);
});

test('real Pass 0 and Pass 1 records remain separate even when both exist', () => {
  const progress=createPlanProgress(createEmptyPaediatricsState(now),[],now);
  Object.assign(progress.topics['3b'], {
    firstPassCompletedAt:'2026-09-17T12:00:00.000Z', secondPassCompletedAt:now,
    firstPassSource:'assistant:first-session', secondPassSource:'assistant:second-session'
  });
  assert.equal(normalizeRecallSupersession(progress).progress,progress);
  const days=structuredActivityByDay(progress,[]);
  assert.equal(days[0].firstPasses,1);
  assert.equal(days[1].secondPasses,1);
});
