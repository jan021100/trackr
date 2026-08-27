<!-- FILE: trackr/src/routes/(app)/clothing/add/+page.svelte -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { collection, addDoc } from 'firebase/firestore';
  import type { User } from 'firebase/auth';

  import ItemEditor from '$lib/components/ItemEditor.svelte';
  import type { ImageStorageFormat } from '$lib/utils/imageCompression';

  let user: User | null = null;
  let loading = true;
  let pendingImageFormat: ImageStorageFormat | null = null;

  // Blank item template (same structure as editor expects)
  let newItem: any = {
    product: '',
    brand: '',
    imageUrl: '',
    imageBase64: '',
    mainCategory: '',
    lowerCategory: '',
    status: 'active',
    rating: '',
    season: '',
    condition: '',
    price: null,
    size: '',
    temperature: '',
    color: '',
    quantity: 1,
    labels: [],
    purchaseDate: null,
    outfitEligible: true,

    // Optional fields (safe defaults)
    fit: '',
    pattern: '',
    weight: '',
    style: '',

    // Wear tracking
    worn: 0,
    wearLog: [],
    lastWorn: null
  };

  onMount(() => {
    const unsub = auth.onAuthStateChanged((_user) => {
      if (_user) {
        user = _user;
        loading = false;
      } else {
        goto('/login');
      }
    });

    return () => unsub();
  });

  async function handleCreate(e: any) {
    if (!user) return;

    const item = e.detail;

    const itemsRef = collection(db, 'users', user.uid, 'items');

    await addDoc(itemsRef, {
      ...item,
      product: item.product ?? item.name ?? '',
      worn: 0,
      wearLog: [],
      lastWorn: null
    });

    const imageNotice = pendingImageFormat ? `?imageSaved=${pendingImageFormat}` : '';
    goto(`/clothing${imageNotice}`);
  }
</script>


<main class="add-page">

  {#if loading}
    <div class="loading">Loading…</div>
  {:else}

    <div class="page-head">
      <h1>Add New Item</h1>
      <button class="back-btn" on:click={() => goto('/clothing')}>
        Cancel
      </button>
    </div>

    <div class="editor-wrapper">
      <ItemEditor
        item={newItem}
        on:cancel={() => goto('/clothing')}
        on:imageprocessed={(e) => (pendingImageFormat = e.detail.storageFormat)}
        on:save={handleCreate}
      />
    </div>

  {/if}

</main>


<style>

/* =========================================================
   PAGE LAYOUT
========================================================= */

.add-page {
  max-width: 1000px;
  margin: auto;
  padding: 2rem 1.4rem 4rem;
  font-family: Inter, system-ui, sans-serif;
}

.loading {
  padding: 4rem;
  text-align: center;
}


/* =========================================================
   HEADER
========================================================= */

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.8rem;
}

.page-head h1 {
  margin: 0;
  font-size: 1.8rem;
}

.back-btn {
  border: 1px solid #ddd;
  background: #fff;
  padding: .55rem .9rem;
  border-radius: 10px;
  cursor: pointer;
}

.back-btn:hover {
  border-color: #111;
}


/* =========================================================
   EDITOR WRAPPER
========================================================= */

.editor-wrapper {
  background: #fff;
  border: 1px solid #e6e6e6;
  border-radius: 18px;
  padding: 2rem;
}

@media (max-width: 700px) {
  .editor-wrapper {
    padding: 1.2rem;
  }
}

</style>
