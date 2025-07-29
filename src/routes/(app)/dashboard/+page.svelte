<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { db } from '$lib/firebase';
  import { collection, getDocs } from 'firebase/firestore';
  import { user, userReady } from '$lib/stores/user';
  import { generateSummerOutfit, generateSpringOutfit, generateWinterOutfit } from '$lib/utils/outfitGenerator';

  let loading = true;
  let randomItem: any = null;
  let neglectedItem: any = null;
  let outfit: Outfit | null = null;
  let chatInput = '';
  let chatResponse = '';
  let sending = false;

  function getTodayKey(uid: string) {
    const today = new Date().toISOString().split('T')[0];
    return `dashboard-suggestions-${uid}-${today}`;
  }

  async function loadSuggestions(uid: string) {
    const key = getTodayKey(uid);
    const saved = localStorage.getItem(key);

    if (saved) {
      try {
        const data = JSON.parse(saved);
        randomItem = data.randomItem;
        neglectedItem = data.neglectedItem;
        return;
      } catch (err) {
        console.error('Failed to parse saved suggestions:', err);
      }
    }

    const snapshot = await getDocs(collection(db, 'users', uid, 'items'));
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const activeItems = items.filter(i => i.status?.toLowerCase() === 'active');

    if (activeItems.length > 0) {
      randomItem = activeItems[Math.floor(Math.random() * activeItems.length)];
    }

    const wornItems = activeItems.filter(i => i.lastWorn)
      .sort((a, b) => new Date(a.lastWorn).getTime() - new Date(b.lastWorn).getTime());

    if (wornItems.length > 0) {
      const topNeglected = wornItems.slice(0, Math.min(10, wornItems.length));
      neglectedItem = topNeglected[Math.floor(Math.random() * topNeglected.length)];
    }

    localStorage.setItem(key, JSON.stringify({ randomItem, neglectedItem }));
  }

  async function handleGenerateSummer() {
    if (!$user?.uid) return;
    const snapshot = await getDocs(collection(db, 'users', $user.uid, 'items'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    outfit = generateSummerOutfit(items);
  }

  async function handleGenerateSpring() {
    if (!$user?.uid) return;
    const snapshot = await getDocs(collection(db, 'users', $user.uid, 'items'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    outfit = generateSpringOutfit(items);
  }

  async function handleGenerateWinter() {
    if (!$user?.uid) return;
    const snapshot = await getDocs(collection(db, 'users', $user.uid, 'items'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    outfit = generateWinterOutfit(items);
  }

  async function sendChatMessage() {
  if (!chatInput.trim() || !$user?.uid) return;
  sending = true;
  chatResponse = '';
  try {
    const res = await fetch('/chat-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: $user.uid,
        messages: [
          { role: 'user', content: chatInput }
        ]
      })
    });
    const data = await res.json();
    chatResponse = data.choices?.[0]?.message?.content || 'No response';
  } catch (e) {
    chatResponse = 'Error loading response';
  } finally {
    sending = false;
  }
}

  onMount(async () => {
    const unsubscribe = userReady.subscribe(async (ready) => {
      if (ready) {
        if (!$user?.uid) {
          goto('/login');
        } else {
          await loadSuggestions($user.uid);
          loading = false;
        }
      }
    });
    return () => unsubscribe();
  });

  function navigateTo(path: string) {
    goto(path);
  }
</script>

<main>
  {#if loading}
    <p class="loading">⏳ Loading Dashboard…</p>
  {:else}
    <section class="intro">
      <h1>Hello, {$user?.name ?? $user?.email ?? 'User'} 👋</h1>
      <p class="subtitle">Here’s what you can explore today.</p>
    </section>

    <!-- ROW 1: Navigation -->
    <section class="grid">
      <div class="card" on:click={() => navigateTo('/clothing')}>
        <h2>👕 Clothing</h2>
        <p>Track items, usage, and wear frequency.</p>
      </div>
      <div class="card" on:click={() => navigateTo('/analytics')}>
        <h2>📊 Analytics</h2>
        <p>View trends and progress over time.</p>
      </div>
    </section>

    <!-- ROW 2: Empfehlungen -->
    <section class="grid">
      {#if randomItem}
        <div class="card">
          <h2>🎯 Why not wear this?</h2>
          {#if randomItem.imageUrl}
            <img src={randomItem.imageUrl} alt={randomItem.product} class="thumb" />
          {/if}
          <p>{randomItem.brand} – {randomItem.product}</p>
        </div>
      {/if}

      {#if neglectedItem}
        <div class="card">
          <h2>😢 Not worn in a while</h2>
          {#if neglectedItem.imageUrl}
            <img src={neglectedItem.imageUrl} alt={neglectedItem.product} class="thumb" />
          {/if}
          <p>{neglectedItem.brand} – {neglectedItem.product}</p>
          <p class="date">Last worn: {new Date(neglectedItem.lastWorn).toLocaleDateString()}</p>
        </div>
      {/if}
    </section>

    <!-- ROW 3: Outfit Generator + Result -->
    <section class="grid">
      <div class="card">
        <h2>🎽 Generate Outfit</h2>
        <p>Pick a season and get a matching outfit.</p>
        <div class="season-buttons">
          <button on:click={handleGenerateSummer}>☀️ Summer</button>
          <button on:click={handleGenerateSpring}>🍂 Spring/Fall</button>
          <button on:click={handleGenerateWinter}>❄️ Winter</button>
        </div>
      </div>

      {#if outfit}
        <div class="card outfit">
          <h2>🧥 Your Outfit</h2>
          <div class="outfit-row">
            {#if outfit.top}
              <div class="outfit-item">
                <img class="thumb" src={outfit.top.imageUrl} alt="Top" />
                <h3>{outfit.top.brand} – {outfit.top.product}</h3>
                <p class="color-label">({outfit.top.color})</p>
              </div>
            {/if}
            {#if outfit.layer}
              <div class="outfit-item">
                <img class="thumb" src={outfit.layer.imageUrl} alt="Layer" />
                <h3>{outfit.layer.brand} – {outfit.layer.product}</h3>
                <p class="color-label">({outfit.layer.color})</p>
              </div>
            {/if}
            {#if outfit.jacket}
              <div class="outfit-item">
                <img class="thumb" src={outfit.jacket.imageUrl} alt="Jacket" />
                <h3>{outfit.jacket.brand} – {outfit.jacket.product}</h3>
                <p class="color-label">({outfit.jacket.color})</p>
              </div>
            {/if}
            {#if outfit.bottom}
              <div class="outfit-item">
                <img class="thumb" src={outfit.bottom.imageUrl} alt="Bottom" />
                <h3>{outfit.bottom.brand} – {outfit.bottom.product}</h3>
                <p class="color-label">({outfit.bottom.color})</p>
              </div>
            {/if}
            {#if outfit.shoes}
              <div class="outfit-item">
                <img class="thumb" src={outfit.shoes.imageUrl} alt="Shoes" />
                <h3>{outfit.shoes.brand} – {outfit.shoes.product}</h3>
                <p class="color-label">({outfit.shoes.color})</p>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <!-- ROW 4: Chat Assistant -->
    <section class="grid">
      <div class="card" style="grid-column: 1 / -1;">
        <h2>🧠 Ask your Style Assistant</h2>
        <textarea bind:value={chatInput} rows="2" placeholder="What should I wear for a date tonight?" style="width: 100%; padding: 0.6rem; border-radius: 0.6rem; border: 1px solid #ccc;"></textarea>
        <button on:click={sendChatMessage} disabled={sending} style="margin-top: 0.5rem;">
          {sending ? 'Sending...' : 'Ask'}
        </button>
        {#if chatResponse}
          <p style="margin-top: 1rem; white-space: pre-wrap; text-align: left;">{chatResponse}</p>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  main {
    padding: 1.5rem;
    padding-bottom: 6rem;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    background: #fefefe;
    color: #1c1c1e;
    min-height: 100vh;
  }

  .loading {
    text-align: center;
    font-size: 1.1rem;
    padding-top: 3rem;
  }

  .intro {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 1.9rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
  }

  .subtitle {
    font-size: 1.05rem;
    color: #6e6e73;
  }

  .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.6rem;
  margin-bottom: 1.6rem; /* 👈 sorgt für Abstand nach unten */
}

  .card {
    background: rgba(255, 255, 255, 0.65);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(60, 60, 67, 0.1);
    border-radius: 1rem;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    padding: 1.2rem 1rem;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-height: auto;
    cursor: pointer;
    justify-content: space-between;
    margin-bottom: 0.5rem; /* ✅ Abstand zwischen Kartenzeilen */
  }

  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .card h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #1c1c1e;
  }

  .card h3 {
    font-size: 0.95rem;
    margin-top: 0.75rem;
    margin-bottom: 0.2rem;
    color: #1c1c1e;
  }

  .card p {
    font-size: 0.9rem;
    color: #6e6e73;
    margin: 0.2rem 0;
  }

  .thumb {
    height: 90px;
    border-radius: 0.5rem;
    object-fit: contain;
    margin-top: 0.3rem;
  }

  .card .date {
    font-size: 0.8rem;
    color: #8e8e93;
  }

  .card.outfit {
    max-height: auto;
    overflow-y: auto;
    scrollbar-width: none;
    padding-bottom: 0.5rem;
  }

  .card.outfit::-webkit-scrollbar {
    display: none;
  }

  .outfit-row {
    display: flex;
    gap: 1rem;
    justify-content: space-around;
    align-items: flex-start;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }

  .outfit-item {
    flex: 1 1 30%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .outfit-item .thumb {
    height: 80px;
    object-fit: contain;
    margin-bottom: 0.5rem;
  }

  .color-label {
    font-size: 0.85rem;
    color: #8e8e93;
  }
  .season-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.6rem;
}

.season-buttons button {
  font-size: 0.85rem;
  padding: 0.4rem 0.8rem;
  border-radius: 0.6rem;
  background: #f1f1f1;
  border: 1px solid #ccc;
  cursor: pointer;
  transition: background 0.2s;
}

.season-buttons button:hover {
  background: #e5e5e5;
}
</style>