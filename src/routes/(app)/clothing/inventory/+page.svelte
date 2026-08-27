<!--
FILE: trackr/src/routes/(app)/clothing/inventory/+page.svelte
Inventory page
Grouped like tracking page
Compact layout
Improved last-worn color gradient
-->

<script lang="ts">
import { onMount } from 'svelte';
import { auth, db } from '$lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { goto } from '$app/navigation';
import { itemEditHref } from '$lib/utils/appNavigation';
import type { User } from 'firebase/auth';

let user: User | null = null;
let items: any[] = [];
let loading = true;

const lowerCategoryOrder = [
  'Sweaters','Hoodies','T-Shirts','Shirts','Polo Shirts','Base Layers',
  'SS Jerseys','LS Jerseys','SS Shirts','LS Shirts','Jackets','Vests',
  'Pants','Shorts','Chinos','Joggers','Leggings','Jeans',
  'Gloves','Headwear','Socks','Bags','Backpacks','Glasses','Others','Leg Warmers',
  'Shoes','Running Shoes','Sneakers','Slides'
];

const mainCategories = ['Casual','Cycling','Running','Other Sports'];

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return (Date.now() - new Date(dateStr).getTime()) / (1000*60*60*24);
}

/* smoother, less strict gradient */
function lastWornColor(item: { lastWorn?: string | null }): string {
  if (!item.lastWorn) return '#666';

  const d = daysSince(item.lastWorn);
  if (d === null) return '#666';

  let hue: number;

  if (d <= 14) {
    hue = 120;
  } 
  else if (d <= 30) {
    hue = 120 - ((d - 14) / 16) * 30;
  } 
  else if (d <= 60) {
    hue = 90 - ((d - 30) / 30) * 30;
  } 
  else if (d <= 120) {
    hue = 60 - ((d - 60) / 60) * 60;
  } 
  else {
    hue = 0;
  }

  return `hsl(${hue}, 80%, 50%)`;
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

  const snapshot = await getDocs(collection(db, 'users', user.uid, 'items'));

  const rawItems = snapshot.docs.map(docSnap => {
    const data = docSnap.data() as any;
    return {
      id: docSnap.id,
      name: data.product ?? 'Unnamed',
      brand: data.brand ?? '',
      imageUrl: data.imageUrl ?? null,
      worn: Number(data.worn ?? 0),
      lastWorn: data.lastWorn ?? null,
      status: data.status ?? '',
      mainCategory: data.mainCategory ?? 'Other Sports',
      lowerCategory: data.lowerCategory ?? 'Others'
    };
  });

  items = rawItems.sort((a,b)=>{
    if (a.mainCategory !== b.mainCategory)
      return a.mainCategory.localeCompare(b.mainCategory);

    const ia = lowerCategoryOrder.indexOf(a.lowerCategory);
    const ib = lowerCategoryOrder.indexOf(b.lowerCategory);

    if (ia !== ib)
      return (ia===-1?999:ia) - (ib===-1?999:ib);

    return b.worn - a.worn;
  });

  loading = false;
}
</script>

<main>
<h1>Inventory</h1>

{#if loading}
<p>Loading…</p>

{:else}

{#each mainCategories as main}
  {#if items.some(i=>i.mainCategory===main)}
    <h2 class="section">{main}</h2>

    {#each Array.from(new Set(items.filter(i=>i.mainCategory===main).map(i=>i.lowerCategory)))
      .sort((a,b)=>{
        const ia=lowerCategoryOrder.indexOf(a);
        const ib=lowerCategoryOrder.indexOf(b);
        return (ia===-1?999:ia)-(ib===-1?999:ib);
      })
      as lower}

      <h3 class="sub">{lower}</h3>

      <div class="grid">
        {#each items.filter(i=>i.mainCategory===main && i.lowerCategory===lower) as item (item.id)}
        <div class="card" style="border-left:4px solid {lastWornColor(item)}">
          
          {#if item.imageUrl}
            <img src={item.imageUrl} alt={item.name}/>
          {/if}

          <div class="info">
            <div class="title">{item.name}</div>
            <div class="brand">{item.brand}</div>
            <div class="meta">Worn: {item.worn}</div>
          </div>

          <button on:click={()=>goto(itemEditHref(item.id, '/clothing/inventory'))}>
            Edit
          </button>
        </div>
        {/each}
      </div>

    {/each}
  {/if}
{/each}

{/if}
</main>

<style>
main { padding:2rem; }

.section { margin-top:1.5rem; font-size:1.1rem; }
.sub { margin-top:.6rem; font-size:.9rem; opacity:.7; }

.grid {
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(240px,1fr));
  gap:.5rem;
  margin-top:.4rem;
}

.card {
  display:flex;
  align-items:center;
  gap:.5rem;
  padding:.4rem;
  background:rgba(255,255,255,0.06);
  border-radius:10px;
}

.card img {
  width:42px;
  height:42px;
  object-fit:contain;
}

.info { flex:1; }

.title { font-size:.82rem; font-weight:600; }
.brand,.meta { font-size:.7rem; opacity:.7; }

button { font-size:.7rem; }
</style>
