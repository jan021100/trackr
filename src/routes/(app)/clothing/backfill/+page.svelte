<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, db } from '$lib/firebase';
  import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
  import type { User } from 'firebase/auth';

  let user: User | null = null;
  let items: any[] = [];
  let selectedIds = new Set<string>();
  let loading = true;
  let saving = false;
  let message = '';

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  let selectedDate = todayISO();

  const mainCategoryOrder = ['Cycling', 'Running'];

  const lowerCategoryOrder = [
    'SS Jerseys',
    'LS Jerseys',
    'SS Shirts',
    'LS Shirts',
    'Jackets',
    'Vests',
    'Base Layers',
    'Shorts',
    'Pants',
    'Leggings',
    'Leg Warmers',
    'Gloves',
    'Headwear',
    'Socks',
    'Glasses',
    'Shoes',
    'Running Shoes',
    'Others'
  ];

  onMount(() => {
    const unsubscribe = auth.onAuthStateChanged(async (_user) => {
      if (!_user) {
        goto('/login');
        return;
      }

      user = _user;
      await loadItems();
    });

    return () => unsubscribe();
  });

  async function loadItems() {
    if (!user) return;

    loading = true;

    const ref = collection(db, 'users', user.uid, 'items');
    const snap = await getDocs(ref);

    items = snap.docs
      .map((d) => {
        const data: any = d.data();

        return {
          id: d.id,
          product: data.product ?? data.name ?? '',
          brand: data.brand ?? '',
          imageUrl: data.imageUrl ?? '',
          imageBase64: data.imageBase64 ?? '',
          mainCategory: data.mainCategory ?? '',
          lowerCategory: data.lowerCategory ?? 'Others',
          status: data.status ?? 'active',
          worn: Number(data.worn ?? 0),
          wearLog: Array.isArray(data.wearLog) ? data.wearLog : [],
          lastWorn: data.lastWorn ?? null
        };
      })
      .filter((i) => mainCategoryOrder.includes(i.mainCategory))
      .sort((a, b) => {
        const ma = mainCategoryOrder.indexOf(a.mainCategory);
        const mb = mainCategoryOrder.indexOf(b.mainCategory);

        if (ma !== mb) return ma - mb;

        const ia = lowerCategoryOrder.indexOf(a.lowerCategory);
        const ib = lowerCategoryOrder.indexOf(b.lowerCategory);

        if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);

        return `${a.brand} ${a.product}`.localeCompare(`${b.brand} ${b.product}`);
      });

    loading = false;
  }

  function toggleItem(id: string) {
    const next = new Set(selectedIds);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    selectedIds = next;
  }

  function alreadyLogged(item: any) {
    return item.wearLog.some((d: string) => String(d).slice(0, 10) === selectedDate);
  }

  function nextLastWorn(item: any) {
    if (!item.lastWorn) return selectedDate;

    const current = String(item.lastWorn).slice(0, 10);
    return selectedDate > current ? selectedDate : current;
  }

  async function saveBackfill() {
    if (!user || selectedIds.size === 0) return;

    saving = true;
    message = '';

    const batch = writeBatch(db);
    let changed = 0;
    let skipped = 0;

    const updatedItems = items.map((item) => {
      if (!selectedIds.has(item.id)) return item;

      if (alreadyLogged(item)) {
        skipped += 1;
        return item;
      }

      changed += 1;

      const updated = {
        ...item,
        worn: item.worn + 1,
        wearLog: [...item.wearLog, selectedDate],
        lastWorn: nextLastWorn(item)
      };

      batch.update(doc(db, 'users', user!.uid, 'items', item.id), {
        worn: updated.worn,
        wearLog: updated.wearLog,
        lastWorn: updated.lastWorn
      });

      return updated;
    });

    if (changed > 0) {
      await batch.commit();
      items = updatedItems;
    }

    selectedIds = new Set();

    message =
      skipped > 0
        ? `Saved ${changed} item${changed === 1 ? '' : 's'}. Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}.`
        : `Saved ${changed} item${changed === 1 ? '' : 's'}.`;

    saving = false;
  }

  function groupedLowerCategories(main: string) {
    return Array.from(
      new Set(items.filter((i) => i.mainCategory === main).map((i) => i.lowerCategory))
    );
  }

  $: selectedCount = selectedIds.size;
</script>

<svelte:head>
  <title>Sport Backfill</title>
</svelte:head>

<main class="page">
  <header class="topbar">
    <div>
      <h1>Sport Backfill</h1>
      <p>Retrospectively add visible cycling and running items from old photos.</p>
    </div>

    <button class="ghost" on:click={() => goto('/clothing')}>Back</button>
    <button class="ghost" on:click={() => goto('/clothing/backfill/edit')}>Edit entries</button>
  </header>
  

  <section class="controls">
    <div class="datebox">
      <label>Date</label>
      <input type="date" bind:value={selectedDate} max={todayISO()} />
    </div>

    <div class="selection-summary">
      <strong>{selectedCount}</strong>
      <span>selected</span>
    </div>

    <button class="save" disabled={saving || selectedCount === 0} on:click={saveBackfill}>
      {saving ? 'Saving…' : `Save ${selectedCount}`}
    </button>
  </section>

  {#if message}
    <div class="message">{message}</div>
  {/if}

  {#if loading}
    <p class="state">Loading sport items…</p>
  {:else if items.length === 0}
    <p class="state">No cycling or running items found.</p>
  {:else}
    <section class="list">
      {#each mainCategoryOrder.filter((main) => items.some((i) => i.mainCategory === main)) as main}
        <div class="main-block">
          <h2 class="main-heading">{main}</h2>

          {#each groupedLowerCategories(main) as lower}
            <div class="category-block">
              <h3>{lower}</h3>

              <div class="category-list">
                {#each items.filter((i) => i.mainCategory === main && i.lowerCategory === lower) as item (item.id)}
                  <button
                    type="button"
                    class="row"
                    class:selected={selectedIds.has(item.id)}
                    class:duplicate={alreadyLogged(item)}
                    class:inactive={item.status && item.status !== 'active'}
                    on:click={() => toggleItem(item.id)}
                  >
                    <div class="check">
                      {#if selectedIds.has(item.id)}✓{/if}
                    </div>

                    <div class="img">
                      {#if item.imageBase64}
                        <img src={item.imageBase64} alt={item.product} />
                      {:else if item.imageUrl}
                        <img src={item.imageUrl} alt={item.product} />
                      {:else}
                        <span>No image</span>
                      {/if}
                    </div>

                    <div class="info">
                      <div class="brand">{item.brand}</div>
                      <div class="name">{item.product}</div>
                      <div class="meta">
                        {item.status || 'active'} · worn {item.worn}
                        {#if alreadyLogged(item)}
                          · already logged
                        {/if}
                      </div>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  .page {
    max-width: 1040px;
    margin: auto;
    padding: 1.4rem 1.4rem 5rem;
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
    font-size: 1.5rem;
  }

  p {
    margin: .25rem 0 0;
    color: #777;
    font-size: .9rem;
  }

  .controls {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(247, 247, 247, .9);
    backdrop-filter: blur(14px);
    border: 1px solid #e6e6e6;
    border-radius: 18px;
    padding: .85rem;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: .8rem;
    align-items: end;
    margin-bottom: 1rem;
  }

  .datebox {
    display: flex;
    flex-direction: column;
    gap: .3rem;
  }

  label {
    font-size: .68rem;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #777;
    font-weight: 700;
  }

  input[type="date"] {
    height: 40px;
    border-radius: 10px;
    border: 1px solid #ddd;
    padding: 0 .7rem;
    background: #fff;
  }

  button {
    cursor: pointer;
    font: inherit;
  }

  .save,
  .ghost {
    height: 40px;
    border-radius: 999px;
    padding: 0 1rem;
    border: 1px solid #111;
    background: #111;
    color: white;
    font-weight: 650;
  }

  .save:disabled {
    opacity: .35;
    cursor: not-allowed;
  }

  .ghost {
    background: white;
    color: #111;
    border-color: #ddd;
  }

  .selection-summary {
    height: 40px;
    border-radius: 999px;
    padding: 0 .9rem;
    background: #fff;
    border: 1px solid #e6e6e6;
    display: flex;
    align-items: center;
    gap: .35rem;
  }

  .selection-summary span {
    color: #777;
    font-size: .8rem;
  }

  .message {
    background: #111;
    color: white;
    border-radius: 999px;
    padding: .6rem .9rem;
    display: inline-block;
    margin-bottom: 1rem;
    font-size: .85rem;
  }

  .state {
    padding: 2rem 0;
  }

  .list {
    display: grid;
    gap: 1.3rem;
  }

  .main-block {
    margin-bottom: .8rem;
  }

  .main-heading {
    font-size: 1.05rem;
    font-weight: 800;
    color: #111;
    margin: 1.2rem 0 .7rem;
    padding-bottom: .45rem;
    border-bottom: 1px solid #dcdcdc;
  }

  .category-block {
    margin-bottom: 1rem;
  }

  .category-block h3 {
    font-size: .78rem;
    font-weight: 800;
    color: #666;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin: .9rem 0 .45rem;
  }

  .category-list {
    display: grid;
    gap: .6rem;
  }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 32px 88px 1fr;
    gap: .85rem;
    align-items: center;
    text-align: left;
    border: 1px solid #e6e6e6;
    background: #fff;
    border-radius: 16px;
    padding: .55rem .7rem;
    transition: all .15s ease;
  }

  .row:hover {
    border-color: #bbb;
    transform: translateY(-1px);
  }

  .row.selected {
    border-color: #111;
    background: #f2f2f2;
  }

  .row.duplicate {
    opacity: .55;
  }

  .row.inactive {
    background: #fafafa;
  }

  .check {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid #ccc;
    display: grid;
    place-items: center;
    font-weight: 800;
    background: white;
  }

  .selected .check {
    background: #111;
    color: white;
    border-color: #111;
  }

  .img {
    width: 88px;
    height: 88px;
    border-radius: 14px;
    background: #f4f4f4;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .img img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 7px;
    box-sizing: border-box;
  }

  .img span {
    color: #aaa;
    font-size: .7rem;
  }

  .brand {
    font-weight: 750;
    font-size: .94rem;
  }

  .name {
    color: #333;
    font-size: .86rem;
    margin-top: .1rem;
  }

  .meta {
    color: #777;
    font-size: .78rem;
    margin-top: .25rem;
  }

  @media (max-width: 650px) {
    .topbar,
    .controls {
      grid-template-columns: 1fr;
      display: grid;
    }

    .save,
    .ghost {
      width: 100%;
    }

    .row {
      grid-template-columns: 28px 74px 1fr;
    }

    .img {
      width: 74px;
      height: 74px;
    }
  }
</style>