<script lang="ts">
  import { buildStudyWeekTimeline, weekStartFor } from '$lib/paediatrics/studyTimeline';
  import type { SessionSnapshot } from '$lib/paediatrics/paediatricsSchema';
  import { shiftDateKey } from '$lib/paediatrics/ankiStudyTime';
  import { formatStudyDurationCompact } from '$lib/paediatrics/studyTimer';

  export let sessions: SessionSnapshot[] = [];
  export let timeZone = 'Europe/Prague';

  function todayInTimeZone() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  const label = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00.000Z`));
  const dayLabel = (date: string) => label(date, { weekday: 'short', month: 'short', day: 'numeric' });
  const weekLabel = (start: string, end: string) => `${label(start, { month: 'short', day: 'numeric' })}–${label(end, { month: 'short', day: 'numeric' })}`;
  const left = (minute?: number) => `${Math.max(0, Math.min(1440, minute ?? 0)) / 14.4}%`;
  const width = (start?: number, end?: number) => `${Math.max(0.8, (Math.min(1440, end ?? 0) - Math.max(0, start ?? 0)) / 14.4)}%`;

  let selectedWeek = weekStartFor(todayInTimeZone());
  $: today = todayInTimeZone();
  $: currentWeek = weekStartFor(today);
  $: week = buildStudyWeekTimeline(sessions, selectedWeek, timeZone);

  function move(weeks: number) { selectedWeek = shiftDateKey(selectedWeek, weeks * 7); }
  function chooseWeek() { selectedWeek = weekStartFor(selectedWeek); }
</script>

<div class="week-toolbar">
  <div class="week-total"><strong>{formatStudyDurationCompact(week.totalSeconds)}</strong><span>active this week</span><small>{week.timedBlocks} timed {week.timedBlocks === 1 ? 'session' : 'sessions'}{week.markers ? ` · ${week.markers} logs` : ''}</small></div>
  <div class="week-controls"><button aria-label="Previous study week" on:click={() => move(-1)}>‹</button><input aria-label="Study week" type="date" bind:value={selectedWeek} max={today} on:change={chooseWeek} /><button aria-label="Next study week" disabled={selectedWeek >= currentWeek} on:click={() => move(1)}>›</button></div>
</div>
<div class="week-range"><b>{weekLabel(week.startDate, week.endDate)}</b>{#if selectedWeek !== currentWeek}<button on:click={() => selectedWeek = currentWeek}>This week</button>{/if}</div>

<div class="week-days">
  {#each week.days as day}
    <article class:studied={day.timed.length > 0}>
      <header><b>{dayLabel(day.date)}</b><span>{day.totalSeconds ? formatStudyDurationCompact(day.totalSeconds) : '—'}</span></header>
      {#if day.timed.length}
        <div class="day-sessions">
          {#each day.timed as entry}
            <div class="session">
              <div class="session-head"><strong>{entry.topicIds.length ? entry.topicIds.join(', ') : entry.label}</strong><span>{entry.clockLabel}</span></div>
              <div class="session-meta"><span>{formatStudyDurationCompact(entry.durationSeconds)} active</span>{#if entry.totalPauseSeconds}<span class="paused">{formatStudyDurationCompact(entry.totalPauseSeconds)} paused</span>{/if}<small>{entry.source === 'anki' ? 'Anki' : 'Trackr'}</small></div>
              {#if entry.exactDayPlacement}
                <div class="rail" title={`${entry.clockLabel} · ${formatStudyDurationCompact(entry.durationSeconds)} active`}><i class:anki={entry.source === 'anki'} style={`left:${left(entry.startMinute)};width:${width(entry.startMinute, entry.endMinute)}`}></i>{#each entry.pauses.filter((pause) => pause.exactDayPlacement) as pause}<span class="pause-bar" style={`left:${left(pause.startMinute)};width:${width(pause.startMinute, pause.endMinute)}`} title={`Break ${pause.clockLabel}`}></span>{/each}</div>
              {/if}
              {#if entry.pauses.length}<div class="break-list">{#each entry.pauses as pause}<em>Break {pause.clockLabel}</em>{/each}</div>{:else if entry.unlocatedPauseSeconds}<div class="legacy-break">{formatStudyDurationCompact(entry.unlocatedPauseSeconds)} paused · exact break times were not stored</div>{/if}
            </div>
          {/each}
        </div>
      {:else if day.markers.length}
        <div class="log-only">{day.markers.map((entry) => entry.topicIds.join(', ') || entry.label).join(' · ')} <small>logged without timer</small></div>
      {/if}
    </article>
  {/each}
</div>

<p class="timeline-note"><i></i> Session window <i class="break-key"></i> recorded break. Start, end and every new pause interval are saved per session; active time excludes all pauses.</p>

<style>
  .week-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.week-total strong,.week-total span,.week-total small{display:block}.week-total strong{font-size:1.35rem}.week-total span{margin-top:1px;color:#dfe3ee;font-size:.68rem}.week-total small{margin-top:3px;color:#7f889a;font-size:.57rem}.week-controls{display:flex;align-items:center;gap:5px}.week-controls button,.week-controls input{height:32px;box-sizing:border-box;border:1px solid #333a48;border-radius:8px;background:#151a22;color:#e9ecf3;font:inherit}.week-controls button{min-width:32px;padding:0 8px;cursor:pointer}.week-controls button:disabled{opacity:.35;cursor:not-allowed}.week-controls input{width:125px;padding:0 7px;color-scheme:dark;font-size:.62rem}.week-range{display:flex;align-items:center;justify-content:space-between;margin:11px 0 8px;color:#858ea0;font-size:.59rem}.week-range button{border:0;background:transparent;color:#8f9cff;font:inherit;font-weight:750;cursor:pointer}.week-days{display:grid;gap:5px}.week-days>article{padding:7px 8px;border:1px solid #282e39;border-radius:9px;background:#12171f}.week-days>article.studied{border-color:#303846;background:#141a23}.week-days header{display:flex;align-items:center;justify-content:space-between;color:#717a8c;font-size:.58rem}.week-days article.studied header b{color:#dfe3ec}.week-days header span{font-weight:750}.day-sessions{display:grid;gap:6px;margin-top:6px}.session{padding-top:6px;border-top:1px solid #272e39}.session-head,.session-meta{display:flex;align-items:center;justify-content:space-between;gap:8px}.session-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.64rem}.session-head span{flex:none;color:#aeb5c4;font-size:.57rem}.session-meta{justify-content:flex-start;margin-top:3px;color:#d5a064;font-size:.53rem}.session-meta .paused{color:#c38e75}.session-meta small{margin-left:auto;color:#737d90}.rail{position:relative;height:11px;margin-top:5px;border-radius:4px;background:repeating-linear-gradient(90deg,#1a2029 0,#1a2029 calc(25% - 1px),#2b323e calc(25% - 1px),#2b323e 25%);overflow:hidden}.rail i{position:absolute;top:2px;bottom:2px;min-width:3px;border-radius:3px;background:#68bd9e}.rail i.anki{background:#9284ee}.pause-bar{position:absolute;top:1px;bottom:1px;z-index:2;min-width:3px;border-radius:2px;background:#d38865;box-shadow:0 0 0 1px rgba(15,18,24,.7)}.break-list{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px}.break-list em,.legacy-break{padding:2px 5px;border-radius:4px;background:#2d2422;color:#d6a08a;font-size:.5rem;font-style:normal}.legacy-break{display:inline-block;margin-top:5px;background:#24252a;color:#858d9c}.log-only{margin-top:5px;color:#aab1bf;font-size:.56rem}.log-only small{color:#747d8e}.timeline-note{margin:10px 0 0;color:#747d90;font-size:.54rem;line-height:1.4}.timeline-note i{display:inline-block;width:9px;height:5px;margin:0 3px;border-radius:2px;background:#68bd9e}.timeline-note i.break-key{background:#d38865}
  @media(max-width:900px){.week-toolbar{align-items:flex-start}.week-controls{flex-wrap:wrap;justify-content:flex-end}.week-days>article{padding:8px 9px}}
  @media(max-width:430px){.week-toolbar{display:block}.week-controls{justify-content:flex-start;margin-top:10px}.week-controls input{flex:1}.session-head{align-items:flex-start}.session-head span{font-size:.54rem}}
</style>
