<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
  import { auth, db } from '$lib/firebase';
  import ItemEditor from '$lib/components/ItemEditor.svelte';
  import type { ImageStorageFormat } from '$lib/utils/imageCompression';

  export let itemId: string;
  const dispatch = createEventDispatcher();
  let item: Record<string, any> | null = null;
  let loading = true;
  let busy = false;
  let errorMessage = '';
  let pendingImageFormat: ImageStorageFormat | null = null;

  onMount(() => {
    document.body.classList.add('modal-open');
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) return;
      loading = true;
      errorMessage = '';
      try {
        const snapshot = await getDoc(doc(db, 'users', currentUser.uid, 'items', itemId));
        if (!snapshot.exists()) throw new Error('Item not found');
        item = { id: snapshot.id, ...snapshot.data() };
      } catch (error) {
        console.error('Could not load item editor', error);
        errorMessage = 'This item could not be loaded. No data was changed.';
      } finally {
        loading = false;
      }
    });
    return unsubscribe;
  });

  onDestroy(() => document.body.classList.remove('modal-open'));
  function close() { if (!busy) dispatch('close'); }
  function closeFromBackdrop(event: MouseEvent) { if (event.target === event.currentTarget) close(); }
  function handleKeydown(event: KeyboardEvent) { if (event.key === 'Escape') close(); }

  async function save(updated: Record<string, any>) {
    const currentUser = auth.currentUser;
    if (!currentUser || !updated.id || busy) return;
    busy = true;
    errorMessage = '';
    try {
      const payload = {
        product: updated.product ?? updated.name, brand: updated.brand,
        imageUrl: updated.imageUrl ?? '', imageBase64: updated.imageBase64 ?? '',
        mainCategory: updated.mainCategory ?? '', lowerCategory: updated.lowerCategory ?? '',
        status: updated.status ?? '', season: updated.season ?? '', condition: updated.condition ?? '',
        price: updated.price ?? null, size: updated.size ?? '', temperature: updated.temperature ?? '',
        color: updated.color ?? '', quantity: updated.quantity ?? 1, labels: updated.labels ?? [],
        purchaseDate: updated.purchaseDate ?? null, outfitEligible: updated.outfitEligible !== false,
        fit: updated.fit ?? '', pattern: updated.pattern ?? '', weight: updated.weight ?? '', style: updated.style ?? ''
      };
      await updateDoc(doc(db, 'users', currentUser.uid, 'items', updated.id), payload);
      dispatch('saved', { storageFormat: pendingImageFormat });
    } catch (error) {
      console.error('Could not save item', error);
      errorMessage = 'The item could not be saved. Your previous data is unchanged.';
    } finally { busy = false; }
  }

  async function remove(selected: Record<string, any>) {
    const currentUser = auth.currentUser;
    if (!currentUser || !selected.id || busy) return;
    busy = true;
    errorMessage = '';
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'items', selected.id));
      dispatch('removed');
    } catch (error) {
      console.error('Could not delete item', error);
      errorMessage = 'The item could not be deleted. Your data is unchanged.';
    } finally { busy = false; }
  }
</script>

<svelte:window on:keydown={handleKeydown} />
<div class="modal-overlay" role="presentation" on:mousedown={closeFromBackdrop}>
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Edit clothing item" tabindex="-1">
    {#if loading}
      <p class="state">Loading item…</p>
    {:else if errorMessage && !item}
      <div class="state error" role="alert"><p>{errorMessage}</p><button type="button" on:click={close}>Close</button></div>
    {:else if item}
      {#if errorMessage}<p class="save-error" role="alert">{errorMessage}</p>{/if}
      <ItemEditor {item} on:cancel={close} on:imageprocessed={(event) => (pendingImageFormat = event.detail.storageFormat)} on:save={(event) => save(event.detail)} on:remove={(event) => remove(event.detail)} />
    {/if}
  </div>
</div>

<style>
  .modal-overlay{
    position:fixed;
    inset:0;
    z-index:1300;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:clamp(.75rem,2vh,1.25rem);
    box-sizing:border-box;
    background:rgba(0,0,0,.35);
  }
  .modal-card{
    width:min(960px,100%);
    max-height:calc(100dvh - clamp(1.5rem,4vh,2.5rem));
    overflow:hidden;
    display:flex;
    flex-direction:column;
    align-items:center;
    padding:clamp(1rem,2.5vw,1.6rem);
    box-sizing:border-box;
    border-radius:16px;
    background:#fff;
    box-shadow:0 28px 90px rgba(0,0,0,.2);
  }
  .modal-card :global(.editor-root){
    width:100%;
    max-width:900px;
    max-height:calc(100dvh - clamp(3.5rem,8vh,5.5rem));
    overflow-y:auto;
    overscroll-behavior:contain;
  }
  .state{min-height:220px;display:grid;place-content:center;color:#777;text-align:center}
  .state.error{gap:1rem;color:#9c3340}
  .state button{justify-self:center;padding:.65rem 1rem;border:0;border-radius:999px;background:#171717;color:#fff;cursor:pointer}
  .save-error{flex:0 0 auto;width:100%;max-width:900px;margin:0 0 .75rem;padding:.75rem 1rem;box-sizing:border-box;border-radius:10px;background:#fff0f1;color:#9c3340}

  @media(max-width:600px){
    .modal-overlay{padding:.5rem}
    .modal-card{max-height:calc(100dvh - 1rem);padding:.9rem;border-radius:13px}
    .modal-card :global(.editor-root){max-height:calc(100dvh - 2.8rem)}
  }
</style>
