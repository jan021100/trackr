<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { collection, getDocs } from 'firebase/firestore';
  import { goto } from '$app/navigation';

  let topCasual = [];
  let topCycling = [];
  let topRunning = [];
  let topOtherSport = [];
  let cpwCasual = [];
  let cpwCycling = [];
  let cpwRunning = [];
  let cpwOtherSport = [];

  onMount(async () => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        goto('/login');
        return;
      }

      const snapshot = await getDocs(collection(db, 'users', user.uid, 'items'));
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      console.log('Loaded items:', items); // DEBUG
      console.log('Erste 5 Items:', items.slice(0, 5));

      const filterAndSort = (category: string) => {
        return items
          .filter(i => i.mainCategory?.toLowerCase() === category.toLowerCase() && i.worn > 0)
          .sort((a, b) => b.worn - a.worn)
          .slice(0, 5);
      };
      
      const filterAndSortByCPW = (category: string) => {
  return items
    .filter(i =>
      i.mainCategory?.toLowerCase() === category.toLowerCase() &&
      i.worn > 0 &&
      typeof i.price === 'number' &&
      i.price >= 1
    )
    .map(i => ({
      ...i,
      cpw: i.price / i.worn
    }))
    .sort((a, b) => a.cpw - b.cpw)
    .slice(0, 5);
};

      topCasual = filterAndSort('casual');
      topCycling = filterAndSort('cycling');
      topRunning = filterAndSort('running');
      topOtherSport = filterAndSort('other sports');
      
      cpwCasual = filterAndSortByCPW('casual');
cpwCycling = filterAndSortByCPW('cycling');
cpwRunning = filterAndSortByCPW('running');
cpwOtherSport = filterAndSortByCPW('other sports');

      console.log({ topCasual, topCycling, topRunning, topOtherSport }); // DEBUG
    });

    return () => unsubscribe();
  });
</script>

<main class="analytics-wrapper">
  <h1>📊 Analytics</h1>
  
  <h2 style="margin: 2rem 0 1rem;">👑 Top 5 Items per Category</h2>
  <div class="grid">
    <div class="stat-group">
      <h2>Casual</h2>
      {#each topCasual as item}
        <div class="stat-tile">
          {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
          <div class="label">{item.brand} – {item.product}</div>
          <div class="value">{item.worn}×</div>
        </div>
      {/each}
    </div>
    <div class="stat-group">
      <h2>Cycling</h2>
      {#each topCycling as item}
        <div class="stat-tile">
          {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
          <div class="label">{item.brand} – {item.product}</div>
          <div class="value">{item.worn}×</div>
        </div>
      {/each}
    </div>
    <div class="stat-group">
      <h2>Running</h2>
      {#each topRunning as item}
        <div class="stat-tile">
          {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
          <div class="label">{item.brand} – {item.product}</div>
          <div class="value">{item.worn}×</div>
        </div>
      {/each}
    </div>
    <div class="stat-group">
  <h2>Other Sport</h2>
  {#each topOtherSport as item}
    <div class="stat-tile">
      {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
      <div class="label">{item.brand} – {item.product}</div>
      <div class="value">{item.worn}×</div>
    </div>
  {/each}
</div>
  </div>
  
  <h2 style="margin: 2rem 0 1rem;">💸 Top 5 Items with Lowest Cost per Wear</h2>
<div class="grid">
  <div class="stat-group">
    <h2>Casual</h2>
    {#each cpwCasual as item}
      <div class="stat-tile">
        {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
        <div class="label">{item.brand} – {item.product}</div>
        <div class="value">€{(item.cpw).toFixed(2)}</div>
      </div>
    {/each}
  </div>
  <div class="stat-group">
    <h2>Cycling</h2>
    {#each cpwCycling as item}
      <div class="stat-tile">
        {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
        <div class="label">{item.brand} – {item.product}</div>
        <div class="value">€{(item.cpw).toFixed(2)}</div>
      </div>
    {/each}
  </div>
  <div class="stat-group">
    <h2>Running</h2>
    {#each cpwRunning as item}
      <div class="stat-tile">
        {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
        <div class="label">{item.brand} – {item.product}</div>
        <div class="value">€{(item.cpw).toFixed(2)}</div>
      </div>
    {/each}
  </div>
  <div class="stat-group">
    <h2>Other Sport</h2>
    {#each cpwOtherSport as item}
      <div class="stat-tile">
        {#if item.imageUrl}<img src={item.imageUrl} alt={item.product} />{/if}
        <div class="label">{item.brand} – {item.product}</div>
        <div class="value">€{(item.cpw).toFixed(2)}</div>
      </div>
    {/each}
  </div>
</div>
</main>

<style>
  .analytics-wrapper {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  h1 {
    text-align: center;
    font-size: 1.6rem;
    font-weight: 700;
    margin-bottom: 2rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1rem;
  }

  .stat-group {
    background-color: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(20px);
    border-radius: 2rem;
    padding: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  }

  .stat-group h2 {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 1rem;
    text-align: center;
  }

  .stat-tile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .stat-tile img {
    width: 40px;
    height: 40px;
    border-radius: 0.5rem;
    object-fit: cover;
  }

  .label {
    flex-grow: 1;
    font-size: 0.9rem;
  }

  .value {
    font-weight: 700;
    color: #007aff;
  }
</style>