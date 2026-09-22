import type { SurgeryState } from './surgerySchema';
import type { EvidenceMode, PlanPass, StudyPlanProgress } from './studyPlanSchema';
import { SURGERY_SYLLABUS } from './surgerySyllabus';

export type ReviewOutcome = 'failed' | 'prompted' | 'passed' | 'fluent';
export type GapPriority = 'critical' | 'important' | 'normal';
export type GapReviewOutcome = 'resolved' | 'unchanged';
export type GapReviewResult = { gapId: string; outcome: GapReviewOutcome; note?: string };

export type SurgeryReviewEvent = {
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
  createdAt: string;
};

export type SurgerySimulation = {
  id: string;
  date: string;
  outcome: ReviewOutcome;
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
  latest?: SurgeryReviewEvent;
  dueDate?: string;
  lastRecallAt?: string;
  recallAgeDays?: number;
  secondPassComplete: boolean;
  mastery: number;
};

export type GapRepairQueueEntry = {
  topicId: string;
  title: string;
  block: string;
  mastery: number;
  confidence: number;
  score: number;
  openGaps: Array<{ id: string; text: string; priority: GapPriority }>;
  criticalGapCount: number;
  importantGapCount: number;
  lastRecallAt?: string;
  recallAgeDays?: number;
  latest?: SurgeryReviewEvent;
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
const latestGapAttempts = (events:SurgeryReviewEvent[]) => {
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
export const latestReviews = (events:SurgeryReviewEvent[]) => {
  const result:Record<string,SurgeryReviewEvent>={};
  for(const event of [...events].sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt))) result[event.topicId]=event;
  return result;
};

export function buildReviewQueue(state:SurgeryState,progress:StudyPlanProgress|null,events:SurgeryReviewEvent[],today=localDate()):ReviewQueueEntry[] {
  const latest=latestReviews(events);
  return SURGERY_SYLLABUS.map((definition) => {
    const topic=state.topics[definition.id]; const review=latest[definition.id]; const plan=progress?.topics[definition.id];
    const open=topic.gaps.filter((gap)=>!gap.resolvedAt); const critical=open.filter((gap)=>gap.priority==='critical').length;
    const important=open.filter((gap)=>gap.priority==='important').length; const secondPassComplete=!!plan?.secondPassCompletedAt;
    const dueDate=review?.outcome==='failed'?addDays(review.reviewedAt.slice(0,10),1):review?.outcome==='prompted'?addDays(review.reviewedAt.slice(0,10),2):undefined;
    const lastRecallAt=review?.reviewedAt??plan?.firstPassCompletedAt;
    const recallAgeDays=lastRecallAt?daysBetween(lastRecallAt.slice(0,10),today):undefined;
    const due=!!dueDate&&dueDate<=today; const reasons:string[]=[]; let score=0; let kind:ReviewQueueEntry['kind']='maintenance';
    if(plan?.redZonePinned){score+=120;reasons.push('Red zone');}
    if(critical){score+=critical*55;reasons.push(`${critical} critical ${critical===1?'gap':'gaps'}`);}
    if(review?.outcome==='failed'){score+=due?110:80;reasons.push(due?'Failed retest due':'Last review failed');}
    if(review?.outcome==='prompted'){score+=due?75:45;reasons.push(due?'Prompted retest due':'Last review prompted');}
    if(!secondPassComplete){score+=60;reasons.push('Second pass not completed');}
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
    if(plan?.redZonePinned||critical||review?.outcome==='failed')kind='critical';
    else if(due)kind='retest'; else if(!secondPassComplete)kind='screen';
    return {topicId:definition.id,title:definition.title,kind,score,reasons,latest:review,dueDate,lastRecallAt,recallAgeDays,secondPassComplete,mastery:topic.mastery};
  }).sort((a,b)=>{
    // A genuinely critical/failed safety signal can interrupt the normal
    // order. Otherwise estimated knowledge is primary: lower mastery first,
    // then unfinished Second Pass before a later retest at the same mastery.
    // Confidence, gaps, recall age and retest due-ness remain in the score and
    // decide the order only inside that knowledge/coverage group.
    const criticalDifference=Number(b.kind==='critical')-Number(a.kind==='critical');
    if(criticalDifference) return criticalDifference;
    return a.mastery-b.mastery
      || Number(a.secondPassComplete)-Number(b.secondPassComplete)
      || b.score-a.score
      || a.topicId.localeCompare(b.topicId);
  });
}

export function filterReviewQueueForSecondPass(queue:ReviewQueueEntry[],ignoreRetests:boolean):ReviewQueueEntry[] {
  return ignoreRetests?queue.filter((entry)=>!entry.secondPassComplete):queue;
}

export function reviewCounts(events:SurgeryReviewEvent[],date:string) {
  const today=events.filter((event)=>event.reviewedAt.slice(0,10)===date);
  return {total:today.length,failed:today.filter(e=>e.outcome==='failed').length,prompted:today.filter(e=>e.outcome==='prompted').length,passed:today.filter(e=>e.outcome==='passed').length,fluent:today.filter(e=>e.outcome==='fluent').length};
}

/**
 * Gap repair deliberately ignores pass coverage as a ranking signal. Its job is
 * to find the weakest knowledge that is still open now: safety-critical gaps,
 * low mastery/confidence, failed retrieval and older recall all increase urgency.
 */
export function gapRepairCooldownSummary(state:SurgeryState,events:SurgeryReviewEvent[],now=new Date().toISOString()):GapRepairCooldownSummary {
  const nowTime=validTime(now)??Date.now();
  const attempts=latestGapAttempts(events);
  let readyCount=0;
  let coolingDownCount=0;
  let nextEligibleTime=Infinity;
  for(const definition of SURGERY_SYLLABUS){
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

export function buildGapRepairQueue(state:SurgeryState,progress:StudyPlanProgress|null,events:SurgeryReviewEvent[],today=localDate(),now=new Date().toISOString()):GapRepairQueueEntry[] {
  const latest=latestReviews(events);
  const attempts=latestGapAttempts(events);
  const nowTime=validTime(now)??Date.now();
  return SURGERY_SYLLABUS.flatMap((definition) => {
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
    const firstPassAt=progress?.topics[definition.id]?.firstPassCompletedAt;
    const lastRecallAt=review?.reviewedAt??firstPassAt??topic.lastReviewedAt??undefined;
    const recallAgeDays=lastRecallAt?daysBetween(lastRecallAt.slice(0,10),today):undefined;
    const criticalGapCount=openGaps.filter((gap)=>gap.priority==='critical').length;
    const importantGapCount=openGaps.filter((gap)=>gap.priority==='important').length;
    let score=criticalGapCount*180+importantGapCount*55+openGaps.length*10+(4-topic.mastery)*35+(4-topic.confidence)*22;
    if(progress?.topics[definition.id]?.redZonePinned) score+=130;
    if(review?.outcome==='failed') score+=100;
    else if(review?.outcome==='prompted') score+=55;
    score+=recallAgeDays===undefined?55:Math.min(80,recallAgeDays*5);
    return [{topicId:definition.id,title:definition.title,block:definition.block,mastery:topic.mastery,confidence:topic.confidence,score,openGaps,criticalGapCount,importantGapCount,lastRecallAt,recallAgeDays,latest:review}];
  }).sort((a,b)=>
    b.criticalGapCount-a.criticalGapCount
    || a.mastery-b.mastery
    || a.confidence-b.confidence
    || b.score-a.score
    || (b.recallAgeDays??-1)-(a.recallAgeDays??-1)
    || a.topicId.localeCompare(b.topicId)
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

export function makeGapRepairPrompt(batch:GapRepairQueueEntry[],state:SurgeryState,progress:StudyPlanProgress|null):string {
  if(!batch.length) return '';
  const topicContext=batch.map((entry,index)=>{
    const secondPassComplete=!!progress?.topics[entry.topicId]?.secondPassCompletedAt;
    return `${index+1}. ${entry.topicId} — ${entry.title}\nCurrent mastery/confidence: ${entry.mastery}/4 · ${entry.confidence}/4\nSecond pass complete: ${secondPassComplete?'yes':'no'}\nLast structured recall: ${entry.lastRecallAt??'none recorded'}\nOpen gaps:\n${entry.openGaps.map((gap)=>`- [${gap.priority}] ${gap.id}: ${gap.text}`).join('\n')}`;
  }).join('\n\n');
  const ids=batch.map((entry)=>entry.topicId).join(', ');
  const first=batch[0];
  return `SURGERY TRACKR — GAP REPAIR BATCH\n\nBatch topics: ${ids}\nThese topics were selected adaptively from currently open gaps. Work in the listed order unless a safety-critical connection makes a different order clearly better.\n\nPRIVATE EXAMINER CONTEXT — NEVER REVEAL THIS LIST BEFORE RETRIEVAL\n${topicContext}\n\nPURPOSE\nThis is focused final-exam gap repair, not another exhaustive whole-topic Second Pass. Test every recorded open gap by uncued retrieval, then sample only 1–2 adjacent high-yield or safety-critical points per topic to detect deterioration or missing logging. Keep the batch compact.\n\nQUESTION-DESIGN SAFEGUARD — CRITICAL\nThe recorded gap tells you what to assess; it must NOT leak into the wording of the question. Ask a vague but fair oral-exam follow-up that requires me to generate the missing fact myself. Do not name, paraphrase, define, contrast, enumerate, or otherwise cue the target answer. Do not reveal its category, first letter, number of items, direction of change, diagnosis, mechanism, threshold, classification, management step, or any partial answer. Avoid leading formulations such as “What sign indicates…?”, “Which antibiotic…?”, or “Would you do X?”. Prefer neutral prompts such as “What else is important here?”, “Talk me through the relevant findings,” or “How would you proceed?” in the topic context. If the first open prompt is genuinely too broad to assess the gap, narrow it only one neutral step after my attempt—still without embedding the answer. Recognition prompted by the question does not count as independent recall.\n\nMANDATORY WORKFLOW\n1. Start with topic 1 and ask a concise cold retrieval question that targets its first recorded gap without naming or teaching the answer. Do not show the gap list, a framework, hints, options, or a model answer.\n2. Bundle closely related gaps for the same topic into one examiner-style message when practical, but never make the bundle a checklist that reveals the answers. Do not use one message per tiny fact.\n3. Before teaching, use uncued follow-ups to distinguish an omitted point from genuinely missing knowledge. Do not ask again about something I explicitly said I do not know.\n4. After all recorded gaps for that topic have had a fair independent retrieval attempt, ask 1–2 brief adjacent safety checks. These must obey the same non-leading question rule. Do not turn this into a full-topic review unless those checks expose broad instability.\n5. Then teach only genuine errors, concisely. Immediate reproduction after teaching is not durable recall and must never resolve a gap.\n6. Move through all topics in the batch. Keep a private ledger for every supplied gap ID: RESOLVED only if independently retrieved before teaching; otherwise UNCHANGED. Add a new gap if an adjacent probe exposes a genuine new weakness.\n7. At the end, give one compact batch summary and immediately append one final multi-topic Trackr JSON patch. Do not wait for me to request PATCH.\n\nLOGGING RULES\n- Every tested topic gets one review object with pass:"review". This is a later targeted review, not a new First- or Second-Pass completion. Never include a plan object in Gap Repair mode.\n- Put every tested existing gap in review.gapResults with its exact supplied gapId and outcome "resolved" or "unchanged". An optional short note may explain the evidence.\n- A gap marked "resolved" in gapResults must also appear in resolveGapIds. An "unchanged" gap must NOT appear in resolveGapIds.\n- Newly discovered weaknesses go in addGaps with a concise, specific statement and priority critical, important, or normal.\n- attemptsDelta and correctDelta count only retrieval units actually attempted in this batch. session.questions is their total across all topics—not the number of topics.\n- Do not repeat deltas or changes already emitted in an earlier patch.\n- session.mode must be "rapid-recall" and session.planPass must be "review".\n\nMASTERY AND CONFIDENCE\n- Default: leave mastery and confidence unchanged in a narrow gap-repair review. Do not raise a topic merely because one recorded gap was repaired.\n- You may lower mastery/confidence when independent retrieval reveals that the topic is globally less stable than currently recorded.\n- You may raise either by at most 1 only when ALL recorded gaps were independently resolved before teaching AND the uncued adjacent safety checks demonstrate broad, stable topic command. Explain this evidence in review.notes.\n- Never raise mastery/confidence from prompted answers or immediate post-teaching reproduction. Fluent remains rare.\n\nREVIEW OUTCOME\n- failed: fail-critical knowledge was absent or the topic was broadly unsafe.\n- prompted: material help/teaching was needed, even if immediate reproduction then succeeded.\n- passed: all tested gaps and safety checks were independently answered at pass level.\n- fluent: unusually fast, structured and robust independent recall; use rarely.\n\nFINAL RESPONSE AND PATCH\nFirst provide a compact human-readable result per topic: independently known, resolved gap IDs, unchanged gap IDs, new gaps, and whether delayed retest is needed. Then output exactly one raw JSON object with no Markdown fence or trailing text. Omit unchanged optional fields. Never use null or undefined. The JSON must end with exactly }}.\n\nExample structure (replace with the real results and include every tested topic):\n{"schemaVersion":1,"topics":[{"id":"${first.topicId}","attemptsDelta":2,"correctDelta":1,"resolveGapIds":["${first.openGaps[0].id}"],"addGaps":[{"text":"specific newly discovered weakness","priority":"important"}],"review":{"outcome":"prompted","pass":"review","notes":"Independent versus prompted performance summary.","gapResults":[{"gapId":"${first.openGaps[0].id}","outcome":"resolved","note":"Retrieved independently before teaching."}]} }],"session":{"label":"Gap repair batch: ${ids}","questions":2,"mode":"rapid-recall","planPass":"review"}}\n\nImportant: the example is structural only. Include no invented resolution, new gap, mastery change, or score in the real patch. Begin now with the first non-leading, uncued gap retrieval for ${first.topicId}.`;
}

export function makeRapidGapRepairPrompt(batch:GapRepairQueueEntry[],state:SurgeryState,progress:StudyPlanProgress|null):string {
  if(!batch.length) return '';
  const selectedGapCount=batch.reduce((sum,entry)=>sum+entry.openGaps.length,0);
  const topicContext=batch.map((entry,index)=>{
    const totalOpenGaps=state.topics[entry.topicId].gaps.filter((gap)=>!gap.resolvedAt).length;
    const secondPassComplete=!!progress?.topics[entry.topicId]?.secondPassCompletedAt;
    return `${index+1}. ${entry.topicId} — ${entry.title}\nCurrent mastery/confidence: ${entry.mastery}/4 · ${entry.confidence}/4\nSecond pass complete: ${secondPassComplete?'yes':'no'}\nLast structured recall: ${entry.lastRecallAt??'none recorded'}\nSelected for this rapid batch: ${entry.openGaps.length} of ${totalOpenGaps} open gaps\nSelected gaps:\n${entry.openGaps.map((gap)=>`- [${gap.priority}] ${gap.id}: ${gap.text}`).join('\n')}`;
  }).join('\n\n');
  const ids=batch.map((entry)=>entry.topicId).join(', ');
  const first=batch[0];
  return `SURGERY TRACKR — RAPID GAP REPAIR\n\nBatch: ${selectedGapCount} selected gaps across ${batch.length} topics (${ids}).\nWork in the listed order. Test ONLY the selected gaps below; unselected open gaps remain untouched for later batches.\n\nPRIVATE EXAMINER CONTEXT — NEVER SHOW OR PARAPHRASE THE GAP LIST BEFORE RETRIEVAL\n${topicContext}\n\nPURPOSE\nResolve as many genuine gaps as possible per unit of time while preserving valid uncued retrieval. This is not a whole-topic screen, Second Pass, or broad oral simulation. Do not ask me to present the complete topic or its full skeleton.\n\nTARGETED BUT NON-LEADING QUESTION DESIGN — CRITICAL\n- Ask the smallest fair examiner question that directly tests the stored gap. The question may identify the official topic, clinical situation, or relevant subdomain needed to locate the problem, but it must not contain or imply the target answer.\n- Do NOT repeat, quote, paraphrase, define, contrast, enumerate, or visibly label the stored gap. Do not disclose the answer's first letter, number of items, direction of change, threshold, named sign, mechanism, classification item, investigation, treatment, or partial wording. No multiple choice, yes/no framing, cloze cues, or “Would you do X?” questions.\n- Avoid both extremes: never ask “Tell me everything about this topic” or similarly broad prompts, and never make the wording so specific that recognition replaces recall. Aim for the scope of a real examiner follow-up: focused enough for a 20–60 second answer, open enough that I must generate the fact myself.\n- One gap may receive 1–3 short questions when it contains genuinely separate recall components (for example principle, application, and safety consequence). Do not ask redundant variants merely to increase question count.\n- Questions for selected gaps within one topic should normally be bundled into one numbered message. A question must never serve as a clue to another question in that bundle.\n\nRAPID WORKFLOW\n1. Start with the selected gap(s) for ${first.topicId}. Ask the focused, uncued question bundle immediately. Do not begin with a 60–120 second whole-topic cold screen, outline, hints, or teaching.\n2. Give each gap a fair independent retrieval attempt. If my response may reflect a simple omission, use at most ONE concise non-leading precision probe before judging it. If I explicitly say I do not know, do not coax me with progressively revealing hints.\n3. Do not perform routine peripheral screening. Ask at most ONE adjacent safety check for a topic, and only when my answer exposes a plausible fail-critical neighbouring weakness. Otherwise move on.\n4. Grade the selected gap before teaching. RESOLVED requires all essential parts to have been produced independently before help. Any material cue, incomplete essential component, wrong answer, or teaching means UNCHANGED.\n5. For an unchanged gap, give only the minimum corrective teaching needed—preferably 1–3 sentences—then move on. Immediate reproduction after teaching is not durable recall and cannot resolve the gap; it can be retested in a later batch.\n6. Keep pace: normally no more than about 2–3 minutes per gap and no more than one follow-up round per topic. A safety-critical exception may take longer, but do not let one difficult gap consume the rest of the batch.\n7. Continue through every selected gap. Never mark or mention an untested gap as resolved. Add a new gap only if an actually asked question reveals a genuine additional weakness.\n8. Finish with one compact batch summary and immediately append one final multi-topic Trackr patch. Do not wait for me to request PATCH.\n\nLOGGING RULES\n- Every tested topic gets one review object with pass:"review". Rapid Gap Repair is later targeted review activity and must never create or repeat First- or Second-Pass completion. Never include a plan object.\n- review.gapResults must contain exactly the selected existing gaps that were actually tested, each with its exact supplied gapId and outcome "resolved" or "unchanged".\n- Every resolved gapResult must also appear in resolveGapIds. An unchanged gap must not appear in resolveGapIds.\n- Newly discovered weaknesses go in addGaps with a concise, specific statement and priority critical, important, or normal.\n- attemptsDelta counts the retrieval questions actually answered for that topic. correctDelta counts only questions answered independently and correctly before teaching. session.questions is the sum across the batch.\n- session.mode must be "rapid-recall" and session.planPass must be "review". Label the session "Rapid gap repair: ${ids}".\n- Do not repeat deltas or updates already emitted by an earlier patch.\n\nMASTERY, CONFIDENCE, AND OUTCOME\n- Because this is a narrow sample, normally omit mastery and confidence so they remain unchanged. Do not raise either merely because selected gaps were resolved.\n- You may lower mastery/confidence if the tested material reveals substantially worse or unsafe global knowledge. A later broad review, not this rapid batch, is the normal place for an increase.\n- failed: fail-critical knowledge was absent or answers were broadly unsafe.\n- prompted: material help or teaching was needed.\n- passed: every selected gap for that topic was independently retrieved at pass level.\n- fluent: rare; every selected gap was immediate, precise, and robust without help.\n\nFINAL RESPONSE AND PATCH\nFirst give a very short result per topic: resolved IDs, unchanged IDs, new gaps, and delayed-retest need. Do not add a full-topic overview. Then output exactly one raw JSON object with no Markdown fence or trailing text. Omit unchanged optional fields. Never use null or undefined. The JSON must end with exactly }}.\n\nExample structure (structural only; replace every value with real results):\n{"schemaVersion":1,"topics":[{"id":"${first.topicId}","attemptsDelta":2,"correctDelta":1,"resolveGapIds":["${first.openGaps[0].id}"],"review":{"outcome":"prompted","pass":"review","notes":"Concise independent-versus-taught result for the selected gaps only.","gapResults":[{"gapId":"${first.openGaps[0].id}","outcome":"resolved","note":"Retrieved independently before teaching."}]}}],"session":{"label":"Rapid gap repair: ${ids}","questions":2,"mode":"rapid-recall","planPass":"review"}}\n\nImportant: do not copy invented scores or resolutions from the example. Begin now with the focused, non-leading question bundle for ${first.topicId}.`;
}

export function makeStudyChatPrompt(entry:ReviewQueueEntry,state:SurgeryState,progress:StudyPlanProgress|null):string {
  const topic=state.topics[entry.topicId]; const gaps=topic.gaps.filter(g=>!g.resolvedAt);
  const purpose=entry.secondPassComplete
    ? `This is a third-pass targeted consolidation review. Cold-test recorded gaps and weakest areas first, then sample the high-yield whole-topic skeleton. Do not mechanically repeat every section unless performance shows broader instability.`
    : entry.kind==='retest'||entry.latest?.outcome==='failed'||entry.latest?.outcome==='prompted'
    ? `This is a targeted retest. Start with cold recall of the previously weak areas, then verify the full pass-level skeleton.`
    : entry.kind==='critical' ? `This is a high-priority safety review. Test fail-critical decisions first, then cover the full pass-level topic.`
    : `This is the topic's adaptive second-pass screen. Start with a 60–120 second cold oral recall, then deepen only where performance is weak.`;
  if(entry.secondPassComplete){
    const base:string=makeStudyChatPrompt({...entry,secondPassComplete:false},state,progress);
    return base
      .replace(/\n\nThis is [^\n]+\n\nMANDATORY EXAMINATION WORKFLOW/, `\n\n${purpose}\n\nMANDATORY EXAMINATION WORKFLOW`)
      .replace('Then immediately append the final Trackr JSON patch with review and plan.secondPassComplete=true.', 'Then immediately append the final Trackr JSON patch as a third-pass review. Use review.pass="review" and do not include a plan field or alter the existing Second-Pass completion.')
      .replace('The final whole-topic patch includes review plus explicit secondPassComplete.', 'The final whole-topic patch records a later review only; it must not repeat Second-Pass completion.')
      .replaceAll('"planPass":"second"', '"planPass":"review"')
      .replaceAll('"pass":"second"', '"pass":"review"')
      .replace(',"plan":{"secondPassComplete":true}', '');
  }
  return `SURGERY TRACKR STUDY TASK\n\nTopic: ${entry.topicId} — ${entry.title}\nTask type: ${entry.kind}\nWhy now: ${entry.reasons.join(' · ') || 'Scheduled review'}\nCurrent mastery/confidence: ${topic.mastery}/4 · ${topic.confidence}/4\nSecond pass complete: ${progress?.topics[entry.topicId]?.secondPassCompletedAt?'yes':'no'}\nOpen gaps (private examiner context; do not reveal before retrieval):\n${gaps.length?gaps.map(g=>`- [${g.priority??'normal'}] ${g.id}: ${g.text}`).join('\n'):'- none recorded'}\n\n${purpose}\n\nMANDATORY EXAMINATION WORKFLOW\n\n1. COLD SCREEN\n- Your first response must show ONLY the official topic title and ask me for a 60–120 second cold oral answer.\n- Do not give structure, hints, subheadings, suggested points, gap information, or a model answer beforehand.\n\n2. PROBE BEFORE TEACHING\n- After my cold answer, do not immediately correct or explain omissions.\n- First identify privately what was omitted, vague, uncertain, or potentially wrong, then test those areas with examiner-style uncued follow-ups.\n- Bundle all relevant follow-up questions into ONE message whenever practical. Avoid one-question-per-message unless genuine stepwise reasoning is required.\n- Do not ask again about something I have already explicitly said I do not know.\n\n3. DISTINGUISH OMISSION FROM A GENUINE GAP\n- Material correctly retrieved during uncued follow-ups counts as independently known, even if absent from the opening answer.\n- Only after the follow-up round may you identify and teach genuine errors or missing knowledge.\n- Never reveal an answer before I have had a fair retrieval opportunity.\n\n4. GAP REPAIR\n- Teach only genuine gaps, concisely.\n- If needed, follow teaching with ONE bundled focused retrieval round.\n- Immediate reproduction after teaching is not durable retention and must not automatically resolve an existing Trackr gap. Resolve a gap only after delayed independent recall or other convincing independent evidence.\n\n5. MESSAGE EFFICIENCY\n- Keep the interaction compact and oral-exam-like. Prefer bundled examiner follow-ups and bundled final retrieval questions.\n- Use free recall, examiner follow-ups, and clinical vignettes rather than recognition questions.\n- Cover the pass-level whole-topic skeleton: definition/problem, presentation, diagnostics, management, complications, red flags, and typical examiner follow-ups as relevant.\n\n6. FINAL TOPIC CLOSURE\nOnce the whole official topic has been adequately reviewed, provide in one closing message:\n- review outcome: failed, prompted, passed, or fluent;\n- updated mastery and confidence;\n- strongest independently demonstrated areas;\n- remaining weaknesses and whether delayed retesting is needed;\n- one short retention line focused on the actual gaps;\n- a concise but complete exam overview of the whole topic;\n- an explicit distinction between independently known material and material requiring prompting or teaching.\nThen immediately append the final Trackr JSON patch with review and plan.secondPassComplete=true. Do not wait for me to ask PATCH for this final patch.\n\n7. ASSESSMENT RULES\n- Weight the initial cold answer and all pre-teaching follow-up retrieval most heavily.\n- Do not confuse oral mastery, confidence, review outcome, second-pass completion, or retention; they are separate measures.\n- Fluent is rare and requires structured, stable, independent, follow-up-ready performance.\n- A completed whole-topic review may still be Prompted or Failed. Completion means coverage, not mastery.\n- Do not mark second pass complete after an isolated subquestion.\n\nTRACKR PATCH WORKFLOW\nI may import an ordinary patch after each answered question or bundled retrieval round. When I write PATCH, output exactly one raw JSON object and nothing else. Ordinary patches update assessment only: session.questions and attemptsDelta reflect only the newly answered material, and there is no review or plan field. The final whole-topic patch includes review plus explicit secondPassComplete. Never repeat previously patched questions or deltas. Never use null, undefined, invented fields, comments, Markdown inside the JSON, or trailing text. The JSON must end with exactly }} — never }]}, }}]}, or extra closing brackets.\n\nOrdinary patch shape:\n{"schemaVersion":1,"topics":[{"id":"${entry.topicId}","mastery":2,"confidence":2,"status":"learning","attemptsDelta":1,"correctDelta":0,"addGaps":[{"text":"specific genuine gap","priority":"important"}]}],"session":{"questions":1,"mode":"oral","planPass":"second"}}\n\nFinal full-topic patch shape:\n{"schemaVersion":1,"topics":[{"id":"${entry.topicId}","mastery":2,"confidence":2,"status":"review","attemptsDelta":1,"correctDelta":1,"review":{"outcome":"prompted","pass":"second","notes":"concise independently-known versus prompted summary"},"plan":{"secondPassComplete":true}}],"session":{"questions":1,"mode":"oral","planPass":"second"}}\n\nAllowed review outcomes: failed, prompted, passed, fluent. Allowed gap priorities: critical, important, normal. Omit unchanged fields. Do not fabricate timestamps. Begin now with the cold screen exactly as specified.`;
}
