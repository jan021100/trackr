// Copy into the app's tests/ directory. Uses the same TypeScript loader as the existing tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAEDIATRICS_BLOCKS, PAEDIATRICS_SYLLABUS, PAEDIATRICS_TOPIC_IDS } from '../src/lib/paediatrics/paediatricsSyllabus.ts';
import { createEmptyPaediatricsState, mergePatch, validatePatch, validateBackup } from '../src/lib/paediatrics/paediatricsSchema.ts';
import { createDefaultStudyPlan, createPlanProgress, migrateToExplicitCoverage, scheduleStudyPlan, normalizeStudyPlan, PLAN_PASSES, passCompletionKey, nextTopicPass } from '../src/lib/paediatrics/studyPlanSchema.ts';
import { passCount, phaseForProgress, pacing, forecast, buildSchedule, shortReviewsDue } from '../src/lib/paediatrics/studyPlanEngine.ts';
import { applyExplicitPlanPatch } from '../src/lib/paediatrics/studyPlanPatch.ts';
import { buildReviewQueue, makeStudyChatPrompt, buildGapRepairQueue, makeGapRepairPrompt, makeRapidGapRepairPrompt, latestReviews, reviewCounts } from '../src/lib/paediatrics/paediatricsReview.ts';
import { createRetentionCard, validateCardImport, cardsToTsv, cardsFromTsv } from '../src/lib/paediatrics/retentionSchema.ts';
import { ankiGapTags, makeAnkiGapCardPrompt, validateAnkiGapCardImport } from '../src/lib/paediatrics/ankiGapStudy.ts';
import { structuredActivityByDay } from '../src/lib/paediatrics/paediatricsChart.ts';
import { makePaediatricsImagingPrompt, PAEDIATRICS_EXAM_FORMAT } from '../src/lib/paediatrics/studyApproach.ts';
import { ANKI_TIME_SESSION_PREFIX } from '../src/lib/paediatrics/ankiStudyTime.ts';

const NOW = '2026-09-09T12:00:00.000Z';
const expectedIds = Array.from({ length: 40 }, (_, i) => ['a', 'b', 'c'].map(letter => `${i + 1}${letter}`)).flat();
const fresh = () => createEmptyPaediatricsState(NOW);
const progressFor = state => createPlanProgress(state, [], NOW);
const backupFor = state => ({ kind: 'trackr-paediatrics-backup', exportedAt: NOW, state, sessions: [], reviews: [], simulations: [] });

test('every lettered exam topic is separate and appears in ticket order', () => {
  assert.deepEqual(PAEDIATRICS_SYLLABUS.map(topic => topic.id), expectedIds);
  assert.equal(PAEDIATRICS_TOPIC_IDS.size, 120);
  assert.deepEqual(PAEDIATRICS_BLOCKS.map(block => [block.id, block.count]), [['A', 40], ['B', 40], ['C', 40]]);
  for (const topic of PAEDIATRICS_SYLLABUS) {
    assert.equal(topic.block, topic.id.at(-1).toUpperCase());
    assert.equal(topic.number, parseInt(topic.id));
    assert.ok(topic.title.trim());
    assert.equal(topic.titleIsPlaceholder, false);
  }
});

test('fresh Paediatrics has no inherited mastery, gaps, timer, deadline, or pass baseline', () => {
  const state = fresh();
  const progress = progressFor(state);
  const config = createDefaultStudyPlan(NOW);
  assert.deepEqual(Object.keys(state.topics), expectedIds);
  assert.equal(state.activeStudyTimer, undefined);
  assert.equal(state.examDate, '');
  assert.equal(config.examDate, '');
  assert.equal(progress.baselineFirstPassCount, 0);
  assert.equal(progress.coverageSemanticsVersion, 2);
  assert.equal(passCount(progress, 'first'), 0);
  assert.equal(passCount(progress, 'second'), 0);
  for (const topic of Object.values(state.topics)) {
    assert.deepEqual([topic.mastery, topic.confidence, topic.attempts, topic.correct], [0, 0, 0, 0]);
    assert.equal(topic.status, 'unassessed');
    assert.deepEqual(topic.gaps, []);
    assert.deepEqual(topic.ankiReviews, []);
  }
  assert.equal(phaseForProgress(config, progress, '2026-09-09').type, 'first-pass');
  assert.deepEqual(config.phases.filter(phase => phase.usesDailyPacing).map(phase => phase.target), [120, 120, 120]);
});

test('Paediatrics never applies the surgery historical coverage correction', () => {
  const progress = progressFor(fresh());
  delete progress.coverageSemanticsVersion;
  const migrated = migrateToExplicitCoverage(progress);
  assert.equal(passCount(migrated, 'first'), 0);
  assert.deepEqual(Object.keys(migrated.topics), expectedIds);
});

test('a study patch changes 1b without affecting 1a, 1c, or first-pass coverage', () => {
  const state = fresh();
  const patch = validatePatch({ schemaVersion: 1, topics: [{ id: '1b', mastery: 2, confidence: 1, attemptsDelta: 3, correctDelta: 2 }] });
  const next = mergePatch(state, patch, NOW);
  assert.equal(next.topics['1b'].attempts, 3);
  assert.deepEqual(next.topics['1a'], state.topics['1a']);
  assert.deepEqual(next.topics['1c'], state.topics['1c']);
  assert.equal(state.topics['1b'].mastery, 0);
  assert.equal(applyExplicitPlanPatch(progressFor(state), patch, NOW).changed, false);
});

test('first-pass flags count each letter once and remain separate from second pass', () => {
  let progress = progressFor(fresh());
  const patch = validatePatch({ schemaVersion: 1, topics: ['1a', '1b', '1c'].map(id => ({ id, plan: { firstPassComplete: true } })) });
  progress = applyExplicitPlanPatch(progress, patch, NOW, 'first-ticket').progress;
  assert.equal(passCount(progress, 'first'), 3);
  assert.equal(passCount(progress, 'second'), 0);
  assert.equal(applyExplicitPlanPatch(progress, patch, NOW, 'repeat').changed, false);
  assert.deepEqual(progress.topics['2a'], {});
});

test('patch and retention imports reject Surgery IDs and unsplit ticket IDs', () => {
  for (const id of ['TO1-01', 'TO4-45', '1', '41a', '0c']) {
    assert.throws(() => validatePatch({ schemaVersion: 1, topics: [{ id, mastery: 1 }] }), /topic id/i);
    assert.throws(() => validateCardImport({ kind: 'trackr-retention-cards', schemaVersion: 1, cards: [{ topicId: id, front: 'Prompt', back: 'Answer' }] }), /topicid/i);
  }
});

test('unassessed queue ties follow 1a, 1b, 1c, 2a rather than lexical 10a ordering', () => {
  const state = fresh();
  assert.deepEqual(buildReviewQueue(state, progressFor(state), [], '2026-09-09').map(entry => entry.topicId), expectedIds);
});

test('topic prompts progress through acquisition and two recall rounds before maintenance', () => {
  const state = fresh();
  const progress = progressFor(state);
  const prompt = () => makeStudyChatPrompt(buildReviewQueue(state, progress, [], '2026-09-09').find(entry => entry.topicId === '1a'), state, progress);
  const first = prompt();
  assert.match(first, /"firstPassComplete":true/);
  assert.match(first, /"planPass":"first"/);
  assert.doesNotMatch(first, /"secondPassComplete":true/);
  assert.match(first, /Each a\/b\/c is separate/);
  progress.topics['1a'].firstPassCompletedAt = NOW;
  const second = prompt();
  assert.match(second, /"secondPassComplete":true/);
  assert.match(second, /"planPass":"second"/);
  progress.topics['1a'].secondPassCompletedAt = NOW;
  const third = prompt();
  assert.match(third, /"thirdPassComplete":true/);
  assert.match(third, /"planPass":"third"/);
  progress.topics['1a'].thirdPassCompletedAt = NOW;
  const maintenance = prompt();
  assert.match(maintenance, /"planPass":"review"/);
  assert.doesNotMatch(maintenance, /"plan":\{/);
});

test('configured exam date produces finite targets without changing recorded coverage', () => {
  const progress = progressFor(fresh());
  progress.topics['1a'].firstPassCompletedAt = NOW;
  const before = structuredClone(progress);
  const config = scheduleStudyPlan({ ...createDefaultStudyPlan(NOW), examDate: '2026-09-30' });
  const phase = phaseForProgress(config, progress, '2026-09-09');
  const target = pacing(config, progress, phase, '2026-09-09');
  assert.equal(config.examDate, '2026-09-30');
  assert.ok(Number.isFinite(target.requiredPace));
  assert.ok(target.todayQuota > 0);
  assert.deepEqual(progress, before);
  for (const phase of config.phases) assert.ok(phase.endDate < config.examDate);
});

test('Anki identities and exports stay Paediatrics-specific across a TSV round trip', () => {
  const card = createRetentionCard({ topicId: '40c', gapId: 'cyanosis-gap', front: 'Clinical prompt', back: 'Expected answer' }, NOW);
  assert.ok(card.tags.includes('trackr::paediatrics-gap'));
  assert.ok(ankiGapTags('40c', 'cyanosis-gap').includes('trackr::paediatrics'));
  assert.doesNotMatch(card.tags.join(' '), /surgery/i);
  assert.equal(ANKI_TIME_SESSION_PREFIX, 'anki-connect-paediatrics-gaps-');
  const restored = cardsFromTsv(cardsToTsv([card]), '1a');
  assert.equal(restored[0].topicId, '40c');
  assert.equal(restored[0].gapId, 'cyanosis-gap');
  assert.equal(restored[0].id, card.id);
});

test('Paediatrics backup rejects a Surgery backup and foreign state', () => {
  assert.throws(() => validateBackup({ ...backupFor(fresh()), kind: 'trackr-surgery-backup' }), /Paediatrics backup/i);
  const state = fresh();
  state.topics['TO1-01'] = structuredClone(state.topics['1a']);
  assert.throws(() => validateBackup(backupFor(state)), /invalid topic/i);
});

test('full backup preserves retention history and Anki links', () => {
  const card = createRetentionCard({ topicId: '1b', front: 'Prompt', back: 'Answer', gapId: 'gap-1' }, NOW);
  card.anki = { noteId: 123, cardIds: [456], syncedAt: NOW };
  const imported = validateBackup({ ...backupFor(fresh()), retentionCards: [card] });
  assert.deepEqual(imported.retentionCards, [card]);
});

test('foreign topic IDs are rejected in backup sessions, plans, reviews and simulations before restore', () => {
  const state = fresh();
  const config = createDefaultStudyPlan(NOW);
  const progress = progressFor(state);
  const session = { id: 's1', date: NOW, createdAt: NOW, label: 'Session', questions: 1, averageMastery: 0, assessedTopics: 1, topicIds: ['TO1-01'] };
  const foreignProgress = structuredClone(progress);
  foreignProgress.topics['TO1-01'] = {};
  const invalidSections = [
    { sessions: [session] },
    { studyPlan: { config: { ...config, topicIds: ['TO1-01'] }, progress } },
    { studyPlan: { config, progress: foreignProgress } },
    { reviews: [{ id: 'r1', topicId: 'TO1-01', reviewedAt: NOW, createdAt: NOW, outcome: 'passed', pass: 'first', source: 'manual' }] },
    { simulations: [{ id: 'sim1', date: NOW, createdAt: NOW, outcome: 'passed', topicIds: ['TO1-01'] }] }
  ];
  for (const section of invalidSections) assert.throws(() => validateBackup({ ...backupFor(state), ...section }), /topic|Paediatrics/i);
});

test('Anki reconciliation excludes Surgery and unrelated Paediatrics cards from time totals', async () => {
  const { readAnkiStudyTime } = await import('../src/lib/paediatrics/ankiConnect.ts');
  const card = createRetentionCard({id:'overlapping-id',topicId:'1a',gapId:'gap-1',front:'Prompt',back:'Answer'},NOW);
  card.anki={noteId:901,cardIds:[999]};
  const makeNote=(noteId,cardId,subject,topicId,id='overlapping-id')=>({noteId,cards:[cardId],modelName:'Model',tags:[`trackr::${subject}-gap`],fields:{TrackrCardId:{value:id},TrackrTopicId:{value:topicId},TrackrGapId:{value:'gap-1'}}});
  const calls=[]; const original=globalThis.fetch;
  globalThis.fetch=async (_url,init)=>{
    const request=JSON.parse(init.body);calls.push(request);
    const result=request.action==='findNotes'?[901,902,903]:request.action==='notesInfo'?[makeNote(901,999,'surgery','TO1-01'),makeNote(902,456,'paediatrics','1a'),makeNote(903,789,'paediatrics','2b','unrelated')]:request.action==='getReviewsOfCards'?Object.fromEntries(request.params.cards.map(id=>[id,[{id:Date.parse(NOW),time:60000,type:1,ease:3}]])):null;
    return {ok:true,json:async()=>({result,error:null})};
  };
  try {
    const total=await readAnkiStudyTime({url:'http://anki.test',deckName:'Paediatrics',modelName:'Model'},[card]);
    assert.equal(total[0].durationSeconds,60);
    assert.equal(calls.find(call=>call.action==='findNotes').params.query,'tag:trackr::paediatrics-gap');
    assert.deepEqual(calls.find(call=>call.action==='getReviewsOfCards').params.cards,[456]);
  }finally{globalThis.fetch=original;}
});


test('shared learning policy preserves topic and targeted repair contracts without mutating progress', () => {
  const state = fresh();
  state.topics['1a'].gaps.push({ id: 'basics-gap', text: 'Basics: explain a physical finding', priority: 'important', createdAt: '2026-09-08T09:00:00.000Z' });
  const progress = progressFor(state);
  const before = JSON.stringify({ state, progress });
  const batch = buildGapRepairQueue(state, progress, [], '2026-09-09', NOW);
  const topic = makeStudyChatPrompt(buildReviewQueue(state, progress, [], '2026-09-09')[0], state, progress);
  const repair = makeGapRepairPrompt(batch, state, progress);
  const rapid = makeRapidGapRepairPrompt(batch, state, progress);
  for (const prompt of [topic, repair, rapid]) {
    assert.equal(prompt.split('PAEDIATRICS LEARNING AGREEMENT').length - 1, 1);
    assert.match(prompt, /second attempt/);
    assert.match(prompt, /Paeds_iBook/);
    assert.match(prompt, /Never invent citations/);
  }
  assert.match(topic, /PASS 0 WORKFLOW/);
  assert.doesNotMatch(topic, /RECALL WORKFLOW|TOPIC SESSION/);
  assert.match(topic, /"firstPassComplete":true/);
  assert.match(repair, /GAP-REPAIR SESSION/);
  assert.match(rapid, /RAPID SESSION/);
  for (const prompt of [repair, rapid]) {
    assert.doesNotMatch(prompt, /TOPIC SESSION|"plan":\{/);
    assert.match(prompt, /"planPass":"review"/);
  }
  assert.equal(makeGapRepairPrompt([], state, progress), '');
  assert.equal(makeRapidGapRepairPrompt([], state, progress), '');
  assert.equal(JSON.stringify({ state, progress }), before);
});

test('source-aware basics cards still end in a valid import skeleton with exact identities', () => {
  const selections = [{ topicId: '1a', topicTitle: PAEDIATRICS_SYLLABUS[0].title, gapId: 'basics-term', gapText: 'Basics: explain a clinical term', priority: 'important' }];
  const prompt = makeAnkiGapCardPrompt(selections);
  const skeleton = JSON.parse(prompt.slice(prompt.indexOf('{\n  "kind"')));
  skeleton.cards[0].front = 'Explain the term in this gap.';
  skeleton.cards[0].back = 'Source-grounded definition supplied by the study chat.';
  const validated = validateAnkiGapCardImport(skeleton, selections);
  assert.equal(validated.cards.length, 1);
  assert.equal(validated.cards[0].gapId, 'basics-term');
  assert.match(prompt, /CARD GENERATION/);
  assert.doesNotMatch(prompt, /TOPIC SESSION/);
});

test('imaging practice uses a separate real-image station without inflating theory coverage', () => {
  assert.equal(PAEDIATRICS_EXAM_FORMAT.triplets * PAEDIATRICS_EXAM_FORMAT.parts.length, PAEDIATRICS_TOPIC_IDS.size);
  assert.equal(PAEDIATRICS_EXAM_FORMAT.imagingPoolSize, 80);
  assert.deepEqual(PAEDIATRICS_EXAM_FORMAT.imagingAreas, ['head', 'chest', 'abdomen', 'skeleton']);
  const prompt = makePaediatricsImagingPrompt();
  assert.match(prompt, /If no image is available, ask me to provide/);
  assert.match(prompt, /without a theory-coverage patch/);
  assert.doesNotMatch(prompt, /"plan":\{|"firstPassComplete"|"secondPassComplete"/);
});


test('legacy plan configuration adds a third round once and retains all recorded evidence', () => {
  const state=fresh(),progress=progressFor(state),config=createDefaultStudyPlan(NOW);
  delete config.learningModelVersion;
  config.phases=config.phases.filter(p=>p.type!=='third-pass');
  config.phases[0].name='First-pass completion';
  progress.topics['1a']={firstPassCompletedAt:NOW,firstPassSource:'assistant:old',firstPassManual:false,secondPassCompletedAt:NOW,secondPassSource:'manual',secondPassManual:true,completionHistory:[{pass:'first',complete:true,changedAt:NOW,source:'assistant:old'}]};
  const original=structuredClone({config,progress});
  const migrated=normalizeStudyPlan(config);
  assert.deepEqual(migrated.previousRoundPhases,original.config.phases);
  assert.deepEqual(migrated.phases.map(p=>p.type),['first-pass','second-pass','third-pass','buffer']);
  assert.equal(migrated.learningModelVersion,2);
  assert.strictEqual(normalizeStudyPlan(migrated),migrated);
  assert.deepEqual(config,original.config);
  assert.deepEqual(progress,original.progress);
  assert.equal(passCount(progress,'first'),1);
  assert.equal(passCount(progress,'second'),1);
  assert.equal(passCount(progress,'third'),0);
});

test('all three rounds require separate explicit coverage and lead into ongoing review without a deadline', () => {
  const state=fresh(),config=createDefaultStudyPlan(NOW);let progress=progressFor(state);
  for (const pass of PLAN_PASSES) {
    assert.equal(phaseForProgress(config,progress,'2026-09-09').type,`${pass}-pass`);
    const patch=validatePatch({schemaVersion:1,topics:expectedIds.map(id=>({id,plan:{[`${pass}PassComplete`]:true}}))});
    const next=applyExplicitPlanPatch(progress,patch,NOW,'round');
    progress=next.progress;
    assert.equal(passCount(progress,pass),120);
    assert.equal(applyExplicitPlanPatch(progress,patch,'2026-09-10T12:00:00.000Z','repeat').changed,false);
    assert.equal(progress.topics['1a'][passCompletionKey(pass)],NOW);
  }
  assert.equal(nextTopicPass(progress.topics['1a']),'review');
  assert.equal(phaseForProgress(config,progress,'2026-09-09').type,'buffer');
  assert.equal(state.topics['1a'].mastery,0);
  const remove=validatePatch({schemaVersion:1,topics:[{id:'1a',plan:{thirdPassComplete:false}}]});
  progress=applyExplicitPlanPatch(progress,remove,NOW).progress;
  assert.equal(passCount(progress,'second'),120);
  assert.equal(passCount(progress,'third'),119);
  assert.equal(phaseForProgress(config,progress,'2026-09-09').type,'third-pass');
});

test('third-round scheduling, pacing and forecast count only that round', () => {
  const config=scheduleStudyPlan({...createDefaultStudyPlan(NOW),examDate:'2026-10-09'});
  const progress=progressFor(fresh());const phase=config.phases.find(p=>p.type==='third-pass');
  progress.topics['1a'].firstPassCompletedAt=phase.startDate+'T10:00:00.000Z';
  progress.topics['1a'].secondPassCompletedAt=phase.startDate+'T10:00:00.000Z';
  assert.equal(forecast(config,progress,phase,phase.startDate),null);
  progress.topics['1a'].thirdPassCompletedAt=phase.startDate+'T10:00:00.000Z';
  progress.topics['1b'].thirdPassCompletedAt=phase.endDate+'T10:00:00.000Z';
  const value=pacing(config,progress,phase,phase.endDate);
  assert.equal(value.pass,'third');assert.equal(value.actual,2);assert.equal(value.todayActual,1);
  assert.equal(forecast(config,progress,phase,phase.endDate).pace,1);
  assert.equal(buildSchedule(config,progress,phase).at(-1).cumulativeTarget,120);
  for(const days of [1,2,3,7,30]){
    const exam=new Date(NOW);exam.setUTCDate(exam.getUTCDate()+days);
    const short=scheduleStudyPlan({...createDefaultStudyPlan(NOW),examDate:exam.toISOString().slice(0,10)});
    for(const phase of short.phases){assert.ok(phase.startDate<=phase.endDate);assert.ok(phase.endDate<short.examDate);}
  }
});

test('guided learning is stored separately and cannot hide failed independent recall', () => {
  const state=fresh(),progress=progressFor(state);
  progress.topics['1a'].firstPassCompletedAt='2026-09-07T10:00:00.000Z';
  const learning={id:'learn',topicId:'1a',reviewedAt:NOW,createdAt:NOW,outcome:'studied',pass:'first',source:'assistant'};
  const failed={...learning,id:'fail',reviewedAt:'2026-09-08T10:00:00.000Z',outcome:'failed',pass:'second'};
  assert.equal(latestReviews([failed,learning])['1a'].id,'fail');
  assert.equal(reviewCounts([learning],'2026-09-09').studied,1);
  const queue=buildReviewQueue(state,progress,[learning],'2026-09-09');
  const entry=queue.find(e=>e.topicId==='1a');
  assert.equal(entry.lastRecallAt,undefined);assert.equal(entry.nextPass,'second');assert.equal(entry.kind,'retest');
  assert.ok(shortReviewsDue(progress,'2026-09-20').includes('1a'));
  progress.topics['1a'].shortReviewDates=['2026-09-20'];
  assert.ok(!shortReviewsDue(progress,'2026-09-20').includes('1a'));
  assert.doesNotThrow(()=>validatePatch({schemaVersion:1,topics:[{id:'1a',review:{outcome:'studied',pass:'first'}}]}));
  assert.throws(()=>validatePatch({schemaVersion:1,topics:[{id:'1a',review:{outcome:'studied',pass:'third'}}]}),/Pass 0/);
  assert.throws(()=>validatePatch({schemaVersion:1,topics:[{id:'1a',plan:{thirdPassCompletedAt:NOW}}]}),/requires/);
});

test('review notes accept detailed reports up to the topic-note limit', () => {
  assert.doesNotThrow(()=>validatePatch({schemaVersion:1,topics:[{id:'21b',review:{outcome:'studied',pass:'first',notes:'x'.repeat(5000)}}]}));
  assert.throws(()=>validatePatch({schemaVersion:1,topics:[{id:'21b',review:{outcome:'studied',pass:'first',notes:'x'.repeat(5001)}}]}),/at most 5000 characters/);
});

test('backup round trips guided outcomes, new recall coverage and legacy configuration', () => {
  const state=fresh(),progress=progressFor(state),config=createDefaultStudyPlan(NOW);
  delete config.learningModelVersion;config.phases=config.phases.filter(p=>p.type!=='third-pass');
  progress.topics['1a'].thirdPassCompletedAt=NOW;
  const backup={...backupFor(state),studyPlan:{config,progress},reviews:[{id:'learn',topicId:'1a',reviewedAt:NOW,createdAt:NOW,outcome:'studied',pass:'first',source:'assistant'}]};
  const restored=validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.studyPlan.progress,progress);
  assert.equal(restored.studyPlan.config.phases.length,4);
  assert.equal(restored.reviews[0].outcome,'studied');
  assert.throws(()=>validateBackup({...backup,simulations:[{id:'sim',topicIds:['1a','1b','1c'],date:NOW,outcome:'studied'}]}),/simulation/);
});

test('third-round chart activity is separate and deduplicates same-day gap repair', () => {
  const progress=progressFor(fresh());
  progress.topics['1a'].firstPassCompletedAt=NOW;
  progress.topics['1b'].secondPassCompletedAt=NOW;
  progress.topics['1c'].thirdPassCompletedAt=NOW;
  const result=structuredActivityByDay(progress,[{id:'r',topicId:'1c',reviewedAt:NOW,pass:'review',outcome:'passed',gapResults:[{gapId:'g',outcome:'resolved'}]}])[0];
  assert.deepEqual([result.firstPasses,result.secondPasses,result.thirdPasses,result.gapRepairTopics],[1,1,1,0]);
  assert.equal(result.gapsResolved,1);
});


test('overdue acquisition pacing reserves time for both later recall rounds', () => {
  const config=scheduleStudyPlan({...createDefaultStudyPlan(NOW),examDate:'2026-10-09'});
  const progress=progressFor(fresh());
  const phase=config.phases[0];
  const late=new Date(phase.endDate+'T12:00:00.000Z');late.setUTCDate(late.getUTCDate()+1);
  const value=pacing(config,progress,phase,late.toISOString().slice(0,10));
  assert.equal(value.status,'behind');
  assert.ok(value.schedule.at(-1).date<config.phases.find(p=>p.type==='buffer').startDate);
  assert.ok(value.todayQuota>0);
});
