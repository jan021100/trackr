<script lang="ts">
  import { onMount } from 'svelte';
  import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
  import { db } from '$lib/firebase';
  import { get } from 'svelte/store';
  import { user } from '$lib/stores/user';

  type Item = {
    id: string;
    brand: string;
    color: string;
    condition: string;
    imageUrl: string;
    index: number;
    lastWorn: string;
    lowerCategory: string;
    mainCategory: string;
    price: number;
    product: string;
    purchaseDate: string;
    rating: number;
    season: string;
    size: string;
    status: string;
    temperature: string;
    worn: number;
    wearLog: string[];
  };

  let items: Item[] = [];
  let loading = true;

  const fields: [string, keyof Item][] = [
    ['Product', 'product'],
    ['Brand', 'brand'],
    ['Color', 'color'],
    ['Main Category', 'mainCategory'],
    ['Lower Category', 'lowerCategory'],
    ['Status', 'status'],
    ['Size', 'size'],
    ['Condition', 'condition'],
    ['Season', 'season'],
    ['Temperature', 'temperature'],
    ['Last Worn', 'lastWorn'],
    ['Purchase Date', 'purchaseDate'],
    ['Worn Count', 'worn'],
    ['Rating', 'rating'],
    ['Price (€)', 'price']
  ];

  const mainCategoryOrder = ['Casual', 'Cycling', 'Running', 'Other Sports'];
  const lowerCategoryOrder = [
    'T-Shirt', 'Longsleeve', 'Shirt', 'Sweater', 'Hoodie',
    'Jacket', 'Vest', 'Shorts', 'Pants', 'Tights',
    'Underwear', 'Shoes', 'Socks', 'Cap', 'Gloves',
    'Neckwear', 'Accessories'
  ];

  onMount(async () => {
  const currentUser = get(user);
  if (!currentUser?.uid) return;

  const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'items'));
  items = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  })) as Item[];

  const mainCategoryOrder = ['Cycling', 'Running', 'Casual', 'Other Sports'];
  const lowerCategoryOrder = [
    'Jersey', 'Bib Shorts', 'Base Layer', 'Jacket', 'Gilet', 'Arm Warmers', 'Leg Warmers', 'Gloves',
    'Cap', 'Socks', 'Shoes', 'Tights', 'Shorts', 'Pants', 'Shirt', 'T-Shirt', 'Longsleeve',
    'Sweater', 'Hoodie', 'Underwear', 'Neckwear', 'Accessories'
  ];

  items.sort((a, b) => {
    const mainA = mainCategoryOrder.indexOf(a.mainCategory);
    const mainB = mainCategoryOrder.indexOf(b.mainCategory);
    if (mainA !== mainB) return (mainA === -1 ? 999 : mainA) - (mainB === -1 ? 999 : mainB);

    const lowerA = lowerCategoryOrder.indexOf(a.lowerCategory);
    const lowerB = lowerCategoryOrder.indexOf(b.lowerCategory);
    if (lowerA !== lowerB) return (lowerA === -1 ? 999 : lowerA) - (lowerB === -1 ? 999 : lowerB);

    return a.product?.toLowerCase().localeCompare(b.product?.toLowerCase());
  });

  loading = false;
});

  async function saveItem(item: Item) {
    const currentUser = get(user);
    if (!currentUser?.uid) return;

    const ref = doc(db, 'users', currentUser.uid, 'items', item.id);
    await updateDoc(ref, { ...item });
  }
</script>

{#if loading}
  <main>
    <p>Loading items...</p>
  </main>
{:else}
  <main>
    <h1>Bulk Edit Clothing</h1>
    <div class="item-grid">
      {#each items as item (item.id)}
        <div class="item-card">
          {#if item.imageUrl}
            <img src={item.imageUrl} alt="Item image" />
          {/if}
          <div class="grid grid-cols-1 gap-2 w-full">
            {#each fields as [label, field]}
              <div>
                <label class="text-xs font-medium text-gray-500">{label}</label>
                {#if field === 'lastWorn' || field === 'purchaseDate'}
                  <input type="date" bind:value={item[field]} />
                {:else if field === 'worn' || field === 'rating' || field === 'price'}
                  <input type="number" bind:value={item[field]} />
                {:else}
                  <input type="text" bind:value={item[field]} />
                {/if}
              </div>
            {/each}
          </div>
          <button class="worn-button" on:click={() => saveItem(item)}>
            💾 Save
          </button>
        </div>
      {/each}
    </div>
  </main>
{/if}

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

  .item-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1.5rem;
  }

  .item-card {
    backdrop-filter: var(--glass-blur);
    background: var(--card-bg);
    border-radius: var(--card-radius);
    padding: 1rem;
    box-shadow: var(--card-shadow);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    transition: all 0.2s ease;
  }

  .item-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  }

  .item-card img {
    width: 100%;
    max-height: 120px;
    object-fit: contain;
    border-radius: 0.75rem;
    margin-bottom: 1rem;
  }

  input[type="text"],
  input[type="number"],
  input[type="date"] {
    width: 100%;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    border-radius: 0.6rem;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-color);
    margin-top: 0.2rem;
  }

  .worn-button {
    margin-top: 0.8rem;
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
</style>
