<script lang="ts">
  import type { AnkiGapCardStats } from '$lib/study/ankiGapStats';

  export let stats: AnkiGapCardStats;
  export let lastValidatedAt = '';

  type Bucket = { key: string; label: string; count: number; percentage: number; knownPercentage: number };
  type MetricPanel = {
    id: 'retrievability' | 'difficulty' | 'stability';
    title: string;
    tooltip: string;
    headline: string;
    known: number;
    unknown: number;
    buckets: Bucket[];
  };

  const stateColors: Record<string, string> = {
    new: '#737b8d', learning: '#8c82f6', review: '#62c49f', relearning: '#eba65c', paused: '#555d6d',
    unseen: '#737b8d', fragile: '#eba65c', stable: '#62c49f', reopened: '#f06f81', missing: '#a25b68', unknown: '#343b49'
  };

  const metricColors: Record<MetricPanel['id'], string[]> = {
    retrievability: ['#f06f81', '#e8a35d', '#c4b769', '#75b990', '#52c7a0'],
    difficulty: ['#52c7a0', '#75b990', '#c4b769', '#e8a35d', '#f06f81'],
    stability: ['#f06f81', '#e8a35d', '#c4b769', '#75b990', '#52c7a0']
  };

  $: validatedLabel = formatValidatedAt(lastValidatedAt);
  $: fsrsPanels = [
    {
      id: 'retrievability',
      title: 'Recall probability',
      tooltip: 'Anki FSRS’s estimated probability that you can recall a reviewed card at the time Trackr last validated it.',
      headline: stats.retrievability.average === undefined ? '—' : `${Math.round(stats.retrievability.average * 100)}% avg`,
      known: stats.retrievability.known,
      unknown: stats.retrievability.unknown,
      buckets: stats.retrievability.buckets
    },
    {
      id: 'difficulty',
      title: 'Difficulty',
      tooltip: 'Anki FSRS’s estimate of how difficult it is to increase this card’s memory stability. Higher means harder; it is not recall probability.',
      headline: stats.difficulty.average === undefined ? '—' : `${Math.round(stats.difficulty.average * 100)}% avg`,
      known: stats.difficulty.known,
      unknown: stats.difficulty.unknown,
      buckets: stats.difficulty.buckets
    },
    {
      id: 'stability',
      title: 'Stability',
      tooltip: 'Estimated days for recall probability to fall from 100% to about 90%. This is not the current card interval.',
      headline: stats.stability.median === undefined ? '—' : `${formatDays(stats.stability.median)} median`,
      known: stats.stability.known,
      unknown: stats.stability.unknown,
      buckets: stats.stability.buckets
    }
  ] satisfies MetricPanel[];

  function formatValidatedAt(value: string) {
    if (!value) return 'Not validated yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Validation time unavailable' : `Last validated ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  }

  function formatDays(value: number) {
    if (value < 1) return `${Math.round(value * 24)}h`;
    return `${value < 10 ? value.toFixed(1).replace('.0', '') : Math.round(value)}d`;
  }

  function metricValue(metric: { count: number; unknown: number }) {
    return stats.total > 0 && metric.unknown === stats.total ? '—' : String(metric.count);
  }

  function metricHint(metric: { unknown: number }, fallback: string) {
    return metric.unknown ? `${metric.unknown} not measured` : fallback;
  }

  function unknownPercentage(unknown: number) {
    return stats.total ? unknown / stats.total * 100 : 0;
  }
</script>

<section class="anki-stats-panel" aria-labelledby="anki-stats-title">
  <header class="snapshot-head">
    <div>
      <p>ANKI SNAPSHOT</p>
      <h3 id="anki-stats-title">Memory and workload</h3>
    </div>
    <small class:stale={!lastValidatedAt}>{validatedLabel}. FSRS values are a snapshot and may change over time.</small>
  </header>

  {#if stats.total === 0}
    <div class="snapshot-empty">Send gap cards to Anki and validate progress to populate these statistics.</div>
  {:else}
    <div class="snapshot-kpis">
      <div><span>Linked cards</span><strong>{stats.total}</strong><small>One per Trackr gap</small></div>
      <div><span>Due now</span><strong>{metricValue(stats.scheduler.due)}</strong><small>{metricHint(stats.scheduler.due, 'Current Anki queue')}</small></div>
      <div><span>New</span><strong>{metricValue(stats.scheduler.newOrUnseen)}</strong><small>{metricHint(stats.scheduler.newOrUnseen, 'Never reviewed')}</small></div>
      <div><span>Reviewed</span><strong>{metricValue(stats.scheduler.reviewed)}</strong><small>{stats.scheduler.totalReviews} total answers</small></div>
      <div><span>Lapsed</span><strong>{metricValue(stats.scheduler.lapsed)}</strong><small>{stats.scheduler.totalLapses} lapse events</small></div>
    </div>

    <div class="snapshot-grid">
      <article class="distribution-card state-distributions">
        <div class="distribution-head">
          <div><span>Anki scheduler</span><strong>Card state</strong></div>
          <small>{stats.scheduler.state.known}/{stats.total} measured</small>
        </div>
        {#if stats.scheduler.state.known}
          <div class="stacked-bar" aria-label="Anki scheduler state distribution">
            {#each stats.scheduler.state.buckets as bucket}
              {#if bucket.count}<i title={`${bucket.label}: ${bucket.count}`} style={`width:${bucket.percentage}%;background:${stateColors[bucket.key]}`}></i>{/if}
            {/each}
            {#if stats.scheduler.state.unknown}<i title={`Not measured: ${stats.scheduler.state.unknown}`} style={`width:${unknownPercentage(stats.scheduler.state.unknown)}%;background:${stateColors.unknown}`}></i>{/if}
          </div>
          <div class="state-key">
            {#each stats.scheduler.state.buckets as bucket}
              {#if bucket.count}<span><i style={`background:${stateColors[bucket.key]}`}></i>{bucket.label}<b>{bucket.count}</b></span>{/if}
            {/each}
            {#if stats.scheduler.state.unknown}<span><i style={`background:${stateColors.unknown}`}></i>Not measured<b>{stats.scheduler.state.unknown}</b></span>{/if}
          </div>
        {:else}
          <div class="metric-empty">Validate once to read New, Learning, Review and Relearning from Anki.</div>
        {/if}

        <div class="evidence-block">
          <div class="distribution-head compact"><div><span>Trackr evidence</span><strong>Gap recall status</strong></div><small>{stats.status.known}/{stats.total} classified</small></div>
          {#if stats.status.known}
            <div class="stacked-bar slim" aria-label="Trackr gap recall status distribution">
              {#each stats.status.buckets as bucket}
                {#if bucket.count}<i title={`${bucket.label}: ${bucket.count}`} style={`width:${bucket.percentage}%;background:${stateColors[bucket.key]}`}></i>{/if}
              {/each}
              {#if stats.status.unknown}<i title={`Not classified: ${stats.status.unknown}`} style={`width:${unknownPercentage(stats.status.unknown)}%;background:${stateColors.unknown}`}></i>{/if}
            </div>
            <div class="state-key evidence-key">
              {#each stats.status.buckets as bucket}
                {#if bucket.count}<span><i style={`background:${stateColors[bucket.key]}`}></i>{bucket.label}<b>{bucket.count}</b></span>{/if}
              {/each}
              {#if stats.status.unknown}<span><i style={`background:${stateColors.unknown}`}></i>Not classified<b>{stats.status.unknown}</b></span>{/if}
            </div>
          {:else}<div class="metric-empty small">No Trackr recall classifications yet.</div>{/if}
        </div>
      </article>

      {#each fsrsPanels as panel}
        <article class="distribution-card">
          <div class="distribution-head">
            <div class="title-with-info"><span>FSRS ESTIMATE</span><strong>{panel.title}</strong><button type="button" title={panel.tooltip} aria-label={`About ${panel.title}`}>i</button></div>
            <div class="metric-summary"><b>{panel.headline}</b><small>{panel.known}/{stats.total} measured</small></div>
          </div>
          {#if panel.known}
            <div class="bucket-list">
              {#each panel.buckets as bucket, index}
                <div class="bucket-row">
                  <span>{bucket.label}</span>
                  <i><b style={`width:${bucket.knownPercentage}%;background:${metricColors[panel.id][index]}`}></b></i>
                  <strong>{bucket.count}</strong>
                </div>
              {/each}
            </div>
            {#if panel.unknown}<small class="unavailable">{panel.unknown} card{panel.unknown === 1 ? '' : 's'} unavailable or not reviewed yet</small>{/if}
          {:else}
            <div class="metric-empty">No FSRS values yet. They require FSRS, a reviewed card and a fresh validation.</div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .anki-stats-panel{grid-column:1/-1;min-width:0;margin-top:2px;padding:14px;border:1px solid #2d3543;border-radius:14px;background:rgba(13,17,24,.72)}
  .snapshot-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:11px}.snapshot-head p{margin:0 0 3px;color:#8e97aa;font-size:.57rem;font-weight:800;letter-spacing:.14em}.snapshot-head h3{margin:0;color:#f0f2f8;font-size:.92rem}.snapshot-head>small{max-width:560px;color:#7f889b;font-size:.58rem;text-align:right;line-height:1.4}.snapshot-head>small.stale{color:#d5a45f}
  .snapshot-empty,.metric-empty{display:grid;place-items:center;min-height:105px;padding:14px;border:1px dashed #303746;border-radius:10px;color:#7f889b;font-size:.64rem;text-align:center;line-height:1.45}.metric-empty.small{min-height:36px}.snapshot-empty{min-height:72px}
  .snapshot-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-bottom:8px}.snapshot-kpis>div{min-width:0;padding:8px 10px;border-radius:9px;background:#121720;border:1px solid #252d39}.snapshot-kpis span,.snapshot-kpis small{display:block;color:#818b9e;font-size:.55rem}.snapshot-kpis strong{display:block;margin:3px 0 1px;color:#f0f2f8;font-size:.94rem}.snapshot-kpis small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .snapshot-grid{display:grid;grid-template-columns:1.25fr repeat(3,minmax(0,1fr));gap:8px}.distribution-card{min-width:0;padding:11px;border-radius:11px;background:#121720;border:1px solid #272f3c}.distribution-head{display:flex;align-items:start;justify-content:space-between;gap:10px}.distribution-head span,.distribution-head small{display:block;color:#818b9d;font-size:.54rem}.distribution-head span{margin-bottom:3px;text-transform:uppercase;letter-spacing:.07em}.distribution-head strong{display:block;color:#e9ecf4;font-size:.72rem}.distribution-head>small{text-align:right}.distribution-head.compact{margin-top:10px}.metric-summary{text-align:right}.metric-summary b{display:block;color:#eef0f7;font-size:.76rem;white-space:nowrap}.metric-summary small{margin-top:2px}
  .title-with-info{position:relative;padding-right:19px}.title-with-info button{position:absolute;right:0;bottom:0;display:grid;place-items:center;width:15px;height:15px;padding:0;border:1px solid #465064;border-radius:50%;background:transparent;color:#929caf;font:700 .5rem/1 sans-serif;cursor:help}
  .stacked-bar{display:flex;width:100%;height:9px;margin:11px 0 8px;overflow:hidden;border-radius:999px;background:#252b36}.stacked-bar.slim{height:6px;margin:8px 0 7px}.stacked-bar i{display:block;height:100%;min-width:2px;border-right:1px solid rgba(10,13,18,.45)}.stacked-bar i:last-child{border-right:0}
  .state-key{display:flex;flex-wrap:wrap;gap:5px 9px}.state-key span{display:flex;align-items:center;gap:4px;color:#9099aa;font-size:.53rem}.state-key span>i{width:6px;height:6px;border-radius:50%}.state-key b{color:#d9dde7;font-size:.55rem}.evidence-block{margin-top:11px;padding-top:10px;border-top:1px solid #252d38}.evidence-key{gap:4px 7px}
  .bucket-list{display:grid;gap:6px;margin-top:12px}.bucket-row{display:grid;grid-template-columns:52px 1fr 22px;align-items:center;gap:6px}.bucket-row>span{color:#9099aa;font-size:.52rem;white-space:nowrap}.bucket-row>i{display:block;height:5px;overflow:hidden;border-radius:999px;background:#272e3a}.bucket-row>i b{display:block;height:100%;min-width:2px;border-radius:inherit}.bucket-row>strong{color:#dfe3ec;font-size:.57rem;text-align:right}.unavailable{display:block;margin-top:9px;color:#717b8e;font-size:.51rem;line-height:1.35}
  @media(max-width:1320px){.snapshot-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.state-distributions{grid-row:span 2}}
  @media(max-width:720px){.snapshot-head{align-items:start;flex-direction:column;gap:5px}.snapshot-head>small{text-align:left}.snapshot-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.snapshot-kpis>div:first-child{grid-column:1/-1}.snapshot-grid{grid-template-columns:1fr}.state-distributions{grid-row:auto}}
</style>
