<!--
FILE: trackr/src/routes/(app)/clothing/+page.svelte
Purpose:
- Clothing list + filters + wear logging UI
- Styling updated for dark / liquid-glass (NO functionality changes)
- Improve product images with white backgrounds by placing them on a subtle “photo mat”
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { collection, getDocs, doc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
  import { goto } from '$app/navigation';
  import type { User } from 'firebase/auth';
 
  import ItemEditor from '$lib/components/ItemEditor.svelte';
  import ItemStatsModal from '$lib/components/ItemStatsModal.svelte';
  import { searchWardrobeItems } from '$lib/utils/wearInsights';
  import type { ImageStorageFormat } from '$lib/utils/imageCompression';

  let user: User | null = null;
  let items: any[] = [];
  let loading = true;

  let selectedMainCategory = 'All';
  let selectedLowerCategory = 'All';
  let searchQuery = '';
  let visibleItems: any[] = [];

  let toastVisible = false;
  let toastMessage = '';
  
  let selectedItem: any = null;
  let showItemModal = false;
  let pendingImageFormat: ImageStorageFormat | null = null;
  
  let selectedStatsItem: any = null;
  let showStatsModal = false;

  function openStatsModal(item: any) {
    selectedStatsItem = JSON.parse(JSON.stringify(item));
    showStatsModal = true;
    document.body.classList.add('modal-open');
  }

  function closeStatsModal() {
    showStatsModal = false;
    selectedStatsItem = null;
    document.body.classList.remove('modal-open');
  }

  const lowerCategoryOrder = [
  'Sweaters',
  'Hoodies',
  'T-Shirts',
  'Shirts',
  'Thick Shirts',
  'Thin Shirts',
  'Polo Shirts',
  'Base Layers',

  'SS Jerseys',
  'LS Jerseys',
  'SS Shirts',
  'LS Shirts',
  'Jackets',
  'Vests',

  'Pants',
  'Shorts',
  'Chinos',
  'Joggers',
  'Leggings',
  'Jeans',

  'Gloves',
  'Headwear',
  'Socks',

  'Bags & Backpacks',
  'Glasses',
  'Others',
  'Leg Warmers',

  'Shoes',
  'Sneakers & Running Shoes',
  'Running Shoes',
  'Sneakers',
  'Slides'
];

  const mainCategories = ['All', 'Casual', 'Cycling', 'Running', 'Other Sports'];

  function getDisplayLowerCategory(item: any): string {
  const main = String(item?.mainCategory ?? '');
  const lower = String(item?.lowerCategory ?? 'Others');

  // Bags and backpacks are displayed together everywhere.
  if (lower === 'Bags' || lower === 'Backpacks') {
    return 'Bags & Backpacks';
  }

  // Only casual running shoes are grouped with casual sneakers.
  if (
    main === 'Casual' &&
    (lower === 'Sneakers' || lower === 'Running Shoes')
  ) {
    return 'Sneakers & Running Shoes';
  }

  return lower;
}

function lowerCategoryIndex(item: any): number {
  const displayCategory = getDisplayLowerCategory(item);
  const index = lowerCategoryOrder.indexOf(displayCategory);

  return index === -1 ? 999 : index;
}

function itemsForDisplayGroup(
  sourceItems: any[],
  main: string,
  displayLower: string
) {
  return sourceItems.filter(
    (item) =>
      item.mainCategory === main &&
      getDisplayLowerCategory(item) === displayLower
  );
}

function displayLowerCategoriesFor(main: string, sourceItems: any[] = items): string[] {
  return Array.from(
    new Set(
      sourceItems
        .filter((item) => item.mainCategory === main)
        .map((item) => getDisplayLowerCategory(item))
    )
  ).sort((a, b) => {
    const indexA = lowerCategoryOrder.indexOf(a);
    const indexB = lowerCategoryOrder.indexOf(b);

    if (indexA !== indexB) {
      return (indexA === -1 ? 999 : indexA) -
        (indexB === -1 ? 999 : indexB);
    }

    return a.localeCompare(b);
  });
}
  
  function getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
  function getYesterdayDate(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  onMount(() => {
  loadCollapsedCategories();

  const savedFormat = new URLSearchParams(window.location.search).get('imageSaved');
  if (savedFormat === 'webp' || savedFormat === 'png') {
    setTimeout(() => showToast(imageSavedMessage(savedFormat)), 0);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('imageSaved');
    window.history.replaceState(window.history.state, '', cleanUrl);
  }

  const unsubscribe = auth.onAuthStateChanged(async (_user) => {
    if (_user) {
      user = _user;
      await loadItems();
    } else {
      goto('/login');
    }
  });

  return () => unsubscribe();
});

  async function loadItems() {
    if (!user) return;
    try {
      const itemsRef = collection(db, 'users', user.uid, 'items');
      const snapshot = await getDocs(itemsRef);

      const rawItems = snapshot.docs.map(docSnap => {
  const data = docSnap.data() as any;

  return {
    id: docSnap.id,

    // TEXT
    name: data.product ?? '',
    brand: data.brand ?? '',

    // IMAGE
    imageUrl: data.imageUrl ?? '',
    imageBase64: data.imageBase64 ?? '',

    // CATEGORY
    mainCategory: data.mainCategory ?? 'Other Sports',
    lowerCategory: data.lowerCategory ?? 'Others',

    // STATUS
    status: data.status ?? 'active',
    condition: data.condition ?? '',
    season: data.season ?? '',

    // META
    price: data.price ?? '',
    size: data.size ?? '',
    temperature: data.temperature ?? '',
    color: data.color ?? '',
    outfitEligible: data.outfitEligible !== false,
    fit: data.fit ?? '',
    pattern: data.pattern ?? '',
    weight: data.weight ?? '',
    style: data.style ?? '',

    // INVENTORY
    quantity: data.quantity ?? 1,
    labels: Array.isArray(data.labels) ? data.labels : [],

    // WEAR
    worn: Number(data.worn ?? 0),
    wearLog: Array.isArray(data.wearLog) ? data.wearLog : [],
    lastWorn: data.lastWorn ?? null,

    // DATE
    purchaseDate: data.purchaseDate ?? null
  };
});

      items = rawItems.sort((a, b) => {
  if (a.mainCategory !== b.mainCategory) {
    return a.mainCategory.localeCompare(b.mainCategory);
  }

  const indexA = lowerCategoryIndex(a);
  const indexB = lowerCategoryIndex(b);

  if (indexA !== indexB) {
    return indexA - indexB;
  }

  const groupA = getDisplayLowerCategory(a);
  const groupB = getDisplayLowerCategory(b);

  if (groupA !== groupB) {
    return groupA.localeCompare(groupB);
  }

  return b.worn - a.worn;
});
    } catch (err) {
      console.error("Error loading items", err);
    } finally {
      loading = false;
    }
  }

  // Helper: sold?
  function isSold(item: any): boolean {
    return String(item?.status ?? '').toLowerCase() === 'sold';
  }
  
  function isSecondHand(item: any): boolean {
  return (item.labels ?? [])
    .map((l: string) => l.toLowerCase())
    .includes('second-hand');
}

function hasLabel(item: any, label: string): boolean {
  return (item.labels ?? [])
    .map((l: string) => l.toLowerCase())
    .includes(label.toLowerCase());
}

  // Lower-Category-Liste für die gewählte Main Category (sortiert nach lowerCategoryOrder)
  function lowerFor(main: string): string[] {
  return displayLowerCategoriesFor(main);
}

  // Toast
  function showToast(message: string) {
    toastMessage = message;
    toastVisible = true;
    setTimeout(() => (toastVisible = false), 2500);
  }

  function imageSavedMessage(format: ImageStorageFormat): string {
    return format === 'webp'
      ? '✅ Image successfully saved as WebP'
      : '✅ Image successfully saved using transparent PNG fallback';
  }
  function updateItemLocally(updatedItem: any) {
  items = items.map((existingItem) =>
    existingItem.id === updatedItem.id
      ? { ...existingItem, ...updatedItem }
      : existingItem
  );
}

  $: visibleItems = searchWardrobeItems(items, searchQuery);

  // Wear flows
  let undoTimeouts: Record<string, any> = {};
  let undoneItems: Record<string, number> = {};

  async function incrementWornToday(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item || !user) return;
    const today = getTodayDate();
    const itemRef = doc(db, 'users', user.uid, 'items', itemId);

    const updatedItem = {
  ...item,
  worn: item.worn + 1,
  lastWorn: today,
  wearLog: [...item.wearLog, today]
};

undoneItems = {
  ...undoneItems,
  [itemId]: updatedItem.worn
};

updateItemLocally(updatedItem);

undoTimeouts[itemId] = setTimeout(async () => {
  await updateDoc(itemRef, {
    worn: updatedItem.worn,
    lastWorn: today,
    wearLog: arrayUnion(today)
  });

  delete undoTimeouts[itemId];

  const { [itemId]: removed, ...remainingUndoneItems } = undoneItems;
  undoneItems = remainingUndoneItems;

  showToast('✅ Saved');
}, 8000);
  }

  async function undoWornToday(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item || !user) return;
    const itemRef = doc(db, 'users', user.uid, 'items', itemId);
    const today = getTodayDate();
    const newWearLog = item.wearLog.filter((date: string) => date !== today);

    const updatedItem = { ...item, worn: Math.max(item.worn - 1, 0), wearLog: newWearLog };
    updateItemLocally(updatedItem);

    await updateDoc(itemRef, { worn: updatedItem.worn, wearLog: newWearLog });

    clearTimeout(undoTimeouts[itemId]);
    delete undoTimeouts[itemId];
    delete undoneItems[itemId];

    showToast('🕒 Undo successful');
  }

  async function incrementWorn(itemId: string) {
    document.body.classList.add('modal-open');
    showDatePickerFor = itemId;
    selectedDate = getTodayDate();
  }

  async function confirmWornWithDate(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item || !user) return;
    const itemRef = doc(db, 'users', user.uid, 'items', itemId);
    const today = selectedDate;

    const updatedItem = { ...item, worn: item.worn + 1, lastWorn: today, wearLog: [...item.wearLog, today] };
    updateItemLocally(updatedItem);

    await updateDoc(itemRef, { worn: updatedItem.worn, lastWorn: today, wearLog: arrayUnion(today) });

    document.body.classList.remove('modal-open');
    showDatePickerFor = null;
    showToast('✅ Updated');
  }

  let showDatePickerFor: string | null = null;
  let selectedDate: string = getTodayDate();

  // Wenn Main-Filter wechselt, Lower auf "All" zurücksetzen
  $: if (selectedMainCategory) selectedLowerCategory = 'All';
  
function openItemModal(item: any) {
  selectedItem = JSON.parse(JSON.stringify(item));
  pendingImageFormat = null;
  showItemModal = true;
  document.body.classList.add('modal-open');
}

function closeItemModal() {
  showItemModal = false;
  selectedItem = null;
  pendingImageFormat = null;
  document.body.classList.remove('modal-open');
}

const COLLAPSED_STORAGE_KEY = 'clothing-collapsed-categories-v1';

let collapsedCategories: Record<string, boolean> = {};

function categoryCollapseKey(main: string, lower: string): string {
  return `${main}::${lower}`;
}

function toggleCategoryCollapsed(main: string, lower: string) {
  const key = categoryCollapseKey(main, lower);

  // Neues Objekt erzeugen, damit Svelte die Änderung sicher erkennt.
  collapsedCategories = {
    ...collapsedCategories,
    [key]: !collapsedCategories[key]
  };

  saveCollapsedCategories();
}

function saveCollapsedCategories() {
  if (typeof localStorage === 'undefined') return;

  const collapsedKeys = Object.entries(collapsedCategories)
    .filter(([, collapsed]) => collapsed)
    .map(([key]) => key);

  localStorage.setItem(
    COLLAPSED_STORAGE_KEY,
    JSON.stringify(collapsedKeys)
  );
}

function loadCollapsedCategories() {
  if (typeof localStorage === 'undefined') return;

  try {
    const saved = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];

    if (!Array.isArray(parsed)) {
      collapsedCategories = {};
      return;
    }

    collapsedCategories = parsed.reduce<Record<string, boolean>>(
      (result, value) => {
        if (typeof value === 'string') {
          result[value] = true;
        }

        return result;
      },
      {}
    );
  } catch (error) {
    console.warn(
      'Could not load collapsed clothing categories:',
      error
    );

    collapsedCategories = {};
  }
}
</script>

<svelte:head>
  <title>👕 Clothing Tracker</title>
</svelte:head>

<main>
  <!-- kompakte, sticky Topbar -->
  <div class="topbar">
    <div class="topline">
      <h1>My Clothing</h1>
      <div class="actions">
        <button class="add-item-button" on:click={() => goto('/clothing/add')}>➕ Add Item</button>
        <button class="add-item-button ghost" on:click={() => goto('/clothing/bulk')}>Edit All</button>
        <button class="add-item-button ghost" on:click={() => goto('/clothing/inventory')}>Inventory</button>
        <button class="add-item-button ghost" on:click={() => goto('/clothing/analysis')}>Analysis</button>
        <button class="add-item-button ghost" on:click={() => goto('/clothing/backfill')}>Backfill</button>
      </div>
    </div>

    <div class="filter-buttons main">
      {#each mainCategories as cat}
        <button
          class:active={selectedMainCategory === cat}
          on:click={() => (selectedMainCategory = cat)}
        >
          {cat}
        </button>
      {/each}
    </div>

    <div class="wardrobe-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        bind:value={searchQuery}
        placeholder="Search item, brand, color, category, status or label"
        aria-label="Search wardrobe"
      />
      {#if searchQuery}
        <span class="search-count">{visibleItems.length} found</span>
        <button type="button" on:click={() => (searchQuery = '')} aria-label="Clear wardrobe search">Clear</button>
      {/if}
    </div>

    {#if selectedMainCategory !== 'All'}
      <div class="filter-buttons lower">
        {#each ['All', ...lowerFor(selectedMainCategory)] as lower}
          <button
            class:active={selectedLowerCategory === lower}
            on:click={() => (selectedLowerCategory = lower)}
          >
            {lower}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if loading}
    <p class="state">Loading clothing…</p>
  {:else if items.length === 0}
    <p class="state">No items found.</p>
  {:else if visibleItems.length === 0}
    <div class="search-empty">
      <strong>No matching pieces</strong>
      <span>Try a brand, color, category, status or label.</span>
      <button type="button" on:click={() => (searchQuery = '')}>Clear search</button>
    </div>
  {:else}
    {#each Array.from(new Set(visibleItems.map(i => i.mainCategory)))
      .filter(main => selectedMainCategory === 'All' || main === selectedMainCategory)
      as main}
      <div>
        <h2 class="section-header">{main}</h2>

        {#each displayLowerCategoriesFor(main, visibleItems)
  .filter(
    (lower) =>
      selectedLowerCategory === 'All' ||
      lower === selectedLowerCategory
  ) as lower}

  {@const collapseKey = categoryCollapseKey(main, lower)}
  {@const collapsed = collapsedCategories[collapseKey] === true}
  {@const groupItems = itemsForDisplayGroup(visibleItems, main, lower)}

  <div class="subcategory">
    <button
      type="button"
      class="subcategory-header"
      class:collapsed={collapsed}
      on:click={() => toggleCategoryCollapsed(main, lower)}
      aria-expanded={!collapsed}
    >
      <span class="subcategory-left">
        <span
          class="collapse-icon"
          class:collapsed={collapsed}
        >
          ›
        </span>

        <span>{lower}</span>
      </span>

      <span class="subcategory-count">
        {groupItems.length}
      </span>
    </button>

    {#if !collapsed}
      <div class="item-grid">
        {#each groupItems as item (item.id)}
                <div class="item-card {isSold(item) ? 'sold' : ''}">
                  {#if isSold(item)}
                    <span class="sold-badge">SOLD</span>
                  {/if}
                      
                  {#if hasLabel(item, 'Second-Hand')}
                    <span class="badge secondhand">2nd</span>
                  {/if}

                  {#if hasLabel(item, 'Gift')}
                    <span class="badge gift">Gift</span>
                  {/if}

                  {#if hasLabel(item, 'Inherited')}
                    <span class="badge inherited">Family</span>
                  {/if}
                  
                  {#if hasLabel(item, 'Legacy')}
                    <span class="badge legacy">Legacy</span>
                  {/if}

                  {#if item.imageBase64}
                    <img src={item.imageBase64} alt={item.name} />
                  {:else if item.imageUrl}
                    <img src={item.imageUrl} alt={item.name} />
                  {/if}

                  <h2>{item.name}</h2>
                  <p>{item.brand}</p>
                  <p>Worn: {item.worn}</p>

                  {#if item.lastWorn}
                    <p>
                      Last worn: {item.lastWorn.slice(0, 10)}
                      {#if item.lastWorn.slice(0, 10) === getTodayDate()}
                        <span class="today">(Today)</span>
                      {/if}
                    </p>
                  {/if}

                  {#if showDatePickerFor === item.id}
                    <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.3rem;">
                      <input type="date" bind:value={selectedDate} max={new Date().toISOString().split('T')[0]} />
                      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <button class="worn-button ghost" on:click={() => (selectedDate = getYesterdayDate())}>Yesterday</button>
                        <button class="worn-button" on:click={() => confirmWornWithDate(item.id)}>Confirm</button>
                        <button
                          class="worn-button ghost"
                          on:click={() => {
                            document.body.classList.remove('modal-open');
                            showDatePickerFor = null;
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          class="worn-button ghost"
                          on:click={async () => {
                            const i = items.find(i => i.id === item.id);
                            if (!i || !user) return;
                            const ref = doc(db, 'users', user.uid, 'items', item.id);
                            await updateDoc(ref, { worn: i.worn + 1 });
                            i.worn += 1;
                            document.body.classList.remove('modal-open');
                            showDatePickerFor = null;
                          }}
                        >
                          Skip Date
                        </button>
                      </div>
                    </div>
                  {:else}
                    {#if !isSold(item)}
                      <button class="worn-button" on:click={() => incrementWorn(item.id)}>
  Worn
</button>

<button class="worn-today-button" on:click={() => incrementWornToday(item.id)}>
  Worn Today
</button>
                    {/if}
                  {/if}

                  {#if undoneItems[item.id]}
                    <button class="worn-button ghost" style="margin-top: 0.4rem;" on:click={() => undoWornToday(item.id)}>Undo</button>
                  {/if}

                  <div class="tile-actions">
  <button class="tile-action" on:click={() => openItemModal(item)}>
    Edit
  </button>

  <button class="tile-action primary" on:click={() => openStatsModal(item)}>
    Stats
  </button>
</div>
                </div>
              {/each}
            </div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}

{#if showItemModal && selectedItem}
  <div class="modal-overlay" on:click={closeItemModal}>
    <div class="modal-card" on:click|stopPropagation>

      <ItemEditor
  item={selectedItem}
  on:cancel={closeItemModal}
  on:imageprocessed={(e) => (pendingImageFormat = e.detail.storageFormat)}

  on:save={async (e) => {
    const updated = e.detail;
    const uid = user?.uid;
    if (!uid) return;

    const ref = doc(db, 'users', uid, 'items', updated.id);

    const payload = {
      product: updated.product ?? updated.name,
      brand: updated.brand,
      imageUrl: updated.imageUrl ?? '',
      imageBase64: updated.imageBase64 ?? '',
      mainCategory: updated.mainCategory ?? '',
      lowerCategory: updated.lowerCategory ?? '',
      status: updated.status ?? '',
      season: updated.season ?? '',
      condition: updated.condition ?? '',
      price: updated.price ?? null,
      size: updated.size ?? '',
      temperature: updated.temperature ?? '',
      color: updated.color ?? '',
      quantity: updated.quantity ?? 1,
      labels: updated.labels ?? [],
      purchaseDate: updated.purchaseDate ?? null,
      outfitEligible: updated.outfitEligible !== false,
      fit: updated.fit ?? '',
      pattern: updated.pattern ?? '',
      weight: updated.weight ?? '',
      style: updated.style ?? ''
    };

    const savedImageFormat = pendingImageFormat;
    await updateDoc(ref, payload);
    updateItemLocally(updated);
    closeItemModal();
    showToast(savedImageFormat ? imageSavedMessage(savedImageFormat) : 'Saved');
  }}

  on:remove={async (e) => {
    const it = e.detail;
    const uid = user?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'items', it.id);
    await deleteDoc(ref);
    items = items.filter(x => x.id !== it.id);
    closeItemModal();
  }}
/>

    </div>
  </div>
{/if}

{#if showStatsModal && selectedStatsItem}
  <div class="modal-overlay" on:click={closeStatsModal}>
    <div class="modal-card stats-modal-card" on:click|stopPropagation>
      <ItemStatsModal
        item={selectedStatsItem}
        on:close={closeStatsModal}
      />
    </div>
  </div>
{/if}
          
  {#if toastVisible}
    <div class="toast">{toastMessage}</div>
  {/if}
</main>

<style>
:root{
  --border:#e6e6e6;
  --text:#111;
  --muted:#666;
  --today:#22c55e;
}

/* PAGE */

main{
  padding:1.2rem 2rem 2rem;
  min-height:100vh;
  background:transparent;
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;
}

/* HEADER */

.topbar{
  margin-bottom:.6rem;
}

.topline{
  display:flex;
  justify-content:space-between;
  align-items:center;
}

.topbar h1{
  font-size:1.25rem;
  font-weight:600;
}

/* ACTION BUTTONS (top-right like MAAP) */

.actions{
  display:flex;
  gap:.4rem;
}

.add-item-button{
  background:transparent;
  border:none;
  font-size:.85rem;
  cursor:pointer;
  color:#111;
}

.add-item-button:hover{
  text-decoration:underline;
}

/* FILTERS */

.filter-buttons{
  display:flex;
  gap:.45rem;
  margin:.4rem 0;
}

.filter-buttons button{
  padding:.28rem .7rem;
  border-radius:999px;
  border:1px solid var(--border);
  background:transparent;
  font-size:.82rem;
}

.filter-buttons button.active{
  background:#111;
  color:#fff;
  border-color:#111;
}

.wardrobe-search{
  min-height:42px;
  margin:.65rem 0 .35rem;
  padding:0 .8rem;
  display:flex;
  align-items:center;
  gap:.55rem;
  border:1px solid var(--border);
  border-radius:12px;
  background:rgba(255,255,255,.82);
}

.wardrobe-search input{
  min-width:0;
  flex:1;
  border:0;
  outline:0;
  background:transparent;
  color:var(--text);
  font:inherit;
}

.wardrobe-search button{
  border:0;
  background:transparent;
  color:#555;
  cursor:pointer;
  font-size:.75rem;
}

.search-count{ color:#888; font-size:.72rem; white-space:nowrap; }
.search-empty{ margin:2rem 0; padding:2.5rem 1rem; display:grid; justify-items:center; gap:.45rem; border:1px dashed #ddd; border-radius:16px; color:#777; text-align:center; }
.search-empty strong{ color:#111; }
.search-empty button{ margin-top:.4rem; padding:.45rem .8rem; border:0; border-radius:999px; background:#111; color:#fff; cursor:pointer; }

/* HEADERS */

.section-header{
  font-size:.95rem;
  font-weight:600;
  margin:1rem 0 .3rem;
  border-bottom:1px solid var(--border);
  padding-bottom:.2rem;
}

/* GRID — 6 columns */

.item-grid{
  display:grid;
  grid-template-columns:repeat(6, 1fr);
  gap:1rem;
}

/* TILE (very minimal) */

.item-card{
  position:relative;
  border:1px solid var(--border);
  border-radius:14px;
  padding:.6rem;
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
  gap:.25rem;
  background:#fff;
}

/* IMAGE — completely clean */

.item-card img{
  width:100%;
  height:150px;
  object-fit:contain;
}

/* TEXT */

.item-card h2{
  font-size:.88rem;
  font-weight:600;
}

.item-card p{
  font-size:.78rem;
  color:var(--muted);
  margin:0;
}

/* TODAY */

.today{
  color:var(--today);
  font-weight:600;
}

/* BUTTONS */

.worn-button{
  margin-top:.25rem;
  padding:.32rem .7rem;
  border-radius:999px;
  border:1px solid #dcdcdc;
  background:#fff;
  font-size:.78rem;
  color:#333;
}

.worn-button:hover{
  background:#f5f5f5;
}

/* subtle emphasis — NOT black */
.worn-today-button{
  margin-top:.25rem;
  padding:.32rem .7rem;
  border-radius:999px;
  border:1px solid #cfcfcf;
  background:#f3f3f3;
  font-size:.78rem;
  font-weight:600;
  color:#111;
}

.worn-today-button:hover{
  background:#eaeaea;
}

/* SOLD */

.item-card.sold{
  opacity:.5;
  filter:grayscale(1);
}

/* EDIT */

.edit-button{
  font-size:.75rem;
  background:transparent;
  border:none;
  cursor:pointer;
  color:#666;
}

/* TOAST */

.toast{
  position:fixed;
  bottom:6rem;
  left:50%;
  transform:translateX(-50%);
  background:#111;
  color:#fff;
  padding:.55rem .9rem;
  border-radius:999px;
  font-size:.85rem;
}

.badge{
  position:absolute;
  top:8px;
  right:8px;
  font-size:.65rem;
  font-weight:600;
  padding:.15rem .45rem;
  border-radius:999px;
  border:1px solid #ddd;
  background:#f3f3f3;
  color:#555;
}

/* MAAP-style muted semantic colors */

.badge.secondhand{
  background:#f1f1f1;
  border-color:#dcdcdc;
}

.badge.gift{
  background:#eef6f0;
  border-color:#cfe6d6;
  color:#2f6b3f;
}

.badge.inherited{
  background:#f6f2ea;
  border-color:#e4d9c7;
  color:#6a5a3a;
}

.badge.legacy{
  background:#f3f4f8;
  border-color:#d8dbe6;
  color:#4a4f6a;
}

.modal-overlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.35);
  display:flex;
  justify-content:center;
  align-items:center;
  z-index:999;
}

.modal-card{
  background:#fff;
  border-radius:16px;
  padding:1.6rem;
  width:900px;
  max-width:96vw;
  max-height:92vh;
  overflow-y:auto;
  display:flex;
  justify-content:center;
}

.modal-img{
  width:100%;
  max-height:200px;
  object-fit:contain;
}

.modal-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:.6rem;
}

.modal-actions{
  display:flex;
  justify-content:flex-end;
  gap:.5rem;
  margin-top:.8rem;
}

.modal-brand{
  color:#666;
  font-size:.85rem;
}

.stats-button {
  color: #111;
  font-weight: 600;
}

.stats-modal-card {
  width: min(1000px, 96vw);
  padding: 0;
  overflow: hidden;
}

.subcategory {
  margin-top: .45rem;
}

.subcategory-header {
  width: 100%;
  min-height: 36px;
  padding: .35rem .2rem;
  margin: .35rem 0 .55rem;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .8rem;

  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;

  color: var(--muted);
  cursor: pointer;
  text-align: left;

  transition:
    color .15s ease,
    border-color .15s ease,
    background .15s ease;
}

.subcategory-header:hover {
  color: var(--text);
  border-bottom-color: #cfcfcf;
}

.subcategory-header.collapsed {
  margin-bottom: .25rem;
  border-bottom-color: #ededed;
}

.subcategory-left {
  display: flex;
  align-items: center;
  gap: .45rem;

  font-size: .82rem;
  font-weight: 650;
}

.collapse-icon {
  width: 18px;
  height: 18px;

  display: grid;
  place-items: center;

  font-size: 1.15rem;
  line-height: 1;
  color: #999;

  transform: rotate(90deg);
  transition: transform .18s ease;
}

.collapse-icon.collapsed {
  transform: rotate(0deg);
}

.subcategory-count {
  min-width: 24px;
  height: 22px;
  padding: 0 .45rem;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid #e3e3e3;
  border-radius: 999px;
  background: rgba(255,255,255,.7);

  color: #888;
  font-size: .7rem;
  font-weight: 650;
}

@media(max-width:1100px){.item-grid{grid-template-columns:repeat(4,1fr)}}
@media(max-width:760px){
  main{min-height:100dvh;padding:.75rem .15rem 2rem}
  .topline{align-items:flex-start;gap:.7rem}
  .topbar h1{margin:.6rem 0}
  .actions{flex-wrap:wrap;justify-content:flex-end}
  .filter-buttons{padding-bottom:.25rem;overflow-x:auto;overscroll-behavior-inline:contain}
  .filter-buttons button{min-height:40px;white-space:nowrap}
  .item-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}
  .item-card{min-width:0;padding:.5rem}
  .item-card img{height:125px}
  .item-card h2{margin:.45rem 0 .15rem;font-size:.8rem}
  .worn-button,.worn-today-button{min-height:40px}
  .modal-overlay{padding:max(.5rem,env(safe-area-inset-top)) .5rem max(.5rem,env(safe-area-inset-bottom));box-sizing:border-box}
  .modal-card{width:100%;max-width:100%;max-height:calc(100dvh - max(1rem,env(safe-area-inset-top) + env(safe-area-inset-bottom)));padding:.75rem;border-radius:14px}
}
</style>
