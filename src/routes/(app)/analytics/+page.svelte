<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { collection, getDocs } from 'firebase/firestore';
  import { auth, db } from '$lib/firebase';
  import { buildMonthlyRecap, type MonthlyRecap } from '$lib/utils/wearInsights';
  import { itemEditHref } from '$lib/utils/appNavigation';

  type Item = {
    id: string;
    brand?: string;
    product?: string;
    name?: string;
    mainCategory?: string;
    lowerCategory?: string;
    imageUrl?: string;
    imageBase64?: string;
    worn?: number;
    wearLog?: unknown[];
    lastWorn?: unknown;
    purchaseDate?: unknown;
    price?: number | string;
    status?: string;
    color?: string;
  };

  type CategoryStat = {
    name: string;
    count: number;
    wears: number;
    recentWears: number;
    value: number;
    share: number;
  };

  type BrandStat = {
    name: string;
    count: number;
    wears: number;
    value: number;
    cpw: number | null;
  };

  let loading = true;
  let errorMessage = '';
  let items: Item[] = [];
  let rangeDays: 30 | 90 | 3650 = 90;

  let activeItems: Item[] = [];
  let totalWears = 0;
  let totalValue = 0;
  let wardrobeCPW: number | null = null;
  let trackedItems = 0;
  let recentWears = 0;
  let recentPieces = 0;
  let utilization = 0;
  let categoryStats: CategoryStat[] = [];
  let topWorn: Item[] = [];
  let bestValue: Array<Item & { cpw: number }> = [];
  let neglected: Item[] = [];
  let brandStats: BrandStat[] = [];
  const initialRecapDate = new Date();
  let recapMonth = `${initialRecapDate.getFullYear()}-${String(initialRecapDate.getMonth() + 1).padStart(2, '0')}`;
  let monthlyRecap: MonthlyRecap<Item> | null = null;

  const DAY = 86_400_000;

  onMount(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        goto('/login');
        return;
      }

      loading = true;
      errorMessage = '';
      try {
        const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'items'));
        items = snapshot.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data() as Omit<Item, 'id'>)
        }));
        calculateStats();
      } catch (error) {
        console.error('Could not load analytics', error);
        errorMessage = 'Your wardrobe analytics could not be loaded. Please try again.';
      } finally {
        loading = false;
      }
    });

    return unsubscribe;
  });

  function numberValue(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isActive(item: Item) {
    const status = String(item.status ?? '').trim().toLowerCase();
    return !['sold', 'archived', 'retired'].includes(status);
  }

  function imageFor(item: Item) {
    return item.imageBase64 || item.imageUrl || '';
  }

  function nameFor(item: Item) {
    return item.product || item.name || 'Unnamed item';
  }

  function brandFor(item: Item) {
    return item.brand?.trim() || 'Unknown brand';
  }

  function timestamp(value: unknown): number | null {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value === 'object' && value && 'seconds' in value) {
      const seconds = Number((value as { seconds?: number }).seconds);
      return Number.isFinite(seconds) ? seconds * 1000 : null;
    }
    return null;
  }

  function wearDates(item: Item) {
    if (!Array.isArray(item.wearLog)) return [];
    return item.wearLog.map(timestamp).filter((value): value is number => value !== null);
  }

  function wearsWithin(item: Item, days: number) {
    const cutoff = Date.now() - days * DAY;
    return wearDates(item).filter((date) => date >= cutoff).length;
  }

  function lastWornTime(item: Item) {
    const explicit = timestamp(item.lastWorn);
    if (explicit) return explicit;
    const dates = wearDates(item);
    return dates.length ? Math.max(...dates) : null;
  }

  function calculateStats() {
    activeItems = items.filter(isActive);
    totalWears = activeItems.reduce((sum, item) => sum + numberValue(item.worn), 0);
    totalValue = activeItems.reduce((sum, item) => sum + numberValue(item.price), 0);
    wardrobeCPW = totalWears > 0 && totalValue > 0 ? totalValue / totalWears : null;
    trackedItems = activeItems.filter((item) => numberValue(item.worn) > 0).length;
    utilization = activeItems.length ? Math.round((trackedItems / activeItems.length) * 100) : 0;

    const recentCounts = activeItems.map((item) => ({ item, count: wearsWithin(item, rangeDays) }));
    recentWears = recentCounts.reduce((sum, entry) => sum + entry.count, 0);
    recentPieces = recentCounts.filter((entry) => entry.count > 0).length;

    const categoryMap = new Map<string, Omit<CategoryStat, 'share'>>();
    for (const item of activeItems) {
      const name = item.mainCategory?.trim() || 'Uncategorized';
      const current = categoryMap.get(name) ?? { name, count: 0, wears: 0, recentWears: 0, value: 0 };
      current.count += 1;
      current.wears += numberValue(item.worn);
      current.recentWears += wearsWithin(item, rangeDays);
      current.value += numberValue(item.price);
      categoryMap.set(name, current);
    }

    const maxCategoryWears = Math.max(1, ...Array.from(categoryMap.values()).map((entry) => entry.wears));
    categoryStats = Array.from(categoryMap.values())
      .map((entry) => ({ ...entry, share: Math.round((entry.wears / maxCategoryWears) * 100) }))
      .sort((a, b) => b.wears - a.wears);

    topWorn = [...activeItems]
      .filter((item) => numberValue(item.worn) > 0)
      .sort((a, b) => numberValue(b.worn) - numberValue(a.worn))
      .slice(0, 6);

    bestValue = activeItems
      .filter((item) => numberValue(item.worn) > 0 && numberValue(item.price) > 0)
      .map((item) => ({ ...item, cpw: numberValue(item.price) / numberValue(item.worn) }))
      .sort((a, b) => a.cpw - b.cpw)
      .slice(0, 6);

    const neglectCutoff = Date.now() - 90 * DAY;
    neglected = [...activeItems]
      .filter((item) => {
        const last = lastWornTime(item);
        return numberValue(item.worn) === 0 || !last || last < neglectCutoff;
      })
      .sort((a, b) => (lastWornTime(a) ?? 0) - (lastWornTime(b) ?? 0))
      .slice(0, 6);

    const brandMap = new Map<string, Omit<BrandStat, 'cpw'>>();
    for (const item of activeItems) {
      const name = brandFor(item);
      const current = brandMap.get(name) ?? { name, count: 0, wears: 0, value: 0 };
      current.count += 1;
      current.wears += numberValue(item.worn);
      current.value += numberValue(item.price);
      brandMap.set(name, current);
    }
    brandStats = Array.from(brandMap.values())
      .map((entry) => ({ ...entry, cpw: entry.wears && entry.value ? entry.value / entry.wears : null }))
      .sort((a, b) => b.wears - a.wears)
      .slice(0, 8);
    monthlyRecap = buildMonthlyRecap(activeItems, recapMonth);
  }

  function shiftRecapMonth(offset: number) {
    const [year, month] = recapMonth.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    recapMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    monthlyRecap = buildMonthlyRecap(activeItems, recapMonth);
  }

  function recapMonthLabel() {
    const [year, month] = recapMonth.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function setRange(days: 30 | 90 | 3650) {
    rangeDays = days;
    calculateStats();
  }

  function rangeLabel() {
    return rangeDays === 3650 ? 'All tracked time' : `Last ${rangeDays} days`;
  }

  function money(value: number | null, digits = 0) {
    if (value === null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    }).format(value);
  }

  function cpwChangeLabel(value: number | null) {
    if (value === null) return 'Not enough tracked history';
    if (Math.abs(value) < 0.005) return 'No tracked change';
    return `${money(Math.abs(value), 2)} ${value < 0 ? 'lower' : 'higher'}`;
  }

  function lastWornLabel(item: Item) {
    const last = lastWornTime(item);
    if (!last) return 'Never worn';
    const days = Math.max(0, Math.floor((Date.now() - last) / DAY));
    if (days === 0) return 'Worn today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  function openItem(item: Item) {
    goto(itemEditHref(item.id, '/analytics'));
  }
</script>

<svelte:head>
  <title>Wardrobe Analytics · Trackr</title>
</svelte:head>

<main class="analytics-page">
  <section class="hero-card">
    <div>
      <p class="eyebrow">Trackr Analytics</p>
      <h1>See what earns its place.</h1>
      <p class="subtitle">
        A clearer look at what you wear, what delivers value, and what is quietly being left behind.
      </p>
    </div>
    <div class="range-switcher" aria-label="Analytics time range">
      <button class:active={rangeDays === 30} on:click={() => setRange(30)}>30d</button>
      <button class:active={rangeDays === 90} on:click={() => setRange(90)}>90d</button>
      <button class:active={rangeDays === 3650} on:click={() => setRange(3650)}>All</button>
    </div>
  </section>

  {#if loading}
    <div class="state-card">Loading wardrobe insights…</div>
  {:else if errorMessage}
    <div class="state-card error">{errorMessage}</div>
  {:else if !activeItems.length}
    <div class="state-card">
      <h2>Your analytics will grow with your wardrobe.</h2>
      <p>Add clothing and log wears to see patterns here.</p>
      <button on:click={() => goto('/clothing/add')}>Add your first item</button>
    </div>
  {:else}
    <section class="summary-grid" aria-label="Wardrobe summary">
      <article class="summary-card accent-purple">
        <span>Active wardrobe</span>
        <strong>{activeItems.length}</strong>
        <small>{trackedItems} pieces have wear data</small>
      </article>
      <article class="summary-card accent-orange">
        <span>Total wears</span>
        <strong>{totalWears.toLocaleString()}</strong>
        <small>{utilization}% of your wardrobe is in rotation</small>
      </article>
      <article class="summary-card accent-blue">
        <span>{rangeLabel()}</span>
        <strong>{recentWears.toLocaleString()}</strong>
        <small>across {recentPieces} different pieces</small>
      </article>
      <article class="summary-card accent-green">
        <span>Wardrobe cost / wear</span>
        <strong>{money(wardrobeCPW, 2)}</strong>
        <small>{money(totalValue)} tracked purchase value</small>
      </article>
    </section>

    {#if monthlyRecap}
      <section class="panel recap-panel" aria-label="Monthly wardrobe recap">
        <div class="recap-head">
          <div>
            <p class="eyebrow">Monthly recap</p>
            <h2>{recapMonthLabel()}</h2>
          </div>
          <div class="recap-actions">
            <button on:click={() => shiftRecapMonth(-1)} aria-label="Previous recap month">←</button>
            <button class="calendar-link" on:click={() => goto('/wear-calendar')}>Open calendar</button>
            <button on:click={() => shiftRecapMonth(1)} aria-label="Next recap month">→</button>
          </div>
        </div>

        <div class="recap-stats">
          <div><span>Active days</span><strong>{monthlyRecap.activeDays}</strong></div>
          <div><span>Logged wears</span><strong>{monthlyRecap.totalWears}</strong></div>
          <div><span>Pieces worn</span><strong>{monthlyRecap.uniquePieces}</strong></div>
          <div>
            <span>Tracked cost / wear</span>
            <strong>{money(monthlyRecap.costPerWearAtEnd, 2)}</strong>
            <small>{cpwChangeLabel(monthlyRecap.costPerWearChange)}</small>
          </div>
        </div>

        <div class="recap-detail-grid">
          <div class="recap-list">
            <h3>Top pieces</h3>
            {#each monthlyRecap.topPieces as entry, index}
              <button on:click={() => openItem(entry.item)}>
                <span>{index + 1}</span>
                <span class="item-image">
                  {#if imageFor(entry.item)}<img src={imageFor(entry.item)} alt={nameFor(entry.item)} />{:else}<i>—</i>{/if}
                </span>
                <span class="item-copy"><strong>{brandFor(entry.item)}</strong><small>{nameFor(entry.item)}</small></span>
                <b>{entry.count}×</b>
              </button>
            {:else}
              <p class="empty">No wear entries are saved for this month.</p>
            {/each}
          </div>

          <div class="recap-categories">
            <h3>Category split</h3>
            {#each monthlyRecap.categorySplit as category}
              <div>
                <span><strong>{category.name}</strong><small>{category.wears} wears</small></span>
                <b>{category.share}%</b>
                <i><em style={`width:${category.share}%`}></em></i>
              </div>
            {:else}
              <p class="empty">Category balance will appear after you log a wear.</p>
            {/each}
          </div>

          <div class="recap-list">
            <h3>Quiet this month</h3>
            {#each monthlyRecap.neglected as item}
              <button on:click={() => openItem(item)}>
                <span class="item-image">
                  {#if imageFor(item)}<img src={imageFor(item)} alt={nameFor(item)} />{:else}<i>—</i>{/if}
                </span>
                <span class="item-copy"><strong>{brandFor(item)}</strong><small>{nameFor(item)}</small></span>
              </button>
            {:else}
              <p class="empty">Every active piece was worn this month.</p>
            {/each}
          </div>
        </div>
        <p class="recap-note">Cost-per-wear movement is estimated from purchase values and dated wear-log entries through the selected month.</p>
      </section>
    {/if}

    <section class="insight-grid">
      <article class="panel category-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Category balance</p>
            <h2>Where your wears go</h2>
          </div>
          <span>{rangeLabel()}</span>
        </div>

        <div class="category-list">
          {#each categoryStats as category}
            <div class="category-row">
              <div class="category-copy">
                <strong>{category.name}</strong>
                <span>{category.count} pieces · {category.recentWears} recent wears</span>
              </div>
              <div class="category-total">{category.wears.toLocaleString()}</div>
              <div class="bar"><i style={`width:${category.share}%`}></i></div>
            </div>
          {/each}
        </div>
      </article>

      <article class="panel rotation-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Rotation</p>
            <h2>{utilization}% utilized</h2>
          </div>
        </div>
        <div class="utilization-ring" style={`--progress:${utilization * 3.6}deg`}>
          <div><strong>{trackedItems}</strong><span>of {activeItems.length}</span></div>
        </div>
        <p>
          {activeItems.length - trackedItems} active piece{activeItems.length - trackedItems === 1 ? '' : 's'}
          {activeItems.length - trackedItems === 1 ? ' has' : ' have'} no recorded wears yet.
        </p>
      </article>
    </section>

    <section class="rankings">
      <article class="panel ranking-panel">
        <div class="panel-head">
          <div><p class="eyebrow">Workhorses</p><h2>Most worn</h2></div>
        </div>
        <div class="item-list">
          {#each topWorn as item, index}
            <button class="item-row" on:click={() => openItem(item)}>
              <span class="rank">{String(index + 1).padStart(2, '0')}</span>
              <span class="item-image">
                {#if imageFor(item)}<img src={imageFor(item)} alt={nameFor(item)} />{:else}<i>—</i>{/if}
              </span>
              <span class="item-copy"><strong>{brandFor(item)}</strong><small>{nameFor(item)}</small></span>
              <span class="item-value">{numberValue(item.worn)}×</span>
            </button>
          {/each}
        </div>
      </article>

      <article class="panel ranking-panel">
        <div class="panel-head">
          <div><p class="eyebrow">Best value</p><h2>Lowest cost per wear</h2></div>
        </div>
        <div class="item-list">
          {#each bestValue as item, index}
            <button class="item-row" on:click={() => openItem(item)}>
              <span class="rank">{String(index + 1).padStart(2, '0')}</span>
              <span class="item-image">
                {#if imageFor(item)}<img src={imageFor(item)} alt={nameFor(item)} />{:else}<i>—</i>{/if}
              </span>
              <span class="item-copy"><strong>{brandFor(item)}</strong><small>{nameFor(item)}</small></span>
              <span class="item-value">{money(item.cpw, 2)}</span>
            </button>
          {/each}
        </div>
      </article>

      <article class="panel ranking-panel neglected-panel">
        <div class="panel-head">
          <div><p class="eyebrow">Rediscover</p><h2>Out of rotation</h2></div>
        </div>
        <div class="item-list">
          {#each neglected as item}
            <button class="item-row" on:click={() => openItem(item)}>
              <span class="item-image">
                {#if imageFor(item)}<img src={imageFor(item)} alt={nameFor(item)} />{:else}<i>—</i>{/if}
              </span>
              <span class="item-copy"><strong>{brandFor(item)}</strong><small>{nameFor(item)}</small></span>
              <span class="item-value muted-value">{lastWornLabel(item)}</span>
            </button>
          {:else}
            <p class="empty">Everything has been in rotation recently.</p>
          {/each}
        </div>
      </article>
    </section>

    <section class="panel brands-panel">
      <div class="panel-head">
        <div><p class="eyebrow">Brand view</p><h2>The labels doing the work</h2></div>
        <span>Sorted by total wears</span>
      </div>
      <div class="brand-table">
        <div class="brand-row brand-header">
          <span>Brand</span><span>Pieces</span><span>Wears</span><span>Value</span><span>Cost / wear</span>
        </div>
        {#each brandStats as brand}
          <div class="brand-row">
            <strong>{brand.name}</strong>
            <span>{brand.count}</span>
            <span>{brand.wears.toLocaleString()}</span>
            <span>{money(brand.value)}</span>
            <span>{money(brand.cpw, 2)}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</main>

<style>
  :global(body) { background: #f7f7f4; }

  .analytics-page {
    width: min(100%, 1320px);
    margin: 0 auto;
    padding: 0 0 5rem;
    color: #151515;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
  }

  .hero-card {
    min-height: 280px;
    padding: clamp(1.7rem, 5vw, 3.8rem);
    box-sizing: border-box;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 2rem;
    border: 1px solid rgba(255,255,255,.9);
    border-radius: 30px;
    background:
      radial-gradient(circle at 16% 18%, rgba(122,102,255,.20), transparent 31%),
      radial-gradient(circle at 85% 35%, rgba(255,163,76,.18), transparent 28%),
      linear-gradient(135deg, rgba(255,255,255,.94), rgba(255,255,255,.58));
    box-shadow: 0 24px 65px rgba(0,0,0,.07);
  }

  .eyebrow {
    margin: 0 0 .45rem;
    color: #777;
    font-size: .66rem;
    font-weight: 850;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  h1 { margin: 0; max-width: 750px; font-size: clamp(2.5rem, 6vw, 5rem); line-height: .9; letter-spacing: -.07em; }
  h2 { margin: 0; font-size: 1.2rem; letter-spacing: -.035em; }
  .subtitle { max-width: 630px; margin: 1.2rem 0 0; color: #626262; line-height: 1.55; }

  .range-switcher { display: flex; gap: .28rem; padding: .28rem; border-radius: 999px; background: rgba(255,255,255,.7); border: 1px solid rgba(0,0,0,.06); }
  .range-switcher button { min-width: 54px; padding: .58rem .75rem; border: 0; border-radius: 999px; background: transparent; color: #777; cursor: pointer; font-weight: 750; }
  .range-switcher button.active { background: #171717; color: white; }

  .state-card { margin-top: 1rem; padding: 4rem 2rem; text-align: center; border-radius: 24px; background: white; color: #777; }
  .state-card h2 { color: #171717; }
  .state-card button { margin-top: 1rem; border: 0; border-radius: 999px; padding: .75rem 1rem; background: #171717; color: white; cursor: pointer; }
  .state-card.error { color: #9c3340; }

  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin: .8rem 0; }
  .summary-card { position: relative; overflow: hidden; min-height: 126px; padding: 1.15rem; border-radius: 21px; background: rgba(255,255,255,.75); border: 1px solid rgba(255,255,255,.86); box-shadow: 0 16px 42px rgba(0,0,0,.045); }
  .summary-card::after { content: ''; position: absolute; width: 86px; height: 86px; right: -24px; top: -28px; border-radius: 50%; background: var(--accent); opacity: .16; }
  .summary-card span, .summary-card small { display: block; }
  .summary-card span { color: #777; font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .summary-card strong { display: block; margin: .55rem 0 .4rem; font-size: clamp(1.65rem, 3vw, 2.35rem); letter-spacing: -.06em; }
  .summary-card small { color: #777; font-size: .74rem; }
  .accent-purple { --accent: #755cff; } .accent-orange { --accent: #ee8e32; } .accent-blue { --accent: #376ca9; } .accent-green { --accent: #3b8063; }

  .panel { padding: 1.15rem; border-radius: 22px; background: rgba(255,255,255,.76); border: 1px solid rgba(255,255,255,.88); box-shadow: 0 18px 46px rgba(0,0,0,.05); }
  .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
  .panel-head > span { color: #888; font-size: .7rem; }
  .recap-panel { margin-bottom: .8rem; }
  .recap-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
  .recap-actions { display:flex; align-items:center; gap:.35rem; }
  .recap-actions button { min-width:34px; height:34px; padding:0 .65rem; border:1px solid #e5e5e2; border-radius:999px; background:#fff; color:#222; cursor:pointer; }
  .recap-actions .calendar-link { padding:0 .9rem; background:#171717; color:#fff; border-color:#171717; }
  .recap-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.55rem; }
  .recap-stats > div { min-height:86px; padding:.85rem; border-radius:15px; background:#f5f5f2; }
  .recap-stats span,.recap-stats small { display:block; color:#777; font-size:.65rem; }
  .recap-stats span { font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
  .recap-stats strong { display:block; margin:.35rem 0 .2rem; font-size:1.55rem; letter-spacing:-.05em; }
  .recap-detail-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1rem; margin-top:1.2rem; }
  .recap-detail-grid h3 { margin:0 0 .55rem; font-size:.78rem; }
  .recap-list button { width:100%; display:grid; grid-template-columns:auto 42px minmax(0,1fr) auto; gap:.55rem; align-items:center; padding:.5rem 0; border:0; border-top:1px solid #ececea; background:transparent; color:inherit; text-align:left; cursor:pointer; }
  .recap-list button:first-of-type { border-top:0; }
  .recap-list button > span:first-child:not(.item-image):not(.item-copy) { color:#aaa; font-size:.62rem; }
  .recap-list button:has(> .item-image:first-child) { grid-template-columns:42px minmax(0,1fr); }
  .recap-list .item-image { width:42px; height:44px; border-radius:10px; }
  .recap-list b { font-size:.7rem; }
  .recap-categories > div { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.25rem .6rem; padding:.45rem 0; }
  .recap-categories span strong,.recap-categories span small { display:block; }
  .recap-categories span strong { font-size:.74rem; }.recap-categories span small { margin-top:.12rem; color:#888; font-size:.63rem; }
  .recap-categories b { font-size:.68rem; }.recap-categories i { grid-column:1/-1; height:5px; overflow:hidden; border-radius:99px; background:#ececea; }.recap-categories em { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#171717,#755cff); }
  .recap-note { margin:1rem 0 0; color:#999; font-size:.62rem; }
  .insight-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(260px, .45fr); gap: .8rem; }

  .category-list { display: grid; gap: .82rem; }
  .category-row { display: grid; grid-template-columns: minmax(130px, 1fr) auto; gap: .32rem 1rem; align-items: end; }
  .category-copy strong, .category-copy span { display: block; }
  .category-copy strong { font-size: .86rem; }
  .category-copy span { margin-top: .15rem; color: #888; font-size: .7rem; }
  .category-total { font-weight: 850; font-size: .86rem; }
  .bar { grid-column: 1 / -1; height: 7px; border-radius: 999px; overflow: hidden; background: #ececea; }
  .bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #171717, #7a66ff); }

  .rotation-panel { display: flex; flex-direction: column; }
  .utilization-ring { width: 152px; height: 152px; margin: auto; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(#171717 var(--progress), #ececea 0); }
  .utilization-ring::before { content: ''; grid-area: 1 / 1; width: 118px; height: 118px; border-radius: 50%; background: #fff; }
  .utilization-ring div { grid-area: 1 / 1; z-index: 1; text-align: center; }
  .utilization-ring strong, .utilization-ring span { display: block; }
  .utilization-ring strong { font-size: 2rem; letter-spacing: -.06em; }
  .utilization-ring span { color: #888; font-size: .7rem; }
  .rotation-panel > p { margin: 1rem 0 0; text-align: center; color: #777; font-size: .76rem; line-height: 1.45; }

  .rankings { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .8rem; margin-top: .8rem; }
  .item-list { display: grid; }
  .item-row { width: 100%; display: grid; grid-template-columns: auto 46px minmax(0, 1fr) auto; gap: .65rem; align-items: center; padding: .62rem 0; border: 0; border-top: 1px solid rgba(0,0,0,.065); background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .item-row:first-child { border-top: 0; }
  .item-row:hover .item-copy strong { text-decoration: underline; }
  .rank { color: #aaa; font-size: .65rem; font-variant-numeric: tabular-nums; }
  .item-image { width: 46px; height: 50px; display: grid; place-items: center; overflow: hidden; border-radius: 12px; background: #f1f1ef; }
  .item-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .item-image i { color: #aaa; font-style: normal; }
  .item-copy { min-width: 0; }
  .item-copy strong, .item-copy small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-copy strong { font-size: .77rem; }
  .item-copy small { margin-top: .14rem; color: #777; font-size: .69rem; }
  .item-value { font-size: .76rem; font-weight: 850; white-space: nowrap; }
  .muted-value { max-width: 74px; color: #926430; font-size: .65rem; text-align: right; }
  .neglected-panel .item-row { grid-template-columns: 46px minmax(0, 1fr) auto; }
  .empty { color: #888; font-size: .78rem; }

  .brands-panel { margin-top: .8rem; }
  .brand-table { overflow: hidden; }
  .brand-row { display: grid; grid-template-columns: minmax(150px, 1.6fr) repeat(4, minmax(74px, .7fr)); gap: 1rem; padding: .75rem .2rem; border-top: 1px solid rgba(0,0,0,.065); align-items: center; }
  .brand-row strong, .brand-row span { font-size: .78rem; }
  .brand-row span { color: #5f5f5f; }
  .brand-header { border-top: 0; padding-top: 0; }
  .brand-header span { color: #999; font-size: .63rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }

  @media (max-width: 1050px) {
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .rankings { grid-template-columns: repeat(2, 1fr); }
    .neglected-panel { grid-column: 1 / -1; }
    .recap-detail-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }

  @media (max-width: 760px) {
    .hero-card { min-height: 0; align-items: flex-start; flex-direction: column; }
    .insight-grid, .rankings { grid-template-columns: 1fr; }
    .neglected-panel { grid-column: auto; }
    .brand-table { overflow-x: auto; }
    .brand-row { min-width: 650px; }
    .recap-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .recap-detail-grid { grid-template-columns:1fr; }
  }

  @media (max-width: 520px) {
    .summary-grid { grid-template-columns: 1fr; }
    .hero-card { border-radius: 24px; }
    h1 { font-size: 2.65rem; }
    .range-switcher { width: 100%; box-sizing: border-box; }
    .range-switcher button { flex: 1; }
    .recap-head { align-items:flex-start; flex-direction:column; }
    .recap-actions { width:100%; }.recap-actions .calendar-link { flex:1; }
  }
</style>
