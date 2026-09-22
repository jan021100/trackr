import { PLAN_PASSES, passCoverageAt, passForPhase, PASS_DETAILS } from './studyPlanSchema';
import type { StudyPlanConfig, StudyPlanPhase, StudyPlanProgress, PlanPass } from './studyPlanSchema';

export const dateKey = (value: Date | string = new Date()) => typeof value === 'string' ? value.slice(0,10) : `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const atNoon = (key:string) => new Date(`${key}T12:00:00`);
export function dateRange(start:string,end:string) { const out:string[]=[]; for(let d=atNoon(start); d<=atNoon(end); d.setDate(d.getDate()+1)) out.push(dateKey(d)); return out; }
export const phaseForDate = (config:StudyPlanConfig,date:string) => config.phases.find((p) => date>=p.startDate && date<=p.endDate);
const dayBefore = (date:string) => dateKey(new Date(atNoon(date).getTime()-86400000));


/** Resolve the operational phase from completed work, while keeping configured dates as planning deadlines. */
export function phaseForProgress(config:StudyPlanConfig,progress:StudyPlanProgress,date:string) {
  if(date<config.planStartDate||(config.examDate&&date>=config.examDate))return undefined;
  for(const pass of PLAN_PASSES){
    const phase=config.phases.find(p=>p.type===PASS_DETAILS[pass].type);
    if(phase&&passCount(progress,pass)<phase.target)return phase;
  }
  return config.phases.find(p=>p.type==='buffer');
}
export const dayWeight = (config:StudyPlanConfig,date:string) => Math.max(0, config.dayOverrides.find((d)=>d.date===date)?.weight ?? 1);
export type ScheduleDay = { date:string; weight:number; quota:number; cumulativeTarget:number };
export function passCount(progress:StudyPlanProgress, pass:PlanPass, through?:string) { return Object.values(progress.topics).filter((t)=>{const coveredAt=passCoverageAt(t,pass);return coveredAt && (!through || coveredAt.slice(0,10)<=through);}).length; }
export function buildSchedule(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase):ScheduleDay[] {
  const dates=dateRange(phase.startDate,phase.endDate); const key=passForPhase(phase.type);
  const baseline=passCount(progress,key, new Date(atNoon(phase.startDate).getTime()-86400000).toISOString().slice(0,10));
  const remaining=Math.max(0,phase.target-baseline); const totalWeight=dates.reduce((s,d)=>s+dayWeight(config,d),0); let cumulativeWeight=0, prior=baseline;
  return dates.map((date)=>{ const weight=dayWeight(config,date); cumulativeWeight+=weight; const target=totalWeight ? baseline+Math.round(remaining*cumulativeWeight/totalWeight) : baseline; const result={date,weight,quota:target-prior,cumulativeTarget:target}; prior=target; return result; });
}
// When a round overruns, reserve a share of the remaining study days for later rounds.
function catchUpPhase(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase, today:string):StudyPlanPhase {
  const current=passForPhase(phase.type), weights={first:5,second:3,third:2};
  const pending=PLAN_PASSES.slice(PLAN_PASSES.indexOf(current)).map(pass=>{
    const configured=config.phases.find(p=>p.type===PASS_DETAILS[pass].type);
    return {pass,weight:configured?weights[pass]*Math.max(0,configured.target-passCount(progress,pass))/Math.max(1,configured.target):0};
  }).filter(item=>item.weight>0);
  const finalDay=dayBefore(config.examDate);
  const buffer=config.phases.find(p=>p.type==='buffer');
  const learningEnd=buffer?.startDate&&buffer.startDate>today?dayBefore(buffer.startDate):finalDay;
  const days=dateRange(today,learningEnd), total=pending.reduce((sum,item)=>sum+item.weight,0);
  const allotment=Math.max(1,Math.ceil(days.length*(pending.find(item=>item.pass===current)?.weight??0)/(total||1)));
  return {...phase,startDate:today,endDate:days[Math.min(days.length-1,allotment-1)]??finalDay};
}
export function pacing(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase, today=dateKey()) {
  const pass=passForPhase(phase.type);
  const actualNow=passCount(progress,pass,today);
  const overdue=today>phase.endDate&&actualNow<phase.target;
  const scheduledPhase=overdue?catchUpPhase(config,progress,phase,today):phase;
  const schedule=buildSchedule(config,progress,scheduledPhase); const entry=schedule.find((d)=>d.date===today); const prior=overdue?phase.target:schedule.filter((d)=>d.date<today).at(-1)?.cumulativeTarget ?? passCount(progress,pass,new Date(atNoon(scheduledPhase.startDate).getTime()-86400000).toISOString().slice(0,10));
  const end=entry?.cumulativeTarget ?? (today<phase.startDate?prior:schedule.at(-1)?.cumulativeTarget ?? prior); const actual=passCount(progress,pass,today); const todayActual=Object.values(progress.topics).filter((t)=>passCoverageAt(t,pass)?.slice(0,10)===today).length;
  const status=overdue?'behind':actual>end?'ahead':actual<prior?'behind':'on-track'; const difference=status==='ahead'?actual-end:status==='behind'?Math.max(0,prior-actual):0;
  const futureWeight=schedule.filter((d)=>d.date>=today).reduce((s,d)=>s+d.weight,0); const remaining=Math.max(0,phase.target-actual);
  const completedBeforeToday=passCount(progress,pass,dayBefore(today));
  // Rebase today's quota on the backlog present at the start of today. This
  // makes tomorrow's goal fall after an extra-productive day and rise after a
  // missed day, while preserving today's denominator as work is completed.
  const remainingAtStart=Math.max(0,phase.target-completedBeforeToday);
  const remainingDates=dateRange(today,scheduledPhase.endDate);
  const remainingWeight=remainingDates.reduce((sum,date)=>sum+dayWeight(config,date),0);
  const todayWeight=dayWeight(config,today);
  const todayQuota=remainingWeight>0?Math.round(remainingAtStart*todayWeight/remainingWeight):remainingAtStart;
  return {pass,schedule,actual,remaining,status,difference,todayQuota,todayActual,todayRemaining:Math.max(0,todayQuota-todayActual),requiredPace:futureWeight?remaining/futureWeight:0,plannedByToday:end,plannedBeforeToday:prior};
}
export function forecast(config:StudyPlanConfig, progress:StudyPlanProgress, phase:StudyPlanPhase, today=dateKey()) {
  const pass=passForPhase(phase.type);
  const counts=new Map<string,number>(); Object.values(progress.topics).forEach((t)=>{const d=passCoverageAt(t,pass)?.slice(0,10); if(d&&d<=today&&d>=phase.startDate) counts.set(d,(counts.get(d)??0)+1);});
  const recent=[...counts.entries()].sort().slice(-config.forecastWindowDays); if(recent.length<2) return null; const pace=recent.reduce((s,[,n])=>s+n,0)/recent.length; if(!pace) return null;
  let remaining=Math.max(0,phase.target-passCount(progress,pass,today)), cursor=atNoon(today), projectedActiveDays=0;
  // Do not clamp the forecast to the exam date. A clamped date falsely implied
  // completion on exam day even when the recent pace could not finish the work.
  // Keep walking the configured day pattern and expose an honest late forecast.
  for(let guard=0;remaining>0&&guard<730;guard+=1){
    cursor.setDate(cursor.getDate()+1);
    const weight=dayWeight(config,dateKey(cursor));
    if(weight>0){remaining-=pace*weight;projectedActiveDays+=weight;}
  }
  return {date:dateKey(cursor),pace,projectedActiveDays};
}
export function shortReviewsDue(progress:StudyPlanProgress,today=dateKey()) { const now=atNoon(today).getTime(); return Object.entries(progress.topics).filter(([,t])=>{const anchor=[t.firstPassCompletedAt,t.secondPassCompletedAt,t.thirdPassCompletedAt,...(t.shortReviewDates??[])].filter((d):d is string=>!!d).sort().at(-1); if(!anchor)return false; const age=(now-atNoon(anchor.slice(0,10)).getTime())/86400000; return age>=2;}).map(([id])=>id); }
