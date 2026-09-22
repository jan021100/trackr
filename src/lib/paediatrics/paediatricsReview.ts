import { oralPriority, oralSummary, type OralAssessment } from './oralAssessment';
import { withPaediatricsStudyApproach } from './studyApproach';
import type { PaediatricsState } from './paediatricsSchema';
import { nextTopicPass, passCoverageAt, passCompletionKey, PASS_DETAILS, type PlanPass as TopicPass } from './studyPlanSchema';
import type { EvidenceMode, PlanPass, StudyPlanProgress } from './studyPlanSchema';
import { PAEDIATRICS_SYLLABUS } from './paediatricsSyllabus';

export type RecallOutcome = 'failed' | 'prompted' | 'passed' | 'fluent';
export type ReviewOutcome = RecallOutcome | 'studied';
export type GapPriority = 'critical' | 'important' | 'normal';
export type GapReviewOutcome = 'resolved' | 'unchanged';
export type GapReviewResult = { gapId: string; outcome: GapReviewOutcome; note?: string };

export type PaediatricsReviewEvent = {
  id: string;
  topicId: string;
  reviewedAt: string;
  outcome: ReviewOutcome;
  pass: PlanPass | 'review';
  mode?: EvidenceMode;
  source: 'assistant' | 'manual';
  sourceSessionId?: string;
  notes?: string;
  gapResults?: GapReviewResult[];
  oralAssessment?: OralAssessment;
  createdAt: string;
};

export type PaediatricsSimulation = {
  id: string;
  date: string;
  outcome: RecallOutcome;
  topicIds: string[];
  durationMinutes?: number;
  criticalErrors?: string;
  notes?: string;
  createdAt: string;
};

export type ReviewQueueEntry = {
  topicId: string;
  title: string;
  kind: 'critical' | 'retest' | 'screen' | 'maintenance';
  score: number;
  reasons: string[];
  latest?: PaediatricsReviewEvent;
  dueDate?: string;
  lastRecallAt?: string;
  recallAgeDays?: number;
  secondPassComplete: boolean;
  thirdPassComplete: boolean;
  nextPass: TopicPass | 'review';
  mastery: number;
  oralPriority?: number;
};

export type GapRepairQueueEntry = {
  topicId: string;
  title: string;
  block: string;
  mastery: number;
  oralPriority?: number;
  confidence: number;
  score: number;
  openGaps: Array<{ id: string; text: string; priority: GapPriority }>;
  criticalGapCount: number;
  importantGapCount: number;
  lastRecallAt?: string;
  recallAgeDays?: number;
  latest?: PaediatricsReviewEvent;
};

export type GapRepairCooldownSummary = {
  readyCount: number;
  coolingDownCount: number;
  nextEligibleAt?: string;
};

export const GAP_REPAIR_COOLDOWN_MINUTES = 120;

const atNoon = (date: string) => new Date(`${date}T12:00:00`);
const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const addDays = (date:string,days:number) => { const value=atNoon(date); value.setDate(value.getDate()+days); return localDate(value); };
const daysBetween = (from:string,to:string) => Math.max(0,Math.floor((atNoon(to).getTime()-atNoon(from).getTime())/86400000));
const gapKey = (topicId:string,gapId:string) => `${topicId}:${gapId}`;
const validTime = (value:string|undefined) => {
  const time=value?new Date(value).getTime():Number.NaN;
  return Number.isFinite(time)?time:undefined;
};
const latestGapAttempts = (events:PaediatricsReviewEvent[]) => {
  const result=new Map<string,number>();
  for(const event of events){
    const reviewedAt=validTime(event.reviewedAt);
    if(reviewedAt===undefined) continue;
    for(const gapResult of event.gapResults??[]){
      const key=gapKey(event.topicId,gapResult.gapId);
      if(reviewedAt>(result.get(key)??-Infinity)) result.set(key,reviewedAt);
    }
  }
  return result;
};
const gapEligibleAt = (topicId:string,gap:{id:string;createdAt:string},attempts:Map<string,number>) => {
  const createdAt=validTime(gap.createdAt);
  const lastAttemptAt=attempts.get(gapKey(topicId,gap.id));
  const anchor=Math.max(createdAt??-Infinity,lastAttemptAt??-Infinity);
  return Number.isFinite(anchor)?anchor+GAP_REPAIR_COOLDOWN_MINUTES*60000:undefined;
};
export const latestReviews = (events:PaediatricsReviewEvent[]) => {
  const result:Record<string,PaediatricsReviewEvent>={};
  for(const event of [...events].filter(event=>event.outcome!=='studied' && event.pass!=='first').sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt))) result[event.topicId]=event;
  return result;
};

const queuePriorityKey = (entry:ReviewQueueEntry) => [
  Number(entry.kind==='critical'),
  entry.oralPriority??entry.mastery*5,
  Number(entry.thirdPassComplete),
  entry.score
].join('|');
const seededTopicRank = (topicId:string,seed:string) => {
  let hash=2166136261;
  for(const character of `${seed}:${topicId}`){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
};
function randomizeEqualPriority(entries:ReviewQueueEntry[],seed?:string):ReviewQueueEntry[] {
  if(!seed)return [...entries];
  const result:ReviewQueueEntry[]=[];
  for(let start=0;start<entries.length;){
    const key=queuePriorityKey(entries[start]);let end=start+1;
    while(end<entries.length&&queuePriorityKey(entries[end])===key)end+=1;
    result.push(...entries.slice(start,end).sort((a,b)=>seededTopicRank(a.topicId,seed)-seededTopicRank(b.topicId,seed)||a.topicId.localeCompare(b.topicId,'en',{numeric:true})));
    start=end;
  }
  return result;
}

/** Keep whole-topic learning in the current round; later urgent reviews remain available. */
export function buildStudyQueue(queue:ReviewQueueEntry[],pass:TopicPass|'review',ignoreRetests=false,randomSeed?:string):ReviewQueueEntry[] {
  if(pass==='review') return ignoreRetests?[]:randomizeEqualPriority(queue,randomSeed);
  const current=queue.filter(entry=>entry.nextPass===pass);
  const later=ignoreRetests?[]:queue.filter(entry=>entry.nextPass!==pass && (entry.kind==='critical'||entry.kind==='retest'));
  return [...randomizeEqualPriority(current,randomSeed),...randomizeEqualPriority(later,randomSeed?`${randomSeed}:later`:undefined)];
}

export function buildReviewQueue(state:PaediatricsState,progress:StudyPlanProgress|null,events:PaediatricsReviewEvent[],today=localDate()):ReviewQueueEntry[] {
  const latest=latestReviews(events);
  return PAEDIATRICS_SYLLABUS.map((definition) => {
    const topic=state.topics[definition.id]; const review=latest[definition.id]; const plan=progress?.topics[definition.id];
    const open=topic.gaps.filter((gap)=>!gap.resolvedAt); const critical=open.filter((gap)=>gap.priority==='critical').length;
    const important=open.filter((gap)=>gap.priority==='important').length; const secondPassComplete=!!plan?.secondPassCompletedAt; const thirdPassComplete=!!plan?.thirdPassCompletedAt; const nextPass=nextTopicPass(plan);
    const dueDate=review?.outcome==='failed'?addDays(review.reviewedAt.slice(0,10),1):review?.outcome==='prompted'?addDays(review.reviewedAt.slice(0,10),2):nextPass==='second'&&plan?.firstPassCompletedAt?addDays(plan.firstPassCompletedAt.slice(0,10),2):nextPass==='third'&&plan?.secondPassCompletedAt?addDays(plan.secondPassCompletedAt.slice(0,10),2):undefined;
    const lastRecallAt=review?.reviewedAt??plan?.thirdPassCompletedAt??plan?.secondPassCompletedAt;
    const recallAgeDays=lastRecallAt?daysBetween(lastRecallAt.slice(0,10),today):undefined;
    const due=!!dueDate&&dueDate<=today; const reasons:string[]=[]; let score=0; let kind:ReviewQueueEntry['kind']='maintenance';
    if(plan?.redZonePinned){score+=120;reasons.push('Red zone');}
    if(critical){score+=critical*55;reasons.push(`${critical} critical ${critical===1?'gap':'gaps'}`);}
    if(review?.outcome==='failed'){score+=due?110:80;reasons.push(due?'Failed retest due':'Last review failed');}
    if(review?.outcome==='prompted'){score+=due?75:45;reasons.push(due?'Prompted retest due':'Last review prompted');}
    if(nextPass!=='review'){score+=60;reasons.push(`${PASS_DETAILS[nextPass].label} not completed`);}
    if(due&&review?.outcome!=='failed'&&review?.outcome!=='prompted'){score+=75;reasons.push('Next recall round due');}
    if(recallAgeDays!==undefined){
      const ageBonus=Math.min(50,Math.max(0,recallAgeDays-2)*4);
      score+=ageBonus;
      if(recallAgeDays>=3) reasons.push(`Last recall ${recallAgeDays} days ago`);
    } else {
      score+=50; reasons.push('No dated recall');
    }
    if(topic.mastery<=1){score+=35;reasons.push(`Mastery ${topic.mastery}`);} else if(topic.mastery===2){score+=18;reasons.push('Developing mastery');}
    if(topic.confidence<=1){score+=25;reasons.push(`Confidence ${topic.confidence}`);} else if(topic.confidence===2){score+=10;reasons.push('Low confidence');}
    if(important){score+=important*12;reasons.push(`${important} important ${important===1?'gap':'gaps'}`);}
    if(open.length&&!critical&&!important){score+=Math.min(20,open.length*3);reasons.push(`${open.length} open ${open.length===1?'gap':'gaps'}`);}
    if(topic.oralAssessment){reasons.push(oralSummary(topic).label);score+=20-oralPriority(topic);}
    if(plan?.redZonePinned||critical||review?.outcome==='failed'||(topic.oralAssessment&&oralPriority(topic)<8))kind='critical';
    else if(due)kind='retest'; else if(!thirdPassComplete)kind='screen';
    return {topicId:definition.id,title:definition.title,kind,score,reasons,latest:review,dueDate,lastRecallAt,recallAgeDays,secondPassComplete,thirdPassComplete,nextPass,mastery:topic.mastery,oralPriority:oralPriority(topic)};
  }).sort((a,b)=>{
    // A genuinely critical/failed safety signal can interrupt the normal
    // order. Otherwise estimated knowledge is primary: lower mastery first,
    // then unfinished Second Pass before a later retest at the same mastery.
    // Confidence, gaps, recall age and retest due-ness remain in the score and
    // decide the order only inside that knowledge/coverage group.
    const criticalDifference=Number(b.kind==='critical')-Number(a.kind==='critical');
    if(criticalDifference) return criticalDifference;
    return (a.oralPriority??a.mastery*5)-(b.oralPriority??b.mastery*5)
      || Number(a.thirdPassComplete)-Number(b.thirdPassComplete)
      || b.score-a.score
      || a.topicId.localeCompare(b.topicId, 'en', { numeric: true });
  });
}

export function filterReviewQueueForSecondPass(queue:ReviewQueueEntry[],ignoreRetests:boolean):ReviewQueueEntry[] {
  return ignoreRetests?queue.filter((entry)=>!entry.thirdPassComplete):queue;
}

export function reviewCounts(events:PaediatricsReviewEvent[],date:string) {
  const today=events.filter((event)=>event.reviewedAt.slice(0,10)===date);
  return {total:today.length,studied:today.filter(e=>e.outcome==='studied').length,failed:today.filter(e=>e.outcome==='failed').length,prompted:today.filter(e=>e.outcome==='prompted').length,passed:today.filter(e=>e.outcome==='passed').length,fluent:today.filter(e=>e.outcome==='fluent').length};
}

/**
 * Gap repair deliberately ignores pass coverage as a ranking signal. Its job is
 * to find the weakest knowledge that is still open now: safety-critical gaps,
 * low mastery/confidence, failed retrieval and older recall all increase urgency.
 */
export function gapRepairCooldownSummary(state:PaediatricsState,events:PaediatricsReviewEvent[],now=new Date().toISOString()):GapRepairCooldownSummary {
  const nowTime=validTime(now)??Date.now();
  const attempts=latestGapAttempts(events);
  let readyCount=0;
  let coolingDownCount=0;
  let nextEligibleTime=Infinity;
  for(const definition of PAEDIATRICS_SYLLABUS){
    for(const gap of state.topics[definition.id].gaps){
      if(gap.resolvedAt) continue;
      const eligibleAt=gapEligibleAt(definition.id,gap,attempts);
      if(eligibleAt!==undefined&&eligibleAt>nowTime){
        coolingDownCount+=1;
        nextEligibleTime=Math.min(nextEligibleTime,eligibleAt);
      } else readyCount+=1;
    }
  }
  return {readyCount,coolingDownCount,...(Number.isFinite(nextEligibleTime)?{nextEligibleAt:new Date(nextEligibleTime).toISOString()}:{})};
}

export function buildGapRepairQueue(state:PaediatricsState,progress:StudyPlanProgress|null,events:PaediatricsReviewEvent[],today=localDate(),now=new Date().toISOString()):GapRepairQueueEntry[] {
  const latest=latestReviews(events);
  const attempts=latestGapAttempts(events);
  const nowTime=validTime(now)??Date.now();
  return PAEDIATRICS_SYLLABUS.flatMap((definition) => {
    const topic=state.topics[definition.id];
    const openGaps=topic.gaps
      .filter((gap)=>!gap.resolvedAt)
      .filter((gap)=>{
        const eligibleAt=gapEligibleAt(definition.id,gap,attempts);
        return eligibleAt===undefined||eligibleAt<=nowTime;
      })
      .map((gap)=>({id:gap.id,text:gap.text,priority:gap.priority??'normal' as GapPriority}));
    if(!openGaps.length) return [];
    const review=latest[definition.id];
    const priorRecallAt=progress?.topics[definition.id]?.thirdPassCompletedAt??progress?.topics[definition.id]?.secondPassCompletedAt;
    const lastRecallAt=review?.reviewedAt??priorRecallAt??undefined;
    const recallAgeDays=lastRecallAt?daysBetween(lastRecallAt.slice(0,10),today):undefined;
    const criticalGapCount=openGaps.filter((gap)=>gap.priority==='critical').length;
    const importantGapCount=openGaps.filter((gap)=>gap.priority==='important').length;
    let score=criticalGapCount*180+importantGapCount*55+openGaps.length*10+(4-topic.mastery)*35+(4-topic.confidence)*22;
    if(progress?.topics[definition.id]?.redZonePinned) score+=130;
    if(review?.outcome==='failed') score+=100;
    else if(review?.outcome==='prompted') score+=55;
    score+=recallAgeDays===undefined?55:Math.min(80,recallAgeDays*5);
    return [{topicId:definition.id,title:definition.title,block:definition.block,mastery:topic.mastery,oralPriority:oralPriority(topic),confidence:topic.confidence,score,openGaps,criticalGapCount,importantGapCount,lastRecallAt,recallAgeDays,latest:review}];
  }).sort((a,b)=>
    b.criticalGapCount-a.criticalGapCount
    || (a.oralPriority??a.mastery*5)-(b.oralPriority??b.mastery*5)
    || a.confidence-b.confidence
    || b.score-a.score
    || (b.recallAgeDays??-1)-(a.recallAgeDays??-1)
    || a.topicId.localeCompare(b.topicId, 'en', { numeric: true })
  );
}

export function buildGapRepairBatch(queue:GapRepairQueueEntry[],size=3):GapRepairQueueEntry[] {
  const safeSize=Math.max(1,Math.min(5,Math.round(size)));
  return queue.slice(0,safeSize);
}

/**
 * Rapid repair is budgeted by gaps, not by whole topics. Limiting each topic to
 * a small number of its highest-priority gaps prevents a nominally small batch
 * from silently becoming several exhaustive topic reviews.
 */
export function buildRapidGapRepairBatch(queue:GapRepairQueueEntry[],gapTarget=8,maxGapsPerTopic=2):GapRepairQueueEntry[] {
  const safeTarget=Math.max(1,Math.min(16,Math.round(gapTarget)));
  const safePerTopic=Math.max(1,Math.min(3,Math.round(maxGapsPerTopic)));
  const priorityRank:Record<GapPriority,number>={critical:0,important:1,normal:2};
  const result:GapRepairQueueEntry[]=[];
  let selected=0;
  for(const entry of queue){
    if(selected>=safeTarget) break;
    const openGaps=[...entry.openGaps]
      .sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority]||a.id.localeCompare(b.id))
      .slice(0,Math.min(safePerTopic,safeTarget-selected));
    if(!openGaps.length) continue;
    result.push({
      ...entry,
      openGaps,
      criticalGapCount:openGaps.filter((gap)=>gap.priority==='critical').length,
      importantGapCount:openGaps.filter((gap)=>gap.priority==='important').length
    });
    selected+=openGaps.length;
  }
  return result;
}

function makeGapRepairTask(batch:GapRepairQueueEntry[],state:PaediatricsState,progress:StudyPlanProgress|null):string {
  if(!batch.length) return '';
  const topicContext=batch.map((entry,index)=>{
    const secondPassComplete=!!progress?.topics[entry.topicId]?.secondPassCompletedAt;
    return `${index+1}. ${entry.topicId} — ${entry.title}\nCurrent oral mastery: ${oralSummary(state.topics[entry.topicId]).label} · Confidence: ${entry.confidence}/4\nPass 1 complete: ${secondPassComplete?'yes':'no'}\nLast structured recall: ${entry.lastRecallAt??'none recorded'}\nOpen gaps:\n${entry.openGaps.map((gap)=>`- [${gap.priority}] ${gap.id}: ${gap.text}`).join('\n')}`;
  }).join('\n\n');
  const ids=batch.map((entry)=>entry.topicId).join(', ');
  const first=batch[0];
  return `PAEDIATRICS TRACKR — GAP REPAIR BATCH\n\nBatch topics: ${ids}\nThese topics were selected adaptively from currently open gaps. Work in the listed order unless a safety-critical connection makes a different order clearly better.\n\nPRIVATE EXAMINER CONTEXT — NEVER REVEAL THIS LIST BEFORE RETRIEVAL\n${topicContext}\n\nPURPOSE\nThis is focused final-exam gap repair, not another exhaustive whole-topic recall pass. Test every recorded open gap by uncued retrieval, then sample only 1–2 adjacent high-yield or safety-critical points per topic to detect deterioration or missing logging. Keep the batch compact.\n\nQUESTION-DESIGN SAFEGUARD — CRITICAL\nThe recorded gap tells you what to assess; it must NOT leak into the wording of the question. Ask a focused, fair oral-exam follow-up that requires me to generate the missing fact myself. Do not supply, paraphrase or cue the target answer. Naming a clinical term is allowed when its meaning is the retrieval target; do not reveal that meaning or the requested examples. You may identify the clinical context or a category when asking me to generate its examples; never disclose those examples, initials, partial answers, or a checklist that supplies the answer. Avoid leading formulations such as “What sign indicates…?”, “Which antibiotic…?”, or “Would you do X?”. Prefer neutral prompts such as “What else is important here?”, “Talk me through the relevant findings,” or “How would you proceed?” in the topic context. If the first open prompt is genuinely too broad to assess the gap, narrow it only one neutral step after my attempt—still without embedding the answer. Recognition prompted by the question does not count as independent recall.\n\nMANDATORY WORKFLOW\n1. Start with topic 1 and ask a concise cold retrieval question that targets its first recorded gap without naming or teaching the answer. Do not show the gap list, a framework, hints, options, or a model answer.\n2. Bundle closely related gaps for the same topic into one examiner-style message when practical, but never make the bundle a checklist that reveals the answers. Do not use one message per tiny fact.\n3. Before teaching, use uncued follow-ups to distinguish an omitted point from genuinely missing knowledge. Do not ask again about something I explicitly said I do not know.\n4. After all recorded gaps for that topic have had a fair independent retrieval attempt, ask 1–2 brief adjacent safety checks. These must obey the same non-leading question rule. Do not turn this into a full-topic review unless those checks expose broad instability.\n5. Then teach only genuine errors, concisely. Immediate reproduction after teaching is not durable recall and must never resolve a gap.\n6. Move through all topics in the batch. Keep a private ledger for every supplied gap ID: RESOLVED only if independently retrieved before teaching; otherwise UNCHANGED. Add a new gap if an adjacent probe exposes a genuine new weakness.\n7. At the end, give one compact batch summary and immediately append one final multi-topic Trackr JSON patch. Do not wait for me to request PATCH.\n\nLOGGING RULES\n- Every tested topic gets one review object with pass:"review". This is a later targeted review, not a new First- or Second-Pass completion. Never include a plan object in Gap Repair mode.\n- Put every tested existing gap in review.gapResults with its exact supplied gapId and outcome "resolved" or "unchanged". An optional short note may explain the evidence.\n- A gap marked "resolved" in gapResults must also appear in resolveGapIds. An "unchanged" gap must NOT appear in resolveGapIds.\n- Newly discovered weaknesses go in addGaps with a concise, specific statement and priority critical, important, or normal.\n- attemptsDelta and correctDelta count only retrieval units actually attempted in this batch. session.questions is their total across all topics—not the number of topics.\n- Do not repeat deltas or changes already emitted in an earlier patch.\n- session.mode must be "rapid-recall" and session.planPass must be "review".\n\nMASTERY AND CONFIDENCE\n- Default: leave mastery and confidence unchanged in a narrow gap-repair review. Do not raise a topic merely because one recorded gap was repaired.\n- If retrieval reveals serious deterioration, record the specific gaps and failed/prompted outcome so the queue prioritises it; preserve the prior full-topic oralAssessment until a new broad assessment.\n- Do not raise mastery/confidence or replace oralAssessment from this narrow gap sample. A later full-topic oral review is required for a new global assessment.\n- Never raise mastery/confidence from prompted answers or immediate post-teaching reproduction. Fluent remains rare.\n\nREVIEW OUTCOME\n- failed: fail-critical knowledge was absent or the topic was broadly unsafe.\n- prompted: material help/teaching was needed, even if immediate reproduction then succeeded.\n- passed: all tested gaps and safety checks were independently answered at pass level.\n- fluent: unusually fast, structured and robust independent recall; use rarely.\n\nFINAL RESPONSE AND PATCH\nFirst provide a compact human-readable result per topic: independently known, resolved gap IDs, unchanged gap IDs, new gaps, and whether delayed retest is needed. Then output exactly one raw JSON object with no Markdown fence or trailing text. Omit unchanged optional fields. Never use null or undefined. The JSON must end with exactly }}.\n\nExample structure (replace with the real results and include every tested topic):\n{"schemaVersion":1,"topics":[{"id":"${first.topicId}","attemptsDelta":2,"correctDelta":1,"resolveGapIds":["${first.openGaps[0].id}"],"addGaps":[{"text":"specific newly discovered weakness","priority":"important"}],"review":{"outcome":"prompted","pass":"review","notes":"Independent versus prompted performance summary.","gapResults":[{"gapId":"${first.openGaps[0].id}","outcome":"resolved","note":"Retrieved independently before teaching."}]} }],"session":{"label":"Gap repair batch: ${ids}","questions":2,"mode":"rapid-recall","planPass":"review"}}\n\nImportant: the example is structural only. Include no invented resolution, new gap, mastery change, or score in the real patch. Begin now with the first non-leading, uncued gap retrieval for ${first.topicId}.`;
}

function makeRapidGapRepairTask(batch:GapRepairQueueEntry[],state:PaediatricsState,progress:StudyPlanProgress|null):string {
  if(!batch.length) return '';
  const selectedGapCount=batch.reduce((sum,entry)=>sum+entry.openGaps.length,0);
  const topicContext=batch.map((entry,index)=>{
    const totalOpenGaps=state.topics[entry.topicId].gaps.filter((gap)=>!gap.resolvedAt).length;
    const secondPassComplete=!!progress?.topics[entry.topicId]?.secondPassCompletedAt;
    return `${index+1}. ${entry.topicId} — ${entry.title}\nCurrent oral mastery: ${oralSummary(state.topics[entry.topicId]).label} · Confidence: ${entry.confidence}/4\nPass 1 complete: ${secondPassComplete?'yes':'no'}\nLast structured recall: ${entry.lastRecallAt??'none recorded'}\nSelected for this rapid batch: ${entry.openGaps.length} of ${totalOpenGaps} open gaps\nSelected gaps:\n${entry.openGaps.map((gap)=>`- [${gap.priority}] ${gap.id}: ${gap.text}`).join('\n')}`;
  }).join('\n\n');
  const ids=batch.map((entry)=>entry.topicId).join(', ');
  const first=batch[0];
  return `PAEDIATRICS TRACKR — RAPID GAP REPAIR\n\nBatch: ${selectedGapCount} selected gaps across ${batch.length} topics (${ids}).\nWork in the listed order. Test ONLY the selected gaps below; unselected open gaps remain untouched for later batches.\n\nPRIVATE EXAMINER CONTEXT — NEVER SHOW OR PARAPHRASE THE GAP LIST BEFORE RETRIEVAL\n${topicContext}\n\nPURPOSE\nResolve as many genuine gaps as possible per unit of time while preserving valid uncued retrieval. This is not a whole-topic screen, recall pass, or broad oral simulation. Do not ask me to present the complete topic or its full skeleton.\n\nTARGETED BUT NON-LEADING QUESTION DESIGN — CRITICAL\n- Ask the smallest fair examiner question that directly tests the stored gap. The question may identify the official topic, clinical situation, or relevant subdomain needed to locate the problem, but it must not contain or imply the target answer.\n- Do NOT repeat or visibly label the stored gap, or supply any part of the answer. You may name a term when its meaning is being tested, or a category when asking for examples; keep the meaning/examples hidden. Do not disclose the answer's first letter, number of items, direction of change, threshold, named sign, mechanism, classification item, investigation, treatment, or partial wording. No multiple choice, yes/no framing, cloze cues, or “Would you do X?” questions.\n- Avoid both extremes: never ask “Tell me everything about this topic” or similarly broad prompts, and never make the wording so specific that recognition replaces recall. Aim for the scope of a real examiner follow-up: focused enough for a 20–60 second answer, open enough that I must generate the fact myself.\n- One gap may receive 1–3 short questions when it contains genuinely separate recall components (for example principle, application, and safety consequence). Do not ask redundant variants merely to increase question count.\n- Questions for selected gaps within one topic should normally be bundled into one numbered message. A question must never serve as a clue to another question in that bundle.\n\nRAPID WORKFLOW\n1. Start with the selected gap(s) for ${first.topicId}. Ask the focused, uncued question bundle immediately. Do not begin with a 60–120 second whole-topic cold screen, outline, hints, or teaching.\n2. Give each gap a fair independent retrieval attempt. If my response may reflect a simple omission, use at most ONE concise non-leading precision probe before judging it. If I explicitly say I do not know, do not coax me with progressively revealing hints.\n3. Do not perform routine peripheral screening. Ask at most ONE adjacent safety check for a topic, and only when my answer exposes a plausible fail-critical neighbouring weakness. Otherwise move on.\n4. Grade the selected gap before teaching. RESOLVED requires all essential parts to have been produced independently before help. Any material cue, incomplete essential component, wrong answer, or teaching means UNCHANGED.\n5. For an unchanged gap, give only the minimum corrective teaching needed—preferably 1–3 sentences—then move on. Immediate reproduction after teaching is not durable recall and cannot resolve the gap; it can be retested in a later batch.\n6. Keep pace: normally no more than about 2–3 minutes per gap and no more than one follow-up round per topic. A safety-critical exception may take longer, but do not let one difficult gap consume the rest of the batch.\n7. Continue through every selected gap. Never mark or mention an untested gap as resolved. Add a new gap only if an actually asked question reveals a genuine additional weakness.\n8. Finish with one compact batch summary and immediately append one final multi-topic Trackr patch. Do not wait for me to request PATCH.\n\nLOGGING RULES\n- Every tested topic gets one review object with pass:"review". Rapid Gap Repair is later targeted review activity and must never create or repeat First- or Second-Pass completion. Never include a plan object.\n- review.gapResults must contain exactly the selected existing gaps that were actually tested, each with its exact supplied gapId and outcome "resolved" or "unchanged".\n- Every resolved gapResult must also appear in resolveGapIds. An unchanged gap must not appear in resolveGapIds.\n- Newly discovered weaknesses go in addGaps with a concise, specific statement and priority critical, important, or normal.\n- attemptsDelta counts the retrieval questions actually answered for that topic. correctDelta counts only questions answered independently and correctly before teaching. session.questions is the sum across the batch.\n- session.mode must be "rapid-recall" and session.planPass must be "review". Label the session "Rapid gap repair: ${ids}".\n- Do not repeat deltas or updates already emitted by an earlier patch.\n\nMASTERY, CONFIDENCE, AND OUTCOME\n- Because this is a narrow sample, normally omit mastery and confidence so they remain unchanged. Do not raise either merely because selected gaps were resolved.\n- If the tested material is unsafe or substantially worse, record the specific gaps and failed/prompted outcome. Preserve the full-topic oralAssessment; a new broad review is required to replace it.\n- failed: fail-critical knowledge was absent or answers were broadly unsafe.\n- prompted: material help or teaching was needed.\n- passed: every selected gap for that topic was independently retrieved at pass level.\n- fluent: rare; every selected gap was immediate, precise, and robust without help.\n\nFINAL RESPONSE AND PATCH\nFirst give a very short result per topic: resolved IDs, unchanged IDs, new gaps, and delayed-retest need. Do not add a full-topic overview. Then output exactly one raw JSON object with no Markdown fence or trailing text. Omit unchanged optional fields. Never use null or undefined. The JSON must end with exactly }}.\n\nExample structure (structural only; replace every value with real results):\n{"schemaVersion":1,"topics":[{"id":"${first.topicId}","attemptsDelta":2,"correctDelta":1,"resolveGapIds":["${first.openGaps[0].id}"],"review":{"outcome":"prompted","pass":"review","notes":"Concise independent-versus-taught result for the selected gaps only.","gapResults":[{"gapId":"${first.openGaps[0].id}","outcome":"resolved","note":"Retrieved independently before teaching."}]}}],"session":{"label":"Rapid gap repair: ${ids}","questions":2,"mode":"rapid-recall","planPass":"review"}}\n\nImportant: do not copy invented scores or resolutions from the example. Begin now with the focused, non-leading question bundle for ${first.topicId}.`;
}

// Normal topic prompts are deliberately standalone: do not append the long learning brief.
// Keep concrete learning, gap and assessment contracts here; retain all supplied gap records.
function makeTopicTask(entry:ReviewQueueEntry,state:PaediatricsState,progress:StudyPlanProgress|null,requestedPass?:'second'):string {
  const topic=state.topics[entry.topicId], pass=requestedPass??nextTopicPass(progress?.topics[entry.topicId]);
  const skipAcquisition=requestedPass==='second'&&!passCoverageAt(progress?.topics[entry.topicId],'first');
  const acquisition=pass==='first';
  const stage=pass==='review'?'Later review':PASS_DETAILS[pass].label;
  const gaps=topic.gaps.filter(g=>!g.resolvedAt);
  const resolved=topic.gaps.filter(g=>g.resolvedAt);
  const shape={schemaVersion:1,topics:[{id:entry.topicId,...(acquisition&&topic.status==='unassessed'?{status:'learning'}:{}),...(pass==='review'?{}:{plan:{[`${pass}PassComplete`]:true}}),...(acquisition?{}:{addGaps:[]}),oralAssessment:{ratings:{coverage:0,accuracy:0,independence:0,clinicalReasoning:0,propedeutics:0},safetyCriticalError:false,evidence:'Justify pre-teaching ratings'},review:{outcome:acquisition?'studied':'prompted',pass,notes:'Actual evidence',...(acquisition?{}:{gapResults:[]})}}],session:{label:`${entry.topicId} ${stage}`,questions:0,mode:acquisition?'mixed':'oral',planPass:pass}};
  return `PAEDIATRICS LEARNING AGREEMENT
${entry.topicId}: ${entry.title} | ${stage} | pass=${pass}. English; CU Prague 1st Faculty, second attempt; >6 months away. Full depth + propedeutics. Each a/b/c is separate (120).
SOURCES: actually read Paeds_iBook + exam-specific Pädiatrie Notes; lectures/Nelson support. No access: ask excerpts; cite file/section. Never invent citations. Zeman/2018 historical; verify safety details.
SCOPE at full Notes/iBook depth: definition/classification, causes/mechanisms, findings, diagnosis/DDx, treatment, complications; age-specific cases/vitals, terminology/exam/examples; common/dangerous first.
${acquisition?`PASS 0 WORKFLOW: Start with ONLY the topic title and invite a 60–120s free cold answer. Before teaching ask bundled neutral, non-leading examiner follow-ups across full scope + propedeutics; no hints/answers.
- PRE-TEACHING SCORE: oralAssessment rates coverage, accuracy, independence, clinicalReasoning, propedeutics from the cold answer + independent neutral follow-ups only. Credit omissions retrieved without hints. Scale: 0 absent/wrong;1 fragmentary;2 incomplete;3 independent/minor omissions;4 precise/robust. Exclude post-teaching/correction/content cues. Evidence separates recall/repair; safetyCriticalError only actual. Rate honestly; Trackr caps separately. Low scores are expected and valid.
- NORMAL PASS 0 if teaching is needed: teach, check application, reconstruct. Do not create tracked gaps during Pass 0. Difficulties in summary/review.notes only; omit addGaps, resolveGapIds, gapResults, cards. Complete firstPass after full-topic learning; outcome=studied regardless of score.
- UPGRADE only if recall was already broad, accurate, independent and safe at Pass 1 level before teaching: finish Pass 1, record gaps or []. Output secondPassComplete only with pass=second/mode=oral. Never record Pass 0; it becomes unnecessary, not performed.`:
`RECALL WORKFLOW: start with ONLY topic title + invite 60–120s cold answer. ${pass==='second'?'Consolidate structure/mechanisms.':pass==='third'?'Require exam-level reasoning/follow-ups.':'Probe weaknesses and sample broadly; expand if unstable.'} Bundle uncued follow-ups before teaching. No answers/hints/gap list; don’t re-ask admitted unknowns. Then teach errors/check application; repetition ≠ mastery. End: complete concise overview, strengths, gaps, delayed retests.
GAPS (mandatory from Pass 1, anytime): record demonstrated wrong/incomplete/prompted recall across full topic + propedeutics. Opening omission retrieved on neutral follow-up without hints ≠ gap. One precise Anki-ready target per addGaps item {text,priority}; critical=safety, important=substantial, normal=detail. No new IDs/duplicates; no automatic cards. Teaching does not remove a gap. Test existing IDs; later uncued success before help → resolveGapIds AND review.gapResults [{gapId,outcome:"resolved"}]; otherwise "unchanged". Untested stay open. Recurrence after resolution → new gap, keep history. Request refreshed IDs after imports.
ORAL (mandatory full-topic only): oralAssessment.ratings: coverage=scope/structure, accuracy=precision, independence=uncued recall, clinicalReasoning=age/DDx/safe action, propedeutics=basics/exam. 0=absent/wrong;1=major gaps/help;2=incomplete/prompted;3=independent/minor omissions;4=robust/precise. Grade ALL pre-teaching recall: cold answer + independently answered neutral examiner follow-ups. Exclude recall after teaching/correction/content hints/explanation; it cannot immediately resolve gaps. Rate each domain from actual evidence, never lower ratings to fit a cap. evidence (≤1500 chars) separates independent pre-teaching recall from excluded post-teaching repair; safetyCriticalError=actual unsafe error. App separately totals /20 and applies caps: unsafe/any0/independence≤1→7; any1/independence2→11; any2→15. outcome: failed=unsafe/broadly absent; prompted=material help; passed=independent ≥12; fluent=robust ≥19. Omit legacy mastery; confidence only if evidenced.`}
${acquisition?'PATCH: first=Pass0, second=Pass1. Full-topic only; no review/plan mid-session. Closure: summary + raw JSON, no fence/trailing text/nulls. Include pre-teaching oralAssessment for Pass0. Count actual questions/uncued answers. Never repeat deltas/session/completion; keep other history.':`PATCH: first=Pass0, second=Pass1, third=Pass2, review=later; use THIS topic's stage. Complete only full-topic work, never fragments/cards/imaging; completion ≠ mastery. During-session PATCH: new data only, no review/plan. Closure: summary then automatically one raw JSON, no fence/trailing text/nulls; replace example values with evidence. Include addGaps:[] if no new gaps and review.gapResults:[] if none tested; resolutions only for supplied tested IDs. attemptsDelta/correctDelta count actual uncued attempts/correct answers; session.questions counts actual questions. Never repeat exported deltas/session/completion. Backfill: gap-only={id,addGaps/resolveGapIds}, assessment-only={id,oralAssessment}; omit session/review/plan/deltas. Keep unmentioned fields/history.`}
${skipAcquisition?'DIRECT PASS 1: user chose to skip guided Pass 0. Start cold recall. After complete full-topic assessment + consolidation, mark secondPassComplete only. Pass 0 then becomes unnecessary but was NOT performed: never output firstPassComplete or a Pass 0 session/review. Completion is not a passing grade; record actual gaps/outcome. Partial work: omit secondPassComplete.\n':''}Template:
${JSON.stringify(shape)}
PRIVATE CONTEXT (do not cue answers): oral=${oralSummary(topic).label}; confidence=${topic.confidence}/4.
Open gaps [id,priority,text,createdAt]:${JSON.stringify(gaps.map(g=>[g.id,g.priority??'normal',g.text,g.createdAt]))}${!acquisition&&resolved.length?`\nResolved history [id,text,resolvedAt]:${JSON.stringify(resolved.map(g=>[g.id,g.text,g.resolvedAt]))}`:''}
Begin now.`;
}

export function makeStudyChatPrompt(entry:ReviewQueueEntry,state:PaediatricsState,progress:StudyPlanProgress|null,requestedPass?:'second'):string {
  return makeTopicTask(entry,state,progress,requestedPass);
}

export function makeGapRepairPrompt(batch:GapRepairQueueEntry[],state:PaediatricsState,progress:StudyPlanProgress|null):string {
  return withPaediatricsStudyApproach(makeGapRepairTask(batch,state,progress), 'gap-repair');
}
export function makeRapidGapRepairPrompt(batch:GapRepairQueueEntry[],state:PaediatricsState,progress:StudyPlanProgress|null):string {
  return withPaediatricsStudyApproach(makeRapidGapRepairTask(batch,state,progress), 'rapid-gap-repair');
}
