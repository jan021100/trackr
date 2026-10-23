export const SKILLS=['listening','speaking','reading','writing'] as const;
export type Skill=typeof SKILLS[number];
export type Focus=Skill|'mixed';
export type VocabularyInput={term:string;meaning:string;lessonId:string;kind:'word'|'phrase';status:'introduced'|'recalled'|'needs-review';evidence:string};
export type VocabularyItem=VocabularyInput & {firstSeenAt:string;lastSeenAt:string};
export const LESSONS=[
 ['hello','Everyday','Introductions & small talk','Introduce yourself and ask simple personal questions.'],
 ['numbers','Everyday','Numbers, dates & appointments','Understand prices, dates, ages and appointment times.'],
 ['food','Everyday','Food & shopping','Order food, ask for items and handle payment.'],
 ['directions','Everyday','Getting around','Ask for directions and use public transport.'],
 ['home','Everyday','Home & daily routine','Describe where you live and your typical day.'],
 ['plans','Everyday','Plans & past events','Explain simple plans and describe what happened.'],
 ['requests','Everyday','Requests & clarification','Ask politely, say you did not understand and request repetition.'],
 ['calls','Everyday','Phone calls & messages','Arrange an appointment and write a short message.'],
 ['rapport','Clinic','Meeting a patient','Introduce your role, check identity and explain the conversation.'],
 ['symptoms','Clinic','Symptoms & pain','Ask where it hurts, since when and what makes it better or worse.'],
 ['history','Clinic','Medical history','Ask about previous illness, operations, medication and allergies.'],
 ['examination','Clinic','Explaining an examination','Give respectful, clear examination instructions.'],
 ['explanation','Clinic','Explaining next steps','Explain simple tests and check the patient understood.'],
 ['handover','Clinic','Colleagues & handover','Give a concise patient summary and ask for clarification.']
].map(([id,track,title,goal])=>({id,track,title,goal}));
export type Rating={score:number;evidence:string;at:string};
export type Gap={id:string;lessonId:string;skill:Skill;prompt:string;answer:string;priority:'important'|'normal';createdAt:string;resolvedAt?:string};
export type Timer={patchId?:string;lessonId:string;startedAt:string;runningSince?:string;seconds:number;status:'running'|'paused'};
export type CzechState={version:1;level?:string;vocabulary?:VocabularyItem[];assessments:Record<string,Partial<Record<Skill,Rating>>>;gaps:Gap[];studySeconds:number;practiceCount:number;timer?:Timer};
export type Patch={kind:'trackr-czech-patch';schemaVersion:1;id:string;assessments:Array<{lessonId:string;skill:Skill;score:number;evidence:string}>;addGaps:Array<Omit<Gap,'id'|'createdAt'|'resolvedAt'>>;resolveGapIds:string[];vocabulary?:VocabularyInput[]};
export const emptyState=():CzechState=>({version:1,vocabulary:[],assessments:{},gaps:[],studySeconds:0,practiceCount:0});
const lesson=(id:unknown)=>typeof id==='string'&&LESSONS.some(l=>l.id===id);
const skill=(id:unknown)=>SKILLS.includes(id as Skill);
const text=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
export function validatePatch(input:unknown):Patch {
 const p=input as Patch;
 const keys=(value:object,allowed:string[])=>Object.keys(value).every(k=>allowed.includes(k));
 if(!p||p.kind!=='trackr-czech-patch'||p.schemaVersion!==1||!text(p.id,100)||!/^[-\w]+$/.test(p.id)||!Array.isArray(p.assessments)||p.assessments.length>20||!Array.isArray(p.addGaps)||p.addGaps.length>40||!Array.isArray(p.resolveGapIds)||p.resolveGapIds.length>100)throw new Error('Use a valid Czech practice patch with assessments, addGaps and resolveGapIds.');
 if(!keys(p,['kind','schemaVersion','id','assessments','addGaps','resolveGapIds','vocabulary'])||(!p.assessments.length&&!p.addGaps.length&&!p.resolveGapIds.length&&!p.vocabulary?.length))throw new Error('Patch needs actual practice evidence and no unknown fields.');
 const seen=new Set<string>();
 for(const a of p.assessments){if(!a||!keys(a,['lessonId','skill','score','evidence'])||!lesson(a.lessonId)||!skill(a.skill)||!Number.isInteger(a.score)||a.score<0||a.score>4||!text(a.evidence,600)||seen.has(`${a.lessonId}:${a.skill}`))throw new Error('Each assessed skill needs one score from 0–4 and real evidence.');seen.add(`${a.lessonId}:${a.skill}`);}
 for(const g of p.addGaps)if(!g||!keys(g,['lessonId','skill','prompt','answer','priority'])||!lesson(g.lessonId)||!skill(g.skill)||!text(g.prompt,500)||!text(g.answer,800)||!['important','normal'].includes(g.priority))throw new Error('Each gap needs a lesson, skill, question and correct answer.');
 if(p.resolveGapIds.some(id=>!text(id,160)))throw new Error('Invalid gap ID.');
 if(p.vocabulary!==undefined){
  if(!Array.isArray(p.vocabulary)||p.vocabulary.length>40)throw new Error('Vocabulary must contain at most 40 evidenced entries.');
  const words=new Set<string>();
  for(const v of p.vocabulary){if(!v||!keys(v,['term','meaning','lessonId','kind','status','evidence'])||!text(v.term,160)||!text(v.meaning,400)||!text(v.evidence,600)||!lesson(v.lessonId)||!['word','phrase'].includes(v.kind)||!['introduced','recalled','needs-review'].includes(v.status))throw new Error('Each vocabulary entry needs Czech, meaning, topic and observed recall evidence.');const key=vocabularyKey(v);if(words.has(key))throw new Error('Duplicate vocabulary entry in patch.');words.add(key);}
 }
 return structuredClone(p);
}
export function applyPatch(state:CzechState,p:Patch,now:string):CzechState {
 p=validatePatch(p);const next=structuredClone(state);
 for(const a of p.assessments){next.assessments[a.lessonId]??={};next.assessments[a.lessonId][a.skill]={score:a.score,evidence:a.evidence,at:now};}
 for(const [i,g] of p.addGaps.entries())if(!next.gaps.some(old=>!old.resolvedAt&&old.lessonId===g.lessonId&&old.skill===g.skill&&old.prompt.trim().toLowerCase()===g.prompt.trim().toLowerCase())) next.gaps.push({...g,id:`${p.id}-${i}`,createdAt:now});
 const ids=new Set(p.resolveGapIds);
 for(const id of ids)if(!next.gaps.some(g=>g.id===id))throw new Error('A resolved gap ID does not exist. Refresh the prompt.');
 next.gaps=next.gaps.map(g=>ids.has(g.id)&&!g.resolvedAt?{...g,resolvedAt:now}:g);
 next.vocabulary=mergeVocabulary(next.vocabulary??[],p.vocabulary??[],now);
 next.practiceCount+=1;return next;
}
export function elapsed(timer:Timer,now=Date.now()){return timer.seconds+(timer.status==='running'?Math.max(0,Math.floor((now-Date.parse(timer.runningSince!))/1000)):0);}
export function pause(timer:Timer,now:number):Timer {if(timer.status==='paused')return timer;const next:Timer={...timer,seconds:elapsed(timer,now),status:'paused'};delete next.runningSince;return next;}
export function resume(timer:Timer,now:number):Timer {return timer.status==='running'?timer:{...timer,status:'running',runningSince:new Date(now).toISOString()};}
export function rankedLessons(state:CzechState,track:string,focus:Focus,now=Date.now()) {
 return LESSONS.filter(l=>track==='All'||l.track===track).map(l=>{const ratings=Object.values(state.assessments[l.id]??{});const a=focus==='mixed'?(ratings.length?{score:ratings.reduce((n,a)=>n+a!.score,0)/ratings.length,at:ratings.map(a=>a!.at).sort()[0]}:undefined):state.assessments[l.id]?.[focus];return {...l,priority:a?(4-a.score)*4+Math.max(0,(now-Date.parse(a.at))/86400000):10000};}).sort((a,b)=>b.priority-a.priority);
}
export function studyPrompt(state:CzechState,lessonId:string,focus:Focus,patchId:string){
 const l=LESSONS.find(l=>l.id===lessonId)!;const gaps=state.gaps.filter(g=>!g.resolvedAt&&g.lessonId===lessonId&&(focus==='mixed'||g.skill===focus));
 return `CZECH PRACTICE | German learner in Prague. Open-ended Czech learning: start from current ability and grow without a fixed level ceiling. Topic ${l.title}: ${l.goal} Focus ${focus}. ${focus==='mixed'?'MIXED MODE: combine a short dialogue, a reading snippet and a brief written reply; include listening ONLY with real audio. Do not ask learner to choose a skill.':'Use the selected skill.'} 10–15 min; explanations in German, exercises in Czech, adapt after brief initial check. When successful, increase vocabulary, grammar and scenario complexity next time; reuse topics at greater depth. A 4/4 means robust for this task, never a finished topic or a maximum level. NOT an exam monologue. Ask one short task at a time; maximise learner production. Use natural Czech, correct diacritics, useful phrases in context. Clinic is language practice, not medical advice. Use supplied resources if available; never invent sources.
Speaking: short role-play with 4–6 turns, let learner answer before correcting; retry corrected phrase in a new context. Assess pronunciation only from actual audio. Listening: use real spoken Czech if audio is available, no transcript before attempt; without audio do NOT score listening, offer reading/speaking instead and say so. Reading: short authentic-style text + comprehension. Writing: short message/dialogue; assess independently written language. Do not infer untested skills or a CEFR level. 0 cannot yet do task;1 substantial help;2 partial/help;3 independent minor errors;4 robust in this task. Score independent performance BEFORE correction; immediate repetition is not mastery.
Finish with brief feedback then one raw JSON patch. Assess only demonstrated skills; omit untested ones. Gaps are atomic recall tasks with a clear front (German instruction/context) and correct Czech answer, optional short German meaning. Prioritise recurrent/useful errors. Never resolve immediately after teaching; only later independent recall. Preserve supplied gap IDs; no fabricated resolutions. No timer/duration in patch: Trackr tracks that separately. Use EXACT patch id below; never reuse it for another session.
Vocabulary entry format: {term,meaning,lessonId,kind:"word"|"phrase",status:"introduced"|"recalled"|"needs-review",evidence}. Include only Czech words/phrases actually introduced or tested in THIS session, with German meaning and evidence. status introduced=seen/taught only; recalled=independently produced BEFORE help; needs-review=failed independent retrieval. Never estimate total vocabulary from scores or generate a list to inflate progress. Keep word vs phrase distinct; omit vocabulary or [] if none.
Template (replace examples with evidence, [] for untested/no gaps):
${JSON.stringify({kind:'trackr-czech-patch',schemaVersion:1,id:patchId,assessments:[{lessonId,skill:focus==='mixed'?'speaking':focus,score:0,evidence:'Observed independent performance'}],addGaps:[{lessonId,skill:focus==='mixed'?'speaking':focus,prompt:'Specific German cue',answer:'Correct Czech response',priority:'normal'}],resolveGapIds:[],vocabulary:[]})}
Recent independent skill evidence: ${JSON.stringify(state.assessments[lessonId]??{})}
PRIVATE open gaps, do not reveal answers before retrieval: ${JSON.stringify(gaps)}
Start with one short task.`;
}
export function gapsTsv(state:CzechState){const clean=(s:string)=>s.replace(/[\t\r\n]+/g,' ').replace(/[<>]/g,'');return state.gaps.filter(g=>!g.resolvedAt).map(g=>`${clean(g.prompt)}\t${clean(g.answer)}\tCzech::${g.lessonId} Czech::${g.skill}`).join('\n');}

export const vocabularyKey=(v:Pick<VocabularyInput,'term'>)=>v.term.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('cs');
export function mergeVocabulary(existing:VocabularyItem[],incoming:VocabularyInput[],now:string):VocabularyItem[]{
 const result=structuredClone(existing);
 for(const v of incoming){const index=result.findIndex(old=>vocabularyKey(old)===vocabularyKey(v));if(index<0)result.push({...v,term:v.term.trim(),firstSeenAt:now,lastSeenAt:now});else{const old=result[index];result[index]={...old,...v,status:v.status==='introduced'&&old.status==='recalled'?'recalled':v.status,firstSeenAt:old.firstSeenAt,lastSeenAt:now};}}
 return result;
}
export function topicScore(state:CzechState,id:string):number|undefined{const ratings=Object.values(state.assessments[id]??{});return ratings.length?ratings.reduce((n,a)=>n+a!.score,0)/ratings.length:undefined;}
export function scoreBand(score:number|undefined){return score===undefined?'unassessed':score<1?'starting':score<2?'building':score<3?'developing':score<4?'independent':'confident';}

export function startPracticeTimer(timer:Timer|undefined,lessonId:string,patchId:string,now:string):Timer{
 if(timer&&(timer.lessonId!==lessonId||(timer.patchId&&timer.patchId!==patchId)))throw new Error('Finish or cancel the current practice timer first.');
 return timer?{...resume(timer,Date.parse(now)),patchId}:{lessonId,patchId,startedAt:now,runningSince:now,seconds:0,status:'running'};
}
export function patchMatchesTimer(timer:Timer|undefined,patch:Patch){
 if(!timer)return false;
 if(timer.patchId)return timer.patchId===patch.id;
 // Older timers predate session IDs. Only finish them when the imported practice
 // actually includes their lesson. All newly started timers use exact patch IDs.
 return [...patch.assessments,...patch.addGaps,...(patch.vocabulary??[])].some(item=>item.lessonId===timer.lessonId);
}
export function finishPracticeTimer(state:CzechState,now:string){
 const next=structuredClone(state),timer=next.timer;if(!timer)return {state:next};
 const seconds=elapsed(timer,Date.parse(now));next.studySeconds+=seconds;delete next.timer;
 return {state:next,id:`czech-time-${timer.startedAt}`,log:{kind:'czech-time',createdAt:now,lessonId:timer.lessonId,startedAt:timer.startedAt,endedAt:now,durationSeconds:seconds}};
}
export function finishPracticePatch(state:CzechState,patch:Patch,now:string){return patchMatchesTimer(state.timer,patch)?finishPracticeTimer(state,now):{state};}
