<!--
FILE: src/routes/(app)/clothing/analysis/+page.svelte
PURPOSE: Wardrobe Analysis (Inventory Intelligence) — overview, usage, decision support
STYLE: clean, compact, MAAP-like (light)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { collection, getDocs } from 'firebase/firestore';
  import { goto } from '$app/navigation';
  import { itemEditHref } from '$lib/utils/appNavigation';
  import type { User } from 'firebase/auth';
  import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

  type Item = {
    id: string;
    name: string;
    brand: string;
    mainCategory: string;
    lowerCategory: string;
    status: string;
    condition: string;
    worn: number;
    lastWorn: string | null;       // "YYYY-MM-DD" or ISO
    wearLog: string[];             // ["YYYY-MM-DD", ...]
    price: number | null;
    purchaseDate: string | null;   // ISO string or "YYYY-MM-DD"
    imageUrl: string | null;
    color?: string | null;
    labels?: string[];
  };

  type OwnershipStats = {
    new: number;
    gift: number;
    inherited: number;
    secondHand: number;
  };

  let user: User | null = null;
  let items: Item[] = [];
  let loading = true;

  // UI state
  let openNotWorn: Record<number, boolean> = { 60: false, 90: false, 180: false };
  let openMissing = false;
  
  let dismissedReplacementIds: string[] = [];
  let settingsRef: any = null;

  // thresholds for “not worn recently”
  const thresholds = [
    { label: '60 days', days: 60 },
    { label: '90 days', days: 90 },
    { label: '180 days', days: 180 }
  ];

  const mainCategoryOrder = ['Casual', 'Cycling', 'Running', 'Other Sports'];

  function normStatus(s: string) {
    return String(s ?? '').trim().toLowerCase();
  }

  function normBrand(b: string) {
    const x = String(b ?? '').trim();
    return x.length ? x : 'No brand';
  }

  function normText(x: any) {
    return String(x ?? '').trim();
  }

  function parseDateSafe(input: string | null): Date | null {
    if (!input) return null;

    const s = String(input).trim();
    if (!s) return null;

    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;

    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const dd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(dd.getTime())) return dd;
    }

    return null;
  }

  function daysBetween(a: Date, b: Date): number {
    const ms = Math.abs(a.getTime() - b.getTime());
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  function daysSince(dateStr: string | null): number | null {
    const d = parseDateSafe(dateStr);
    if (!d) return null;
    return daysBetween(new Date(), d);
  }

  function maxWearLogDate(wearLog: string[]): string | null {
    if (!Array.isArray(wearLog) || wearLog.length === 0) return null;

    let best: { s: string; t: number } | null = null;

    for (const x of wearLog) {
      const d = parseDateSafe(x);
      if (!d) continue;
      const t = d.getTime();
      if (!best || t > best.t) best = { s: x, t };
    }

    return best ? best.s : null;
  }

  // If lastWorn missing but wearLog exists, use wearLog max date.
  function effectiveLastWorn(i: Item): string | null {
    const lw = i.lastWorn ? String(i.lastWorn).slice(0, 10) : null;
    if (lw && parseDateSafe(lw)) return lw;

    const wl = maxWearLogDate(i.wearLog ?? []);
    if (wl && parseDateSafe(wl)) return String(wl).slice(0, 10);

    return null;
  }

  function money(x: number | null): string {
    if (x == null || isNaN(x)) return '—';
    return `${x.toFixed(0)}€`;
  }

  function safeDiv(a: number, b: number): number {
    if (!b) return 0;
    return a / b;
  }

  // group helpers
  function countBy(arr: Item[], pick: (i: Item) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of arr) {
      const k = pick(it);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  function toSortedPairs(map: Record<string, number>, order?: string[]) {
    const pairs = Object.entries(map);
    if (order?.length) {
      const idx = (k: string) => {
        const i = order.indexOf(k);
        return i === -1 ? 999 : i;
      };
      return pairs.sort(
        (a, b) => idx(a[0]) - idx(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0])
      );
    }
    return pairs.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function normalizedStatus(i: Item): string {
    const s = normStatus(i.status);
    if (!s) return 'unknown';
    if (s === 'active') return 'active';
    if (s === 'sold') return 'sold';
    if (s === 'for sale' || s === 'forsale') return 'for sale';
    if (s === 'lent out' || s === 'lentout') return 'lent out';
    if (s === 'retired') return 'retired';
    return s;
  }

  function isActive(i: Item): boolean {
    return normalizedStatus(i) === 'active';
  }

  function notWornIn(days: number): Item[] {
    return items
      .filter((i) => isActive(i))
      .filter((i) => {
        const lw = effectiveLastWorn(i);
        if (!lw) return true;
        const d = daysSince(lw);
        return d != null && d >= days;
      })
      .sort(
        (a, b) =>
          (daysSince(effectiveLastWorn(b)) ?? 99999) -
          (daysSince(effectiveLastWorn(a)) ?? 99999)
      );
  }

  function monthsSince(dateStr: string | null): number | null {
    const d = parseDateSafe(dateStr);
    if (!d) return null;
    const now = new Date();
    let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 0) months = 0;
    return months;
  }

  function wearFrequency(i: Item): number | null {
    const m = monthsSince(i.purchaseDate);
    if (m == null) return null;
    const months = Math.max(1, m);
    return safeDiv(i.worn ?? 0, months);
  }

  // Exclude <= 0 prices (refunds / profit flips / free items) from CPW.
  function costPerWear(i: Item): number | null {
    if (i.price == null || isNaN(i.price)) return null;
    if (i.price <= 0) return null;
    if (!i.worn) return null;
    return i.price / i.worn;
  }

  // Robust outliers for “balance insights” (lower category concentrations)
  function quartiles(values: number[]) {
    const arr = [...values].sort((a, b) => a - b);
    const q = (p: number) => {
      const pos = (arr.length - 1) * p;
      const base = Math.floor(pos);
      const rest = pos - base;
      const next = arr[base + 1] ?? arr[base];
      return (arr[base] ?? 0) + (next - (arr[base] ?? 0)) * rest;
    };
    return { q1: q(0.25), q2: q(0.5), q3: q(0.75) };
  }

  // reactive derived stats
  $: totalItems = items.length;

  $: statusCounts = countBy(items, (i) => normalizedStatus(i));
  $: brandCounts = countBy(items, (i) => normBrand(i.brand));
  $: mainCounts = countBy(items, (i) => normText(i.mainCategory) || 'Unknown');
  $: lowerCounts = countBy(items, (i) => normText(i.lowerCategory) || 'Unknown');

  $: mainPairs = toSortedPairs(mainCounts, mainCategoryOrder);
  $: lowerPairs = toSortedPairs(lowerCounts);
  $: statusPairs = toSortedPairs(statusCounts, ['active', 'for sale', 'lent out', 'retired', 'sold', 'unknown']);
  $: brandPairs = toSortedPairs(brandCounts);

  $: activeCount = statusCounts['active'] ?? 0;
  $: forSaleCount = statusCounts['for sale'] ?? 0;
  $: retiredCount = statusCounts['retired'] ?? 0;
  $: soldCount = statusCounts['sold'] ?? 0;
  $: lentOutCount = statusCounts['lent out'] ?? 0;

  // fixed: active-only + effectiveLastWorn
  $: notWorn90Count = notWornIn(90).length;

  // chart scaling
  function maxVal(pairs: [string, number][]) {
    return Math.max(1, ...pairs.map(([, v]) => v));
  }

  function pct(v: number, max: number) {
    return `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  }

  $: maxBrand = maxVal(brandPairs.slice(0, 10));
  $: maxLower = maxVal(lowerPairs.slice(0, 10));
  $: maxMain = maxVal(mainPairs);
  $: maxStatus = maxVal(statusPairs);

  $: notWornLists = thresholds.map((t) => {
    const all = notWornIn(t.days);
    const open = !!openNotWorn[t.days];
    return {
      ...t,
      total: all.length,
      items: open ? all : all.slice(0, 12),
      open
    };
  });

  $: mostWorn = [...items]
    .filter(isActive)
    .sort((a, b) => (b.worn ?? 0) - (a.worn ?? 0))
    .slice(0, 12);

  $: wearFrequencyTop = [...items]
    .filter(isActive)
    .map((i) => ({ i, wf: wearFrequency(i) }))
    .filter((x) => x.wf != null)
    .sort((a, b) => (b.wf! - a.wf!))
    .slice(0, 10);

  const REVIEW_DAYS = 90;
  $: reviewItems = items
    .filter(isActive)
    .filter((i) => {
      const cond = normStatus(i.condition);
      const notNew = cond && cond !== 'new';
      const d = daysSince(effectiveLastWorn(i));
      const old = d == null ? true : d >= REVIEW_DAYS;
      return notNew && old;
    })
    .sort(
      (a, b) =>
        (daysSince(effectiveLastWorn(b)) ?? 99999) -
        (daysSince(effectiveLastWorn(a)) ?? 99999)
    )
    .slice(0, 14);

  $: bestValue = [...items]
    .map((i) => ({ i, cpw: costPerWear(i) }))
    .filter((x) => x.cpw != null)
    .sort((a, b) => a.cpw! - b.cpw!)
    .slice(0, 10);

  $: worstValue = [...items]
    .map((i) => ({ i, cpw: costPerWear(i) }))
    .filter((x) => x.cpw != null)
    .sort((a, b) => b.cpw! - a.cpw!)
    .slice(0, 10);

  function balanceInsights(): string[] {
    const pairs = lowerPairs.filter(([, c]) => typeof c === 'number');
    const counts = pairs.map(([, c]) => c);

    if (counts.length < 4) return ['Not enough category data for balance insights.'];

    const { q1, q3 } = quartiles(counts);
    const iqr = Math.max(1, q3 - q1);
    const hi = q3 + 1.5 * iqr;

    const highOutliers = pairs
      .filter(([, c]) => c > hi)
      .slice(0, 5)
      .map(([k, c]) => `${k} (${c})`);

    const rare = [...pairs]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 6)
      .map(([k, c]) => `${k} (${c})`);

    const out: string[] = [];

    if (highOutliers.length) out.push(`Unusually high: ${highOutliers.join(', ')}`);
    out.push(`Rarest categories: ${rare.join(', ')}`);

    const unknownLower = lowerCounts['Unknown'] ?? 0;
    if (unknownLower > Math.max(5, totalItems * 0.05)) {
      out.push(`Many items have missing/Unknown lowerCategory (${unknownLower}) — cleaning this improves analysis.`);
    }

    return out;
  }

  $: insights = balanceInsights();

  // Missing values
  const REQUIRED_FIELDS: Array<{ label: string; check: (i: Item) => boolean }> = [
    { label: 'Status', check: (i) => !!normText(i.status) },
    { label: 'Price (> 0)', check: (i) => typeof i.price === 'number' && !isNaN(i.price) && i.price > 0 },
    { label: 'Purchase date', check: (i) => !!parseDateSafe(i.purchaseDate ?? null) },
    { label: 'Brand', check: (i) => !!normText(i.brand) },
    { label: 'Main category', check: (i) => !!normText(i.mainCategory) },
    { label: 'Lower category', check: (i) => !!normText(i.lowerCategory) },
    { label: 'Condition', check: (i) => !!normText(i.condition) },
    { label: 'Color', check: (i) => !!normText((i as any).color) }
  ];

  type MissingRow = { item: Item; missing: string[] };

  $: missingRows = items
    .map((it) => {
      const missing = REQUIRED_FIELDS.filter((f) => !f.check(it)).map((f) => f.label);
      return { item: it, missing };
    })
    .filter((x) => x.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  onMount(() => {
    const unsub = auth.onAuthStateChanged(async (_user) => {
      if (!_user) return goto('/login');
      user = _user;
      await load();
    });
    return () => unsub();
  });

  async function load() {
  if (!user) return;

  loading = true;

  try {
    const ref = collection(db, 'users', user.uid, 'items');
    const snap = await getDocs(ref);

    items = snap.docs.map((d) => {
      const x: any = d.data();
      return {
        id: d.id,
        name: x.product ?? 'Unnamed',
        brand: x.brand ?? '',
        mainCategory: x.mainCategory ?? 'Other Sports',
        lowerCategory: x.lowerCategory ?? 'Others',
        status: x.status ?? '',
        condition: x.condition ?? '',
        worn: Number(x.worn ?? 0),
        lastWorn: x.lastWorn ?? null,
        wearLog: Array.isArray(x.wearLog) ? x.wearLog : [],
        price: typeof x.price === 'number'
          ? x.price
          : (x.price ? Number(x.price) : null),
        purchaseDate: x.purchaseDate ?? null,
        imageUrl: x.imageUrl ?? null,
        color: x.color ?? null,
        labels: Array.isArray(x.labels) ? x.labels : []
      } as Item;
    });

    /* ---------------- META SETTINGS ---------------- */

    settingsRef = doc(db, 'users', user.uid, 'meta', 'analysis');

    const settingsSnap = await getDoc(settingsRef);

    if (settingsSnap.exists()) {
      const settings = settingsSnap.data() as { dismissedReplacementIds?: unknown };
      dismissedReplacementIds = Array.isArray(settings.dismissedReplacementIds)
        ? settings.dismissedReplacementIds.filter((id): id is string => typeof id === 'string')
        : [];
    } else {
      await setDoc(settingsRef, {
        dismissedReplacementIds: []
      });

      dismissedReplacementIds = [];
    }

  } catch (e) {
    console.error('Analysis load error:', e);
  } finally {
    loading = false;
  }
}

  function toggleNotWorn(days: number) {
    openNotWorn = { ...openNotWorn, [days]: !openNotWorn[days] };
  }
  
  /* =========================
   OWNERSHIP SOURCE STATS
   ========================= */

function ownershipStats(arr: Item[]): OwnershipStats {
  const stats = {
    new: 0,
    gift: 0,
    inherited: 0,
    secondHand: 0
  };

  for (const item of arr) {
    const labels = item.labels ?? [];

    if (labels.includes('Gift')) stats.gift++;
    else if (labels.includes('Inherited')) stats.inherited++;
    else if (labels.includes('Second-Hand')) stats.secondHand++;
    else stats.new++;
  }

  return stats;
}

$: ownershipGlobal = ownershipStats(items);
$: ownershipCycling = ownershipStats(items.filter(i => i.mainCategory === 'Cycling'));
$: ownershipCasual = ownershipStats(items.filter(i => i.mainCategory === 'Casual'));

function totalOwnership(o: OwnershipStats) {
  return o.new + o.gift + o.inherited + o.secondHand;
}

function donutSegments(o: OwnershipStats) {
  const total = totalOwnership(o);
  if (!total) return [];

  const values = [
    { key: 'new', value: o.new, color: '#e5e5e5' },
    { key: 'gift', value: o.gift, color: '#9fd3a7' },
    { key: 'inherited', value: o.inherited, color: '#d8c6a3' },
    { key: 'secondHand', value: o.secondHand, color: '#cfcfcf' }
  ];

  let offset = 0;

  return values.map(v => {
    const fraction = v.value / total;
    const dash = fraction * 100;

    const seg = {
      ...v,
      dash,
      offset
    };

    offset += dash;
    return seg;
  });
}

/* ================================
REPLACEMENT RECOMMENDATION LOGIC
================================ */

/* percentile helper */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((sorted.length - 1) * p);
  return sorted[index] ?? 0;
}

/* normalize condition */
function normCondition(c: string) {
  return String(c ?? '').toLowerCase().trim();
}

/* high-wear threshold (dynamic) */
$: wearValues = items
  .filter(isActive)
  .map(i => i.worn ?? 0);

$: highWearThreshold = percentile(wearValues, 0.8);

/* replacement candidates */
$: replacementCandidates = items
  .filter(isActive)
  .filter(i => (i.worn ?? 0) >= highWearThreshold)
  .filter(i => {
    const c = normCondition(i.condition);
    return c === 'worn' || c === 'damaged';
  })
  .sort((a, b) => (b.worn ?? 0) - (a.worn ?? 0))
  .slice(0, 10);

/* ================================
REPLACEMENT DISMISS SYSTEM
================================ */

async function dismissReplacement(item: Item) {
  if (!user) {
    console.log("No user — abort");
    return;
  }

  console.log("Dismiss clicked for:", item.id);

  dismissedReplacementIds = [...dismissedReplacementIds, item.id];
  lastDismissed = item;

  const ref = doc(db, 'users', user.uid, 'meta', 'analysis');

  try {
    await setDoc(
      ref,
      { dismissedReplacementIds },
      { merge: true }
    );

    console.log("Firestore write successful");
  } catch (e) {
    console.error("Firestore write FAILED:", e);
  }
}

async function undoDismiss() {
  if (!lastDismissed || !user) return;

  dismissedReplacementIds =
    dismissedReplacementIds.filter(id => id !== lastDismissed!.id);

  const ref = doc(db, 'users', user.uid, 'meta', 'analysis');

  await setDoc(
    ref,
    { dismissedReplacementIds },
    { merge: true }
  );

  lastDismissed = null;
  clearTimeout(undoTimer);
}

/* visible candidates (exclude dismissed ones) */
$: visibleReplacementCandidates =
  replacementCandidates.filter(
    i => !dismissedReplacementIds.includes(i.id)
  );

/* undo state */
let lastDismissed: Item | null = null;
let undoTimer: any = null;
</script>

<svelte:head>
  <title>🧠 Wardrobe Analysis</title>
</svelte:head>

<main class="page">
  <!-- ===================================================== -->
  <!-- TOPBAR: Title + Navigation + KPI Cards                -->
  <!-- ===================================================== -->
  <div class="topbar">
    <!-- Title + Nav -->
    <div class="title-row">
      <div>
        <h1>Wardrobe Analysis</h1>
        <p class="sub">See what you own, what you wear, and what should be reviewed.</p>
      </div>

      <div class="nav">
        <button class="btn ghost" on:click={() => goto('/clothing')}>Back</button>
        <button class="btn" on:click={() => goto('/clothing/inventory')}>Inventory</button>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">Items</div>
        <div class="kpi-val">{totalItems}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Active</div>
        <div class="kpi-val">{activeCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">For Sale</div>
        <div class="kpi-val">{forSaleCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Retired</div>
        <div class="kpi-val">{retiredCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Sold</div>
        <div class="kpi-val">{soldCount}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Lent out</div>
        <div class="kpi-val">{lentOutCount}</div>
      </div>
    </div>
  </div>

  <!-- ===================================================== -->
  <!-- STATE: Loading / Empty / Content                      -->
  <!-- ===================================================== -->
  {#if loading}
    <div class="state">Loading analysis…</div>
  {:else if items.length === 0}
    <div class="state">No items found.</div>
  {:else}
    <!-- ===================================================== -->
    <!-- SECTION: INVENTORY CLARITY                            -->
    <!-- ===================================================== -->
    <section class="section">
      <div class="section-head">
        <h2>Inventory clarity</h2>
        <p>Counts by category, brand and status.</p>
      </div>

      <!-- Tile Row 1: Main categories / Status / Top brands -->
      <div class="grid-3">
        <!-- TILE: Main categories -->
        <div class="panel">
          <div class="panel-head">
            <h3>Main categories</h3>
            <span class="pill">count</span>
          </div>

          <div class="bars">
            {#each mainPairs as [k, v]}
              <div class="bar-row">
                <div class="bar-label" title={k}>{k}</div>
                <div class="bar-track">
                  <div class="bar-fill" style={`width:${pct(v, maxMain)}`}></div>
                </div>
                <div class="bar-val">{v}</div>
              </div>
            {/each}
          </div>
        </div>

        <!-- TILE: Status -->
        <div class="panel">
          <div class="panel-head">
            <h3>Status</h3>
            <span class="pill">count</span>
          </div>

          <div class="bars">
            {#each statusPairs as [k, v]}
              <div class="bar-row">
                <div class="bar-label" title={k}>{k}</div>
                <div class="bar-track">
                  <div class="bar-fill" style={`width:${pct(v, maxStatus)}`}></div>
                </div>
                <div class="bar-val">{v}</div>
              </div>
            {/each}
          </div>
        </div>

        <!-- TILE: Top brands -->
        <div class="panel">
          <div class="panel-head">
            <h3>Top brands</h3>
            <span class="pill">count</span>
          </div>

          <div class="bars">
            {#each brandPairs.slice(0, 10) as [k, v]}
              <div class="bar-row">
                <div class="bar-label" title={k}>{k}</div>
                <div class="bar-track">
                  <div class="bar-fill" style={`width:${pct(v, maxBrand)}`}></div>
                </div>
                <div class="bar-val">{v}</div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Tile Row 2: Lower categories / Balance insights -->
      <div class="grid-2" style="margin-top: 1rem;">
        <!-- TILE: Lower categories -->
        <div class="panel">
          <div class="panel-head">
            <h3>Lower categories</h3>
            <span class="pill">top 10</span>
          </div>

          <div class="bars">
            {#each lowerPairs.slice(0, 10) as [k, v]}
              <div class="bar-row">
                <div class="bar-label" title={k}>{k}</div>
                <div class="bar-track">
                  <div class="bar-fill" style={`width:${pct(v, maxLower)}`}></div>
                </div>
                <div class="bar-val">{v}</div>
              </div>
            {/each}
          </div>
        </div>

        <!-- TILE: Balance insights -->
        <div class="panel">
          <div class="panel-head">
            <h3>Balance insights</h3>
            <span class="pill">smarter</span>
          </div>

          <div class="insights">
            {#each insights as t}
              <div class="insight">• {t}</div>
            {/each}
          </div>

          <div class="hint" style="margin-top:.6rem;">
            This flags unusual concentrations + messy categorization, not “you own fewer shoes than shirts”.
          </div>
        </div>
      </div>

      <!-- Tile Row 3: Ownership donuts (Global / Cycling / Casual) -->
      <div class="grid-3" style="margin-top:1rem;">
        <!-- TILE: Ownership — Global -->
        <div class="panel">
          <div class="panel-head">
            <h3>Ownership</h3>
            <span class="pill">all</span>
          </div>

          <div class="donut-wrap">
            <svg viewBox="0 0 42 42" class="donut">
              {#each donutSegments(ownershipGlobal) as seg}
                <circle
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="transparent"
                  stroke={seg.color}
                  stroke-width="4"
                  stroke-dasharray={`${seg.dash} ${100 - seg.dash}`}
                  stroke-dashoffset={-seg.offset}
                />
              {/each}
            </svg>

            <div class="legend">
              <div>New {ownershipGlobal.new}</div>
              <div>Gift {ownershipGlobal.gift}</div>
              <div>Inherited {ownershipGlobal.inherited}</div>
              <div>2nd {ownershipGlobal.secondHand}</div>
            </div>
          </div>
        </div>

        <!-- TILE: Ownership — Cycling -->
        <div class="panel">
          <div class="panel-head">
            <h3>Cycling</h3>
            <span class="pill">source</span>
          </div>

          <div class="donut-wrap">
            <svg viewBox="0 0 42 42" class="donut">
              {#each donutSegments(ownershipCycling) as seg}
                <circle
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="transparent"
                  stroke={seg.color}
                  stroke-width="4"
                  stroke-dasharray={`${seg.dash} ${100 - seg.dash}`}
                  stroke-dashoffset={-seg.offset}
                />
              {/each}
            </svg>

            <div class="legend">
              <div>New {ownershipCycling.new}</div>
              <div>Gift {ownershipCycling.gift}</div>
              <div>Inherited {ownershipCycling.inherited}</div>
              <div>2nd {ownershipCycling.secondHand}</div>
            </div>
          </div>
        </div>

        <!-- TILE: Ownership — Casual -->
        <div class="panel">
          <div class="panel-head">
            <h3>Casual</h3>
            <span class="pill">source</span>
          </div>

          <div class="donut-wrap">
            <svg viewBox="0 0 42 42" class="donut">
              {#each donutSegments(ownershipCasual) as seg}
                <circle
                  cx="21"
                  cy="21"
                  r="15.915"
                  fill="transparent"
                  stroke={seg.color}
                  stroke-width="4"
                  stroke-dasharray={`${seg.dash} ${100 - seg.dash}`}
                  stroke-dashoffset={-seg.offset}
                />
              {/each}
            </svg>

            <div class="legend">
              <div>New {ownershipCasual.new}</div>
              <div>Gift {ownershipCasual.gift}</div>
              <div>Inherited {ownershipCasual.inherited}</div>
              <div>2nd {ownershipCasual.secondHand}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===================================================== -->
    <!-- SECTION: USAGE INTELLIGENCE                            -->
    <!-- ===================================================== -->
    <section class="section">
      <div class="section-head">
        <h2>Usage intelligence</h2>
        <p>What you wear most, and what’s fading out (active items only).</p>
      </div>

      <!-- Row: Most worn / Wear frequency -->
      <div class="grid-2">
        <!-- TILE: Most worn -->
        <div class="panel">
          <div class="panel-head">
            <h3>Most worn</h3>
            <span class="pill">top 12</span>
          </div>

          <div class="list">
            {#each mostWorn as it}
              <div class="rowitem">
                <div class="rowleft">
                  <div class="rowtitle">
                    <div class="thumb" aria-hidden="true">
                      {#if it.imageUrl}
                        <img src={it.imageUrl} alt="" loading="lazy" />
                      {:else}
                        <div class="thumb-ph"></div>
                      {/if}
                    </div>
                    <div class="rowtext">
                      <div class="name">{it.name}</div>
                      <div class="meta">{normBrand(it.brand)} · {it.mainCategory} / {it.lowerCategory}</div>
                    </div>
                  </div>
                </div>
                <div class="rowright">
                  <div class="big">{it.worn}</div>
                  <div class="small">worn</div>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <!-- TILE: Wear frequency -->
        <div class="panel">
          <div class="panel-head">
            <h3>Wear frequency</h3>
            <span class="pill">worn / month</span>
          </div>

          <div class="list">
            {#each wearFrequencyTop as x}
              <div class="rowitem">
                <div class="rowleft">
                  <div class="rowtitle">
                    <div class="thumb" aria-hidden="true">
                      {#if x.i.imageUrl}
                        <img src={x.i.imageUrl} alt="" loading="lazy" />
                      {:else}
                        <div class="thumb-ph"></div>
                      {/if}
                    </div>
                    <div class="rowtext">
                      <div class="name">{x.i.name}</div>
                      <div class="meta">
                        {normBrand(x.i.brand)} · owned {Math.max(1, monthsSince(x.i.purchaseDate) ?? 1)} mo
                      </div>
                    </div>
                  </div>
                </div>
                <div class="rowright">
                  <div class="big">{(x.wf ?? 0).toFixed(1)}</div>
                  <div class="small">/ mo</div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Row: Not worn lists (60/90/180) -->
      <div class="grid-3" style="margin-top: 1rem;">
        {#each notWornLists as block}
          <div class="panel">
            <div class="panel-head">
              <h3>Not worn in {block.label}</h3>

              <div class="panel-actions">
                <span class="pill">{block.total}</span>
                <button class="mini ghost" on:click={() => toggleNotWorn(block.days)}>
                  {block.open ? 'Collapse' : 'Show all'}
                </button>
              </div>
            </div>

            <div class={"list " + (block.open ? 'scroll' : '')}>
              {#if block.total === 0}
                <div class="empty">Nothing here. Nice.</div>
              {:else}
                {#each block.items as it}
                  <div class="rowitem compact">
                    <div class="rowleft">
                      <div class="rowtitle">
                        <div class="thumb" aria-hidden="true">
                          {#if it.imageUrl}
                            <img src={it.imageUrl} alt="" loading="lazy" />
                          {:else}
                            <div class="thumb-ph"></div>
                          {/if}
                        </div>
                        <div class="rowtext">
                          <div class="name">{it.name}</div>
                          <div class="meta">
                            {normBrand(it.brand)} · {it.mainCategory}/{it.lowerCategory} · {daysSince(effectiveLastWorn(it)) ?? '—'}d
                          </div>
                        </div>
                      </div>
                    </div>
                    <button class="mini" on:click={() => goto(itemEditHref(it.id, '/clothing/analysis'))}>Edit</button>
                  </div>
                {/each}

                {#if !block.open}
                  <div class="hint" style="margin-top:.55rem;">
                    Showing top 12. Click “Show all” to expand (scrollable).
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- ===================================================== -->
    <!-- SECTION: DECISION SUPPORT                              -->
    <!-- ===================================================== -->
    <section class="section">
      <div class="section-head">
        <h2>Decision support</h2>
        <p>Review candidates + cost per wear (excludes price ≤ 0).</p>
      </div>

      <div class="grid-2">
        <!-- TILE: Review items -->
        <div class="panel">
          <div class="panel-head">
            <h3>Review items</h3>
            <span class="pill">active · not new · ≥ {REVIEW_DAYS}d</span>
          </div>

          <div class="list">
            {#if reviewItems.length === 0}
              <div class="empty">No review candidates found.</div>
            {:else}
              {#each reviewItems as it}
                <div class="rowitem">
                  <div class="rowleft">
                    <div class="rowtitle">
                      <div class="thumb" aria-hidden="true">
                        {#if it.imageUrl}
                          <img src={it.imageUrl} alt="" loading="lazy" />
                        {:else}
                          <div class="thumb-ph"></div>
                        {/if}
                      </div>
                      <div class="rowtext">
                        <div class="name">{it.name}</div>
                        <div class="meta">
                          {normBrand(it.brand)} · {it.lowerCategory} · condition: {it.condition || '—'} · last worn: {daysSince(effectiveLastWorn(it)) ?? '—'}d
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="rowright">
                    <button class="mini" on:click={() => goto(itemEditHref(it.id, '/clothing/analysis'))}>Edit</button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <div class="hint">
            Tip: set status to <b>for sale</b> / <b>retired</b> once you decide.
          </div>
        </div>

        <!-- TILE: Cost per wear -->
        <div class="panel">
          <div class="panel-head">
            <h3>Cost per wear</h3>
            <span class="pill">price / worn</span>
          </div>

          <div class="split">
            <!-- Best value -->
            <div>
              <div class="split-title">Best value</div>
              <div class="list">
                {#if bestValue.length === 0}
                  <div class="empty">Add price (>0) + wears to see this.</div>
                {:else}
                  {#each bestValue as x}
                    <div class="rowitem compact">
                      <div class="rowleft">
                        <div class="rowtitle">
                          <div class="thumb" aria-hidden="true">
                            {#if x.i.imageUrl}
                              <img src={x.i.imageUrl} alt="" loading="lazy" />
                            {:else}
                              <div class="thumb-ph"></div>
                            {/if}
                          </div>
                          <div class="rowtext">
                            <div class="name">{x.i.name}</div>
                            <div class="meta">{money(x.i.price)} · worn {x.i.worn}</div>
                          </div>
                        </div>
                      </div>
                      <div class="rowright">
                        <div class="big">{x.cpw!.toFixed(1)}€</div>
                        <div class="small">/ wear</div>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Worst value -->
            <div>
              <div class="split-title">Worst value</div>
              <div class="list">
                {#if worstValue.length === 0}
                  <div class="empty">Add price (>0) + wears to see this.</div>
                {:else}
                  {#each worstValue as x}
                    <div class="rowitem compact">
                      <div class="rowleft">
                        <div class="rowtitle">
                          <div class="thumb" aria-hidden="true">
                            {#if x.i.imageUrl}
                              <img src={x.i.imageUrl} alt="" loading="lazy" />
                            {:else}
                              <div class="thumb-ph"></div>
                            {/if}
                          </div>
                          <div class="rowtext">
                            <div class="name">{x.i.name}</div>
                            <div class="meta">{money(x.i.price)} · worn {x.i.worn}</div>
                          </div>
                        </div>
                      </div>
                      <div class="rowright">
                        <div class="big">{x.cpw!.toFixed(1)}€</div>
                        <div class="small">/ wear</div>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          </div>

          <div class="hint" style="margin-top:.65rem;">
            Items with price ≤ 0 are excluded (refunds / profit flips / “free” items).
          </div>
        </div>
      </div>
      
      <div class="panel replacement-panel">
  <div class="panel-head">
    <h3>Replacement suggestions</h3>
    <span class="pill">top wear percentile</span>
  </div>

  <div class="list">
    {#if visibleReplacementCandidates.length === 0}
      <div class="empty">No replacement candidates detected.</div>
    {:else}
      {#each visibleReplacementCandidates as it}
        <div class="rowitem">
          <div class="rowleft row-with-img">
            {#if it.imageUrl}
              <img class="mini-thumb" src={it.imageUrl} alt={it.name} />
            {/if}

            <div>
              <div class="name">{it.name}</div>
              <div class="meta">
                {normBrand(it.brand)} · worn {it.worn} · condition {it.condition || '—'}
              </div>
            </div>
          </div>

          <div class="rowright">
            <button class="mini ghost" on:click={() => dismissReplacement(it)}>
              Dismiss
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if lastDismissed}
    <div class="undo-bar">
      Dismissed “{lastDismissed.name}”
      <button class="mini" on:click={undoDismiss}>Undo</button>
    </div>
  {/if}

  <div class="hint">
    Items above the 80th percentile of wear count with condition "worn" or "damaged".
  </div>
</div>
    </section>

    <!-- ===================================================== -->
    <!-- SECTION: DATA QUALITY                                  -->
    <!-- ===================================================== -->
    <section class="section">
      <div class="section-head">
        <h2>Data quality</h2>
        <p>Find items missing required values (status, price, buy date, color, etc.).</p>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Missing required fields</h3>
          <div class="panel-actions">
            <span class="pill">{missingRows.length}</span>
            <button class="mini ghost" on:click={() => (openMissing = !openMissing)}>
              {openMissing ? 'Collapse' : 'Show'}
            </button>
          </div>
        </div>

        {#if missingRows.length === 0}
          <div class="empty">Nice. No missing required fields detected.</div>
        {:else}
          <div class="hint" style="margin-bottom:.6rem;">
            Sorted by “most missing fields” first. Season/size/temperature are ignored.
          </div>

          <div class={"list " + (openMissing ? 'scroll' : '')}>
            {#each (openMissing ? missingRows : missingRows.slice(0, 12)) as row}
              <div class="rowitem">
                <div class="rowleft">
                  <div class="rowtitle">
                    <div class="thumb" aria-hidden="true">
                      {#if row.item.imageUrl}
                        <img src={row.item.imageUrl} alt="" loading="lazy" />
                      {:else}
                        <div class="thumb-ph"></div>
                      {/if}
                    </div>
                    <div class="rowtext">
                      <div class="name">{row.item.name}</div>
                      <div class="meta">{normBrand(row.item.brand)} · Missing: {row.missing.join(', ')}</div>
                    </div>
                  </div>
                </div>
                <div class="rowright">
                  <button class="mini" on:click={() => goto(itemEditHref(row.item.id, '/clothing/analysis'))}>Edit</button>
                </div>
              </div>
            {/each}
          </div>

          {#if !openMissing}
            <div class="hint" style="margin-top:.6rem;">Showing first 12. Click “Show” for full list (scrollable).</div>
          {/if}
        {/if}
      </div>
    </section>
  {/if}
</main>

<!--
  NOTE:
  This body adds a small thumbnail + brand + item name wherever items are listed.
  Add these styles in your <style> block next (we do that in the next step):

  .rowtitle { display:flex; align-items:center; gap:.55rem; }
  .thumb { width:28px; height:28px; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:#fff; flex:0 0 auto; display:flex; align-items:center; justify-content:center; }
  .thumb img { width:100%; height:100%; object-fit:contain; display:block; }
  .thumb-ph { width:100%; height:100%; background:#f0f0f0; }
  .rowtext { min-width:0; }
-->

<style>
  :root{
    --bg:#f6f6f6;
    --card:#ffffff;
    --border:#e6e6e6;
    --text:#111;
    --muted:#666;

    --pill:#f3f3f3;
    --pill-border:#e2e2e2;

    --accent:#111;
  }

  .page{
    padding:1.4rem;
    padding-bottom:84px;
    background:var(--bg);
    color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;
  }

  .topbar{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:16px;
    padding:1rem;
    margin-bottom:1rem;
  }

  .title-row{
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap: 1rem;
  }

  h1{
    margin:0 0 .25rem;
    font-size:1.2rem;
    font-weight:600;
    letter-spacing:-0.01em;
  }

  .sub{
    margin:0;
    font-size:.9rem;
    color:var(--muted);
  }

  .nav{
    display:flex;
    gap:.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .btn{
    height:36px;
    padding:0 .9rem;
    border-radius:999px;
    border:1px solid var(--border);
    background:#fff;
    font-size:.8rem;
    font-weight: 600;
    cursor:pointer;
    transition: background .12s ease, transform .12s ease;
  }

  .btn:hover{ background:#f3f3f3; transform: translateY(-1px); }
  .btn:active{ transform: scale(.99); }
  .btn.ghost{ background:transparent; }

  .kpis{
    display:grid;
    grid-template-columns:repeat(7,1fr);
    gap:.5rem;
    margin-top:.8rem;
  }

  .kpi{
    background:#fafafa;
    border:1px solid var(--border);
    border-radius:12px;
    padding:.55rem .65rem;
  }

  .kpi-label{
    font-size:.7rem;
    color:var(--muted);
  }

  .kpi-val{
    font-size:1rem;
    font-weight:700;
    margin-top:.15rem;
  }

  @media (max-width: 980px){
    .kpis{ grid-template-columns: repeat(3, 1fr); }
  }

  .state{
    color:var(--muted);
    padding: 1rem .25rem;
  }

  .section{ margin-top:1.2rem; }

  .section-head{
    margin-bottom:.6rem;
  }

  h2{
    font-size:.95rem;
    font-weight:650;
    margin:0 0 .1rem;
    letter-spacing:-0.01em;
  }

  .section-head p{
    margin:0;
    font-size:.85rem;
    color:var(--muted);
  }

  .grid-3{
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:.8rem;
  }

  .grid-2{
    display:grid;
    grid-template-columns:repeat(2,1fr);
    gap:.8rem;
  }

  @media (max-width:900px){
    .grid-3,.grid-2{ grid-template-columns:1fr; }
  }

  .panel{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:14px;
    padding:.9rem;
  }

  .panel-head{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap: .8rem;
    margin-bottom:.6rem;
  }

  .panel-actions{
    display:flex;
    align-items:center;
    gap:.45rem;
  }

  h3{
    margin:0;
    font-size:.85rem;
    font-weight:650;
    letter-spacing:-0.01em;
  }

  .pill{
    font-size:.7rem;
    padding:.2rem .45rem;
    border-radius:999px;
    background:var(--pill);
    border:1px solid var(--pill-border);
    color: #222;
    white-space: nowrap;
  }

  .bars{
    display:flex;
    flex-direction:column;
    gap:.5rem;
  }

  .bar-row{
    display:grid;
    grid-template-columns: 150px 1fr 34px;
    gap:.6rem;
    align-items:center;
    font-size:.8rem;
  }

  .bar-label{
    overflow:hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color:#111;
  }

  .bar-track{
    height:9px;
    border-radius:999px;
    background:#eee;
    overflow:hidden;
    border: 1px solid #e9e9e9;
  }

  .bar-fill{
    height:100%;
    background:#111;
    border-radius:999px;
  }

  .bar-val{
    text-align:right;
    font-weight:700;
    font-variant-numeric: tabular-nums;
  }

  .list{
    display:flex;
    flex-direction:column;
    gap:.5rem;
  }

  .list.scroll{
    max-height: 520px;
    overflow: auto;
    padding-right: .25rem;
  }

  .rowitem{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap: .75rem;
    padding:.55rem .65rem;
    border-radius:12px;
    border:1px solid var(--border);
    background:#fafafa;
  }

  .rowitem.compact{
    padding:.5rem .6rem;
  }

  .rowleft{ min-width: 0; }

  .name{
    font-size:.85rem;
    font-weight:650;
    overflow:hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 52ch;
  }

  .meta{
    font-size:.75rem;
    color:var(--muted);
    overflow:hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 72ch;
  }

  .rowright{
    display:flex;
    flex-direction:column;
    align-items:flex-end;
    gap:.15rem;
  }

  .big{
    font-weight:750;
    font-variant-numeric: tabular-nums;
  }

  .small{
    font-size:.7rem;
    color:var(--muted);
  }

  .mini{
    height:30px;
    padding:0 .75rem;
    border-radius:999px;
    border:1px solid var(--border);
    background:#fff;
    font-size:.75rem;
    font-weight: 650;
    cursor:pointer;
    transition: background .12s ease, transform .12s ease;
  }

  .mini:hover{ background:#f3f3f3; transform: translateY(-1px); }
  .mini:active{ transform: scale(.99); }

  .mini.ghost{
    background: transparent;
  }

  .empty{
    font-size:.85rem;
    color:var(--muted);
    padding:.25rem 0;
  }

  .hint{
    margin-top:.5rem;
    font-size:.8rem;
    color:var(--muted);
    line-height: 1.35;
  }

  .insights{
    display:flex;
    flex-direction:column;
    gap:.35rem;
  }

  .insight{
    font-size:.85rem;
    color:var(--muted);
  }

  .split{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:.8rem;
  }

  @media (max-width:900px){
    .split{ grid-template-columns:1fr; }
  }

  .split-title{
    font-size:.82rem;
    font-weight:700;
    margin-bottom:.45rem;
    color:#111;
  }
  
  /* OWNERSHIP PIE (MAAP minimal) */

.pie{
  display:flex;
  flex-direction:column;
  gap:.4rem;
  font-size:.82rem;
}

.slice{
  display:flex;
  justify-content:space-between;
  padding:.35rem .5rem;
  border-radius:8px;
  border:1px solid var(--border);
  background:#fafafa;
}

.slice.new{
  background:#f6f6f6;
}

.slice.gift{
  background:#eef6f0;
  border-color:#cfe6d6;
}

.slice.inherited{
  background:#f6f2ea;
  border-color:#e4d9c7;
}

.slice.second{
  background:#f1f1f1;
  border-color:#ddd;
}

/* DONUT */

.donut-wrap{
  display:flex;
  align-items:center;
  gap:1rem;
}

.donut{
  width:90px;
  height:90px;
  transform:rotate(-90deg);
}

.legend{
  display:flex;
  flex-direction:column;
  gap:.2rem;
  font-size:.82rem;
  color:var(--muted);
}

/* ================================
ROW TITLE (image + text inline)
================================ */

.rowtitle{
  display:flex;
  align-items:center;
  gap:.55rem;
  min-width:0;
}

/* thumbnail */
.thumb{
  width:28px;
  height:28px;
  border-radius:6px;
  overflow:hidden;
  border:1px solid var(--border);
  background:#fff;
  flex:0 0 28px;
  display:flex;
  align-items:center;
  justify-content:center;
}

.thumb img{
  width:100%;
  height:100%;
  object-fit:contain;
  display:block;
}

.thumb-ph{
  width:100%;
  height:100%;
  background:#f0f0f0;
}

/* text container */
.rowtext{
  display:flex;
  flex-direction:column;
  justify-content:center;
  min-width:0;
}

.row-with-img{
  display:flex;
  align-items:center;
  gap:.55rem;
}

.mini-thumb{
  width:34px;
  height:34px;
  object-fit:contain;
  border-radius:6px;
  background:#fff;
  border:1px solid #eee;
  flex-shrink:0;
}


.replacement-panel {
  margin-top: 1rem;
}
.undo-bar{
  margin-top:.5rem;
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:.8rem;
  color:var(--muted);
  background:#fafafa;
  border:1px solid var(--border);
  border-radius:10px;
  padding:.35rem .5rem;
}

</style>
