<script lang="ts">
  import { goto } from '$app/navigation';
  import { db } from '$lib/firebase';
  import { user, userReady } from '$lib/stores/user';
  import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';

  type Item = {
    id: string;
    brand: string;
    product: string;
    mainCategory: string;
    lowerCategory: string;
    status: string;
    worn: number;
    wearLog: string[];
    lastWorn: string | null;
  };

  type DateGroup = {
    date: string;
    count: number;
    items: Item[];
  };

  let items: Item[] = [];
  let dateGroups: DateGroup[] = [];

  let loading = true;
  let saving = false;
  let message = '';
  let error = '';
  let loadedUid: string | null = null;
  let editedDates: Record<string, string> = {};

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysAgoISO(days: number) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  let filterFrom = daysAgoISO(14);
  let filterTo = todayISO();

  function normalizeDate(value: any): string | null {
    if (!value) return null;

    if (typeof value === 'string') {
      const sliced = value.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(sliced) ? sliced : null;
    }

    if (value?.seconds) {
      return new Date(value.seconds * 1000).toISOString().slice(0, 10);
    }

    return null;
  }

  function isInRange(date: string) {
    if (filterFrom && date < filterFrom) return false;
    if (filterTo && date > filterTo) return false;
    return true;
  }

  function rebuildDateGroups() {
    const map = new Map<string, Item[]>();

    for (const item of items) {
      for (const date of item.wearLog) {
        if (!date) continue;
        if (!isInRange(date)) continue;

        if (!map.has(date)) map.set(date, []);
        map.get(date)!.push(item);
      }
    }

    dateGroups = Array.from(map.entries())
      .map(([date, linkedItems]) => ({
        date,
        count: linkedItems.length,
        items: linkedItems.sort((a, b) =>
          `${a.mainCategory} ${a.lowerCategory} ${a.brand} ${a.product}`.localeCompare(
            `${b.mainCategory} ${b.lowerCategory} ${b.brand} ${b.product}`
          )
        )
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 200);
  }

  async function loadItems(uid: string) {
    loading = true;
    error = '';
    message = '';

    try {
      const snap = await getDocs(collection(db, 'users', uid, 'items'));

      items = snap.docs.map((d) => {
        const data: any = d.data();

        const wearLog = Array.isArray(data.wearLog)
          ? (data.wearLog
              .map((x: any) => normalizeDate(x))
              .filter((x: string | null) => Boolean(x)) as string[])
          : [];

        return {
          id: d.id,
          brand: data.brand ?? '',
          product: data.product ?? data.name ?? '',
          mainCategory: data.mainCategory ?? '',
          lowerCategory: data.lowerCategory ?? '',
          status: data.status ?? 'active',
          worn: Number(data.worn ?? wearLog.length),
          wearLog,
          lastWorn: normalizeDate(data.lastWorn)
        };
      });

      rebuildDateGroups();
    } catch (e) {
      console.error(e);
      error = 'Could not load item logs.';
    } finally {
      loading = false;
    }
  }

  $: if ($userReady && $user?.uid && loadedUid !== $user.uid) {
    loadedUid = $user.uid;
    loadItems($user.uid);
  }

  $: if ($userReady && !$user?.uid) {
    goto('/login');
  }

  $: if (items.length) {
    filterFrom;
    filterTo;
    rebuildDateGroups();
  }

  function setPreset(days: number) {
    filterFrom = daysAgoISO(days);
    filterTo = todayISO();
  }

  function showAll() {
    filterFrom = '';
    filterTo = '';
  }

  function uniqueSorted(log: string[]) {
    return Array.from(new Set(log.filter(Boolean))).sort();
  }

  function maxDate(log: string[]) {
    if (!log.length) return null;
    return [...log].sort().at(-1) ?? null;
  }

  async function saveDateChange(oldDate: string) {
    const uid = $user?.uid;
    const newDate = editedDates[oldDate];

    if (!uid || !newDate || newDate === oldDate) return;

    saving = true;
    message = '';
    error = '';

    try {
      const batch = writeBatch(db);
      let changedItems = 0;

      const updatedItems = items.map((item) => {
        if (!item.wearLog.includes(oldDate)) return item;

        const replaced = item.wearLog.map((d) => (d === oldDate ? newDate : d));
        const cleanLog = uniqueSorted(replaced);

        const updated = {
          ...item,
          wearLog: cleanLog,
          worn: cleanLog.length,
          lastWorn: maxDate(cleanLog)
        };

        batch.update(doc(db, 'users', uid, 'items', item.id), {
          wearLog: updated.wearLog,
          worn: updated.worn,
          lastWorn: updated.lastWorn
        });

        changedItems += 1;
        return updated;
      });

      if (changedItems > 0) {
        await batch.commit();
        items = updatedItems;
        rebuildDateGroups();
      }

      delete editedDates[oldDate];
      editedDates = { ...editedDates };

      message = `Changed ${oldDate} → ${newDate} in ${changedItems} item${changedItems === 1 ? '' : 's'}.`;
    } catch (e) {
      console.error(e);
      error = 'Save failed.';
    } finally {
      saving = false;
    }
  }

  async function deleteDateEverywhere(dateToDelete: string) {
    const uid = $user?.uid;
    if (!uid) return;

    const ok = confirm(`Remove ${dateToDelete} from all item wear logs?`);
    if (!ok) return;

    saving = true;
    message = '';
    error = '';

    try {
      const batch = writeBatch(db);
      let changedItems = 0;

      const updatedItems = items.map((item) => {
        if (!item.wearLog.includes(dateToDelete)) return item;

        const cleanLog = uniqueSorted(item.wearLog.filter((d) => d !== dateToDelete));

        const updated = {
          ...item,
          wearLog: cleanLog,
          worn: cleanLog.length,
          lastWorn: maxDate(cleanLog)
        };

        batch.update(doc(db, 'users', uid, 'items', item.id), {
          wearLog: updated.wearLog,
          worn: updated.worn,
          lastWorn: updated.lastWorn
        });

        changedItems += 1;
        return updated;
      });

      if (changedItems > 0) {
        await batch.commit();
        items = updatedItems;
        rebuildDateGroups();
      }

      message = `Removed ${dateToDelete} from ${changedItems} item${changedItems === 1 ? '' : 's'}.`;
    } catch (e) {
      console.error(e);
      error = 'Delete failed.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Edit Backfill Entries</title>
</svelte:head>

<main class="page">
  <header class="topbar">
    <div>
      <h1>Edit Backfill Entries</h1>
      <p>Filter by wear date, then change or remove mistaken dates across all item logs.</p>
    </div>

    <button class="ghost" on:click={() => goto('/clothing/backfill')}>Backfill</button>
  </header>

  <section class="filters">
    <div class="field">
      <label>From</label>
      <input type="date" bind:value={filterFrom} />
    </div>

    <div class="field">
      <label>To</label>
      <input type="date" bind:value={filterTo} max={todayISO()} />
    </div>

    <div class="presets">
      <button class="ghost small" on:click={() => setPreset(7)}>7d</button>
      <button class="ghost small" on:click={() => setPreset(14)}>14d</button>
      <button class="ghost small" on:click={() => setPreset(30)}>30d</button>
      <button class="ghost small" on:click={showAll}>All</button>
    </div>

    <div class="count">
      {dateGroups.length} date group{dateGroups.length === 1 ? '' : 's'}
    </div>
  </section>

  {#if message}
    <div class="message success">{message}</div>
  {/if}

  {#if error}
    <div class="message error">{error}</div>
  {/if}

  {#if loading}
    <p class="state">Loading wear logs…</p>
  {:else if dateGroups.length === 0}
    <p class="state">No wear logs found in this date range.</p>
  {:else}
    <section class="list">
      {#each dateGroups as group}
        <div class="date-card">
          <div class="date-row">
            <div class="date-main">
              <strong>{group.date}</strong>
              <span>{group.count} item{group.count === 1 ? '' : 's'}</span>
            </div>

            <div class="edit-row">
              <input type="date" max={todayISO()} bind:value={editedDates[group.date]} />

              <button
                class="save"
                disabled={saving || !editedDates[group.date]}
                on:click={() => saveDateChange(group.date)}
              >
                Save
              </button>

              <button class="danger" disabled={saving} on:click={() => deleteDateEverywhere(group.date)}>
                Remove
              </button>
            </div>
          </div>

          <div class="items">
            {#each group.items as item}
              <div class="item-line">
                <span>{item.mainCategory}</span>
                <strong>{item.brand}</strong>
                <em>{item.product}</em>
                <small>{item.lowerCategory} · {item.status}</small>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  .page {
    max-width: 1060px;
    margin: auto;
    padding: 1.5rem 1.4rem 5rem;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
    color: #111;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1.2rem;
  }

  h1 {
    margin: 0;
    font-size: 1.45rem;
  }

  p {
    margin: .25rem 0 0;
    color: #777;
    font-size: .92rem;
  }

  .filters {
    border: 1px solid #e6e6e6;
    background: #fff;
    border-radius: 16px;
    padding: .85rem;
    display: grid;
    grid-template-columns: 170px 170px auto 1fr;
    gap: .7rem;
    align-items: end;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: .25rem;
  }

  label {
    font-size: .65rem;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #777;
    font-weight: 700;
  }

  input {
    height: 36px;
    border-radius: 10px;
    border: 1px solid #ddd;
    padding: 0 .65rem;
    background: #fff;
  }

  button {
    height: 36px;
    border-radius: 999px;
    border: 1px solid #111;
    background: #111;
    color: white;
    padding: 0 .9rem;
    cursor: pointer;
    font-weight: 650;
    font-size: .82rem;
  }

  button:disabled {
    opacity: .35;
    cursor: not-allowed;
  }

  .ghost {
    background: white;
    color: #111;
    border-color: #ddd;
  }

  .small {
    padding: 0 .7rem;
  }

  .danger {
    background: #fff;
    color: #b91c1c;
    border-color: #f0b5b5;
  }

  .presets {
    display: flex;
    gap: .35rem;
  }

  .count {
    color: #777;
    font-size: .85rem;
    justify-self: end;
    padding-bottom: .55rem;
  }

  .message {
    display: inline-block;
    border-radius: 999px;
    padding: .55rem .85rem;
    margin-bottom: 1rem;
    font-size: .85rem;
  }

  .message.success {
    background: #111;
    color: white;
  }

  .message.error {
    background: #fee2e2;
    color: #991b1b;
  }

  .state {
    padding: 2rem 0;
  }

  .list {
    display: grid;
    gap: .85rem;
  }

  .date-card {
    border: 1px solid #e6e6e6;
    background: #fff;
    border-radius: 16px;
    padding: .9rem;
  }

  .date-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    border-bottom: 1px solid #eee;
    padding-bottom: .75rem;
    margin-bottom: .75rem;
  }

  .date-main {
    display: flex;
    align-items: baseline;
    gap: .55rem;
  }

  .date-main strong {
    font-size: 1rem;
  }

  .date-main span {
    color: #777;
    font-size: .86rem;
  }

  .edit-row {
    display: flex;
    gap: .45rem;
    align-items: center;
  }

  .items {
    display: grid;
    gap: .35rem;
  }

  .item-line {
    display: grid;
    grid-template-columns: 90px 130px 1fr 190px;
    gap: .65rem;
    font-size: .85rem;
    align-items: center;
  }

  .item-line span {
    color: #777;
  }

  .item-line em {
    font-style: normal;
    color: #333;
  }

  .item-line small {
    color: #888;
  }

  @media (max-width: 850px) {
    .topbar,
    .date-row,
    .edit-row {
      flex-direction: column;
      align-items: stretch;
    }

    .filters {
      grid-template-columns: 1fr;
    }

    .count {
      justify-self: start;
      padding-bottom: 0;
    }

    .item-line {
      grid-template-columns: 1fr;
      gap: .1rem;
      padding: .45rem 0;
      border-bottom: 1px solid #f1f1f1;
    }

    button,
    input {
      width: 100%;
    }

    .presets {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>