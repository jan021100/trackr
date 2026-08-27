import type { StudyPlanConfig, StudyPlanPhase, StudyPlanProgress, PlanPass } from './studyPlanSchema';

export const dateKey = (value: Date | string = new Date()) => typeof value === 'string' ? value.slice(0,10) : `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const atNoon = (key:string) => new Date(`${key}T12:00:00`);
export function dateRange(start:string,end:string) { const out:string[]=[]; for(let d=atNoon(start); d<=atNoon(end); d.setDate(d.getDate()+1)) out.push(dateKey(d)); return out; }
export const phaseForDate = (config:StudyPlanConfig,date:string) => config.phases.find((p) => date>=p.startDate && date<=p.endDate);
export const dayWeight = (config:StudyPlanConfig,date:string) => Math.max(0, config.dayOverrides.find((d)=>d.date===date)?.weight ?? 1);
export type ScheduleDay = { date:string; weight:number; quota:number; cumulativeTarget:number };
export function passCount(progress:StudyPlanProgress, pass:PlanPass, through?:string) { const key=pass==='first'?'firstPassCompletedAt':'secondPassCompletedAt'; return Object.values(progress.topics).filter((t)=>t[key] && (!through || t[key]!.slice(0,10)<=through)).length; }
export function buildSchedule(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase):ScheduleDay[] {
  const dates=dateRange(phase.startDate,phase.endDate); const key=phase.type==='first-pass'?'first':'second';
  const baseline=passCount(progress,key, new Date(atNoon(phase.startDate).getTime()-86400000).toISOString().slice(0,10));
  const remaining=Math.max(0,phase.target-baseline); const totalWeight=dates.reduce((s,d)=>s+dayWeight(config,d),0); let cumulativeWeight=0, prior=baseline;
  return dates.map((date)=>{ const weight=dayWeight(config,date); cumulativeWeight+=weight; const target=totalWeight ? baseline+Math.round(remaining*cumulativeWeight/totalWeight) : baseline; const result={date,weight,quota:target-prior,cumulativeTarget:target}; prior=target; return result; });
}
export function pacing(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase, today=dateKey()) {
  const pass:PlanPass=phase.type==='second-pass'?'second':'first'; const schedule=buildSchedule(config,progress,phase); const entry=schedule.find((d)=>d.date===today); const prior=schedule.filter((d)=>d.date<today).at(-1)?.cumulativeTarget ?? passCount(progress,pass,new Date(atNoon(phase.startDate).getTime()-86400000).toISOString().slice(0,10));
  const end=entry?.cumulativeTarget ?? (today<phase.startDate?prior:schedule.at(-1)?.cumulativeTarget ?? prior); const actual=passCount(progress,pass,today); const todayActual=Object.values(progress.topics).filter((t)=>(pass==='first'?t.firstPassCompletedAt:t.secondPassCompletedAt)?.slice(0,10)===today).length;
  const status=actual>end?'ahead':actual<prior?'behind':'on-track'; const difference=status==='ahead'?actual-end:status==='behind'?prior-actual:0;
  const futureWeight=schedule.filter((d)=>d.date>=today).reduce((s,d)=>s+d.weight,0); const remaining=Math.max(0,phase.target-actual);
  return {pass,schedule,actual,remaining,status,difference,todayQuota:entry?.quota??0,todayActual,todayRemaining:Math.max(0,(entry?.quota??0)-todayActual),requiredPace:futureWeight?remaining/futureWeight:0,plannedByToday:end,plannedBeforeToday:prior};
}
export function forecast(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase, today=dateKey()) {
  const pass:PlanPass=phase.type==='second-pass'?'second':'first', key=pass==='first'?'firstPassCompletedAt':'secondPassCompletedAt';
  const counts=new Map<string,number>(); Object.values(progress.topics).forEach((t)=>{const d=t[key]?.slice(0,10); if(d&&d<=today&&d>=phase.startDate) counts.set(d,(counts.get(d)??0)+1);});
  const recent=[...counts.entries()].sort().slice(-config.forecastWindowDays); if(recent.length<2) return null; const pace=recent.reduce((s,[,n])=>s+n,0)/recent.length; if(!pace) return null;
  let remaining=Math.max(0,phase.target-passCount(progress,pass,today)), cursor=atNoon(today); while(remaining>0&&cursor<atNoon(config.examDate)){cursor.setDate(cursor.getDate()+1); if(dayWeight(config,dateKey(cursor))>0) remaining-=pace*dayWeight(config,dateKey(cursor));}
  return {date:dateKey(cursor),pace};
}
export function shortReviewsDue(progress:StudyPlanProgress,today=dateKey()) { const now=atNoon(today).getTime(); return Object.entries(progress.topics).filter(([,t])=>{if(!t.firstPassCompletedAt)return false; const age=(now-atNoon(t.firstPassCompletedAt.slice(0,10)).getTime())/86400000; const last=t.shortReviewDates?.at(-1); return age>=2&&age<=4&&last!==today;}).map(([id])=>id); }
