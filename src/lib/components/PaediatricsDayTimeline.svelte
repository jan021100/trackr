<script lang="ts">
  import { buildStudyDayTimeline } from '$lib/paediatrics/studyTimeline';
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

  let selectedDate = todayInTimeZone();
  $: today = todayInTimeZone();
  $: timeline = buildStudyDayTimeline(sessions, selectedDate, timeZone);

  function move(days: number) { selectedDate = shiftDateKey(selectedDate, days); }
  const left = (minute?: number) => `${Math.max(0, Math.min(1440, minute ?? 0)) / 14.4}%`;
  const width = (start?: number, end?: number) => `${Math.max(0.8, (Math.min(1440, end ?? 0) - Math.max(0, start ?? 0)) / 14.4)}%`;
</script>

<div class="day-toolbar">
  <div class="day-total"><strong>{formatStudyDurationCompact(timeline.totalSeconds)}</strong><span>active study</span><small>{timeline.timed.length} timed {timeline.timed.length === 1 ? 'block' : 'blocks'}{timeline.markers.length ? ` · ${timeline.markers.length} log ${timeline.markers.length === 1 ? 'marker' : 'markers'}` : ''}</small></div>
  <div class="date-controls"><button aria-label="Previous study day" on:click={() => move(-1)}>‹</button><input aria-label="Study day" type="date" bind:value={selectedDate} max={today} /><button aria-label="Next study day" disabled={selectedDate >= today} on:click={() => move(1)}>›</button>{#if selectedDate !== today}<button class="today" on:click={() => selectedDate = today}>Today</button>{/if}</div>
</div>

{#if timeline.timed.length}
  <div class="scale"><span></span><div>{#each ['00','06','12','18','24'] as hour}<b>{hour}</b>{/each}</div></div>
  <div class="timeline">
    {#each timeline.timed as entry}
      <article>
        <div class="time"><strong>{entry.clockLabel}</strong><span>{formatStudyDurationCompact(entry.durationSeconds)} active</span></div>
        <div class="session-copy"><b>{entry.label}</b><small>{entry.source === 'anki' ? (entry.origin === 'anki-connect' ? 'Anki review window' : 'Anki timer') : 'Trackr timer'}{entry.topicIds.length ? ` · ${entry.topicIds.join(', ')}` : ''}</small></div>
        {#if entry.exactDayPlacement}
          <div class="rail"><i class:anki={entry.source === 'anki'} style={`left:${left(entry.startMinute)};width:${width(entry.startMinute, entry.endMinute)}`} title={`${entry.clockLabel} · ${formatStudyDurationCompact(entry.durationSeconds)} active`}></i></div>
        {:else}
          <div class="cross-day">Time window crosses this study day's calendar boundary</div>
        {/if}
      </article>
    {/each}
  </div>
{:else if !timeline.markers.length}
  <div class="empty-day">No timed study recorded for this day.</div>
{/if}

{#if timeline.markers.length}
  <div class="markers">
    <small>Logged without timer</small>
    {#each timeline.markers as entry}<div><b>{entry.clockLabel}</b><span>{entry.label}</span>{#if entry.topicIds.length}<em>{entry.topicIds.join(', ')}</em>{/if}</div>{/each}
  </div>
{/if}

<p class="timeline-note">The bar shows the session window. “Active” is the timer total after pauses, so paused time is not counted as study.</p>

<style>
  .day-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:14px}.day-total strong,.day-total span,.day-total small{display:block}.day-total strong{font-size:1.5rem}.day-total span{margin-top:2px;color:#dfe3ee;font-size:.72rem}.day-total small{margin-top:3px;color:#7f889a;font-size:.62rem}.date-controls{display:flex;align-items:center;gap:6px}.date-controls button,.date-controls input{height:36px;box-sizing:border-box;border:1px solid #333a48;border-radius:9px;background:#151a22;color:#e9ecf3;font:inherit}.date-controls button{min-width:36px;padding:0 10px;cursor:pointer}.date-controls button:disabled{opacity:.35;cursor:not-allowed}.date-controls input{padding:0 9px;color-scheme:dark}.date-controls .today{font-size:.65rem;font-weight:750}.scale{display:grid;grid-template-columns:118px 1fr;gap:12px;margin-bottom:5px}.scale>div{display:flex;justify-content:space-between;color:#697285;font-size:.52rem}.scale b{font-weight:650}.timeline{display:grid;gap:8px}.timeline article{display:grid;grid-template-columns:106px minmax(180px,.75fr) minmax(220px,1.5fr);gap:12px;align-items:center;min-width:0;padding:10px;border:1px solid #2a303c;border-radius:11px;background:#131820}.time strong,.time span,.session-copy b,.session-copy small{display:block}.time strong{font-size:.65rem;white-space:nowrap}.time span{margin-top:3px;color:#d7a267;font-size:.57rem}.session-copy{min-width:0}.session-copy b,.session-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-copy b{font-size:.68rem}.session-copy small{margin-top:3px;color:#7f889a;font-size:.57rem}.rail{position:relative;height:22px;border:1px solid #2a313d;border-radius:7px;background:repeating-linear-gradient(90deg,#181e27 0,#181e27 calc(25% - 1px),#2b323e calc(25% - 1px),#2b323e 25%);overflow:hidden}.rail i{position:absolute;top:3px;bottom:3px;min-width:4px;border-radius:5px;background:linear-gradient(90deg,#62aa91,#77d0ad);box-shadow:0 0 12px rgba(99,195,160,.2)}.rail i.anki{background:linear-gradient(90deg,#7c70d6,#a193ff);box-shadow:0 0 12px rgba(145,130,240,.2)}.cross-day{padding:6px 8px;border:1px dashed #3b4351;border-radius:7px;color:#8992a4;font-size:.57rem}.markers{margin-top:12px;padding-top:10px;border-top:1px solid #292f3a}.markers>small{display:block;margin-bottom:5px;color:#747d90;font-size:.56rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.markers>div{display:grid;grid-template-columns:82px 1fr auto;gap:8px;padding:6px 0;color:#aeb5c4;font-size:.62rem}.markers b{color:#dce0e9}.markers em{color:#7f889a;font-style:normal}.empty-day{min-height:100px;display:grid;place-content:center;color:#747d90;font-size:.72rem}.timeline-note{margin:12px 0 0;color:#747d90;font-size:.6rem;line-height:1.45}
  @media(max-width:700px){.day-toolbar{align-items:flex-start}.date-controls{flex-wrap:wrap;justify-content:flex-end}.scale{grid-template-columns:1fr}.scale>span{display:none}.timeline article{grid-template-columns:1fr}.session-copy{grid-row:2}.rail,.cross-day{grid-row:3}.markers>div{grid-template-columns:72px 1fr}.markers em{display:none}}
  @media(max-width:430px){.day-toolbar{display:block}.date-controls{justify-content:flex-start;margin-top:12px}.date-controls input{flex:1}.scale{margin-top:16px}}
</style>
