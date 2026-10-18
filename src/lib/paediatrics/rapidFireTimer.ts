import type { TopicStudyTimer, SessionSnapshot } from './paediatricsSchema';
import { startStudyTimer } from './studyTimer';
import { PAEDIATRICS_TOPIC_IDS } from './paediatricsSyllabus';

export function startRapidFireTimer(ids: string[], now = new Date()): TopicStudyTimer {
  if (!ids.length || ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id=>!PAEDIATRICS_TOPIC_IDS.has(id))) throw new Error('Choose 1–4 distinct Rapid Fire topics.');
  return {...startStudyTimer(ids[0], now), rapidFireTopicIds:[...ids]};
}

/** Equal active-time allocation, with contiguous wall-clock ranges and real pauses. */
export function rapidFireTimedSessions(timer: TopicStudyTimer, base: SessionSnapshot): SessionSnapshot[] {
  const ids = timer.rapidFireTopicIds;
  if (!ids?.length) return [base];
  const start=Date.parse(timer.startedAt), end=Date.parse(base.studyEndedAt!);
  const pauses=(timer.pauseIntervals??[]).map(p=>({start:Math.max(start,Date.parse(p.startedAt)),end:Math.min(end,Date.parse(p.endedAt??base.studyEndedAt!))})).filter(p=>p.end>p.start).sort((a,b)=>a.start-b.start);
  const runs:Array<{start:number;end:number}>=[];
  let cursor=start;
  for(const pause of pauses){if(pause.start>cursor)runs.push({start:cursor,end:pause.start});cursor=Math.max(cursor,pause.end);}
  if(cursor<end)runs.push({start:cursor,end});
  const total=Math.max(0,Math.floor(base.durationSeconds??0));
  const at=(seconds:number)=>{
    let ms=seconds*1000;
    for(const run of runs){const length=run.end-run.start;if(ms<=length)return run.start+ms;ms-=length;}
    return end;
  };
  let allocated=0;
  return ids.map((topicId,index)=>{
    const durationSeconds=Math.floor(total/ids.length)+(index<total%ids.length?1:0);
    const from=index===0?start:at(allocated);allocated+=durationSeconds;
    const to=index===ids.length-1?end:at(allocated);
    const pauseIntervals=pauses.map(p=>({startedAt:new Date(Math.max(from,p.start)).toISOString(),endedAt:new Date(Math.min(to,p.end)).toISOString()})).filter(p=>p.startedAt<p.endedAt);
    return {...base,id:`rapid-time-${timer.startedAt}-${topicId}`,label:`Rapid Fire time share · ${topicId}`,topicIds:[topicId],durationSeconds,studyStartedAt:new Date(from).toISOString(),studyEndedAt:new Date(to).toISOString(),pauseIntervals,mode:'rapid-recall',planPass:'none',questions:0};
  });
}
