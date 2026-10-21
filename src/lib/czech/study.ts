export const SKILLS=['listening','speaking','reading','writing'] as const;
export type Skill=typeof SKILLS[number];
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
export type Timer={lessonId:string;startedAt:string;runningSince?:string;seconds:number;status:'running'|'paused'};
export type CzechState={version:1;level:'A1/A2';assessments:Record<string,Partial<Record<Skill,Rating>>>;gaps:Gap[];studySeconds:number;practiceCount:number;timer?:Timer};
export type Patch={kind:'trackr-czech-patch';schemaVersion:1;id:string;assessments:Array<{lessonId:string;skill:Skill;score:number;evidence:string}>;addGaps:Array<Omit<Gap,'id'|'createdAt'|'resolvedAt'>>;resolveGapIds:string[]};
export const emptyState=():CzechState=>({version:1,level:'A1/A2',assessments:{},gaps:[],studySeconds:0,practiceCount:0});
const lesson=(id:unknown)=>typeof id==='string'&&LESSONS.some(l=>l.id===id);
const skill=(id:unknown)=>SKILLS.includes(id as Skill);
const text=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
export function validatePatch(input:unknown):Patch {
 const p=input as Patch;
 const keys=(value:object,allowed:string[])=>Object.keys(value).every(k=>allowed.includes(k));
 if(!p||p.kind!=='trackr-czech-patch'||p.schemaVersion!==1||!text(p.id,100)||!/^[-\w]+$/.test(p.id)||!Array.isArray(p.assessments)||p.assessments.length>20||!Array.isArray(p.addGaps)||p.addGaps.length>40||!Array.isArray(p.resolveGapIds)||p.resolveGapIds.length>100)throw new Error('Use a valid Czech practice patch with assessments, addGaps and resolveGapIds.');
 if(!keys(p,['kind','schemaVersion','id','assessments','addGaps','resolveGapIds'])||(!p.assessments.length&&!p.addGaps.length&&!p.resolveGapIds.length))throw new Error('Patch needs actual practice evidence and no unknown fields.');
 const seen=new Set<string>();
 for(const a of p.assessments){if(!a||!keys(a,['lessonId','skill','score','evidence'])||!lesson(a.lessonId)||!skill(a.skill)||!Number.isInteger(a.score)||a.score<0||a.score>4||!text(a.evidence,600)||seen.has(`${a.lessonId}:${a.skill}`))throw new Error('Each assessed skill needs one score from 0–4 and real evidence.');seen.add(`${a.lessonId}:${a.skill}`);}
 for(const g of p.addGaps)if(!g||!keys(g,['lessonId','skill','prompt','answer','priority'])||!lesson(g.lessonId)||!skill(g.skill)||!text(g.prompt,500)||!text(g.answer,800)||!['important','normal'].includes(g.priority))throw new Error('Each gap needs a lesson, skill, question and correct answer.');
 if(p.resolveGapIds.some(id=>!text(id,160)))throw new Error('Invalid gap ID.');
 return structuredClone(p);
}
export function applyPatch(state:CzechState,p:Patch,now:string):CzechState {
 p=validatePatch(p);const next=structuredClone(state);
 for(const a of p.assessments){next.assessments[a.lessonId]??={};next.assessments[a.lessonId][a.skill]={score:a.score,evidence:a.evidence,at:now};}
 for(const [i,g] of p.addGaps.entries())if(!next.gaps.some(old=>!old.resolvedAt&&old.lessonId===g.lessonId&&old.skill===g.skill&&old.prompt.trim().toLowerCase()===g.prompt.trim().toLowerCase())) next.gaps.push({...g,id:`${p.id}-${i}`,createdAt:now});
 const ids=new Set(p.resolveGapIds);
 for(const id of ids)if(!next.gaps.some(g=>g.id===id))throw new Error('A resolved gap ID does not exist. Refresh the prompt.');
 next.gaps=next.gaps.map(g=>ids.has(g.id)&&!g.resolvedAt?{...g,resolvedAt:now}:g);
 next.practiceCount+=1;return next;
}
export function elapsed(timer:Timer,now=Date.now()){return timer.seconds+(timer.status==='running'?Math.max(0,Math.floor((now-Date.parse(timer.runningSince!))/1000)):0);}
export function pause(timer:Timer,now:number):Timer {return timer.status==='paused'?timer:{lessonId:timer.lessonId,startedAt:timer.startedAt,seconds:elapsed(timer,now),status:'paused'};}
export function resume(timer:Timer,now:number):Timer {return timer.status==='running'?timer:{...timer,status:'running',runningSince:new Date(now).toISOString()};}
export function rankedLessons(state:CzechState,track:string,focus:Skill,now=Date.now()) {
 return LESSONS.filter(l=>track==='All'||l.track===track).map(l=>{const a=state.assessments[l.id]?.[focus];return {...l,priority:a?(4-a.score)*4+Math.max(0,(now-Date.parse(a.at))/86400000):10000};}).sort((a,b)=>b.priority-a.priority);
}
export function studyPrompt(state:CzechState,lessonId:string,focus:Skill,patchId:string){
 const l=LESSONS.find(l=>l.id===lessonId)!;const gaps=state.gaps.filter(g=>!g.resolvedAt&&g.lessonId===lessonId&&g.skill===focus);
 return `CZECH PRACTICE | German learner in Prague, refresh A1/A2. Topic ${l.title}: ${l.goal} Focus ${focus}. 10–15 min; explanations in German, exercises in Czech, adapt after brief initial check. NOT an exam monologue. Ask one short task at a time; maximise learner production. Use natural Czech, correct diacritics, useful phrases in context. Clinic is language practice, not medical advice. Use supplied resources if available; never invent sources.
Speaking: short role-play with 4–6 turns, let learner answer before correcting; retry corrected phrase in a new context. Assess pronunciation only from actual audio. Listening: use real spoken Czech if audio is available, no transcript before attempt; without audio do NOT score listening, offer reading/speaking instead and say so. Reading: short authentic-style text + comprehension. Writing: short message/dialogue; assess independently written language. Do not infer untested skills or a CEFR level. 0 cannot yet do task;1 substantial help;2 partial/help;3 independent minor errors;4 robust in this task. Score independent performance BEFORE correction; immediate repetition is not mastery.
Finish with brief feedback then one raw JSON patch. Assess only demonstrated skills; omit untested ones. Gaps are atomic recall tasks with a clear front (German instruction/context) and correct Czech answer, optional short German meaning. Prioritise recurrent/useful errors. Never resolve immediately after teaching; only later independent recall. Preserve supplied gap IDs; no fabricated resolutions. No timer/duration in patch: Trackr tracks that separately. Use EXACT patch id below; never reuse it for another session.
Template (replace examples with evidence, [] for untested/no gaps):
${JSON.stringify({kind:'trackr-czech-patch',schemaVersion:1,id:patchId,assessments:[{lessonId,skill:focus,score:0,evidence:'Observed independent performance'}],addGaps:[{lessonId,skill:focus,prompt:'Specific German cue',answer:'Correct Czech response',priority:'normal'}],resolveGapIds:[]})}
PRIVATE open gaps, do not reveal answers before retrieval: ${JSON.stringify(gaps)}
Start with one short task.`;
}
export function gapsTsv(state:CzechState){const clean=(s:string)=>s.replace(/[\t\r\n]+/g,' ').replace(/[<>]/g,'');return state.gaps.filter(g=>!g.resolvedAt).map(g=>`${clean(g.prompt)}\t${clean(g.answer)}\tCzech::${g.lessonId} Czech::${g.skill}`).join('\n');}
