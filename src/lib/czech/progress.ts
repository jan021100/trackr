import { mergeVocabulary, type VocabularyItem, type Patch, type Rating } from './study';
export type PracticeLog={id:string;createdAt:string;patch:Patch};
export function progressHistory(logs:PracticeLog[]){
 const ratings=new Map<string,Rating>();let vocabulary:VocabularyItem[]=[];const days=new Map<string,{date:string;average:number;assessed:number;words:number;phrases:number;recalled:number;practices:number}>();let practices=0;
 for(const log of [...logs].filter(l=>Number.isFinite(Date.parse(l.createdAt))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))){
  for(const a of log.patch.assessments??[])ratings.set(`${a.lessonId}:${a.skill}`,{score:a.score,evidence:a.evidence,at:log.createdAt});
  vocabulary=mergeVocabulary(vocabulary,log.patch.vocabulary??[],log.createdAt);practices++;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(log.createdAt));
  days.set(date,{date,average:ratings.size?[...ratings.values()].reduce((n,a)=>n+a.score,0)/ratings.size:0,assessed:ratings.size,words:vocabulary.filter(v=>v.kind==='word').length,phrases:vocabulary.filter(v=>v.kind==='phrase').length,recalled:vocabulary.filter(v=>v.status==='recalled').length,practices});
 }
 return [...days.values()];
}

export function recordedVocabulary(logs:PracticeLog[],legacy:VocabularyItem[]=[]){let words=structuredClone(legacy);for(const log of [...logs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)))words=mergeVocabulary(words,log.patch.vocabulary??[],log.createdAt);return words;}
