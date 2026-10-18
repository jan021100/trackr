import type { PaediatricsState } from './paediatricsSchema';
import type { ReviewQueueEntry, PaediatricsReviewEvent } from './paediatricsReview';
import { scoreOralAssessment } from './oralAssessment';

export const RAPID_FIRE_MARKER = '[RAPID FIRE]';
/** Keep the regular priority order. One sweep per day; imports advance the next block. */
export function rapidFireQueue(queue: ReviewQueueEntry[], events: PaediatricsReviewEvent[], today: string) {
  const done = new Set(events.filter(e => e.pass === 'review' && e.mode === 'rapid-recall' && e.reviewedAt.slice(0,10) === today && e.notes?.startsWith(RAPID_FIRE_MARKER)).map(e => e.topicId));
  return queue.filter(e => !done.has(e.topicId));
}
export function makeRapidFirePrompt(batch: ReviewQueueEntry[], state: PaediatricsState, examDate: string) {
  const selected = batch.slice(0,4);
  const context = selected.map(entry => {
    const topic = state.topics[entry.topicId];
    const ceiling = Math.min(15, topic.oralAssessment ? scoreOralAssessment(topic.oralAssessment).score : 15);
    const rank = {critical:0,important:1,normal:2};
    const gaps = topic.gaps.filter(g=>!g.resolvedAt).sort((a,b)=>rank[a.priority??'normal']-rank[b.priority??'normal']).slice(0,2);
    return {id:entry.topicId,title:entry.title,stage:entry.nextPass,previousScore:topic.oralAssessment?scoreOralAssessment(topic.oralAssessment).score:undefined,ceiling,gaps:gaps.map(g=>({id:g.id,text:g.text,priority:g.priority??'normal'}))};
  });
  const topics = context.map(t=>({id:t.id,oralAssessment:{scope:'rapid',scoreCeiling:t.ceiling,ratings:{coverage:0,accuracy:0,independence:0,clinicalReasoning:0,propedeutics:0},safetyCriticalError:false,evidence:'Actual pre-teaching evidence; sampled and untested areas'},addGaps:[],review:{pass:'review',outcome:'prompted',notes:`${RAPID_FIRE_MARKER} sampled domains, independent recall vs correction`,gapResults:[]}}));
  return `PAEDIATRICS RAPID FIRE | exam ${examDate || 'date unknown'} | English; CU Prague 1st Faculty. Up to 4 topics, STRICT 5min/topic including feedback, 20min/block. Same topic priority as Trackr; follow listed order.
Read uploaded Paeds_iBook + exam Notes; lectures/Nelson support. No access: ask excerpts, never invent citations. Include propedeutics; verify historical safety claims.
WORKFLOW: one topic at a time. No monologue/lesson. Ask 3–4 numbered open, neutral questions together; request brief bullet answers, 20–40s each. Sample core pattern/DDx, diagnostic/treatment decision incl. safety, relevant propedeutic finding/term/age, and a supplied gap. Test reasoning and independent recall. No obscure trivia, yes/no, options, answer-bearing checklists or hints; never reveal private gap text. No cross-question cues.
Allow at most ONE short neutral clarification if omission is uncertain. Explicit unknown: move on. Judge ALL independent answers before correction. Then give concise per-question right/partial/wrong verdict + correct key point (1–2 sentences). No extended teaching/repetition. At 5min or learner says NEXT: close topic and continue; never invent answers to unasked questions. Do not claim to measure elapsed time: learner uses Trackr countdown.
GAPS: every demonstrated missing/wrong/prompted fact gets its own concise atomic addGaps {text,priority}; context + exact missing recall target, Anki-ready. critical=safety, important=core, normal=detail. Avoid duplicate existing gaps. Teaching/immediate repetition never resolves gaps. Test supplied IDs: later independent complete recall → resolveGapIds AND review.gapResults [{gapId,outcome:"resolved"}]; otherwise "unchanged". Untested IDs stay untouched. No automatic Anki cards.
ASSESSMENT: limited rapid sample, NEVER full Pass completion. Rate 5 domains 0–4 only from independent pre-correction answers: coverage, accuracy, independence, clinicalReasoning, propedeutics. 0 absent/wrong;1 major gaps;2 incomplete;3 independent/minor omissions;4 robust. Opening omission retrieved on neutral follow-up is credited. Evidence explicitly states sampled/untested areas and excludes teaching. If any domain cannot fairly be rated, OMIT oralAssessment, state insufficient evidence; still log review/gaps. Never invent zero for an untested domain. Mandatory scope="rapid", scoreCeiling=given ceiling; app caps /20 at 15 and never raises the previous score from this sample. Existing safety/domain caps also apply. If previousScore>15, ratings≥3 throughout and safe: OMIT oralAssessment, preserve strong full score. No mastery/confidence. outcome failed=unsafe/broadly absent; prompted=material help; passed=independent and capped score≥12; no fluent. Correct independently retrieved gaps can resolve even when overall topic is weak.
PATCH: one compact summary then ONE raw JSON for actually attempted topics only, automatically, no fences/trailing text. No plan/firstPassComplete/secondPassComplete/thirdPassComplete; review.pass="review" ALWAYS. Every review.notes starts "${RAPID_FIRE_MARKER}" so imported topics leave today's rapid queue. Include addGaps:[]/gapResults:[] if empty. Actual question counts only; no duplicate sessions/deltas. Never log skipped topics or pretend sampled work completed a full pass.
Template shows ONE topic; include one entry per actually tested topic (up to 4). Replace placeholders; never copy zeros/outcomes blindly:
${JSON.stringify({schemaVersion:1,topics:topics.slice(0,1),session:{label:'Rapid Fire: '+context.map(t=>t.id).join(', '),questions:0,mode:'rapid-recall',planPass:'review'}})}
PRIVATE context; keep hidden before testing:
${JSON.stringify(context)}
Start topic 1 with its question bundle.`;
}
