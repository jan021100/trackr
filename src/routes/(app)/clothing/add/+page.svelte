<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { collection, addDoc, getDocs } from 'firebase/firestore';
  import type { User } from 'firebase/auth';

  let user: User | null = null;
  let name = '';
  let brand = '';
  let imageUrl = '';
  let mainCategory = '';
  let lowerCategory = '';
  let status = 'active';
  let rating = '';
  let season = '';
  let condition = '';
  let price = '';
  let size = '';
  let temperature = '';
  let color = '';

  const mainCategories = ['Casual', 'Cycling', 'Running', 'Other Sports'];
  const lowerCategories = [
    'Sweaters', 'Hoodies', 'T-Shirts', 'Shirts', 'Polo Shirts', 'Base Layers',
    'SS Jerseys', 'LS Jerseys', 'SS Shirts', 'LS Shirts', 'Jackets', 'Vests',
    'Pants', 'Shorts', 'Chinos', 'Joggers', 'Leggings', 'Jeans',
    'Gloves', 'Headwear', 'Socks', 'Bags', 'Backpacks', 'Glasses', 'Others', 'Leg Warmers',
    'Shoes', 'Running Shoes', 'Sneakers', 'Slides'
  ];
  const statuses = ['active', 'lent out', 'sold', 'for sale', 'retired'];
  const ratings = ['1', '2', '3', '4', '5'];
  const seasons = ['1/3', '2/3', '3/3', 'X/3'];
  const conditions = ['new', 'like new', 'good', 'worn', 'damaged'];

  const colors = [
    { name: 'black', hex: '#1C1C1E' },
    { name: 'white', hex: '#F5F5F5' },
    { name: 'grey', hex: '#C7C7CC' },
    { name: 'navy', hex: '#1F3A93' },
    { name: 'blue', hex: '#007AFF' },
    { name: 'lightblue', hex: '#5AC8FA' },
    { name: 'green', hex: '#34C759' },
    { name: 'olive', hex: '#808000' },
    { name: 'yellow', hex: '#FFCC00' },
    { name: 'orange', hex: '#FF9500' },
    { name: 'red', hex: '#FF3B30' },
    { name: 'pink', hex: '#FF2D55' },
    { name: 'purple', hex: '#AF52DE' },
    { name: 'brown', hex: '#A2845E' }
  ];

  let allBrands: string[] = [];
  let brandSuggestions: string[] = [];

  function updateBrandSuggestions() {
    const query = brand.toLowerCase();
    brandSuggestions = allBrands.filter(b => b.toLowerCase().includes(query));
  }

  onMount(async () => {
    const unsubscribe = auth.onAuthStateChanged(async (_user) => {
      if (_user) {
        user = _user;
        const snapshot = await getDocs(collection(db, 'users', user.uid, 'items'));
        allBrands = Array.from(new Set(snapshot.docs.map(doc => doc.data().brand).filter(Boolean)));
      } else {
        goto('/login');
      }
    });
    return () => unsubscribe();
  });

  async function saveItem() {
    if (!user) return;
    const itemsRef = collection(db, 'users', user.uid, 'items');
    await addDoc(itemsRef, {
      product: name,
      brand,
      imageUrl,
      mainCategory,
      lowerCategory,
      status,
      rating,
      season,
      condition,
      price: parseFloat(price) || null,
      size,
      temperature,
      color,
      worn: 0,
      wearLog: [],
      lastWorn: null
    });
    goto('/clothing');
  }
</script>

<main class="form-wrapper">
  <h1>Add New Item</h1>
  <form on:submit|preventDefault={saveItem}>
    <input class="form-input" placeholder="Name" bind:value={name} required />

    <input
      class="form-input"
      placeholder="Brand"
      bind:value={brand}
      on:input={updateBrandSuggestions}
      list="brandSuggestions"
    />
    <datalist id="brandSuggestions">
      {#each brandSuggestions as suggestion}
        <option value={suggestion} />
      {/each}
    </datalist>

    <input class="form-input" placeholder="Image URL" bind:value={imageUrl} />

    <select class="form-input" bind:value={mainCategory} required>
      <option value="" disabled selected>Select Main Category</option>
      {#each mainCategories as cat}
        <option value={cat}>{cat}</option>
      {/each}
    </select>

    <select class="form-input" bind:value={lowerCategory} required>
      <option value="" disabled selected>Select Lower Category</option>
      {#each lowerCategories as cat}
        <option value={cat}>{cat}</option>
      {/each}
    </select>

    <select class="form-input" bind:value={status}>
      {#each statuses as s}
        <option value={s}>{s}</option>
      {/each}
    </select>

    <select class="form-input" bind:value={rating}>
      <option value="" disabled selected>Select Rating</option>
      {#each ratings as r}
        <option value={r}>{r}</option>
      {/each}
    </select>

    <select class="form-input" bind:value={season}>
      <option value="" disabled selected>Select Season</option>
      {#each seasons as s}
        <option value={s}>{s}</option>
      {/each}
    </select>

    <select class="form-input" bind:value={condition}>
      <option value="" disabled selected>Select Condition</option>
      {#each conditions as c}
        <option value={c}>{c}</option>
      {/each}
    </select>

    <label class="label">Color</label>
    <div class="color-picker">
      {#each colors as c}
        <div
          class="color-dot {color === c.name ? 'selected' : ''}"
          style="background-color: {c.hex}"
          on:click={() => color = c.name}
          title={c.name}
        />
      {/each}
    </div>

    <input class="form-input" placeholder="Price (€)" type="number" step="0.01" bind:value={price} />
    <input class="form-input" placeholder="Size" bind:value={size} />
    <input class="form-input" placeholder="Temperature (e.g. 10-20°C)" bind:value={temperature} />

    <div class="button-group">
      <button type="submit" class="form-button primary">➕ Add Item</button>
      <button type="button" class="form-button secondary" on:click={() => goto('/clothing')}>Cancel</button>
    </div>
  </form>
</main>

<style>
  .form-wrapper {
    padding: 2rem;
    max-width: 480px;
    margin: 0 auto;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    background-color: rgba(255, 255, 255, 0.6);
    border-radius: 2rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  }

  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-input {
    padding: 0.75rem 1rem;
    font-size: 1rem;
    border: none;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.8);
    box-shadow: inset 0 0 0 1px #ccc;
    transition: all 0.2s ease;
  }

  .form-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px #007aff;
  }

  .button-group {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .form-button {
    flex: 1;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 1.2rem;
    cursor: pointer;
    transition: 0.2s ease;
  }

  .form-button.primary {
    background-color: #007aff;
    color: white;
  }

  .form-button.primary:hover {
    opacity: 0.9;
    transform: scale(1.02);
  }

  .form-button.secondary {
    background-color: rgba(0, 0, 0, 0.05);
    color: #333;
  }

  .form-button.secondary:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }

  .label {
    font-size: 0.95rem;
    font-weight: 600;
    margin-top: 0.5rem;
  }

  .color-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.2rem 0.1rem;
  }

  .color-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.2s ease, border 0.2s ease;
  }

  .color-dot:hover {
    transform: scale(1.1);
  }

  .color-dot.selected {
    border-color: #007aff;
    box-shadow: 0 0 0 2px white;
  }
</style>