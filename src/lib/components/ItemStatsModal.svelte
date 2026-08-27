<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { db } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import { doc, updateDoc } from 'firebase/firestore';
  import { analyzeItemStats } from '$lib/utils/itemStatsEngine';

  export let item: any;

  const dispatch = createEventDispatcher();

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let showAdvanced = false;
  let savingAdvanced = false;
  let advancedMessage = '';

  let advanced = {
    ratingOverall: '',
    ratingPerformance: '',
    ratingQuality: '',
    ratingComfort: '',
    ratingStyle: '',
    wouldBuyAgain: '',
    sentimentalValue: false,
    expectedUse: 'auto',
    evaluationMode: 'auto',
    valueOverrideNote: '',
    durabilityNote: '',
    personalNote: ''
  };

  $: if (item) {
    advanced = {
      ratingOverall: item.ratingOverall ?? '',
      ratingPerformance: item.ratingPerformance ?? '',
      ratingQuality: item.ratingQuality ?? '',
      ratingComfort: item.ratingComfort ?? '',
      ratingStyle: item.ratingStyle ?? '',
      wouldBuyAgain:
        item.wouldBuyAgain === true ? 'yes' :
        item.wouldBuyAgain === false ? 'no' : '',
      sentimentalValue: item.sentimentalValue === true,
      expectedUse: item.expectedUse ?? 'auto',
      evaluationMode: item.evaluationMode ?? 'auto',
      valueOverrideNote: item.valueOverrideNote ?? '',
      durabilityNote: item.durabilityNote ?? '',
      personalNote: item.personalNote ?? ''
    };
  }

  function close() {
    dispatch('close');
  }

  function parseDate(value: any): Date | null {
    if (!value) return null;

    if (typeof value === 'string') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    if (value?.seconds) return new Date(value.seconds * 1000);

    return null;
  }

  function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatDate(value: any) {
    const d = parseDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('de-DE');
  }

  function money(v: number | null | undefined) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return `${v.toFixed(2)} €`;
  }

  function toNumberOrNull(v: any) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function getWearDates(item: any): Date[] {
    const log: unknown[] = Array.isArray(item?.wearLog) ? item.wearLog : [];

    return log
      .map(parseDate)
      .filter((d: Date | null): d is Date => Boolean(d))
      .sort((a: Date, b: Date) => a.getTime() - b.getTime());
  }

  async function saveAdvancedContext() {
    const uid = $user?.uid;
    if (!uid || !item?.id) return;

    savingAdvanced = true;
    advancedMessage = '';

    const payload = {
      ratingOverall: toNumberOrNull(advanced.ratingOverall),
      ratingPerformance: toNumberOrNull(advanced.ratingPerformance),
      ratingQuality: toNumberOrNull(advanced.ratingQuality),
      ratingComfort: toNumberOrNull(advanced.ratingComfort),
      ratingStyle: toNumberOrNull(advanced.ratingStyle),
      wouldBuyAgain:
        advanced.wouldBuyAgain === 'yes' ? true :
        advanced.wouldBuyAgain === 'no' ? false : null,
      sentimentalValue: advanced.sentimentalValue,
      expectedUse: advanced.expectedUse,
      evaluationMode: advanced.evaluationMode,
      valueOverrideNote: advanced.valueOverrideNote.trim(),
      durabilityNote: advanced.durabilityNote.trim(),
      personalNote: advanced.personalNote.trim()
    };

    await updateDoc(doc(db, 'users', uid, 'items', item.id), payload);

    item = {
      ...item,
      ...payload
    };

    dispatch('updated', item);

    advancedMessage = 'Advanced context saved.';
    savingAdvanced = false;
  }

  $: analysis = analyzeItemStats(item);

  $: wearDates = getWearDates(item);

  $: monthCounts = (() => {
    const counts = Array(12).fill(0);

    for (const d of wearDates) {
      counts[d.getMonth()] += 1;
    }

    return counts;
  })();

  $: maxMonthCount = Math.max(1, ...monthCounts);

  $: bestMonthIndex = monthCounts.indexOf(Math.max(...monthCounts));
  $: bestMonth = monthCounts[bestMonthIndex] > 0 ? monthLabels[bestMonthIndex] : '—';

  function buildTimeline() {
    const startKey =
      analysis.metrics.purchaseDate ??
      analysis.metrics.firstWearDate ??
      new Date().toISOString().slice(0, 10);

    const start = parseDate(startKey);
    if (!start) return [];

    const map = new Map<string, number>();

    for (const d of wearDates) {
      const key = monthKey(d);
      map.set(key, (map.get(key) ?? 0) + 1);
    }

    const result: { key: string; label: string; count: number; cumulative: number }[] = [];

    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);

    let cumulative = 0;

    while (cursor <= end) {
      const key = monthKey(cursor);
      const count = map.get(key) ?? 0;
      cumulative += count;

      result.push({
        key,
        label: `${monthLabels[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
        count,
        cumulative
      });

      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return result;
  }

  $: timeline = buildTimeline();
  $: maxTimelineCount = Math.max(1, ...timeline.map((m) => m.count));
  $: maxCumulative = Math.max(1, ...timeline.map((m) => m.cumulative));

  $: imageSrc = item?.imageBase64 || item?.imageUrl || '';
  
  function wearMilestone(worn: number) {
  if (worn >= 100) {
    return {
      label: 'Wardrobe Workhorse',
      detail: '100+ wears. This item is clearly deeply used.',
      target: 100,
      progress: 100,
      tone: 'excellent'
    };
  }

  if (worn >= 50) {
    return {
      label: 'Strong Value',
      detail: '50+ wears. This item has clearly earned its place.',
      target: 100,
      progress: worn,
      tone: 'strong'
    };
  }

  if (worn >= 30) {
    return {
      label: '30-Wear Baseline Reached',
      detail: 'This item has reached the classic slow-fashion baseline.',
      target: 50,
      progress: worn,
      tone: 'good'
    };
  }

  if (worn >= 10) {
    return {
      label: 'Building Value',
      detail: 'On the way to the 30-wear sustainability baseline.',
      target: 30,
      progress: worn,
      tone: 'progress'
    };
  }

  return {
    label: 'Unproven',
    detail: 'Still below 10 wears. Too early to judge fairly.',
    target: 30,
    progress: worn,
    tone: 'low'
  };
}

$: milestone = wearMilestone(analysis.metrics.wornCount);
$: milestonePercent = Math.min(100, (milestone.progress / milestone.target) * 100);
</script>

<div class="modal-shell">
  <header class="header">
    <div class="item-head">
      <div class="image-box">
        {#if imageSrc}
          <img src={imageSrc} alt={item?.product ?? item?.name ?? ''} />
        {:else}
          <span>No image</span>
        {/if}
      </div>

      <div>
        <div class="eyebrow">Item Intelligence</div>
        <h1>{item?.brand ?? 'Unknown brand'}</h1>
        <p>{item?.product ?? item?.name ?? 'Unnamed item'}</p>
      </div>
    </div>

    <button class="close" on:click={close}>×</button>
  </header>

  <section class="score-card {analysis.verdict.tone}">
    <div>
      <div class="score-label">Value Score</div>
      <div class="score">{analysis.scores.adjustedValueScore}/10</div>
      <div class="verdict">{analysis.verdict.label}</div>
    </div>

    <div class="score-note">
      <strong>{analysis.texts.headline}</strong>
      <br />
      Confidence: {analysis.dataQuality.confidence} · {analysis.dataQuality.score}/10
      <br />
      {analysis.verdict.recommendedAction}
    </div>
  </section>
  
  <section class="milestone-card {milestone.tone}">
  <div class="milestone-top">
    <div>
      <div class="score-label">Wear Milestone</div>
      <h2>{milestone.label}</h2>
      <p>{milestone.detail}</p>
    </div>

    <div class="milestone-count">
      {analysis.metrics.wornCount}
      <span>/ {milestone.target}</span>
    </div>
  </div>

  <div class="milestone-track">
    <div class="milestone-fill" style={`width:${milestonePercent}%`}></div>
  </div>

  <div class="milestone-scale">
    <span>0</span>
    <span>10</span>
    <span>30</span>
    <span>50</span>
    <span>100+</span>
  </div>
</section>

  {#if analysis.texts.caveat || analysis.warnings.length}
    <section class="warning-card">
      <h2>Data Confidence</h2>

      {#if analysis.texts.caveat}
        <p>{analysis.texts.caveat}</p>
      {/if}

      {#each analysis.warnings as warning}
        <p class="warning">• {warning}</p>
      {/each}
    </section>
  {/if}

  <section class="stats-grid">
    <div class="stat">
      <span>Price</span>
      <strong>{money(analysis.metrics.price)}</strong>
    </div>

    <div class="stat">
      <span>Worn</span>
      <strong>{analysis.metrics.wornCount}</strong>
    </div>

    <div class="stat">
      <span>Cost / Wear</span>
      <strong>{money(analysis.metrics.costPerWear)}</strong>
    </div>

    <div class="stat">
      <span>Purchased</span>
      <strong>{analysis.metrics.purchaseDate ? formatDate(analysis.metrics.purchaseDate) : '—'}</strong>
    </div>

    <div class="stat">
      <span>Owned for</span>
      <strong>{analysis.metrics.daysOwned} days</strong>
    </div>

    <div class="stat">
      <span>Last worn</span>
      <strong>{analysis.metrics.lastWorn ? formatDate(analysis.metrics.lastWorn) : '—'}</strong>
    </div>

    <div class="stat">
      <span>Days / Wear</span>
      <strong>{analysis.metrics.daysPerWear ?? '—'}</strong>
    </div>

    <div class="stat">
      <span>Wears / Month</span>
      <strong>{analysis.metrics.wearsPerMonth}</strong>
    </div>

    <div class="stat">
      <span>Projected / Year</span>
      <strong>{analysis.metrics.wearsPerYear}</strong>
    </div>

    <div class="stat">
      <span>Best Month</span>
      <strong>{bestMonth}</strong>
    </div>
  </section>

  <section class="insight-card">
    <h2>Interpretation</h2>
    <p>{analysis.texts.interpretation}</p>

    {#if analysis.texts.durabilityText}
      <p>{analysis.texts.durabilityText}</p>
    {/if}
  </section>

  <section class="score-breakdown">
    <h2>Score Breakdown</h2>

    <div class="breakdown-grid">
      <div>
        <span>Usage</span>
        <strong>{analysis.scores.usageScore}/10</strong>
      </div>
      <div>
        <span>Cost</span>
        <strong>{analysis.scores.costScore}/10</strong>
      </div>
      <div>
        <span>Recency</span>
        <strong>{analysis.scores.recencyScore}/10</strong>
      </div>
      <div>
        <span>Rating</span>
        <strong>{analysis.scores.ratingScore ?? '—'}</strong>
      </div>
      <div>
        <span>Durability</span>
        <strong>{analysis.scores.durabilityScore ?? '—'}</strong>
      </div>
    </div>
  </section>

  <section class="advanced-card">
    <div class="advanced-head">
      <div>
        <h2>Advanced Item Context</h2>
        <p>Add optional personal context to make the analysis more precise.</p>
      </div>

      <button class="secondary" on:click={() => (showAdvanced = !showAdvanced)}>
        {showAdvanced ? 'Hide' : 'Add Context'}
      </button>
    </div>

    {#if showAdvanced}
      <div class="advanced-form">
        <div class="field-grid five">
          <label>
            Overall
            <input type="number" min="1" max="10" bind:value={advanced.ratingOverall} />
          </label>

          <label>
            Performance
            <input type="number" min="1" max="10" bind:value={advanced.ratingPerformance} />
          </label>

          <label>
            Quality
            <input type="number" min="1" max="10" bind:value={advanced.ratingQuality} />
          </label>

          <label>
            Comfort
            <input type="number" min="1" max="10" bind:value={advanced.ratingComfort} />
          </label>

          <label>
            Style
            <input type="number" min="1" max="10" bind:value={advanced.ratingStyle} />
          </label>
        </div>

        <div class="field-grid three">
          <label>
            Would buy again?
            <select bind:value={advanced.wouldBuyAgain}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label>
            Expected Use
            <select bind:value={advanced.expectedUse}>
              <option value="auto">Auto</option>
              <option value="daily">Daily</option>
              <option value="regular">Regular</option>
              <option value="seasonal">Seasonal</option>
              <option value="rare">Rare</option>
              <option value="archive">Archive</option>
            </select>
          </label>

          <label>
            Evaluation Mode
            <select bind:value={advanced.evaluationMode}>
              <option value="auto">Auto</option>
              <option value="performance">Performance</option>
              <option value="utility">Utility</option>
              <option value="sentimental">Sentimental</option>
              <option value="archive">Archive</option>
            </select>
          </label>
        </div>

        <label class="toggle-line">
          <input type="checkbox" bind:checked={advanced.sentimentalValue} />
          Sentimental value / keep for personal reasons
        </label>

        <label>
          Value context
          <textarea bind:value={advanced.valueOverrideNote} placeholder="e.g. bought second-hand very cheaply, rare use but essential in bad weather..." />
        </label>

        <label>
          Durability context
          <textarea bind:value={advanced.durabilityNote} placeholder="e.g. fabric still perfect, zipper weak, pad worn out..." />
        </label>

        <label>
          Personal note
          <textarea bind:value={advanced.personalNote} placeholder="Anything that helps the algorithm judge this item more fairly." />
        </label>

        <div class="advanced-actions">
          <button class="primary" disabled={savingAdvanced} on:click={saveAdvancedContext}>
            {savingAdvanced ? 'Saving…' : 'Save Advanced Context'}
          </button>

          {#if advancedMessage}
            <span>{advancedMessage}</span>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <section class="chart-card">
    <div class="chart-head">
      <h2>Seasonality</h2>
      <p>Total wears per calendar month across all years.</p>
    </div>

    <div class="bar-chart">
      {#each monthCounts as count, i}
        <div class="bar-col">
          <div class="bar-wrap">
            <div class="bar" style={`height:${(count / maxMonthCount) * 100}%`}></div>
          </div>
          <div class="bar-value">{count}</div>
          <div class="bar-label">{monthLabels[i]}</div>
        </div>
      {/each}
    </div>
  </section>

  <section class="chart-card">
    <div class="chart-head">
      <h2>Usage Timeline</h2>
      <p>Monthly usage from purchase date or first recorded wear until now.</p>
    </div>

    {#if timeline.length > 0}
      <svg class="line-chart" viewBox="0 0 900 260" preserveAspectRatio="none">
        {#each timeline as point, i}
          {@const x = timeline.length === 1 ? 40 : 40 + (820 * i) / (timeline.length - 1)}
          {@const y = 220 - (point.cumulative / maxCumulative) * 180}

          {#if i > 0}
            {@const prev = timeline[i - 1]}
            {@const px = 40 + (820 * (i - 1)) / (timeline.length - 1)}
            {@const py = 220 - (prev.cumulative / maxCumulative) * 180}
            <line x1={px} y1={py} x2={x} y2={y} stroke="#111" stroke-width="3" />
          {/if}

          <circle cx={x} cy={y} r="5" fill="#fff" stroke="#111" stroke-width="2" />
        {/each}
      </svg>

      <div class="timeline-bars">
        {#each timeline as point}
          <div class="timeline-row">
            <span>{point.label}</span>
            <div class="mini-track">
              <div class="mini-fill" style={`width:${(point.count / maxTimelineCount) * 100}%`}></div>
            </div>
            <strong>{point.count}</strong>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">No timeline data yet.</p>
    {/if}
  </section>
</div>

<style>
  .modal-shell {
    width: min(980px, 94vw);
    max-height: calc(100vh - 96px);
    overflow: auto;
    background: #fff;
    border-radius: 18px;
    padding: 1.4rem;
    box-sizing: border-box;
    font-family: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: #111;
  }

  .header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .item-head {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .image-box {
    width: 100px;
    height: 100px;
    border-radius: 16px;
    background: #f4f4f4;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .image-box img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    padding: 8px;
    box-sizing: border-box;
  }

  .image-box span {
    font-size: .75rem;
    color: #999;
  }

  .eyebrow {
    font-size: .7rem;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: #999;
    font-weight: 700;
  }

  h1 {
    margin: .15rem 0;
    font-size: 1.35rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  p {
    margin: .25rem 0 0;
    color: #666;
    font-size: .9rem;
    line-height: 1.45;
  }

  .close {
    border: none;
    background: #f1f1f1;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    font-size: 1.4rem;
    cursor: pointer;
  }

  .score-card {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 1rem;
    background: #111;
    color: white;
    border-radius: 16px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .score-card.archive {
    background: #3f3a32;
  }

  .score-card.caution {
    background: #3f2f2f;
  }

  .score-label {
    font-size: .72rem;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: .08em;
    font-weight: 700;
  }

  .score {
    font-size: 2.2rem;
    font-weight: 800;
    margin-top: .1rem;
  }

  .verdict {
    color: #ddd;
    font-size: .9rem;
  }

  .score-note {
    color: #ddd;
    font-size: .88rem;
    line-height: 1.45;
    align-self: center;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: .7rem;
    margin-bottom: 1rem;
  }

  .stat {
    border: 1px solid #e6e6e6;
    border-radius: 14px;
    padding: .8rem;
    background: #fafafa;
  }

  .stat span,
  .breakdown-grid span {
    display: block;
    font-size: .68rem;
    color: #888;
    text-transform: uppercase;
    letter-spacing: .07em;
    font-weight: 700;
    margin-bottom: .25rem;
  }

  .stat strong {
    font-size: .95rem;
  }

  .chart-card,
  .insight-card,
  .warning-card,
  .advanced-card,
  .score-breakdown {
    border: 1px solid #e6e6e6;
    border-radius: 16px;
    background: #fff;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .warning-card {
    background: #fffaf0;
  }

  .warning {
    color: #9a5a00;
    font-weight: 600;
  }

  .breakdown-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: .7rem;
    margin-top: .8rem;
  }

  .breakdown-grid div {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 12px;
    padding: .7rem;
  }

  .advanced-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .advanced-form {
    display: grid;
    gap: .9rem;
    margin-top: 1rem;
  }

  .field-grid {
    display: grid;
    gap: .7rem;
  }

  .field-grid.five {
    grid-template-columns: repeat(5, 1fr);
  }

  .field-grid.three {
    grid-template-columns: repeat(3, 1fr);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: .3rem;
    font-size: .72rem;
    color: #777;
    text-transform: uppercase;
    letter-spacing: .07em;
    font-weight: 700;
  }

  input,
  select,
  textarea {
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: .55rem .65rem;
    font: inherit;
    text-transform: none;
    letter-spacing: normal;
  }

  textarea {
    min-height: 74px;
    resize: vertical;
  }

  .toggle-line {
    flex-direction: row;
    align-items: center;
    text-transform: none;
    letter-spacing: normal;
    font-size: .88rem;
    color: #333;
  }

  .toggle-line input {
    width: auto;
  }

  .advanced-actions {
    display: flex;
    align-items: center;
    gap: .8rem;
  }

  .advanced-actions span {
    color: #666;
    font-size: .85rem;
  }

  button.primary,
  button.secondary {
    border: 1px solid #111;
    border-radius: 999px;
    padding: .55rem .9rem;
    cursor: pointer;
    font-weight: 700;
  }

  button.primary {
    background: #111;
    color: white;
  }

  button.secondary {
    background: white;
    color: #111;
    border-color: #ddd;
  }

  .chart-head {
    margin-bottom: .9rem;
  }

  .bar-chart {
    height: 210px;
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: .5rem;
    align-items: end;
  }

  .bar-col {
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto auto;
    gap: .25rem;
    text-align: center;
  }

  .bar-wrap {
    height: 150px;
    background: #f3f3f3;
    border-radius: 10px;
    display: flex;
    align-items: end;
    overflow: hidden;
  }

  .bar {
    width: 100%;
    background: #111;
    border-radius: 10px 10px 0 0;
    min-height: 2px;
  }

  .bar-value {
    font-size: .75rem;
    font-weight: 700;
  }

  .bar-label {
    font-size: .7rem;
    color: #777;
  }

  .line-chart {
    width: 100%;
    height: 260px;
    background: #fafafa;
    border-radius: 14px;
    margin-bottom: 1rem;
  }

  .timeline-bars {
    display: grid;
    gap: .45rem;
    max-height: 260px;
    overflow: auto;
    padding-right: .3rem;
  }

  .timeline-row {
    display: grid;
    grid-template-columns: 72px 1fr 32px;
    align-items: center;
    gap: .6rem;
    font-size: .78rem;
  }

  .mini-track {
    height: 8px;
    background: #eee;
    border-radius: 999px;
    overflow: hidden;
  }

  .mini-fill {
    height: 100%;
    background: #111;
    border-radius: 999px;
  }

  .empty {
    color: #999;
  }

  @media (max-width: 850px) {
    .score-card,
    .field-grid.five,
    .field-grid.three {
      grid-template-columns: 1fr;
    }

    .stats-grid,
    .breakdown-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .advanced-head {
      flex-direction: column;
    }
  }
  
  .milestone-card {
  border: 1px solid #e6e6e6;
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fafafa;
}

.milestone-card.good {
  background: #f4f8f2;
}

.milestone-card.strong {
  background: #f2f6fb;
}

.milestone-card.excellent {
  background: #f7f3ff;
}

.milestone-card.progress {
  background: #fffaf0;
}

.milestone-card.low {
  background: #fafafa;
}

.milestone-top {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.milestone-count {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.milestone-count span {
  font-size: .85rem;
  color: #777;
}

.milestone-track {
  height: 10px;
  background: #e9e9e9;
  border-radius: 999px;
  overflow: hidden;
  margin-top: 1rem;
}

.milestone-fill {
  height: 100%;
  background: #111;
  border-radius: 999px;
}

.milestone-scale {
  display: flex;
  justify-content: space-between;
  margin-top: .35rem;
  font-size: .7rem;
  color: #888;
}
</style>
