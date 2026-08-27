<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
  import { auth, db } from '$lib/firebase';
  import { itemEditHref } from '$lib/utils/appNavigation';
  import {
    buildWardrobeCatalogHtml,
    exportTrackrOutfitCode,
    parseTrackrOutfitCode
  } from '$lib/utils/outfitExchange';
  import {
    applyOutfitFeedback,
    createPersonalOutfitModel,
    generateSmartOutfit,
    markSuggestionSeen,
    type OutfitFeedbackKind,
    type OutfitScope,
    type PersonalOutfitModel,
    type SmartOutfitSuggestion,
    type SmartSuggestionMode
  } from '$lib/utils/smartOutfitEngine';
  import {
    STUDIO_SLOTS,
    clampStudioCanvasPlacement,
    defaultStudioCanvasPlacement,
    emptyStudioCanvas,
    emptyStudioLayout,
    placeStudioItem,
    removeStudioItem,
    searchStudioItems,
    serializeStudioCanvas,
    studioCanvasFromLayout,
    studioItemIds,
    studioLayoutFromItemIds,
    studioLayoutFromOutfit,
    type StudioItem,
    type SerializedStudioCanvas,
    type StudioCanvasLayout,
    type StudioLayout,
    type StudioSlot
  } from '$lib/utils/outfitStudio';

  type WardrobeItem = StudioItem & {
    id: string;
    worn?: number;
    labels?: string[];
  };

  type SavedOutfit = {
    id: string;
    itemIds: string[];
    label: string;
    layout?: Partial<Record<StudioSlot, string | null>>;
    canvas?: SerializedStudioCanvas;
    createdAt?: unknown;
  };

  type EditorCanvasDraft = {
    version: 1;
    savedAt: number;
    name: string;
    selectedSlot: StudioSlot;
    layout: Partial<Record<StudioSlot, string | null>>;
    canvas: SerializedStudioCanvas;
  };

  const EDITOR_DRAFT_KEY = 'trackr:outfit-studio:editor-draft';

  const suggestionModes: Array<{ id: SmartSuggestionMode; label: string; detail: string }> = [
    { id: 'auto', label: 'Smart pick', detail: 'Based on today’s season' },
    { id: 'summer', label: 'Summer', detail: 'Light and warm-weather ready' },
    { id: 'warmSpringFall', label: 'Warm transition', detail: 'Layered, but still light' },
    { id: 'springFall', label: 'Spring / fall', detail: 'Balanced seasonal layers' },
    { id: 'winter', label: 'Winter', detail: 'Built for colder days' },
    { id: 'rotation', label: 'Rediscover', detail: 'Prioritise less-worn pieces' },
    { id: 'discovery', label: 'Something new', detail: 'Explore a fresh combination' }
  ];

  const slotLabels: Record<StudioSlot, string> = {
    outerwear: 'Outerwear',
    layer: 'Layer',
    top: 'Top',
    bottom: 'Bottom',
    shoes: 'Shoes',
    accessory: 'Accessory'
  };

  let loading = true;
  let errorMessage = '';
  let userId = '';
  let items: WardrobeItem[] = [];
  let savedOutfits: SavedOutfit[] = [];
  let layout: StudioLayout<WardrobeItem> = emptyStudioLayout<WardrobeItem>();
  let canvas: StudioCanvasLayout = emptyStudioCanvas();
  let queryText = '';
  let categoryFilter = 'All';
  let visibleItems: WardrobeItem[] = [];
  let categories: string[] = [];
  let selectedSlot: StudioSlot = 'top';
  let outfitName = '';
  let saving = false;
  let message = '';
  let draggedItemId = '';
  let outfitArchiveAvailable = true;
  let canvasElement: HTMLDivElement | null = null;
  let moveState: {
    slot: StudioSlot;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null = null;
  let nextLayer = 10;
  let suggestionMode: SmartSuggestionMode = 'auto';
  let outfitScope: OutfitScope = 'casual';
  let personalModel: PersonalOutfitModel = createPersonalOutfitModel();
  let currentSuggestion: SmartOutfitSuggestion | null = null;
  let suggestionSeed = 0;
  let feedbackSaving = false;
  let learningAvailable = true;
  let exchangeOpen = false;
  let importCode = '';
  let exchangeErrors: string[] = [];
  let exchangeMessage = '';

  $: categories = ['All', ...Array.from(new Set(items.map((item) => item.mainCategory || 'Uncategorized'))).sort()];
  $: visibleItems = searchStudioItems(items, queryText)
    .filter((item) => categoryFilter === 'All' || (item.mainCategory || 'Uncategorized') === categoryFilter);

  onMount(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        goto('/login');
        return;
      }
      userId = currentUser.uid;
      loading = true;
      errorMessage = '';
      try {
        const itemSnapshot = await getDocs(collection(db, 'users', userId, 'items'));
        items = itemSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as WardrobeItem));
        restoreEditorCanvasDraft();

        try {
          const learningSnapshot = await getDoc(doc(db, 'users', userId, 'meta', 'outfitIntelligence'));
          personalModel = createPersonalOutfitModel(learningSnapshot.exists() ? learningSnapshot.data() as Partial<PersonalOutfitModel> : null);
          learningAvailable = true;
        } catch (learningError) {
          console.warn('Personal outfit learning is not available yet', learningError);
          personalModel = createPersonalOutfitModel();
          learningAvailable = false;
        }

        try {
          const outfitSnapshot = await getDocs(collection(db, 'users', userId, 'outfits'));
          savedOutfits = outfitSnapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() } as SavedOutfit))
            .sort((a, b) => savedTime(b.createdAt) - savedTime(a.createdAt))
            .slice(0, 12);
          outfitArchiveAvailable = true;
        } catch (archiveError) {
          console.warn('Outfit archive is not available yet', archiveError);
          savedOutfits = [];
          outfitArchiveAvailable = false;
        }
      } catch (error) {
        console.error('Could not load wardrobe for outfit studio', error);
        errorMessage = 'Your wardrobe could not be loaded. Please try again.';
      } finally {
        loading = false;
      }
    });
    return unsubscribe;
  });

  function savedTime(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (value && typeof value === 'object' && 'seconds' in value) {
      const seconds = Number((value as { seconds?: unknown }).seconds);
      return Number.isFinite(seconds) ? seconds * 1000 : 0;
    }
    return 0;
  }

  function imageFor(item: WardrobeItem | null) {
    return item?.imageBase64 || item?.imageUrl || '';
  }

  function nameFor(item: WardrobeItem) {
    return item.product || item.name || 'Unnamed item';
  }

  function preserveEditorCanvasDraft() {
    const draft: EditorCanvasDraft = {
      version: 1,
      savedAt: Date.now(),
      name: outfitName,
      selectedSlot,
      layout: Object.fromEntries(STUDIO_SLOTS.map((slot) => [slot, layout[slot]?.id ?? null])),
      canvas: serializeStudioCanvas(layout, canvas)
    };
    sessionStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(draft));
  }

  function restoreEditorCanvasDraft() {
    const raw = sessionStorage.getItem(EDITOR_DRAFT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(EDITOR_DRAFT_KEY);
    try {
      const draft = JSON.parse(raw) as Partial<EditorCanvasDraft>;
      if (draft.version !== 1 || !draft.savedAt || Date.now() - draft.savedAt > 15 * 60 * 1000 || !draft.layout) return;
      const restored = emptyStudioLayout<WardrobeItem>();
      for (const slot of STUDIO_SLOTS) {
        const id = draft.layout[slot];
        restored[slot] = id ? items.find((item) => item.id === id) ?? null : null;
      }
      layout = restored;
      canvas = studioCanvasFromLayout(layout, draft.canvas);
      outfitName = String(draft.name ?? '').slice(0, 80);
      selectedSlot = draft.selectedSlot && STUDIO_SLOTS.includes(draft.selectedSlot) && layout[draft.selectedSlot]
        ? draft.selectedSlot
        : STUDIO_SLOTS.find((slot) => Boolean(layout[slot])) ?? 'top';
      nextLayer = highestCanvasLayer(canvas) + 1;
      message = 'Your outfit canvas was restored after editing the item.';
    } catch {
      // Ignore an invalid local draft. Wardrobe data is never affected.
    }
  }

  function openSelectedItemEditor() {
    const item = layout[selectedSlot] as WardrobeItem | null;
    if (!item?.id) return;
    preserveEditorCanvasDraft();
    goto(itemEditHref(item.id, '/outfit-studio'), { noScroll: true, keepFocus: true });
  }

  function place(item: WardrobeItem, target: StudioSlot = selectedSlot) {
    layout = placeStudioItem(layout, item, target);
    const nextCanvas = { ...canvas };
    for (const slot of STUDIO_SLOTS) if (!layout[slot]) nextCanvas[slot] = null;
    nextCanvas[target] = { ...defaultStudioCanvasPlacement(target), z: nextLayer++ };
    canvas = nextCanvas;
    selectedSlot = target;
    currentSuggestion = null;
    message = '';
  }

  function remove(slot: StudioSlot) {
    layout = removeStudioItem(layout, slot);
    canvas = { ...canvas, [slot]: null };
    selectedSlot = slot;
    currentSuggestion = null;
    message = '';
  }

  function clearBoard() {
    layout = emptyStudioLayout<WardrobeItem>();
    canvas = emptyStudioCanvas();
    nextLayer = 10;
    outfitName = '';
    currentSuggestion = null;
    message = '';
  }

  function generateOutfit(mode: SmartSuggestionMode = suggestionMode) {
    suggestionMode = mode;
    const generated = generateSmartOutfit(items, { mode, scope: outfitScope, model: personalModel, seed: suggestionSeed++ });
    currentSuggestion = generated;
    if (generated) personalModel = markSuggestionSeen(personalModel, generated);
    layout = studioLayoutFromOutfit<WardrobeItem>(generated?.outfit ?? {});
    canvas = studioCanvasFromLayout(layout);
    nextLayer = highestCanvasLayer(canvas) + 1;
    message = studioItemIds(layout).length
      ? `${suggestionModes.find((entry) => entry.id === mode)?.label ?? 'Smart'} outfit ready — move, resize, layer, or replace any piece.`
      : `Trackr needs an eligible top, bottom, and shoes in your ${outfitScope === 'casual' ? 'casual' : 'sports'} wardrobe.`;
  }

  function exportWardrobeForChatGPT() {
    exchangeErrors = [];
    exchangeMessage = '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      exchangeErrors = ['Safari blocked the catalogue window. Allow pop-ups for Trackr, then try again.'];
      exchangeOpen = true;
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildWardrobeCatalogHtml(items));
    printWindow.document.close();
    exchangeMessage = 'The visual catalogue is ready. Choose “Save as PDF” in Safari’s print window, then upload that PDF to ChatGPT.';
    exchangeOpen = true;
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = value;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
  }

  async function copyCurrentOutfitCode() {
    if (studioItemIds(layout).length < 2) {
      exchangeErrors = ['Put at least two pieces on the canvas before copying an outfit code.'];
      exchangeOpen = true;
      return;
    }
    await copyText(exportTrackrOutfitCode(layout, outfitName));
    exchangeErrors = [];
    exchangeMessage = 'Current Trackr outfit code copied.';
    exchangeOpen = true;
  }

  function importChatGptOutfit() {
    const imported = parseTrackrOutfitCode(importCode, items);
    exchangeErrors = imported.errors;
    exchangeMessage = '';
    if (!imported.ok) return;
    layout = imported.layout;
    canvas = studioCanvasFromLayout(layout);
    nextLayer = highestCanvasLayer(canvas) + 1;
    selectedSlot = STUDIO_SLOTS.find((slot) => Boolean(layout[slot])) ?? 'top';
    outfitName = imported.name;
    currentSuggestion = null;
    exchangeMessage = `“${imported.name}” was recreated on the canvas. Review it before choosing Save outfit.`;
  }

  function loadSaved(saved: SavedOutfit) {
    const restoredLayout = emptyStudioLayout<WardrobeItem>();
    let restoredExactSlot = false;
    for (const slot of STUDIO_SLOTS) {
      const id = saved.layout?.[slot];
      const item = id ? items.find((entry) => entry.id === id) : null;
      if (item) {
        restoredLayout[slot] = item;
        restoredExactSlot = true;
      }
    }
    layout = restoredExactSlot
      ? restoredLayout
      : studioLayoutFromItemIds(items, Array.isArray(saved.itemIds) ? saved.itemIds : []);
    canvas = studioCanvasFromLayout(layout, saved.canvas);
    nextLayer = highestCanvasLayer(canvas) + 1;
    outfitName = saved.label || '';
    currentSuggestion = null;
    message = `Loaded “${saved.label || 'Saved outfit'}” as a new editable board.`;
  }

  async function learnFrom(kind: OutfitFeedbackKind, quiet = false) {
    if (!currentSuggestion || feedbackSaving) return;
    const previous = personalModel;
    const updated = applyOutfitFeedback(personalModel, currentSuggestion, kind);
    personalModel = updated;
    if (!learningAvailable) {
      if (!quiet) message = 'Feedback applied for this session. Personal learning could not be saved yet.';
      return;
    }
    feedbackSaving = true;
    try {
      await setDoc(doc(db, 'users', userId, 'meta', 'outfitIntelligence'), {
        ...updated,
        updatedAt: serverTimestamp()
      }, { merge: true });
      if (!quiet) message = kind === 'dislike'
        ? 'Got it — Trackr will reduce similar pieces and pairings.'
        : 'Preference learned — future suggestions will reflect this.';
    } catch (feedbackError) {
      console.warn('Outfit feedback could not be saved', feedbackError);
      personalModel = previous;
      if (!quiet) message = 'The feedback could not be saved. Your wardrobe was not changed.';
    } finally {
      feedbackSaving = false;
    }
  }

  function highestCanvasLayer(value: StudioCanvasLayout): number {
    return Math.max(9, ...STUDIO_SLOTS.map((slot) => value[slot]?.z ?? 0));
  }

  function beginDrag(event: DragEvent, item: WardrobeItem) {
    draggedItemId = item.id;
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  function dropOnCanvas(event: DragEvent) {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') || draggedItemId;
    const item = items.find((entry) => entry.id === id);
    if (item) {
      place(item, selectedSlot);
      const rect = canvasElement?.getBoundingClientRect();
      if (rect) setPlacement(selectedSlot, {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
        z: nextLayer++
      });
    }
    draggedItemId = '';
  }

  function setPlacement(slot: StudioSlot, changes: Partial<NonNullable<StudioCanvasLayout[StudioSlot]>>) {
    const current = canvas[slot] ?? defaultStudioCanvasPlacement(slot);
    canvas = { ...canvas, [slot]: clampStudioCanvasPlacement({ ...current, ...changes }, current) };
  }

  function beginMove(event: PointerEvent, slot: StudioSlot) {
    const placement = canvas[slot];
    if (!placement || !canvasElement) return;
    event.preventDefault();
    selectedSlot = slot;
    setPlacement(slot, { z: nextLayer++ });
    moveState = {
      slot,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function movePiece(event: PointerEvent) {
    if (!moveState || event.pointerId !== moveState.pointerId || !canvasElement) return;
    const rect = canvasElement.getBoundingClientRect();
    setPlacement(moveState.slot, {
      x: moveState.originX + ((event.clientX - moveState.startX) / rect.width) * 100,
      y: moveState.originY + ((event.clientY - moveState.startY) / rect.height) * 100
    });
  }

  function endMove(event: PointerEvent) {
    if (moveState?.pointerId === event.pointerId) moveState = null;
  }

  function resizeSelected(delta: number) {
    const placement = canvas[selectedSlot];
    if (placement) setPlacement(selectedSlot, { scale: placement.scale + delta });
  }

  function layerSelected(delta: number) {
    const placement = canvas[selectedSlot];
    if (placement) setPlacement(selectedSlot, { z: placement.z + delta });
  }

  function nudgeSelected(event: KeyboardEvent, slot: StudioSlot) {
    const placement = canvas[slot];
    if (!placement) return;
    const step = event.shiftKey ? 3 : 1;
    const changes: Partial<NonNullable<StudioCanvasLayout[StudioSlot]>> = {};
    if (event.key === 'ArrowLeft') changes.x = placement.x - step;
    else if (event.key === 'ArrowRight') changes.x = placement.x + step;
    else if (event.key === 'ArrowUp') changes.y = placement.y - step;
    else if (event.key === 'ArrowDown') changes.y = placement.y + step;
    else if (event.key === 'Delete' || event.key === 'Backspace') { remove(slot); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    selectedSlot = slot;
    setPlacement(slot, changes);
  }

  async function saveOutfit() {
    const itemIds = studioItemIds(layout);
    if (!userId || saving) return;
    if (!outfitArchiveAvailable) {
      message = 'The outfit archive is temporarily unavailable. Your board and wardrobe were not changed.';
      return;
    }
    if (itemIds.length < 2) {
      message = 'Add at least two pieces before saving.';
      return;
    }

    saving = true;
    message = '';
    const label = outfitName.trim() || `Studio outfit · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    try {
      const serializedLayout = Object.fromEntries(STUDIO_SLOTS.map((slot) => [slot, layout[slot]?.id ?? null]));
      const serializedCanvas = serializeStudioCanvas(layout, canvas);
      const reference = await addDoc(collection(db, 'users', userId, 'outfits'), {
        itemIds,
        label,
        layout: serializedLayout,
        canvas: serializedCanvas,
        source: 'studio',
        createdAt: serverTimestamp()
      });
      savedOutfits = [{ id: reference.id, itemIds, label, layout: serializedLayout, canvas: serializedCanvas, createdAt: new Date() }, ...savedOutfits].slice(0, 12);
      outfitName = label;
      message = 'Saved to your existing outfit archive.';
      if (currentSuggestion) await learnFrom('saved', true);
    } catch (error) {
      console.error('Could not save studio outfit', error);
      message = 'This outfit could not be saved. Your wardrobe data was not changed.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Visual Outfit Studio · Trackr</title></svelte:head>

<main class="studio-page">
  <section class="studio-hero">
    <div>
      <p class="eyebrow">Visual Outfit Studio</p>
      <h1>Put the whole look together.</h1>
      <p>Drag pieces anywhere on the canvas, then move, resize, and layer them freely. Your wardrobe stays untouched until you explicitly save a new outfit.</p>
    </div>
    <div class="hero-actions">
      <button class="soft" on:click={() => goto('/dashboard')}>Dashboard</button>
      <button on:click={() => generateOutfit(suggestionMode)}>Start with a suggestion</button>
    </div>
  </section>

  {#if loading}
    <div class="state-card">Opening your wardrobe studio…</div>
  {:else if errorMessage}
    <div class="state-card error">{errorMessage}</div>
  {:else if !items.length}
    <div class="state-card"><h2>Your studio needs a wardrobe.</h2><p>Add pieces first, then return to build combinations.</p><button on:click={() => goto('/clothing/add')}>Add a piece</button></div>
  {:else}
    <section class="generator-panel" aria-label="Outfit suggestion generator">
      <div class="generator-intro">
        <p class="eyebrow">Personal outfit intelligence</p>
        <h2>Smart with every piece.</h2>
        <p>Category, subcategory and colour are always enough. Optional details improve confidence, while your feedback teaches Trackr what you actually like.</p>
      </div>
      <div class="generator-options">
        {#each suggestionModes as mode (mode.id)}
          <button class:active={suggestionMode === mode.id} on:click={() => (suggestionMode = mode.id)}>
            <strong>{mode.label}</strong><span>{mode.detail}</span>
          </button>
        {/each}
      </div>
      <div class="generator-actions">
        <div class="scope-control" aria-label="Outfit type">
          <button class:active={outfitScope === 'casual'} on:click={() => (outfitScope = 'casual')}>Casual</button>
          <button class:active={outfitScope === 'sports'} on:click={() => (outfitScope = 'sports')}>Sports</button>
        </div>
        <button class="generate-button" on:click={() => generateOutfit(suggestionMode)}>Generate on canvas <span>→</span></button>
        <small>{personalModel.feedbackCount} learning signal{personalModel.feedbackCount === 1 ? '' : 's'} · private to Trackr</small>
      </div>
    </section>

    <section class="exchange-panel" aria-label="ChatGPT wardrobe exchange">
      <div class="exchange-intro">
        <p class="eyebrow">ChatGPT exchange</p>
        <h2>Take your real wardrobe into a conversation.</h2>
        <p>Export a visual PDF with every picture and exact item ID. Paste ChatGPT’s Trackr code back here to rebuild its suggestion safely.</p>
      </div>
      <div class="exchange-actions">
        <button class="primary" on:click={exportWardrobeForChatGPT}>Export visual wardrobe</button>
        <button on:click={copyCurrentOutfitCode}>Copy canvas code</button>
        <button on:click={() => (exchangeOpen = !exchangeOpen)}>{exchangeOpen ? 'Close importer' : 'Import ChatGPT code'}</button>
      </div>
      {#if exchangeOpen}
        <div class="exchange-importer">
          <label for="trackr-outfit-code"><span>Paste TRACKR_OUTFIT_V1 code</span><textarea id="trackr-outfit-code" bind:value={importCode} placeholder={'TRACKR_OUTFIT_V1\n{\n  "format": "trackr-outfit",\n  "version": 1,\n  "name": "...",\n  "slots": { ... }\n}'}></textarea></label>
          <button class="import-button" on:click={importChatGptOutfit}>Recreate on canvas</button>
          <div class="exchange-feedback" aria-live="polite">
            {#if exchangeMessage}<p>{exchangeMessage}</p>{/if}
            {#if exchangeErrors.length}<ul>{#each exchangeErrors as error}<li>{error}</li>{/each}</ul>{/if}
          </div>
        </div>
      {/if}
    </section>

    {#if currentSuggestion}
      <section class="suggestion-insight" aria-live="polite">
        <div class="insight-score">
          <span>{Math.round(currentSuggestion.confidence * 100)}%</span>
          <small>recommendation confidence</small>
        </div>
        <div class="insight-copy">
          <p class="eyebrow">Why this works</p>
          <ul>{#each currentSuggestion.reasons as reason}<li>{reason}</li>{/each}</ul>
          <small>Optional metadata coverage: {Math.round(currentSuggestion.metadataCoverage * 100)}%. Missing fields never exclude a piece.</small>
        </div>
        <div class="feedback-actions">
          <span>Teach Trackr</span>
          <button on:click={() => learnFrom('like')} disabled={feedbackSaving}>Like this</button>
          <button class="negative" on:click={() => learnFrom('dislike')} disabled={feedbackSaving}>Not for me</button>
        </div>
      </section>
    {/if}

    <section class="studio-layout">
      <aside class="library-panel">
        <div class="panel-head">
          <div><p class="eyebrow">Your wardrobe</p><h2>Choose a piece</h2></div>
          <span>{visibleItems.length}</span>
        </div>
        <label class="search-box">
          <span>⌕</span>
          <input bind:value={queryText} type="search" placeholder="Search name, brand, color…" />
        </label>
        <div class="category-pills">
          {#each categories as category}
            <button class:active={categoryFilter === category} on:click={() => (categoryFilter = category)}>{category}</button>
          {/each}
        </div>
        <div class="role-picker" aria-label="Piece role">
          <span>Place as</span>
          <div>{#each STUDIO_SLOTS as slot}<button class:active={selectedSlot === slot} on:click={() => (selectedSlot = slot)}>{slotLabels[slot]}</button>{/each}</div>
        </div>
        <div class="library-grid">
          {#each visibleItems as item (item.id)}
            <button
              class="library-item"
              draggable="true"
              on:dragstart={(event) => beginDrag(event, item)}
              on:click={() => place(item)}
              title={`Place ${nameFor(item)} into ${slotLabels[selectedSlot]}`}
            >
              <span class="library-image">
                {#if imageFor(item)}<img src={imageFor(item)} alt={nameFor(item)} />{:else}<i>{nameFor(item).slice(0, 1)}</i>{/if}
              </span>
              <span class="library-copy"><strong>{item.brand || 'Unknown brand'}</strong><small>{nameFor(item)}</small></span>
            </button>
          {:else}
            <div class="library-empty">No eligible pieces match this search.</div>
          {/each}
        </div>
      </aside>

      <section class="canvas-panel">
        <div class="canvas-head">
          <div><p class="eyebrow">Outfit board</p><h2>{studioItemIds(layout).length} pieces on canvas</h2></div>
          <button class="text-button" on:click={clearBoard}>Clear board</button>
        </div>

        <div class="canvas-toolbar" class:empty={!layout[selectedSlot]}>
          {#if layout[selectedSlot]}
            <span><strong>{slotLabels[selectedSlot]}</strong> · {nameFor(layout[selectedSlot] as WardrobeItem)}</span>
            <div>
              <button on:click={() => resizeSelected(-.1)} aria-label="Make selected piece smaller">−</button>
              <button on:click={() => resizeSelected(.1)} aria-label="Make selected piece larger">+</button>
              <button on:click={() => layerSelected(-1)}>Back</button>
              <button on:click={() => layerSelected(1)}>Front</button>
              <button class="edit-item" on:click={openSelectedItemEditor}>Edit item</button>
              <button class="danger" on:click={() => remove(selectedSlot)}>Remove</button>
            </div>
          {:else}
            <span>Drag any piece to position it freely. Tap a piece to adjust size or layering.</span>
          {/if}
        </div>

        <div
          class="outfit-canvas free-canvas"
          bind:this={canvasElement}
          role="region"
          aria-label="Free-position outfit canvas"
          on:dragover|preventDefault
          on:drop={dropOnCanvas}
        >
          <div class="canvas-glow one"></div><div class="canvas-glow two"></div>
          {#if !studioItemIds(layout).length}<p class="canvas-empty">Drop a piece anywhere<br /><small>or tap one in your wardrobe</small></p>{/if}
          {#each STUDIO_SLOTS as slot}
            {#if layout[slot] && canvas[slot]}
              {@const item = layout[slot] as WardrobeItem}
              {@const placement = canvas[slot] as NonNullable<StudioCanvasLayout[StudioSlot]>}
              <button
                class="canvas-piece piece-{slot}"
                class:selected={selectedSlot === slot}
                style={`--piece-x:${placement.x}%;--piece-y:${placement.y}%;--piece-scale:${placement.scale};--piece-z:${placement.z}`}
                on:pointerdown={(event) => beginMove(event, slot)}
                on:pointermove={movePiece}
                on:pointerup={endMove}
                on:pointercancel={endMove}
                on:keydown={(event) => nudgeSelected(event, slot)}
                aria-label={`${nameFor(item)}. Drag to move, arrow keys to nudge.`}
              >
                {#if imageFor(item)}<img src={imageFor(item)} alt="" draggable="false" />{:else}<i>{nameFor(item).slice(0, 1)}</i>{/if}
                <span>{slotLabels[slot]}</span>
              </button>
            {/if}
          {/each}
        </div>

        <div class="save-panel">
          <label><span>Outfit name</span><input bind:value={outfitName} maxlength="80" placeholder="e.g. Friday dinner" /></label>
          <button on:click={saveOutfit} disabled={saving || studioItemIds(layout).length < 2 || !outfitArchiveAvailable}>{saving ? 'Saving…' : 'Save outfit'}</button>
        </div>
        {#if message}<p class="studio-message" aria-live="polite">{message}</p>{/if}
      </section>

      <aside class="archive-panel">
        <div class="panel-head"><div><p class="eyebrow">Outfit archive</p><h2>Saved looks</h2></div><span>{savedOutfits.length}</span></div>
        <p class="archive-help">
          {outfitArchiveAvailable
            ? 'Open a saved look on the board without changing the original.'
            : 'The archive is temporarily unavailable. You can still build outfits safely.'}
        </p>
        <div class="archive-list">
          {#each savedOutfits as saved (saved.id)}
            <button on:click={() => loadSaved(saved)}>
              <span class="archive-images">
                {#each saved.itemIds.slice(0, 4) as id}
                  {@const item = items.find((entry) => entry.id === id)}
                  <i>{#if item && imageFor(item)}<img src={imageFor(item)} alt="" />{:else}—{/if}</i>
                {/each}
              </span>
              <span class="archive-copy"><strong>{saved.label || 'Saved outfit'}</strong><small>{saved.itemIds.length} pieces · Open as new</small></span>
            </button>
          {:else}
            <div class="archive-empty">Your saved outfits will appear here.</div>
          {/each}
        </div>
      </aside>
    </section>
  {/if}
</main>

<style>
  :global(body){ background:#f5f5f2; }
  .studio-page{ width:min(100%,1480px); margin:0 auto; padding-bottom:5rem; color:#151515; font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif; }
  .studio-hero{ min-height:230px; padding:clamp(1.6rem,5vw,3.5rem); box-sizing:border-box; display:flex; align-items:flex-end; justify-content:space-between; gap:2rem; overflow:hidden; border:1px solid rgba(255,255,255,.9); border-radius:30px; background:radial-gradient(circle at 18% 15%,rgba(122,102,255,.20),transparent 32%),radial-gradient(circle at 86% 60%,rgba(255,158,77,.17),transparent 29%),rgba(255,255,255,.72); box-shadow:0 24px 65px rgba(0,0,0,.05); }
  .eyebrow{ margin:0 0 .5rem; color:#777; font-size:.65rem; font-weight:850; letter-spacing:.12em; text-transform:uppercase; }
  h1{ max-width:780px; margin:0; font-size:clamp(2.5rem,5.4vw,4.8rem); line-height:.92; letter-spacing:-.068em; } h2{ margin:0; font-size:1.1rem; letter-spacing:-.035em; }
  .studio-hero p:not(.eyebrow){ max-width:680px; margin:1rem 0 0; color:#666; line-height:1.5; }
  .hero-actions{ display:flex; gap:.45rem; flex-wrap:wrap; }.hero-actions button,.state-card button{ padding:.7rem 1rem; border:0; border-radius:999px; background:#171717; color:#fff; cursor:pointer; white-space:nowrap; }.hero-actions .soft{ border:1px solid rgba(0,0,0,.08); background:rgba(255,255,255,.72); color:#222; }
  .state-card{ margin-top:.8rem; padding:4rem 2rem; border-radius:22px; background:#fff; color:#777; text-align:center; }.state-card h2{ color:#171717; }.state-card.error{ color:#9c3340; }
  .generator-panel{margin-top:.8rem;padding:1rem;display:grid;grid-template-columns:minmax(230px,.85fr) minmax(560px,1.9fr) minmax(150px,.55fr);gap:1rem;align-items:center;border:1px solid rgba(255,255,255,.9);border-radius:22px;background:rgba(255,255,255,.8);box-shadow:0 18px 46px rgba(0,0,0,.04)}.generator-intro h2{font-size:1.05rem}.generator-intro>p:not(.eyebrow){margin:.35rem 0 0;color:#888;font-size:.65rem;line-height:1.45}.generator-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.35rem}.generator-options button{min-height:62px;padding:.55rem;border:1px solid #e8e8e4;border-radius:12px;background:#fafaf8;color:#555;text-align:left;cursor:pointer}.generator-options button.active{border-color:#755cff;background:#f0edff;color:#4f3bb8;box-shadow:0 0 0 2px rgba(117,92,255,.08)}.generator-options strong,.generator-options span{display:block}.generator-options strong{font-size:.65rem}.generator-options span{margin-top:.2rem;color:#888;font-size:.52rem;line-height:1.25}.generator-actions{display:grid;gap:.4rem}.scope-control{padding:.22rem;display:grid;grid-template-columns:1fr 1fr;gap:.2rem;border-radius:10px;background:#ecece8}.scope-control button{padding:.45rem;border:0;border-radius:8px;background:transparent;color:#777;font-size:.62rem;cursor:pointer}.scope-control button.active{background:#fff;color:#171717;font-weight:850;box-shadow:0 3px 10px rgba(0,0,0,.06)}.generate-button{padding:.75rem .9rem;border:0;border-radius:12px;background:#171717;color:#fff;font-size:.68rem;font-weight:800;cursor:pointer;white-space:nowrap}.generate-button span{margin-left:.35rem}.generator-actions>small{color:#888;font-size:.52rem;text-align:center}.suggestion-insight{margin-top:.65rem;padding:.85rem 1rem;display:grid;grid-template-columns:125px minmax(0,1fr) auto;gap:1rem;align-items:center;border:1px solid #ddd8ff;border-radius:19px;background:linear-gradient(110deg,#f1eeff,#fff 58%,#eef8f2);box-shadow:0 12px 35px rgba(63,46,140,.05)}.insight-score{padding-right:1rem;border-right:1px solid rgba(0,0,0,.07)}.insight-score span,.insight-score small{display:block}.insight-score span{font-size:2.2rem;font-weight:900;letter-spacing:-.07em}.insight-score small,.insight-copy>small{color:#7c7c7c;font-size:.56rem;line-height:1.35}.insight-copy .eyebrow{margin-bottom:.25rem}.insight-copy ul{margin:.2rem 0 .3rem;padding-left:1rem;color:#444;font-size:.66rem;line-height:1.45}.feedback-actions{display:grid;grid-template-columns:1fr 1fr;gap:.3rem}.feedback-actions>span{grid-column:1/-1;color:#777;font-size:.55rem;font-weight:850;text-transform:uppercase}.feedback-actions button{padding:.5rem .65rem;border:1px solid #cfded3;border-radius:9px;background:#fff;color:#315c40;font-size:.6rem;font-weight:800;cursor:pointer}.feedback-actions button.negative{border-color:#e5d4d4;color:#855050}.feedback-actions button:disabled{opacity:.45}
  .exchange-panel{margin-top:.65rem;padding:1rem;display:grid;grid-template-columns:minmax(280px,1fr) auto;gap:1rem;align-items:center;border:1px solid #e2ded7;border-radius:22px;background:linear-gradient(115deg,#fff,#f8f4ee);box-shadow:0 14px 40px rgba(0,0,0,.035)}.exchange-intro h2{font-size:1.05rem}.exchange-intro>p:not(.eyebrow){max-width:720px;margin:.35rem 0 0;color:#777;font-size:.65rem;line-height:1.45}.exchange-actions{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}.exchange-actions button,.import-button{padding:.64rem .78rem;border:1px solid #ddd9d1;border-radius:11px;background:#fff;color:#333;font-size:.63rem;font-weight:800;cursor:pointer}.exchange-actions button.primary,.import-button{border-color:#171717;background:#171717;color:#fff}.exchange-importer{grid-column:1/-1;padding:.85rem;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;align-items:end;border-top:1px solid #e4e0d9}.exchange-importer label span{display:block;margin-bottom:.35rem;color:#777;font-size:.58rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.exchange-importer textarea{width:100%;min-height:145px;padding:.7rem;box-sizing:border-box;resize:vertical;border:1px solid #ddd9d1;border-radius:11px;background:#fff;font:500 .65rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.import-button{min-height:42px}.exchange-feedback{grid-column:1/-1;font-size:.65rem}.exchange-feedback p{margin:0;color:#39634a;font-weight:750}.exchange-feedback ul{margin:.2rem 0 0;padding-left:1.2rem;color:#9c3340}
  .studio-layout{ display:grid; grid-template-columns:minmax(240px,.72fr) minmax(520px,1.5fr) minmax(220px,.6fr); gap:.8rem; margin-top:.8rem; align-items:start; }
  .library-panel,.canvas-panel,.archive-panel{ padding:1rem; border:1px solid rgba(255,255,255,.9); border-radius:22px; background:rgba(255,255,255,.78); box-shadow:0 18px 46px rgba(0,0,0,.045); }
  .library-panel,.archive-panel{ max-height:760px; overflow:auto; }.panel-head,.canvas-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }.panel-head > span{ min-width:26px; height:26px; display:grid; place-items:center; border-radius:999px; background:#f0f0ed; color:#777; font-size:.66rem; }
  .search-box{ margin:.85rem 0 .65rem; padding:0 .7rem; height:40px; display:flex; align-items:center; gap:.5rem; border:1px solid #e6e6e3; border-radius:12px; background:#fff; }.search-box input{ min-width:0; width:100%; border:0; outline:0; background:transparent; font:inherit; font-size:.76rem; }
  .category-pills{ display:flex; gap:.3rem; overflow-x:auto; padding-bottom:.25rem; }.category-pills button{ padding:.35rem .62rem; border:1px solid #e5e5e2; border-radius:999px; background:#fff; color:#777; font-size:.65rem; white-space:nowrap; cursor:pointer; }.category-pills button.active{ border-color:#171717; background:#171717; color:#fff; }.role-picker{margin:.7rem 0 .5rem}.role-picker>span{display:block;margin-bottom:.3rem;color:#888;font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.role-picker>div{display:flex;gap:.25rem;overflow-x:auto;padding-bottom:.15rem}.role-picker button{padding:.3rem .48rem;border:1px solid #e5e5e2;border-radius:999px;background:#fff;color:#777;font-size:.58rem;white-space:nowrap;cursor:pointer}.role-picker button.active{border-color:#755cff;background:#eeeafd;color:#5f48d2;font-weight:800}
  .library-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.45rem; }.library-item{ min-width:0; padding:.4rem; display:grid; grid-template-columns:42px minmax(0,1fr); gap:.45rem; align-items:center; border:1px solid #ececea; border-radius:13px; background:#fafaf8; color:inherit; text-align:left; cursor:grab; }.library-item:hover{ border-color:#aaa; }.library-image{ width:42px; height:48px; display:grid; place-items:center; overflow:hidden; border-radius:9px; background:#efefec; }.library-image img,.archive-images img{ width:100%; height:100%; object-fit:contain; }.library-image i{ color:#aaa; font-style:normal; }.library-copy{ min-width:0; }.library-copy strong,.library-copy small{ display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.library-copy strong{ font-size:.68rem; }.library-copy small{ margin-top:.12rem; color:#777; font-size:.62rem; }.library-empty,.archive-empty{ grid-column:1/-1; padding:2rem .5rem; color:#999; font-size:.72rem; text-align:center; }
  .text-button{ border:0; background:transparent; color:#777; font-size:.7rem; cursor:pointer; }.canvas-toolbar{min-height:38px;margin-top:.75rem;padding:.42rem .55rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;box-sizing:border-box;border:1px solid #e7e7e3;border-radius:12px;background:#f7f7f4}.canvas-toolbar>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#777;font-size:.64rem}.canvas-toolbar>span strong{color:#222}.canvas-toolbar>div{display:flex;gap:.25rem;flex-shrink:0}.canvas-toolbar button{min-width:30px;padding:.34rem .48rem;border:1px solid #ddd;border-radius:8px;background:#fff;color:#555;font-size:.58rem;cursor:pointer}.canvas-toolbar button.edit-item{border-color:#171717;background:#171717;color:#fff}.canvas-toolbar button.danger{color:#9d3838}.canvas-toolbar.empty{justify-content:center}.outfit-canvas{position:relative;min-height:660px;margin-top:.55rem;overflow:hidden;border:1px solid rgba(0,0,0,.06);border-radius:24px;background:linear-gradient(145deg,#f0efec,#faf9f6);touch-action:none;user-select:none}.canvas-glow{position:absolute;width:260px;height:260px;border-radius:50%;filter:blur(2px);opacity:.3;pointer-events:none}.canvas-glow.one{left:-80px;top:40px;background:radial-gradient(circle,rgba(122,102,255,.4),transparent 70%)}.canvas-glow.two{right:-90px;bottom:0;background:radial-gradient(circle,rgba(255,153,75,.35),transparent 70%)}.canvas-empty{position:absolute;inset:0;display:grid;place-content:center;margin:0;color:#999;font-size:.8rem;font-weight:750;line-height:1.6;text-align:center;pointer-events:none}.canvas-empty small{font-size:.65rem;font-weight:500}.canvas-piece{position:absolute;left:var(--piece-x);top:var(--piece-y);z-index:var(--piece-z);width:29%;height:31%;padding:.25rem;display:grid;place-items:center;transform:translate(-50%,-50%) scale(var(--piece-scale));transform-origin:center;border:1px solid transparent;border-radius:16px;background:transparent;cursor:grab;touch-action:none}.canvas-piece:active{cursor:grabbing}.canvas-piece.selected{border-color:rgba(117,92,255,.42);background:rgba(255,255,255,.28);box-shadow:0 0 0 3px rgba(117,92,255,.08)}.canvas-piece img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 13px 12px rgba(0,0,0,.11));pointer-events:none}.canvas-piece i{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#ddd;color:#777;font-style:normal}.canvas-piece>span{position:absolute;left:50%;bottom:3px;max-width:90%;padding:.18rem .38rem;transform:translateX(-50%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:999px;background:rgba(20,20,20,.72);color:#fff;font-size:.48rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:0;transition:opacity .15s}.canvas-piece.selected>span{opacity:1}.canvas-piece.piece-bottom{width:27%;height:38%}.canvas-piece.piece-shoes{width:25%;height:18%}.canvas-piece.piece-accessory{width:20%;height:22%}.canvas-piece.piece-outerwear{width:31%;height:34%}
  .save-panel{ margin-top:.75rem; padding:.75rem; display:flex; align-items:flex-end; gap:.65rem; border-radius:16px; background:#f2f2ef; }.save-panel label{ min-width:0; flex:1; }.save-panel label span{ display:block; margin-bottom:.3rem; color:#777; font-size:.62rem; font-weight:800; text-transform:uppercase; }.save-panel input{ width:100%; box-sizing:border-box; padding:.62rem .7rem; border:1px solid #dededb; border-radius:10px; background:#fff; font:inherit; }.save-panel button{ padding:.7rem 1rem; border:0; border-radius:11px; background:#171717; color:#fff; cursor:pointer; white-space:nowrap; }.save-panel button:disabled{ opacity:.45; cursor:not-allowed; }.studio-message{ margin:.6rem .2rem 0; color:#496555; font-size:.7rem; font-weight:700; }
  .archive-help{ margin:.7rem 0; color:#888; font-size:.68rem; line-height:1.45; }.archive-list{ display:grid; gap:.5rem; }.archive-list > button{ width:100%; padding:.55rem; display:grid; grid-template-columns:80px minmax(0,1fr); gap:.55rem; align-items:center; border:1px solid #ececea; border-radius:13px; background:#fafaf8; color:inherit; text-align:left; cursor:pointer; }.archive-list > button:hover{ border-color:#aaa; }.archive-images{ display:grid; grid-template-columns:repeat(4,1fr); height:48px; overflow:hidden; border-radius:9px; background:#efefec; }.archive-images i{ min-width:0; display:grid; place-items:center; overflow:hidden; color:#aaa; font-size:.55rem; font-style:normal; }.archive-copy{ min-width:0; }.archive-copy strong,.archive-copy small{ display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.archive-copy strong{ font-size:.7rem; }.archive-copy small{ margin-top:.15rem; color:#888; font-size:.6rem; }
  @media(max-width:1150px){ .generator-panel{grid-template-columns:1fr minmax(160px,.35fr)}.generator-intro{grid-column:1/-1}.generator-options{grid-template-columns:repeat(4,minmax(0,1fr))}.studio-layout{ grid-template-columns:minmax(230px,.7fr) minmax(500px,1.3fr); }.archive-panel{ grid-column:1/-1; max-height:none; }.archive-list{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
  @media(max-width:820px){ .studio-hero{ min-height:0; align-items:flex-start; flex-direction:column; }.generator-panel{grid-template-columns:1fr}.generator-options{grid-template-columns:repeat(3,minmax(0,1fr))}.generate-button{width:100%}.exchange-panel{grid-template-columns:1fr}.exchange-actions{justify-content:flex-start}.suggestion-insight{grid-template-columns:100px 1fr}.feedback-actions{grid-column:1/-1;grid-template-columns:1fr 1fr}.studio-layout{ grid-template-columns:1fr; }.library-panel{ max-height:520px; }.canvas-panel{ grid-row:1; }.archive-panel{ grid-column:auto; }.archive-list{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media(max-width:560px){ .studio-hero{ border-radius:24px; }.generator-options{grid-template-columns:1fr 1fr}.exchange-actions{display:grid;grid-template-columns:1fr}.exchange-importer{grid-template-columns:1fr}.import-button{width:100%}.suggestion-insight{grid-template-columns:1fr}.insight-score{padding:0 0 .6rem;border-right:0;border-bottom:1px solid rgba(0,0,0,.07)}.canvas-toolbar{align-items:stretch;flex-direction:column}.canvas-toolbar>div{width:100%;overflow-x:auto}.outfit-canvas{min-height:560px}.canvas-piece{width:34%;height:29%}.canvas-piece.piece-bottom{width:32%;height:36%}.canvas-piece.piece-shoes{width:29%;height:17%}.canvas-piece.piece-accessory{width:24%;height:20%}.canvas-piece.piece-outerwear{width:36%;height:32%}.save-panel{ align-items:stretch; flex-direction:column; }.save-panel button{ width:100%; }.archive-list{ grid-template-columns:1fr; } }
</style>
