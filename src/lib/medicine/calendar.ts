export type StudyTime={id:string;startedAt:string;endedAt:string};
export type CalendarBlock={id:string;start:number;end:number;count:number};
// Deliberately exports only generic learning time, never case content or scores.
export function calendarBlocks(sessions:StudyTime[]):CalendarBlock[]{
 const valid=sessions.map(s=>({id:s.id,start:Date.parse(s.startedAt),end:Date.parse(s.endedAt),count:1})).filter(s=>s.id&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
 const blocks:CalendarBlock[]=[];const seen=new Set<string>();
 for(const session of valid){if(seen.has(session.id))continue;seen.add(session.id);const previous=blocks.at(-1);if(previous&&session.start-previous.end<15*60000){previous.end=Math.max(previous.end,session.end);previous.count++;}else blocks.push({...session});}
 return blocks;
}
const escapeText=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[\r\n]+/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
export function foldCalendarLine(line:string){let result='',part='',size=0;const encoder=new TextEncoder();for(const c of line){const bytes=encoder.encode(c).length;if(size+bytes>75){result+=part+'\r\n';part=' ';size=1;}part+=c;size+=bytes;}return result+part;}
const stamp=(n:number)=>new Date(n).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function calendarFeed(sessions:StudyTime[],namespace:string){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Trackr//Clinical Learning//DE','CALSCALE:GREGORIAN','X-WR-CALNAME:Trackr · Lernzeiten','REFRESH-INTERVAL;VALUE=DURATION:PT15M','X-PUBLISHED-TTL:PT15M'];
 for(const b of calendarBlocks(sessions)){lines.push('BEGIN:VEVENT',`UID:${escapeText(namespace)}-${escapeText(b.id)}@trackr.learning`,`DTSTAMP:${stamp(b.end)}`,`LAST-MODIFIED:${stamp(b.end)}`,`DTSTART:${stamp(b.start)}`,`DTEND:${stamp(b.end)}`,'SUMMARY:Medizin · Lernsession',`DESCRIPTION:${b.count} Lernsession${b.count===1?'':'s'}. Zeitraum inklusive Pausen. Abstand unter 15 Minuten zusammengefasst.`,'CLASS:PRIVATE','TRANSP:TRANSPARENT','END:VEVENT');}
 lines.push('END:VCALENDAR');return lines.map(foldCalendarLine).join('\r\n')+'\r\n';
}
