<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/firebase';
  import FitnessHistoryChart from '$lib/components/FitnessHistoryChart.svelte';
  import { firebaseAuthFetch } from '$lib/utils/firebase-auth-fetch';
  import { formatSportsDuration, sportsByType, sportsByWeek, sportsTypeSymbol, sportsWeekStart, summarizeSports, type SportsActivity, type SportsWellness } from '$lib/utils/sports';

  type SportsPayload = {
    syncedAt: string;
    range: { oldest: string; newest: string; days: number };
    activities: SportsActivity[];
    wellness: SportsWellness[];
    rateLimit: { limit: string | null; remaining: string | null };
  };

  let loading = true;
  let refreshing = false;
  let error = '';
  let payload: SportsPayload | null = null;
  let rangeDays = 90;

  $: activities = payload?.activities ?? [];
  $: wellness = payload?.wellness ?? [];
  $: latestWellness = wellness[wellness.length - 1] ?? null;
  $: thisWeekKey = sportsWeekStart(new Date().toISOString());
  $: thisWeekActivities = activities.filter((activity) => sportsWeekStart(activity.startDateLocal) === thisWeekKey);
  $: weekTotals = summarizeSports(thisWeekActivities);
  $: rangeTotals = summarizeSports(activities);
  $: weekSeries = sportsByWeek(activities, new Date().toISOString(), 8);
  $: maxWeekLoad = Math.max(1, ...weekSeries.map((week) => week.load));
  $: sportTypes = sportsByType(activities);
  $: recentActivities = activities.slice(0, 12);

  function distance(value: number) { return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)} km`; }
  function dateLabel(value: string) {
    const key = value.slice(0, 10);
    return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function formLabel(value: number) {
    if (value >= 8) return 'Fresh';
    if (value >= -5) return 'Balanced';
    if (value >= -15) return 'Loaded';
    return 'Very fatigued';
  }
  async function loadSports(force = false) {
    if (force) refreshing = true; else loading = true;
    error = '';
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Sign in to view sports data.');
      const response = await firebaseAuthFetch(currentUser, `/api/sports?days=${rangeDays}${force ? `&refresh=${Date.now()}` : ''}`, {
        cache: force ? 'reload' : 'default'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sports data could not be loaded.');
      payload = data as SportsPayload;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Sports data could not be loaded.';
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function setRange(days: number) { rangeDays = days; await loadSports(); }
  onMount(() => { const unsubscribe = auth.onAuthStateChanged((current) => { if (current) loadSports(); else { loading = false; error = 'Sign in to view sports data.'; } }); return unsubscribe; });
</script>

<svelte:head><title>Sports · Trackr</title><meta name="description" content="Training, fitness, fatigue and recent activities from Intervals.icu in Trackr." /></svelte:head>

<main class="sports-page">
  <section class="sports-hero">
    <div class="hero-grid"></div><div class="hero-glow"></div>
    <div class="hero-copy"><p class="eyebrow">Trackr Sports · Intervals.icu</p><h1>Train with the<br />full picture.</h1><p>Recent activities, weekly consistency, training load, fitness and fatigue—read directly from your existing sports history.</p></div>
    <div class="hero-status">
      <span>Current form</span>
      <strong>{latestWellness ? Math.round(latestWellness.form) : '—'}</strong>
      <p>{latestWellness ? formLabel(latestWellness.form) : 'Awaiting wellness data'}</p>
      <i></i>
      <small>{latestWellness ? `Fitness ${Math.round(latestWellness.fitness)} · Fatigue ${Math.round(latestWellness.fatigue)}` : 'Connected securely through Trackr'}</small>
    </div>
  </section>

  {#if loading}
    <section class="state-card"><span class="spinner"></span><p>Reading your training history…</p></section>
  {:else if error}
    <section class="state-card error"><p class="eyebrow">Connection</p><h2>Sports could not be loaded.</h2><p>{error}</p><button on:click={() => loadSports(true)}>Try again</button></section>
  {:else if payload}
    <section class="week-strip">
      <div><small>This week</small><strong>{weekTotals.count}</strong><span>activities</span></div>
      <div><small>Time moving</small><strong>{formatSportsDuration(weekTotals.duration)}</strong><span>active time</span></div>
      <div><small>Distance</small><strong>{distance(weekTotals.distance)}</strong><span>all sports</span></div>
      <div><small>Training load</small><strong>{Math.round(weekTotals.load)}</strong><span>Intervals load</span></div>
      <div><small>Elevation</small><strong>{Math.round(weekTotals.elevation).toLocaleString()} m</strong><span>vertical gain</span></div>
    </section>

    <section class="control-row">
      <div><p class="eyebrow">Training overview</p><h2>Your recent rhythm</h2></div>
      <div class="range-control" aria-label="Sports history range">{#each [30, 90, 180, 365] as days}<button class:active={rangeDays === days} on:click={() => setRange(days)}>{days === 365 ? '1y' : `${days}d`}</button>{/each}</div>
      <button class="refresh" on:click={() => loadSports(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh data'}</button>
    </section>

    <section class="training-grid">
      <article class="panel load-panel">
        <div class="panel-head"><div><p class="eyebrow">Eight weeks</p><h3>Training load</h3></div><strong>{Math.round(weekTotals.load)}</strong></div>
        <div class="load-chart" aria-label="Weekly training load">
          {#each weekSeries as week (week.weekStart)}
            <div class="bar-column" title={`${dateLabel(week.weekStart)}: ${Math.round(week.load)} load`} style={`--bar-height:${Math.max(3, (week.load / maxWeekLoad) * 100)}%`}><div class="bar-track"><span>{week.load ? Math.round(week.load) : ''}</span><i></i></div><small>{new Date(`${week.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>
          {/each}
        </div>
      </article>

      <article class="panel fitness-panel">
        <div class="panel-head"><div><p class="eyebrow">Current state</p><h3>Fitness & fatigue</h3></div><span>{latestWellness?.date ? dateLabel(latestWellness.date) : '—'}</span></div>
        <div class="fitness-values"><div class="fitness"><span>Fitness</span><strong>{latestWellness ? latestWellness.fitness.toFixed(1) : '—'}</strong><i></i></div><div class="fatigue"><span>Fatigue</span><strong>{latestWellness ? latestWellness.fatigue.toFixed(1) : '—'}</strong><i></i></div><div class="form"><span>Form</span><strong>{latestWellness ? latestWellness.form.toFixed(1) : '—'}</strong><i></i></div></div>
        {#if wellness.length}<FitnessHistoryChart {wellness} />{:else}<p class="fitness-empty">No wellness history is available for this range.</p>{/if}
      </article>

      <article class="panel sport-panel">
        <div class="panel-head"><div><p class="eyebrow">Last {rangeDays === 365 ? 'year' : `${rangeDays} days`}</p><h3>Sport balance</h3></div><strong>{rangeTotals.count}</strong></div>
        <div class="sport-list">{#each sportTypes.slice(0, 6) as sport (sport.type)}<div><i class="sport-symbol" aria-hidden="true" title={sport.type}>{sportsTypeSymbol(sport.type)}</i><span><strong>{sport.type}</strong><small>{formatSportsDuration(sport.duration)} · {distance(sport.distance)}</small></span><b>{rangeTotals.duration ? Math.round((sport.duration / rangeTotals.duration) * 100) : 0}%</b></div>{:else}<p>No activities in this range.</p>{/each}</div>
      </article>
    </section>

    <section class="activity-section">
      <div class="section-head"><div><p class="eyebrow">Activity feed</p><h2>Latest sessions</h2></div><p>{rangeTotals.count} activities · {formatSportsDuration(rangeTotals.duration)} · {distance(rangeTotals.distance)}</p></div>
      <div class="activity-list">
        {#each recentActivities as activity (activity.id)}
          <article><div class="activity-icon sport-symbol" aria-hidden="true" title={activity.type}>{sportsTypeSymbol(activity.type)}</div><div class="activity-copy"><small>{dateLabel(activity.startDateLocal)} · {activity.type}</small><h3>{activity.name}</h3><p>{formatSportsDuration(activity.movingTime)}{activity.distance ? ` · ${distance(activity.distance)}` : ''}{activity.elevationGain ? ` · ${Math.round(activity.elevationGain)} m up` : ''}</p></div><div class="activity-metrics"><span>Load</span><strong>{Math.round(activity.trainingLoad)}</strong>{#if activity.averageHeartRate}<small>{Math.round(activity.averageHeartRate)} bpm</small>{:else if activity.averagePower}<small>{Math.round(activity.averagePower)} W</small>{/if}</div></article>
        {:else}<div class="empty">No activities in this range.</div>{/each}
      </div>
    </section>

    <footer class="sports-footer"><div><span class="live-dot"></span><p>Read-only Intervals.icu connection · refreshed {new Date(payload.syncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p></div><button on:click={() => goto('/system')}>Connection & system health →</button></footer>
  {/if}
</main>

<style>
  :global(body){background:#f2f4f1}:global(.main-content){max-width:1440px}.sports-page{width:min(100%,1360px);margin:0 auto;padding-bottom:5rem;color:#161916;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif}.eyebrow{margin:0;color:#6f756f;font-size:.65rem;font-weight:850;letter-spacing:.13em;text-transform:uppercase}
  .sports-hero{position:relative;min-height:390px;padding:clamp(2rem,5vw,4.5rem);box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:3rem;overflow:hidden;border-radius:32px;background:#121713;color:#f6f8f5;box-shadow:0 28px 80px rgba(19,29,22,.18)}.hero-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:38px 38px;mask-image:linear-gradient(90deg,#000,transparent)}.hero-glow{position:absolute;width:620px;height:620px;right:-170px;top:-280px;border-radius:50%;background:radial-gradient(circle,rgba(104,255,164,.25),transparent 68%)}.hero-copy,.hero-status{position:relative;z-index:1}.sports-hero .eyebrow{color:#91a096}.hero-copy h1{margin:.7rem 0 1rem;font-size:clamp(3.4rem,7vw,7.2rem);line-height:.84;letter-spacing:-.078em}.hero-copy>p:last-child{max-width:620px;margin:0;color:#a6b0a8;font-size:.92rem;line-height:1.6}.hero-status{min-width:230px;padding:1.4rem;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(255,255,255,.055);backdrop-filter:blur(16px)}.hero-status span,.hero-status p,.hero-status small{display:block;color:#9ca89f}.hero-status span{font-size:.62rem;font-weight:850;text-transform:uppercase}.hero-status strong{display:block;margin:.35rem 0;font-size:4.5rem;line-height:1;letter-spacing:-.08em}.hero-status p{margin:0;font-size:.78rem}.hero-status i{display:block;height:1px;margin:1.2rem 0;background:rgba(255,255,255,.1)}.hero-status small{font-size:.62rem;line-height:1.5}
  .state-card{min-height:330px;margin-top:.8rem;display:grid;place-content:center;justify-items:center;border-radius:24px;background:#fff;color:#777;text-align:center}.spinner{width:34px;height:34px;border:3px solid #ddd;border-top-color:#161916;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.state-card.error h2{margin:.4rem 0}.state-card.error>p:not(.eyebrow){max-width:430px}.state-card button{padding:.65rem .9rem;border:0;border-radius:999px;background:#171717;color:#fff;cursor:pointer}
  .week-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:.65rem;margin-top:.75rem}.week-strip>div{padding:1.05rem;border:1px solid rgba(255,255,255,.9);border-radius:19px;background:rgba(255,255,255,.82);box-shadow:0 13px 40px rgba(0,0,0,.035)}.week-strip small,.week-strip strong,.week-strip span{display:block}.week-strip small{color:#777;font-size:.59rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.week-strip strong{margin:.28rem 0;font-size:1.75rem;letter-spacing:-.055em}.week-strip span{color:#8b8b8b;font-size:.62rem}
  .control-row{margin:3.8rem 0 1rem;display:grid;grid-template-columns:1fr auto auto;gap:.7rem;align-items:end}.control-row h2,.activity-section h2{margin:.35rem 0 0;font-size:clamp(2rem,3.5vw,3.4rem);letter-spacing:-.06em}.range-control{padding:.25rem;display:flex;border-radius:999px;background:#e4e7e2}.range-control button{padding:.48rem .7rem;border:0;border-radius:999px;background:transparent;color:#737873;font-size:.64rem;cursor:pointer}.range-control button.active{background:#fff;color:#171917;font-weight:850;box-shadow:0 3px 10px rgba(0,0,0,.07)}.refresh{padding:.63rem .9rem;border:0;border-radius:999px;background:#171b18;color:#fff;font-size:.68rem;font-weight:800;cursor:pointer}.refresh:disabled{opacity:.5}
  .training-grid{display:grid;grid-template-columns:1.35fr .9fr .85fr;gap:.7rem}.panel{min-height:330px;padding:1.25rem;box-sizing:border-box;border:1px solid rgba(255,255,255,.95);border-radius:23px;background:#fff;box-shadow:0 16px 48px rgba(0,0,0,.04)}.panel-head,.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.panel-head h3{margin:.3rem 0 0;font-size:1.15rem;letter-spacing:-.04em}.panel-head>strong{font-size:2rem;letter-spacing:-.06em}.panel-head>span{color:#888;font-size:.62rem}.load-chart{height:235px;margin-top:1rem;display:grid;grid-template-columns:repeat(8,1fr);gap:.45rem}.bar-column{min-width:0;height:100%;display:grid;grid-template-rows:minmax(0,1fr) 22px;align-items:stretch;text-align:center}.bar-track{position:relative;min-height:0;border-bottom:1px solid #ddd}.bar-track i{position:absolute;right:14%;bottom:0;width:72%;height:var(--bar-height);min-height:3px;border-radius:7px 7px 0 0;background:linear-gradient(#60d98f,#203c2b)}.bar-track span{position:absolute;z-index:1;left:0;right:0;bottom:calc(var(--bar-height) + .28rem);color:#777;font-size:.53rem}.bar-column small{padding-top:.35rem;color:#888;font-size:.48rem;white-space:nowrap}.fitness-panel{overflow:hidden}.fitness-values{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;margin-top:1.35rem}.fitness-values>div{padding:.75rem;border-radius:14px;background:#f4f5f2}.fitness-values span,.fitness-values strong{display:block}.fitness-values span{color:#777;font-size:.58rem;text-transform:uppercase}.fitness-values strong{margin:.3rem 0;font-size:1.45rem}.fitness-values i{display:block;width:24px;height:3px;border-radius:99px;background:#63d493}.fitness-values .fatigue i{background:#f09b62}.fitness-values .form i{background:#778bea}.fitness-empty{margin:2rem 0 0;color:#858985;font-size:.67rem;line-height:1.55}.sport-list{display:grid;gap:.45rem;margin-top:1rem}.sport-list>div{padding:.54rem;display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:.6rem;align-items:center;border-radius:12px;background:#f5f6f3}.sport-list>div>i,.activity-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#dfeee4;color:#315a3d;font-size:.7rem;font-style:normal;font-weight:900}.sport-symbol{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;font-size:1rem!important;font-weight:400!important;line-height:1}.sport-list span strong,.sport-list span small{display:block}.sport-list span strong{font-size:.7rem}.sport-list span small{margin-top:.1rem;color:#888;font-size:.56rem}.sport-list b{font-size:.65rem}.sport-list>p{color:#888;font-size:.7rem}
  .activity-section{margin-top:4rem}.section-head{align-items:end}.section-head>p{margin:0;color:#777;font-size:.68rem}.activity-list{margin-top:1rem;display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.activity-list article{padding:.85rem;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:.8rem;align-items:center;border:1px solid rgba(255,255,255,.95);border-radius:17px;background:rgba(255,255,255,.83);box-shadow:0 12px 34px rgba(0,0,0,.025)}.activity-icon{width:44px;height:44px;border-radius:13px}.activity-copy{min-width:0}.activity-copy small{color:#7c827d;font-size:.56rem;font-weight:750;text-transform:uppercase}.activity-copy h3{margin:.2rem 0;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-copy p{margin:0;color:#888;font-size:.59rem}.activity-metrics{text-align:right}.activity-metrics span,.activity-metrics strong,.activity-metrics small{display:block}.activity-metrics span{color:#888;font-size:.52rem;text-transform:uppercase}.activity-metrics strong{font-size:1.15rem}.activity-metrics small{color:#888;font-size:.52rem}.empty{grid-column:1/-1;padding:3rem;border-radius:18px;background:#fff;color:#888;text-align:center}
  .sports-footer{margin-top:1rem;padding:1rem 1.15rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-radius:17px;background:#e3e7e1;color:#687068}.sports-footer>div{display:flex;align-items:center;gap:.55rem}.sports-footer p{margin:0;font-size:.62rem}.sports-footer button{border:0;background:transparent;color:#424842;font-size:.62rem;font-weight:800;cursor:pointer}.live-dot{width:7px;height:7px;border-radius:50%;background:#3aaa66;box-shadow:0 0 0 4px rgba(58,170,102,.12)}
  @media(max-width:1100px){.training-grid{grid-template-columns:1fr 1fr}.load-panel{grid-column:1/-1}.week-strip{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:760px){:global(.main-content){padding:.7rem;padding-bottom:72px}.sports-hero{min-height:520px;padding:2rem;align-items:flex-start;flex-direction:column}.hero-status{align-self:flex-end;min-width:190px}.week-strip{grid-template-columns:1fr 1fr}.control-row{grid-template-columns:1fr auto}.control-row>div:first-child{grid-column:1/-1}.training-grid,.activity-list{grid-template-columns:1fr}.load-panel{grid-column:auto}.activity-section{margin-top:2.7rem}.section-head{align-items:flex-start;flex-direction:column}.sports-footer{align-items:flex-start;flex-direction:column}}
  @media(max-width:480px){.sports-hero{min-height:560px;border-radius:24px}.hero-copy h1{font-size:3.8rem}.hero-status{width:100%;box-sizing:border-box}.week-strip{grid-template-columns:1fr 1fr}.week-strip>div:last-child{grid-column:1/-1}.control-row{grid-template-columns:1fr}.range-control{justify-content:space-between}.refresh{width:100%}.fitness-values{grid-template-columns:1fr 1fr 1fr}.load-chart{gap:.2rem}.bar-column small{font-size:.42rem}}
</style>
