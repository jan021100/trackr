<!--
FILE: src/lib/components/ItemEditor.svelte
PURPOSE: Edit existing clothing item (Trackr app)
-->

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let item: Record<string, any>;
  const dispatch = createEventDispatcher();
  import { onMount, onDestroy } from 'svelte';
  import { auth, db } from '$lib/firebase';
  import { doc, getDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { User } from 'firebase/auth';
  import { compressImageForFirestore, formatImageBytes, imageFileFromClipboard } from '$lib/utils/imageCompression';

  let user: User | null = null;
  let itemId = '';
  let itemRef;
  let imageBase64 = '';
  let imageUploadBusy = false;
  let imageUploadMessage = '';
  let imageUploadError = '';

  let name = '';
  let brand = '';
  let imageUrl = '';
  let mainCategory = '';
  let lowerCategory = '';
  let status = 'active';
  let season = '';
  let condition = '';
  let price = '';
  let size = '';
  let temperature = '';
  let color = '';
  let fit = '';
  let pattern = '';
  let weight = '';
  let style = 'casual';  
  let outfitEligible = true;

  // ✅ quantity (default 1)
  let quantity: number = 1;

  // ✅ labels (separate from status)
  let labels: string[] = [];
  const labelOptions = ['Second-Hand', 'Gift', 'Inherited', 'Legacy'];

  // ✅ now a plain text field: "dd.mm.yyyy"
  let purchaseDate = '';

  // ✅ error message if format invalid
  let purchaseDateError = '';

  const mainCategories = ['Casual', 'Cycling', 'Running', 'Other Sports'];

  const lowerCategories = [
    'Sweaters','Hoodies','T-Shirts','Thick Shirts','Thin Shirts','Polo Shirts','Base Layers',
    'SS Jerseys','LS Jerseys','SS Shirts','LS Shirts','Jackets','Vests',
    'Pants','Shorts','Chinos','Joggers','Leggings','Jeans',
    'Gloves','Headwear','Socks','Bags','Backpacks','Glasses',
    'Others','Leg Warmers','Shoes','Running Shoes','Sneakers','Slides'
  ];

  const statuses = ['active','lent out','sold','for sale','retired'];
  const seasons = ['1/3','2/3','3/3','X/3'];
  const conditions = ['new','like new','good','worn','damaged'];

  const allColors = [
      { name: 'Black', hex: '#111111' },
      { name: 'Charcoal', hex: '#2C2C2C' },
      { name: 'Grey', hex: '#8A8A8A' },
      { name: 'Light-Grey', hex: '#CFCFCF' },
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Off-White', hex: '#F5F5F3' },
      { name: 'Navy', hex: '#1F2A44' },
      { name: 'Mid-Blue', hex: '#3A5FA8' },
      { name: 'Royal-Blue', hex: '#17458F' },
      { name: 'Slate', hex: '#5A646E' },
      { name: 'Olive', hex: '#6B7A3A' },
      { name: 'Beige', hex: '#D6C7A1' },
      { name: 'Sand', hex: '#E6D3A3' },
      { name: 'Cream', hex: '#FFF5D6' },
      { name: 'Stone', hex: '#B9B3A5' },
      { name: 'Taupe', hex: '#8B7D6B' },
      { name: 'Brown', hex: '#6A4A2C' },
      { name: 'Dark-Brown', hex: '#3E2A1F' },
      { name: 'Fluorescent-Yellow', hex: '#D7FF00' },
      { name: 'Neon-Green', hex: '#39FF14' },
      { name: 'Cyan', hex: '#00C7FF' },
      { name: 'Orange', hex: '#FF6A00' },
      { name: 'Red', hex: '#D03C3F' },
      { name: 'Burgundy', hex: '#702632' },
      { name: 'Pink', hex: '#D41367' },
      { name: 'Purple', hex: '#6B4EA0' },
      { name: 'Yellow', hex: '#FFD400' },
      { name: 'Light-Blue', hex: '#A7D8FF' },
      { name: 'Denim', hex: '#4A6FA5' },
      { name: 'Dark-Grey', hex: '#4B4B4B' },
      { name: 'Forest-Green', hex: '#2F4F3E' },
      { name: 'Wine', hex: '#5A1E2C' }
    ];
    
    const fitOptions = ['slim','regular','oversized'];
    const patternOptions = ['plain','graphic','pattern'];
    const weightOptions = ['thin','mid','thick'];
    const styleOptions = ['casual','formal','sporty'];

  function pad2(n: number) {
    return String(n).padStart(2, '0');
  }

  function parseDDMMYYYYToISO(input: string): string | null | undefined {
    const raw = (input ?? '').trim();
    if (!raw) return null;

    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return undefined;

    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);

    if (mm < 1 || mm > 12) return undefined;
    if (dd < 1 || dd > 31) return undefined;
    if (yyyy < 1900 || yyyy > 2100) return undefined;

    const dt = new Date(yyyy, mm - 1, dd);
    if (
      dt.getFullYear() !== yyyy ||
      dt.getMonth() !== mm - 1 ||
      dt.getDate() !== dd
    ) {
      return undefined;
    }

    return dt.toISOString();
  }

  function isoToDDMMYYYY(iso: string): string {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    return `${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  }

  function validatePurchaseDateLive() {
    const res = parseDDMMYYYYToISO(purchaseDate);
    if (res === undefined) {
      purchaseDateError = 'Invalid format. Use dd.mm.yyyy (e.g. 03.08.2022).';
    } else {
      purchaseDateError = '';
    }
  }

  function toggleLabel(label: string) {
    if (labels.includes(label)) {
      labels = labels.filter((l) => l !== label);
    } else {
      labels = [...labels, label];
    }
  }

  let hydrated = false;

$: if (item && !hydrated) {
  // support both shapes: {product: ...} and {name: ...}
  name = item.product ?? item.name ?? '';
  brand = item.brand ?? '';
  imageUrl = item.imageUrl ?? '';
  mainCategory = item.mainCategory ?? '';
  lowerCategory = item.lowerCategory ?? '';
  status = item.status ?? 'active';
  season = item.season ?? '';
  condition = item.condition ?? '';
  price = item.price?.toString?.() ?? (item.price ?? '');
  size = item.size ?? '';
  temperature = item.temperature ?? '';
  color = item.color ?? '';
  imageBase64 = item.imageBase64 ?? '';
  outfitEligible = item.outfitEligible !== false;

  quantity =
    Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
      ? Number(item.quantity)
      : 1;

  labels = Array.isArray(item.labels) ? item.labels : [];

  purchaseDate = item.purchaseDate ? isoToDDMMYYYY(item.purchaseDate) : '';
  
  fit = item.fit ?? '';
  pattern = item.pattern ?? '';
  weight = item.weight ?? '';
  style = item.style ?? '';
  hydrated = true;
}


  function save() {
  if (imageUploadBusy) {
    imageUploadError = 'Please wait for the image to finish processing.';
    return;
  }
  const parsed = parseDDMMYYYYToISO(purchaseDate);

  if (parsed === undefined) {
    purchaseDateError = 'Invalid format. Use dd.mm.yyyy';
    return;
  }

  dispatch('save', {
    ...item,
    product: name,
    brand,
    imageUrl,
    imageBase64,
    mainCategory,
    lowerCategory,
    status,
    season,
    condition,
    price: parseFloat(price) || null,
    size,
    temperature,
    color,
    quantity,
    labels,
    outfitEligible,
    purchaseDate: parsed,
    fit,
    pattern,
    weight,
    style
  });
}

  
  async function processImageFile(file: File, source: 'upload' | 'paste', input?: HTMLInputElement) {
    imageUploadBusy = true;
    imageUploadMessage = source === 'paste' ? 'Optimizing pasted image safely…' : 'Optimizing image safely…';
    imageUploadError = '';
    try {
      const compressed = await compressImageForFirestore(file);
      // Only replace the existing value after a complete, validated conversion.
      imageBase64 = compressed.dataUrl;
      dispatch('imageprocessed', { storageFormat: compressed.storageFormat });
      const formatLabel = compressed.storageFormat === 'webp' ? 'WebP' : 'transparent PNG fallback';
      imageUploadMessage = `Ready to save · ${formatLabel} · ${compressed.width}×${compressed.height} · ${formatImageBytes(compressed.byteLength)}`;
    } catch (error) {
      imageUploadError = error instanceof Error ? error.message : 'The image could not be processed.';
      imageUploadMessage = 'The previous image has been preserved.';
      if (input) input.value = '';
    } finally {
      imageUploadBusy = false;
    }
  }

  async function handleImageUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await processImageFile(file, 'upload', input);
  }

  async function handleImagePaste(event: ClipboardEvent) {
    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) {
      imageUploadError = 'The clipboard does not contain an image. Copy an image, then try ⌘V again.';
      return;
    }
    event.preventDefault();
    await processImageFile(file, 'paste');
  }

function confirmDelete() {
  const ok = confirm(`Delete "${name}"? This cannot be undone.`);
  if (!ok) return;

  dispatch('remove', item);
}

</script>

<svelte:head>
  <title>Edit Item</title>
</svelte:head>

<div class="editor-root">
    <header class="header">
      <h1>Edit Item</h1>
      <p class="sub">Fine-tune details so your inventory stays clean & searchable.</p>
    </header>

    <form class="form" on:submit|preventDefault={save}>
      <div class="group">
        <label class="label">Name</label>
        <input class="field" placeholder="e.g. Better Sweater Jacket" bind:value={name} required />
      </div>

      <div class="group">
        <label class="label">Brand</label>
        <input class="field" placeholder="e.g. Patagonia" bind:value={brand} />
      </div>

      <div class="group">
        <label class="label">Image URL</label>
        <input class="field" placeholder="https://…" bind:value={imageUrl} />
      </div>
      
      <div class="group">
        <label class="label">Upload Image</label>
        <div class="image-upload-row">
          {#if imageBase64 || imageUrl}
            <img class="image-preview" src={imageBase64 || imageUrl} alt="Current item preview" />
          {/if}
          <div class="image-upload-copy">
            <input type="file" accept="image/*" on:change={handleImageUpload} disabled={imageUploadBusy} />
            <div class="paste-image-zone" role="textbox" aria-multiline="false" tabindex="0" on:paste={handleImagePaste} aria-label="Paste an image from the clipboard">
              <strong>Or click here and press ⌘V</strong>
              <span>Paste a copied image from Safari, Finder, or another app.</span>
            </div>
            <small>Safari-compatible WebP is preferred. Transparent PNG is used only if both WebP encoders fail. Maximum 80 KB.</small>
            {#if imageUploadMessage}<span class="image-status" aria-live="polite">{imageUploadMessage}</span>{/if}
            {#if imageUploadError}<span class="error" role="alert">{imageUploadError}</span>{/if}
          </div>
        </div>
      </div>

      <div class="row">
        <div class="group">
          <label class="label">Main Category</label>
          <select class="field" bind:value={mainCategory} required>
            <option value="" disabled>Select</option>
            {#each mainCategories as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>

        <div class="group">
          <label class="label">Lower Category</label>
          <select class="field" bind:value={lowerCategory} required>
            <option value="" disabled>Select</option>
            {#each lowerCategories as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="row">
        <div class="group">
          <label class="label">Status</label>
          <select class="field" bind:value={status}>
            {#each statuses as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </div>

        <div class="group">
          <label class="label">Season</label>
          <select class="field" bind:value={season}>
            <option value="" disabled>Select</option>
            {#each seasons as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </div>

        <div class="group">
          <label class="label">Condition</label>
          <select class="field" bind:value={condition}>
            <option value="" disabled>Select</option>
            {#each conditions as c}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Quantity, Outfit and Labels -->

      <div class="row2">
  <!-- Quantity -->
  <div class="group">
    <label class="label">Quantity</label>
    <input
      class="field"
      type="number"
      min="1"
      step="1"
      bind:value={quantity}
    />
  </div>

  <!-- Outfit toggle -->
  <div class="group">
    <label class="label">Outfit</label>
    <div class="toggle-inline">
      <button
        type="button"
        class="toggle {outfitEligible ? 'on' : ''}"
        on:click={() => (outfitEligible = !outfitEligible)}
        aria-pressed={outfitEligible}
      >
        <span class="knob"></span>
      </button>
    </div>
  </div>

  <!-- Labels -->
  <div class="group">
    <div class="label-row">
      <label class="label">Labels</label>
      {#if labels.length > 0}
        <span class="pill">{labels.length}</span>
      {/if}
    </div>

    <div class="label-grid">
      {#each labelOptions as l}
        <button
          type="button"
          class="label-chip {labels.includes(l) ? 'active' : ''}"
          on:click={() => toggleLabel(l)}
        >
          {l}
        </button>
      {/each}
    </div>
  </div>
</div>
     

      <div class="group">
        <label class="label">Purchase Date (dd.mm.yyyy)</label>
        <input
          class="field {purchaseDateError ? 'field-error' : ''}"
          placeholder="e.g. 03.08.2022"
          bind:value={purchaseDate}
          on:input={validatePurchaseDateLive}
        />
        {#if purchaseDateError}
          <div class="error">{purchaseDateError}</div>
        {/if}
      </div>

      <div class="group">
  <div class="label-row">
    <label class="label">Color</label>
    {#if color}
      <span class="pill">{color}</span>
    {/if}
  </div>

  <div class="color-grid">
    {#each allColors as c}
      <button
        type="button"
        class="swatch {color === c.name ? 'active' : ''}"
        on:click={() => (color = c.name)}
        title={c.name}
      >
        <div class="dot" style={`background:${c.hex}`}></div>
      </button>
    {/each}
  </div>
</div>

<div class="row4">
  <div class="group">
    <label class="label">Fit</label>
    <select class="field" bind:value={fit}>
      <option value="">–</option>
      {#each fitOptions as f}
        <option value={f}>{f}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label class="label">Pattern</label>
    <select class="field" bind:value={pattern}>
      <option value="">–</option>
      {#each patternOptions as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label class="label">Weight</label>
    <select class="field" bind:value={weight}>
      <option value="">–</option>
      {#each weightOptions as w}
        <option value={w}>{w}</option>
      {/each}
    </select>
  </div>
  
  <div class="group">
  <label class="label">Style</label>
  <select class="field" bind:value={style}>
    <option value="">–</option>
    {#each styleOptions as s}
      <option value={s}>{s}</option>
    {/each}
  </select>
</div>
</div>

      <div class="row">
        <div class="group">
          <label class="label">Price (€)</label>
          <input class="field" type="number" step="0.01" placeholder="e.g. 150" bind:value={price} />
        </div>

        <div class="group">
          <label class="label">Size</label>
          <input class="field" placeholder="e.g. S / M / 42" bind:value={size} />
        </div>

        <div class="group">
          <label class="label">Temperature</label>
          <input class="field" placeholder="e.g. 5–12°C" bind:value={temperature} />
        </div>
      </div>

      <div class="actions">
        <div class="left">
          <button
            type="button"
            class="btn ghost"
            on:click={() => dispatch('cancel')}
          >
            Cancel
          </button>
        </div>

        <div class="right">
          <button
            type="button"
            class="btn danger"
            on:click={confirmDelete}
          >
            Delete
          </button>

          <button
            type="submit"
            class="btn primary"
            disabled={imageUploadBusy}
          >
            {imageUploadBusy ? 'Optimizing…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

:root{
  --bg: #f6f6f6;
  --card: #ffffff;
  --border: #e6e6e6;

  --text: #111111;
  --muted: #6a6a6a;

  --accent: #111111;
  --danger: #d92c2c;

  --radius: 10px;
}

.page{
  padding: 2.5rem 1.5rem;
  display:flex;
  justify-content:center;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, sans-serif;
}

.card{
  width: min(720px, 100%);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.8rem;
}

.header{
  margin-bottom: 1.5rem;
}

h1{
  margin: 0 0 .25rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.sub{
  margin: 0;
  font-size: .9rem;
  color: var(--muted);
}

.form{
  display:flex;
  flex-direction: column;
  gap: 1.1rem;
}

.group{
  display:flex;
  flex-direction:column;
  gap:.35rem;
}

.label{
  font-size: .7rem;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--muted);
}

.row{
  display:grid;
  grid-template-columns: repeat(3, 1fr);
  gap: .8rem;
}

@media (max-width: 760px){
  .row{ grid-template-columns: 1fr; }
}

/* INPUTS */

.field{
  height: 42px;
  padding: 0 .75rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: .95rem;
}

.field:focus{
  outline: none;
  border-color: #111;
}

.field-error{
  border-color: var(--danger);
}

.error{
  font-size: .8rem;
  color: var(--danger);
}

.image-upload-row{ display:flex; align-items:center; gap:.8rem; padding:.65rem; border:1px solid var(--border); border-radius:8px; background:#fafafa; }
.image-preview{ width:62px; height:70px; flex:0 0 auto; object-fit:contain; border-radius:7px; background:#fff; border:1px solid #ececec; }
.image-upload-copy{ min-width:0; display:grid; gap:.3rem; }
.image-upload-copy small{ color:var(--muted); font-size:.72rem; line-height:1.35; }
.image-status{ color:#3d654c; font-size:.75rem; font-weight:600; }
.paste-image-zone{padding:.55rem .65rem;border:1px dashed #cfcfc9;border-radius:8px;background:#fff;outline:none;cursor:text}.paste-image-zone:focus{border-color:#755cff;box-shadow:0 0 0 3px rgba(117,92,255,.1)}.paste-image-zone strong,.paste-image-zone span{display:block}.paste-image-zone strong{font-size:.74rem}.paste-image-zone span{margin-top:.12rem;color:var(--muted);font-size:.67rem}
.btn:disabled{ opacity:.55; cursor:wait; }

/* SMALL QUANTITY FIELD */

input[type="number"]{
  width: 90px;
}

/* LABEL CHIPS — MAAP STYLE */

.label-grid{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:.4rem;
}

.label-chip{
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid #ddd;
  background: #fafafa;
  font-size: .82rem;
  cursor:pointer;
  transition: all .15s ease;
}

.label-chip:hover{
  border-color:#bbb;
}

.label-chip.active{
  background:#111;
  color:#fff;
  border-color:#111;
}

/* COLOR SELECTOR */

.color-grid{
  display:flex;
  flex-wrap:wrap;
  gap:12px;
  margin-top:.6rem;
}

/* critical: remove button defaults */
.swatch{
  appearance:none;
  -webkit-appearance:none;

  width:44px;
  height:44px;
  padding:0;
  margin:0;

  border-radius:50%;
  border:2px solid #e3e3e3;

  display:flex;
  align-items:center;
  justify-content:center;

  background:#fff;
  cursor:pointer;
  line-height:0;
}

.swatch.active{
  border-color:#111;
}

.dot{
  width:30px;
  height:30px;
  border-radius:50%;
  flex-shrink:0;
}

/* BUTTONS */

.actions{
  display:flex;
  gap:.6rem;
  margin-top:.3rem;
}

.btn{
  height: 40px;
  padding: 0 .9rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  cursor:pointer;
  font-weight: 500;
}

.btn.primary{
  background: #111;
  color: white;
  border: none;
}

.btn.danger{
  border:1px solid #f0b5b5;
  color: var(--danger);
  background:#fff;
}
.editor-root{
  width: min(900px, 92vw);
}

.actions{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-top:.6rem;
  padding-top:.5rem;
  border-top:1px solid var(--border);
}

.actions .right{
  display:flex;
  gap:.5rem;
}

.editor-root{
  width: min(900px, 92vw);
  padding-bottom: 24px; /* keeps buttons off the modal edge */
  max-height: calc(100vh - 140px); /* ensures it never touches top/bottom */
  overflow: auto; /* scroll inside the modal instead of pushing to screen edge */
  box-sizing: border-box;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  border: none;
  background: #ddd;
  position: relative;
  cursor: pointer;
  transition: background .2s ease;
}

.toggle.on {
  background: #111;
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform .2s ease;
}

.toggle.on .knob {
  transform: translateX(20px);
}
.toggle-inline {
  height: 42px;
  display: flex;
  align-items: center;
}

.label-grid {
  gap: 6px;
  flex-wrap: nowrap;
  overflow-x: auto;
}
.row2{
  display:grid;
  grid-template-columns: 120px 100px 1fr;
  gap: .8rem;
}

.row4 {
  display:grid;
  grid-template-columns: repeat(4, 1fr);
  gap: .8rem;
}
</style>
