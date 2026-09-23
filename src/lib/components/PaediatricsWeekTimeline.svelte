<script lang="ts">
  import { buildRecentStudyTimeline, type StudyTimelineEntry } from '$lib/paediatrics/studyTimeline';
  import type { SessionSnapshot } from '$lib/paediatrics/paediatricsSchema';
  import { formatStudyDurationCompact } from '$lib/paediatrics/studyTimer';

  export let sessions: SessionSnapshot[] = [];
  export let timeZone = 'Europe/Prague';

  function todayInTimeZone() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  const label = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00.000Z`));
  const top = (minute?: number) => `${Math.max(0, Math.min(1440, minute ?? 0)) / 14.4}%`;
  const height = (start?: number, end?: number) => `${Math.max(1.2, (Math.min(1440, end ?? 0) - Math.max(0, start ?? 0)) / 14.4)}%`;
  const sessionTitle = (entry: StudyTimelineEntry) => [entry.label, entry.clockLabel, `${formatStudyDurationCompact(entry.durationSeconds)} active`, entry.pauses.length ? `Breaks: ${entry.pauses.map((pause) => pause.clockLabel).join(', ')}` : entry.unlocatedPauseSeconds ? `${formatStudyDurationCompact(entry.unlocatedPauseSeconds)} paused; exact times unavailable` : 'No breaks'].join(' · ');

  $: today = todayInTimeZone();
  $: timeline = buildRecentStudyTimeline(sessions, today, timeZone);
</script>

<div class="timeline-summary"><strong>{formatStudyDurationCompact(timeline.totalSeconds)}</strong><span>active across the last 7 days</span><small>{label(timeline.startDate, { month: 'short', day: 'numeric' })}–{label(timeline.endDate, { month: 'short', day: 'numeric' })}</small></div>

<div class="week-plot" aria-label="Study sessions over the last seven days on a 24-hour vertical time axis">
  <div class="plot-corner"></div>
  <div class="day-heads">
    {#each timeline.days as day, index}
      <div class:today={index === 6}><b>{index === 6 ? 'Today' : label(day.date, { weekday: 'short' })}</b><span>{label(day.date, { day: 'numeric' })}</span><small>{day.totalSeconds ? formatStudyDurationCompact(day.totalSeconds) : '—'}</small></div>
    {/each}
  </div>
  <div class="time-axis">{#each [{ label: '00', position: 0 }, { label: '06', position: 25 }, { label: '12', position: 50 }, { label: '18', position: 75 }, { label: '24', position: 100 }] as tick}<span style={`top:${tick.position}%`}>{tick.label}</span>{/each}</div>
  <div class="day-tracks">
    {#each timeline.days as day, dayIndex}
      <div class="day-track" class:today={dayIndex === 6}>
        {#each day.timed.filter((entry) => entry.exactDayPlacement) as entry}
          <div class="study-block" class:anki={entry.source === 'anki'} class:legacy-pause={entry.unlocatedPauseSeconds > 0} style={`top:${top(entry.startMinute)};height:${height(entry.startMinute, entry.endMinute)}`} title={sessionTitle(entry)} aria-label={sessionTitle(entry)}>{#if (entry.endMinute ?? 0) - (entry.startMinute ?? 0) >= 75}<b>{entry.topicIds.join(', ')}</b>{/if}</div>
          {#each entry.pauses.filter((pause) => pause.exactDayPlacement) as pause}<div class="pause-block" style={`top:${top(pause.startMinute)};height:${height(pause.startMinute, pause.endMinute)}`} title={`Break ${pause.clockLabel}`}></div>{/each}
        {/each}
        {#if day.markers.length}<i class="log-marker" title={`${day.markers.length} session log(s) without timer`}>{day.markers.length}</i>{/if}
      </div>
    {/each}
  </div>
</div>

<div class="legend"><span><i></i>Trackr study</span><span><i class="anki"></i>Anki</span><span><i class="pause"></i>Break</span></div>

<style>
  .timeline-summary{display:flex;align-items:baseline;gap:8px;height:23px;margin-bottom:8px;color:#8e95a9;font-size:.61rem}.timeline-summary strong{color:#e7eaf2;font-size:.78rem}.timeline-summary small{margin-left:auto;color:#70798b}.week-plot{height:clamp(280px,32vw,370px);display:grid;grid-template-columns:27px minmax(0,1fr);grid-template-rows:38px minmax(0,1fr);min-width:0}.plot-corner{grid-column:1;grid-row:1}.day-heads{grid-column:2;grid-row:1;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.day-heads>div{min-width:0;text-align:center;color:#70798c}.day-heads b,.day-heads span,.day-heads small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.day-heads b{font-size:.52rem;text-transform:uppercase}.day-heads span{margin-top:1px;font-size:.54rem}.day-heads small{margin-top:2px;color:#929bad;font-size:.47rem}.day-heads .today b,.day-heads .today span{color:#cdd4ff}.time-axis{position:relative;grid-column:1;grid-row:2;color:#667084;font-size:.48rem}.time-axis span{position:absolute;right:5px;transform:translateY(-50%)}.time-axis span:first-child{transform:none}.time-axis span:last-child{transform:translateY(-100%)}.day-tracks{grid-column:2;grid-row:2;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;min-height:0}.day-track{position:relative;min-width:0;border:1px solid #282f3a;border-radius:6px;background:repeating-linear-gradient(to bottom,#151b23 0,#151b23 calc(25% - 1px),#29313d calc(25% - 1px),#29313d 25%);overflow:hidden}.day-track.today{border-color:#46506b;background:repeating-linear-gradient(to bottom,#181e2a 0,#181e2a calc(25% - 1px),#323b4c calc(25% - 1px),#323b4c 25%)}.study-block,.pause-block{position:absolute;left:13%;right:13%;z-index:1;min-height:3px;border-radius:3px;background:linear-gradient(180deg,#73cfad,#4c927b);box-shadow:0 0 8px rgba(99,195,160,.18);overflow:hidden}.study-block.anki{background:linear-gradient(180deg,#a397ff,#7166c7);box-shadow:0 0 8px rgba(145,130,240,.2)}.study-block.legacy-pause{box-shadow:inset 0 2px #d38865,0 0 8px rgba(99,195,160,.18)}.study-block b{display:block;padding:2px;color:#09120f;font-size:.43rem;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pause-block{z-index:2;min-height:3px;background:#d38865;box-shadow:0 0 0 1px rgba(13,16,21,.75)}.log-marker{position:absolute;right:2px;bottom:2px;z-index:3;display:grid;place-items:center;width:12px;height:12px;border-radius:50%;background:#343b49;color:#aeb5c4;font-size:.43rem;font-style:normal}.legend{display:flex;justify-content:flex-end;gap:11px;margin-top:8px;color:#747d90;font-size:.52rem}.legend span{display:flex;align-items:center;gap:4px}.legend i{width:8px;height:5px;border-radius:2px;background:#62b596}.legend i.anki{background:#8c80e7}.legend i.pause{background:#d38865}
  @media(max-width:600px){.timeline-summary span{display:none}.week-plot{height:310px}.day-heads b{font-size:.48rem}.day-heads small{display:none}.day-heads>div:not(.today) b{font-size:0}.day-heads>div:not(.today) b:first-letter{font-size:.5rem}.study-block,.pause-block{left:9%;right:9%}.legend{justify-content:flex-start}}
</style>
