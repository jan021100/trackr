<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { collection, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
  import { goto } from '$app/navigation';
  import type { User } from 'firebase/auth';

  let user: User | null = null;
  let items: any[] = [];
  let loading = true;
  let selectedMainCategory = 'All';
  let toastVisible = false;
  let toastMessage = '';

  const lowerCategoryOrder = [
    'Sweaters', 'Hoodies', 'T-Shirts', 'Shirts', 'Polo Shirts', 'Base Layers',
    'SS Jerseys', 'LS Jerseys', 'SS Shirts', 'LS Shirts', 'Jackets', 'Vests',
    'Pants', 'Shorts', 'Chinos', 'Joggers', 'Leggings', 'Jeans',
    'Gloves', 'Headwear', 'Socks', 'Bags', 'Backpacks', 'Glasses', 'Others', 'Leg Warmers',
    'Shoes', 'Running Shoes', 'Sneakers', 'Slides'
  ];

  const mainCategories = ['All', 'Casual', 'Cycling', 'Running', 'Other Sports'];

  function getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  function getYesterdayDate(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  onMount(() => {
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

      const rawItems = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.product ?? 'Unnamed',
          brand: data.brand ?? 'Unknown Brand',
          worn: Number(data.worn ?? 0),
          imageUrl: data.imageUrl ?? null,
          mainCategory: data.mainCategory ?? 'Other Sports',
          lowerCategory: data.lowerCategory ?? 'Others',
          wearLog: Array.isArray(data.wearLog) ? data.wearLog : [],
          lastWorn: data.lastWorn ?? null
        };
      });

      items = rawItems.sort((a, b) => {
        if (a.mainCategory !== b.mainCategory) return a.mainCategory.localeCompare(b.mainCategory);
        const indexA = lowerCategoryOrder.indexOf(a.lowerCategory);
        const indexB = lowerCategoryOrder.indexOf(b.lowerCategory);
        if (indexA !== indexB) return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        return b.worn - a.worn;
      });
    } catch (err) {
      console.error("Error loading items", err);
    } finally {
      loading = false;
    }
  }

  let undoTimeouts: Record<string, any> = {};
  let undoneItems: Record<string, number> = {};

  function showToast(message: string) {
    toastMessage = message;
    toastVisible = true;
    setTimeout(() => {
      toastVisible = false;
    }, 2500);
  }

  function updateItemLocally(updatedItem) {
    items = items.map(item => item.id === updatedItem.id ? { ...updatedItem } : item);
  }

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
    undoneItems[itemId] = updatedItem.worn;
    updateItemLocally(updatedItem);

    undoTimeouts[itemId] = setTimeout(async () => {
      await updateDoc(itemRef, {
        worn: updatedItem.worn,
        lastWorn: today,
        wearLog: arrayUnion(today)
      });
      delete undoTimeouts[itemId];
      delete undoneItems[itemId];
      showToast('✅ Saved');
    }, 8000);
  }

  async function undoWornToday(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item || !user) return;
    const itemRef = doc(db, 'users', user.uid, 'items', itemId);
    const today = getTodayDate();
    const newWearLog = item.wearLog.filter(date => date !== today);

    const updatedItem = {
      ...item,
      worn: Math.max(item.worn - 1, 0),
      wearLog: newWearLog
    };
    updateItemLocally(updatedItem);

    await updateDoc(itemRef, {
      worn: updatedItem.worn,
      wearLog: newWearLog
    });

    clearTimeout(undoTimeouts[itemId]);
    delete undoTimeouts[itemId];
    delete undoneItems[itemId];

    showToast('🕒 Undo successful');
  }

  async function incrementWorn(itemId: string) {
    showDatePickerFor = itemId;
    selectedDate = getTodayDate();
  }

  async function confirmWornWithDate(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item || !user) return;
    const itemRef = doc(db, 'users', user.uid, 'items', itemId);
    const today = selectedDate;

    const updatedItem = {
      ...item,
      worn: item.worn + 1,
      lastWorn: today,
      wearLog: [...item.wearLog, today]
    };
    updateItemLocally(updatedItem);

    await updateDoc(itemRef, {
      worn: updatedItem.worn,
      lastWorn: today,
      wearLog: arrayUnion(today)
    });

    showDatePickerFor = null;
    showToast('✅ Updated');
  }

  let showDatePickerFor: string | null = null;
  let selectedDate: string = getTodayDate();
</script>

<style>
  @import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@400;600;700&display=swap');

  :root {
    --bg-color: #fefefe;
    --card-bg: rgba(255, 255, 255, 0.72);
    --accent-color: #0a84ff;
    --accent-hover: #0060df;
    --text-color: #1c1c1e;
    --subtle-text: #6e6e73;
    --border-color: #d1d1d6;
    --button-bg: #f2f2f7;
    --button-hover: #e5e5ea;
    --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    --card-radius: 1rem;
    --glass-blur: blur(18px);
  }

  main {
    font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 2rem;
    background-color: var(--bg-color);
    min-height: 100vh;
    color: var(--text-color);
    -webkit-font-smoothing: antialiased;
  }

  h1 {
    font-size: 1.75rem;
    margin-bottom: 1rem;
    font-weight: 700;
  }

  .section-header {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 0.5px solid var(--border-color);
  }

  .item-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .item-card {
    backdrop-filter: var(--glass-blur);
    background: var(--card-bg);
    border-radius: var(--card-radius);
    padding: 1rem;
    box-shadow: var(--card-shadow);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    transition: all 0.2s ease;
  }

  .item-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  }

  .item-card img {
    width: 100%;
    max-height: 140px;
    object-fit: contain;
    border-radius: 0.75rem;
    margin-bottom: 1rem;
  }

  .item-card h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0.3rem 0;
  }

  .item-card p {
    font-size: 0.8rem;
    margin: 0.2rem 0;
    color: var(--subtle-text);
  }

  .worn-button {
    margin-top: 0.4rem;
    padding: 0.45rem 0.9rem;
    border: none;
    border-radius: 0.75rem;
    background-color: var(--accent-color);
    color: white;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s ease;
  }

  .worn-button:hover {
    background-color: var(--accent-hover);
  }

  .filter-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 2rem;
  }

  .filter-buttons button {
    padding: 0.5rem 1rem;
    border-radius: 1rem;
    border: 1px solid var(--border-color);
    background: var(--button-bg);
    font-weight: 600;
    cursor: pointer;
    color: var(--text-color);
    transition: all 0.2s ease;
  }

  .filter-buttons button:hover {
    background: var(--button-hover);
  }

  .filter-buttons button.active {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  .back-button {
    margin-bottom: 1.5rem;
    padding: 0.4rem 0.8rem;
    border: none;
    background: transparent;
    color: var(--accent-color);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    transition: color 0.2s;
  }

  .back-button:hover {
    color: var(--accent-hover);
  }

  input[type="date"] {
    border: 1px solid var(--border-color);
    padding: 0.4rem 0.6rem;
    border-radius: 0.6rem;
    font-family: inherit;
    background-color: var(--card-bg);
    color: var(--text-color);
  }
  
  .modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  backdrop-filter: blur(8px);
  background: rgba(240, 240, 245, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: fadeIn 0.2s ease-out;
}

.modal-card {
  background: var(--card-bg);
  backdrop-filter: var(--glass-blur);
  border-radius: 1.25rem;
  padding: 1.5rem;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.15);
  animation: scaleIn 0.25s ease;
}

.modal-card h3 {
  font-size: 1.2rem;
  font-weight: 600;
  margin-bottom: 1rem;
  text-align: center;
}

.modal-card input[type="date"] {
  width: 100%;
  font-size: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-color);
  margin-bottom: 1rem;
}

.modal-card .modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: center;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from {
    transform: scale(0.92);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.toast {
  position: fixed;
  bottom: 6rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(28, 28, 30, 0.85);
  color: white;
  padding: 0.75rem 1.25rem;
  border-radius: 1.25rem;
  font-size: 0.9rem;
  font-weight: 500;
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--card-shadow);
  animation: fadeInOut 2s ease forwards;
  z-index: 9999;
}

@keyframes fadeInOut {
  0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  10%, 90% { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(10px); }
}

.add-item-button {
  background-color: #007aff;
  color: white;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 1.2rem;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  transition: 0.2s ease;
}

.edit-button {
  font-size: 0.5rem;
  background: transparent;
  border: none;
  cursor: pointer;
  margin-bottom: 0.3rem;
  color: #007aff;
  padding: 0.2rem 0.4rem;
}
</style>

<svelte:head>
  <title>👕 Clothing Tracker</title>
</svelte:head>

<main>
  <h1>My Clothing</h1>
  
  <div style="margin-bottom: 1.5rem; display: flex; justify-content: flex-end;">
  <button class="add-item-button" on:click={() => goto('/clothing/add')}>
    ➕ Add Item
  </button>
</div>

  <div class="filter-buttons">
    {#each mainCategories as cat}
      <button class:selected={selectedMainCategory === cat} class:active={selectedMainCategory === cat} on:click={() => selectedMainCategory = cat}>
        {cat}
      </button>
    {/each}
  </div>

  {#if loading}
    <p>Loading clothing…</p>
  {:else if items.length === 0}
    <p>No items found.</p>
  {:else}
    {#each Array.from(new Set(items.map(i => i.mainCategory)))
      .filter(main => selectedMainCategory === 'All' || main === selectedMainCategory)
      as main}
      <div>
        <h2 class="section-header">{main}</h2>
        {#each Array.from(new Set(items.filter(i => i.mainCategory === main).map(i => i.lowerCategory))) as lower}
          <div>
            <h3 class="section-header">{lower}</h3>
            <div class="item-grid">
              {#each items.filter(i => i.mainCategory === main && i.lowerCategory === lower) as item (item.id)}
                <div class="item-card">
                  {#if item.imageUrl}
                    <img src={item.imageUrl} alt={item.name} />
                  {/if}
                  <h2>{item.name}</h2>
                  <p>{item.brand}</p>
                  <p>Worn: {item.worn}</p>
                  {#if item.lastWorn}
                   <p>
                    Last worn:
                       {item.lastWorn.slice(0, 10)}
                      {#if item.lastWorn.slice(0, 10) === getTodayDate()}
                      <span style="color: green; font-weight: 600;">(Today)</span>
                     {/if}
                     </p>
                    {/if}

                  {#if showDatePickerFor === item.id}
                    <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.3rem;">
                      <input type="date" bind:value={selectedDate} max={new Date().toISOString().split('T')[0]} />
                      <div style="display: flex; gap: 0.5rem;">
                        <button class="worn-button" on:click={() => selectedDate = getYesterdayDate()}>Yesterday</button>
                        <button class="worn-button" on:click={() => confirmWornWithDate(item.id)}>Confirm</button>
                        <button class="worn-button" on:click={() => showDatePickerFor = null}>Cancel</button>
                        <button class="worn-button" on:click={async () => {
                          const i = items.find(i => i.id === item.id);
                          if (!i || !user) return;
                          const ref = doc(db, 'users', user.uid, 'items', item.id);
                          await updateDoc(ref, { worn: i.worn + 1 });
                          i.worn += 1;
                          showDatePickerFor = null;
                        }}>Skip Date</button>
                      </div>
                    </div>
                  {:else}
                    <button class="worn-button" on:click={() => incrementWorn(item.id)}>Worn</button>
                  {/if}

                  <button class="worn-button" on:click={() => incrementWornToday(item.id)}>Worn Today</button>

                  {#if undoneItems[item.id]}
                    <button class="worn-button" style="margin-top: 0.4rem;" on:click={() => undoWornToday(item.id)}>Undo</button>
                  {/if}
                
                <button class="edit-button" style="margin-top: 0.4rem;" on:click={() => goto(`/clothing/edit/${item.id}`)}>
                          Edit
                </button>
                      
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
      {#if toastVisible}
  <div class="toast">
    {toastMessage}
  </div>
{/if}
</main>