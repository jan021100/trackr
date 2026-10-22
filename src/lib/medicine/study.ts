import {SPECIALTIES,DOMAINS,type Domain} from './catalogue';
export type Assessment={specialtyId:string;ratings:Partial<Record<Domain,number>>;safetyCriticalError:boolean;evidence:string};
export type Source={kind:'guideline'|'uploaded';title:string;locator:string;url?:string;access:'opened'|'unavailable';checkedAt:string;supports:string};
export type Gap={id:string;specialtyId:string;prompt:string;answer:string;priority:'critical'|'important'|'normal';createdAt:string;resolvedAt?:string;lastTestedAt?:string};
export type Timer={specialtyId:string;startedAt:string;runningSince?:string;seconds:number;status:'running'|'paused';request:Request};
export type Summary={cases:number;lastAt:string;scores:number[];lastRatings:Assessment['ratings']};
export type State={version:1;caseCount:number;studySeconds:number;specialties:Record<string,Summary>;scenarios:Record<string,number>;timer?:Timer;lastCaseId?:string};
export type Request={id:string;specialtyId:string;scenarioIndex:number;setting:'primary-care'|'acute'|'mixed'};
export type Patch={kind:'trackr-medicine-patch';schemaVersion:1;id:string;specialtyId:string;scenarioIndex:number;caseTitle:string;caseSummary:string;assessments:Assessment[];addGaps:Array<Pick<Gap,'specialtyId'|'prompt'|'answer'|'priority'>>;gapResults:Array<{gapId:string;outcome:'resolved'|'unchanged'}>;sources:Source[]};
export type CaseLog={id:string;createdAt:string;patch:Patch};
export const emptyState=():State=>({version:1,caseCount:0,studySeconds:0,specialties:{},scenarios:{}});
export const isSpecialty=(id:unknown)=>typeof id==='string'&&SPECIALTIES.some(s=>s.id===id);
const text=(v:unknown,n:number)=>typeof v==='string'&&!!v.trim()&&v.length<=n;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:object,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const https=(url:unknown)=>{try{return typeof url==='string'&&new URL(url).protocol==='https:';}catch{return false;}};
export function assessmentScore(a:Assessment):number|undefined{
 if(!DOMAINS.every(d=>Number.isInteger(a.ratings[d])))return undefined;
 const values=DOMAINS.map(d=>a.ratings[d]!);let cap=20;
 if(a.safetyCriticalError||values.includes(0)||a.ratings.safety!<=1)cap=7;else if(values.includes(1))cap=11;else if(values.includes(2))cap=15;
 return Math.min(cap,values.reduce((n,v)=>n+v,0));
}
export function validatePatch(input:unknown):Patch{
 if(!object(input))throw new Error('Bitte einen Medizin-Patch einfügen.');const p=input as unknown as Patch;
 if(!keys(p,['kind','schemaVersion','id','specialtyId','scenarioIndex','caseTitle','caseSummary','assessments','addGaps','gapResults','sources'])||p.kind!=='trackr-medicine-patch'||p.schemaVersion!==1||!text(p.id,100)||!/^[-\w]+$/.test(p.id)||!isSpecialty(p.specialtyId)||!Number.isInteger(p.scenarioIndex)||p.scenarioIndex<0||p.scenarioIndex>2||!text(p.caseTitle,180)||!text(p.caseSummary,1400))throw new Error('Ungültiger Medizin-Fall: Fach, Falltitel, Zusammenfassung oder ID prüfen.');
 if(!Array.isArray(p.assessments)||p.assessments.length>4||!Array.isArray(p.addGaps)||p.addGaps.length>40||!Array.isArray(p.gapResults)||p.gapResults.length>60||!Array.isArray(p.sources)||p.sources.length>20)throw new Error('Bewertungen, Lücken, Lückentests und Quellen müssen gültige Listen sein.');
 const checkedGuideline=p.sources.some(s=>s?.kind==='guideline'&&s.access==='opened');
 if(p.addGaps.length&&!p.sources.some(s=>s?.access==='opened'))throw new Error('Lückenantworten erst nach tatsächlichem Quellenzugriff speichern.');
 const seen=new Set<string>();
 for(const a of p.assessments){if(!object(a)||!keys(a,['specialtyId','ratings','safetyCriticalError','evidence'])||!isSpecialty(a.specialtyId)||seen.has(a.specialtyId)||typeof a.safetyCriticalError!=='boolean'||!text(a.evidence,1200)||!object(a.ratings)||!Object.keys(a.ratings).length||!keys(a.ratings,[...DOMAINS])||Object.values(a.ratings).some(v=>!Number.isInteger(v)||Number(v)<0||Number(v)>4))throw new Error('Nur tatsächlich geprüfte Bereiche mit 0–4 und konkreter Evidenz bewerten.');if(!checkedGuideline&&(a.ratings.management!==undefined||a.ratings.safety!==undefined))throw new Error('Behandlung und Sicherheit nur mit einer vom Tutor geöffneten aktuellen Leitlinienquelle bewerten; sonst diese Bereiche auslassen.');seen.add(a.specialtyId);}
 for(const g of p.addGaps)if(!object(g)||!keys(g,['specialtyId','prompt','answer','priority'])||!isSpecialty(g.specialtyId)||!text(g.prompt,500)||!text(g.answer,1000)||!['critical','important','normal'].includes(g.priority))throw new Error('Jede Lücke braucht ein Fach, eine präzise Frage, eine belegte Antwort und Priorität.');
 const gapIds=new Set<string>();for(const r of p.gapResults){if(!object(r)||!keys(r,['gapId','outcome'])||(!text(r.gapId,180)||!/^[-\w]+$/.test(r.gapId))||!['resolved','unchanged'].includes(r.outcome)||gapIds.has(r.gapId))throw new Error('Lückentests brauchen eindeutige vorhandene IDs.');gapIds.add(r.gapId);}
 for(const s of p.sources)if(!object(s)||!keys(s,['kind','title','locator','url','access','checkedAt','supports'])||!['guideline','uploaded'].includes(s.kind)||!text(s.title,250)||!text(s.locator,400)||!text(s.supports,600)||!['opened','unavailable'].includes(s.access)||!/^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt)||!Number.isFinite(Date.parse(s.checkedAt))||(s.url!==undefined&&(!text(s.url,2000)||!https(s.url)))||(s.kind==='guideline'&&!https(s.url)))throw new Error('Quellen brauchen Titel, genaue Fundstelle, Zugriffsstatus und Datum; Leitlinien außerdem eine HTTPS-Adresse.');
 return structuredClone(p);
}
export function applyPatch(state:State,input:Patch,now:string):State{
 const p=validatePatch(input),next=structuredClone(state);next.caseCount++;next.lastCaseId=p.id;
 next.scenarios[`${p.specialtyId}:${p.scenarioIndex}`]=(next.scenarios[`${p.specialtyId}:${p.scenarioIndex}`]??0)+1;
 for(const a of p.assessments){const old=next.specialties[a.specialtyId],score=assessmentScore(a);next.specialties[a.specialtyId]={cases:(old?.cases??0)+1,lastAt:now,scores:[...(old?.scores??[]),...(score===undefined?[]:[score])].slice(-5),lastRatings:a.ratings};}
 return next;
}
export function specialtyScore(state:State,id:string){const values=state.specialties[id]?.scores??[];return values.length?values.reduce((n,v)=>n+v,0)/values.length:undefined;}
export function rankSpecialties(state:State,gaps:Gap[],now=Date.now(),mode:'balanced'|'weakness'='balanced'){
 return SPECIALTIES.map(s=>{const summary=state.specialties[s.id],score=specialtyScore(state,s.id),age=summary?Math.max(0,(now-Date.parse(summary.lastAt))/86400000):0;const critical=gaps.filter(g=>g.specialtyId===s.id&&!g.resolvedAt&&g.priority==='critical'&&now-Date.parse(g.lastTestedAt??g.createdAt)>=12*3600000).length;const attempts=[0,1,2].reduce((n,i)=>n+(state.scenarios[`${s.id}:${i}`]??0),0);return {...s,priority:(score===undefined?(mode==='balanced'?10000:100): (20-score)*4)+age+critical*(mode==='balanced'?20:200)-(score===undefined?Math.min(mode==='balanced'?1000:50,attempts*10):0)};}).sort((a,b)=>b.priority-a.priority);
}
export function caseRequest(state:State,specialtyId:string,setting:Request['setting'],id:string):Request{if(!isSpecialty(specialtyId))throw new Error('Unbekanntes Fach.');const scenarioIndex=[0,1,2].sort((a,b)=>(state.scenarios[`${specialtyId}:${a}`]??0)-(state.scenarios[`${specialtyId}:${b}`]??0))[0];return {id,specialtyId,setting,scenarioIndex};}
export function elapsed(timer:Timer,now=Date.now()){return timer.seconds+(timer.status==='running'?Math.max(0,Math.floor((now-Date.parse(timer.runningSince!))/1000)):0);}
export function pause(timer:Timer,now:number):Timer{return timer.status==='paused'?timer:{specialtyId:timer.specialtyId,startedAt:timer.startedAt,seconds:elapsed(timer,now),status:'paused',request:timer.request};}
export function resume(timer:Timer,now:number):Timer{return timer.status==='running'?timer:{...timer,status:'running',runningSince:new Date(now).toISOString()};}
export function makePrompt(state:State,gaps:Gap[],request:Request){
 const s=SPECIALTIES.find(s=>s.id===request.specialtyId)!;const selected=gaps.filter(g=>g.specialtyId===s.id&&!g.resolvedAt).sort((a,b)=>({critical:0,important:1,normal:2}[a.priority]-{critical:0,important:1,normal:2}[b.priority])).slice(0,5);
 return `KLINISCHE FALLSIMULATION | Deutschsprachiger Arzt, 1. LF Prag (englisch). Langfristige klinische Breite, kein Examen; 15–20min. Alle klinischen Fächer, keine separaten Public-Health/Hygiene/Epidemiologie-Blöcke. Zugängliche Uni-Unterlagen tatsächlich lesen: Internal Notes.pdf, Innere Notes 1.pdf, Surgery notes.pdf, Surgery_state_iBook.pdf, Gyn Notes+Cards.pdf, Gyn Textbook.pdf, Paeds_iBook.pdf, Pädiatrie Notes.pdf sowie vorhandene weitere Klinikquellen. Nicht verfügbare Dateien/Auszüge anfordern; niemals Lesezugriff erfinden.
QUELLEN: Aktuelle offizielle Leitlinie passend zur Region tatsächlich öffnen (AWMF/DEGAM/NICE/Fachgesellschaft); Gültigkeit/Version, Datum, konkreten Abschnitt und direkten Link dokumentieren. DE/CZ/UK-Unterschiede benennen. Alte Prüfungsnotizen ersetzen keine Therapieleitlinie. Dosis, Grenzwert, Akutalgorithmus und entscheidende Therapie vor Verwendung prüfen. Ohne Zugriff pausieren, Unsicherheit nennen, Auszug/Browserzugriff erbitten: nicht aus Gedächtnis auffüllen! Keine erfundenen Quellen/Fakten. Trackr speichert Tutor-Angaben, prüft Quellen nicht unabhängig.
FALL: Fiktiv, konsistente Physiologie/Chronologie, keine identifizierbaren Patientendaten. Nur kurze Vorstellung, keine Diagnose/Lösung/Lücken vorab. Patient/Team liefert auf meine Fragen und angeforderten Untersuchungen schrittweise Befunde mit Alter/Einheiten. Generierte Werte als fiktiv kennzeichnen, nicht als Leitlinien-Grenzen ausgeben. Echte Bilder/ECG bereitstellen oder fiktiven Textbefund kennzeichnen; ohne Bild keine visuelle Befundungskompetenz bewerten. Neutral nach Begründung, gefährlichen Alternativen, Prioritäten, Disposition, Verlauf/Safety-Net fragen. Relevante Propädeutik praktisch prüfen. Keine Antworten andeuten, Multiple Choice, unnötigen Tests oder auswendig gelernten Vollständigkeitslisten. Bei gefährlichem Handeln unterbrechen und quellenbasiert korrigieren.
BEWERTUNG nur unabhängig VOR Hilfe/Korrektur; neutrale Nachfragen zählen, Anfangsauslassung allein ist keine Lücke. Nur tatsächlich geprüfte Fachanteile bewerten. Domänen je 0–4: historyExam,differential,investigations,management,safety. 0 falsch/fehlend trotz fairer Chance;1 erhebliche Hilfe;2 unvollständig;3 selbstständig/kleine Lücken;4 belastbar für diesen Fall. Ungeprüft AUSLASSEN, keine Default-Null. management/safety ohne geöffnete aktuelle Leitlinienquelle AUSLASSEN. evidence trennt eigenständige Leistung und Teaching, benennt Stichprobe/Ungeprüftes. safetyCriticalError nur tatsächlicher Sicherheitsfehler. Trackr /20 nur bei allen fünf geprüften Domänen; separate Caps: unsicher/irgendeine0/Safety≤1→7; irgendeine1→11; irgendeine2→15. Keine künstlich gesenkten Domänen, keine Fachbeherrschung aus einem Fall ableiten.
LÜCKEN: addGaps {specialtyId,prompt,answer,priority}: atomare fehlende Entscheidung/Interpretation/Unterscheidung, belegte Antwort; critical=Sicherheit,important=klinischer Kern,normal=Detail. Keine Duplikate/automatischen Karten. Vorhandene IDs nur nach späterem unabhängigem Abruf vor Hilfe resolved, sonst unchanged; Ungetestete auslassen. Sofortiges Nachsprechen löst nichts. Wenige gezielte Nachfragen, minimale Korrektur, Transfer, Take-home-Punkte.
ENDE: Debrief + geprüfte Quellen/Fundstellen + EIN rohes JSON ohne Codeblock. Nur wirklich gespielten Fall, keine Pass-Abschlüsse, keine erfundene Dauer (Timer separat). Quellen access=opened nur gelesen; unavailable ehrlich. Fehlende Quellen → Teilbewertung. ID/Szenario exakt übernehmen; Beispielwerte ersetzen, ungeprüfte Domänen weglassen.
${JSON.stringify({kind:'trackr-medicine-patch',schemaVersion:1,id:request.id,specialtyId:s.id,scenarioIndex:request.scenarioIndex,caseTitle:'Tatsächlich gespielter Fall',caseSummary:'Fall, unabhängige Entscheidungen, Teaching und verbleibende Unsicherheit',assessments:[{specialtyId:s.id,ratings:{historyExam:0,differential:0,investigations:0},safetyCriticalError:false,evidence:'Beispielwerte ersetzen, ungeprüfte Bereiche auslassen'}],addGaps:[],gapResults:[],sources:[]})}
Quellenobjekt: {kind:"guideline"|"uploaded",title,locator,url?(für guideline Pflicht, HTTPS),access:"opened"|"unavailable",checkedAt:"YYYY-MM-DD",supports:"Welche konkrete Aussage wird gestützt"}.
PRIVATE PLAN: ${s.title}; Startanlass ${s.presentations[request.scenarioIndex]}; Setting ${request.setting}. Alter/Lebensphase/Schwere/Komorbidität sinnvoll variieren. Jüngste Beobachtung: ${JSON.stringify(state.specialties[s.id]??{})}. PRIVATE LÜCKEN (nicht vor dem Abruf offenlegen): ${JSON.stringify(selected.map(g=>({id:g.id,prompt:g.prompt,answer:g.answer,priority:g.priority,createdAt:g.createdAt,lastTestedAt:g.lastTestedAt})))}
Starte mit kurzer fiktiver Patientenvorstellung ohne Diagnose/Lösung; Quellen vor quellenabhängigen Entscheidungen prüfen.`;
}

export function updateGaps(existing:Gap[],p:Patch,now:string):Gap[]{
 const result=structuredClone(existing);
 const priority={critical:0,important:1,normal:2};
 for(const [i,g] of p.addGaps.entries()){
  const found=result.find(old=>!old.resolvedAt&&old.specialtyId===g.specialtyId&&old.prompt.trim().toLowerCase()===g.prompt.trim().toLowerCase());
  if(found){found.answer=g.answer;if(priority[g.priority]<priority[found.priority])found.priority=g.priority;}
  else result.push({...g,id:`${p.id}-${i}`,createdAt:now});
 }
 for(const r of p.gapResults){const g=result.find(g=>g.id===r.gapId);if(!g||g.createdAt===now)throw new Error('Nur vorhandene, später unabhängig getestete Lücken aktualisieren.');g.lastTestedAt=now;if(r.outcome==='resolved')g.resolvedAt??=now;}
 return result;
}
