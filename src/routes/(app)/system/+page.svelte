<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { collection, deleteField, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
  import { db } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import { itemEditHref } from '$lib/utils/appNavigation';
  import { createBackgroundRemovalPreview, BACKGROUND_REMOVAL_VERSION } from '$lib/utils/backgroundRemoval';
  import { compressCanvasForFirestore } from '$lib/utils/imageCompression';
  import type { ImageStorageFormat } from '$lib/utils/imageCompression';
  import {
    FIRESTORE_FREE_DAILY_READS,
    FIRESTORE_FREE_DAILY_WRITES,
    FIRESTORE_FREE_MONTHLY_EGRESS_BYTES,
    FIRESTORE_FREE_STORAGE_BYTES,
    analyzeWardrobeStorage,
    formatBytes,
    readBrowserPerformance
  } from '$lib/utils/systemHealth';
  import type {
    BrowserPerformanceHealth,
    StoredImageFormat,
    WardrobeStorageHealth
  } from '$lib/utils/systemHealth';

  type WardrobeRecord = { id: string; data: Record<string, unknown> };
  type BackgroundStatus = 'processing' | 'ready' | 'skipped' | 'error' | 'saving' | 'saved' | 'restored';
  type BackgroundCandidate = {
    id: string;
    name: string;
    source: string;
    originalImageBase64: string;
    originalImageUrl: string;
    resultDataUrl: string;
    resultBytes: number;
    storageFormat: ImageStorageFormat | null;
    confidence: number;
    borderUniformity: number;
    removedRatio: number;
    safe: boolean;
    reason: string;
    status: BackgroundStatus;
    saveError: string;
  };

  type ImageBackup = {
    id: string;
    itemId: string;
    name: string;
    originalImageBase64: string;
    originalImageUrl: string;
    createdAtMillis: number;
  };

  let loading = true;
  let refreshing = false;
  let error = '';
  let activeUserId = '';
  let scannedUserId = '';
  let scanReads = 0;
  let scanDurationMs = 0;
  let lastScanned = '';
  let health: WardrobeStorageHealth | null = null;
  let browserHealth: BrowserPerformanceHealth = readBrowserPerformance();
  let wardrobeRecords: WardrobeRecord[] = [];
  let backgroundCandidates: BackgroundCandidate[] = [];
  let imageBackups: ImageBackup[] = [];
  let backgroundBusy = false;
  let backgroundSaving = false;
  let backgroundProgress = 0;
  let backgroundMessage = '';

  const formatLabels: Record<StoredImageFormat, string> = {
    webp: 'WebP',
    png: 'PNG fallback',
    jpeg: 'JPEG',
    other: 'Other embedded',
    'url-only': 'External URL',
    none: 'No image'
  };

  function performanceLabel(score: number) {
    if (score >= 90) return 'Healthy';
    if (score >= 70) return 'Watch';
    return 'Needs attention';
  }

  function storagePercentLabel(value: number) {
    if (value === 0) return '0%';
    if (value < 0.01) return '<0.01%';
    return `${value.toFixed(2)}%`;
  }

  function candidateStatusLabel(candidate: BackgroundCandidate) {
    if (candidate.status === 'processing') return 'Processing';
    if (candidate.status === 'saving') return 'Saving';
    if (candidate.status === 'saved') return 'Saved';
    if (candidate.status === 'restored') return 'Restored';
    if (candidate.status === 'error') return 'Blocked';
    if (candidate.status === 'skipped') return 'Skipped safely';
    return candidate.safe ? 'Safe result' : 'Review needed';
  }

  function backupFor(itemId: string) {
    return imageBackups.find((backup) => backup.itemId === itemId) ?? null;
  }

  function formatPercent(count: number) {
    if (!health?.documentCount) return 0;
    return (count / health.documentCount) * 100;
  }

  async function scanSystem(force = false) {
    if (!activeUserId || (scannedUserId === activeUserId && !force)) return;

    refreshing = force;
    loading = !health;
    error = '';
    const started = performance.now();

    try {
      const snapshot = await getDocs(collection(db, 'users', activeUserId, 'items'));
      const records = snapshot.docs.map((item) => ({
        id: item.id,
        data: item.data() as Record<string, unknown>
      }));

      wardrobeRecords = records;
      health = analyzeWardrobeStorage(records);
      try {
        await loadImageBackups();
      } catch (backupReadError) {
        console.warn('Could not read protected image backups during the system scan:', backupReadError);
        imageBackups = [];
      }
      scanReads = snapshot.size;
      scanDurationMs = performance.now() - started;
      lastScanned = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      scannedUserId = activeUserId;
      browserHealth = readBrowserPerformance();
    } catch (scanError) {
      console.error('Could not load System health:', scanError);
      error = 'System health could not read your wardrobe. No data was changed.';
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function updateCandidate(id: string, patch: Partial<BackgroundCandidate>) {
    backgroundCandidates = backgroundCandidates.map((candidate) =>
      candidate.id === id ? { ...candidate, ...patch } : candidate
    );
  }

  function updateLocalItem(id: string, patch: Record<string, unknown>) {
    wardrobeRecords = wardrobeRecords.map((record) =>
      record.id === id ? { ...record, data: { ...record.data, ...patch } } : record
    );
    health = analyzeWardrobeStorage(wardrobeRecords);
  }

  async function loadImageBackups() {
    const snapshot = await getDocs(collection(db, 'users', activeUserId, 'imageBackups'));
    imageBackups = snapshot.docs.map((backup) => {
      const data = backup.data();
      return {
        id: backup.id,
        itemId: String(data.itemId ?? backup.id),
        name: String(data.name ?? 'Unnamed item'),
        originalImageBase64: String(data.originalImageBase64 ?? ''),
        originalImageUrl: String(data.originalImageUrl ?? ''),
        createdAtMillis: typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : 0
      };
    }).sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  }

  async function immutableBackupId(itemId: string, source: string) {
    if (!globalThis.crypto?.subtle) throw new Error('Secure backup fingerprinting is unavailable in this browser. No data was changed.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const fingerprint = [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${itemId}--${fingerprint}`;
  }

  async function prepareBackgroundRemoval() {
    if (!activeUserId || backgroundBusy || backgroundSaving) return;
    backgroundBusy = true;
    backgroundProgress = 0;
    backgroundMessage = 'Checking immutable backup access…';
    backgroundCandidates = [];
    try {
      await loadImageBackups();
      const recordsWithImages = wardrobeRecords.filter((record) => {
        const embedded = String(record.data.imageBase64 ?? '').trim();
        const linked = String(record.data.imageUrl ?? '').trim();
        return Boolean(embedded || linked);
      });
      if (!recordsWithImages.length) {
        backgroundMessage = 'No wardrobe images are available to process.';
        return;
      }

      for (let index = 0; index < recordsWithImages.length; index += 1) {
        const record = recordsWithImages[index];
        const originalImageBase64 = String(record.data.imageBase64 ?? '').trim();
        const originalImageUrl = String(record.data.imageUrl ?? '').trim();
        const source = originalImageBase64 || originalImageUrl;
        const name = String(record.data.product ?? record.data.name ?? 'Unnamed item');
        const candidate: BackgroundCandidate = {
          id: record.id,
          name,
          source,
          originalImageBase64,
          originalImageUrl,
          resultDataUrl: '',
          resultBytes: 0,
          storageFormat: null,
          confidence: 0,
          borderUniformity: 0,
          removedRatio: 0,
          safe: false,
          reason: 'Processing locally…',
          status: 'processing',
          saveError: ''
        };
        backgroundCandidates = [...backgroundCandidates, candidate];
        backgroundProgress = index + 1;
        backgroundMessage = `Analyzing ${index + 1} of ${recordsWithImages.length} locally…`;
        try {
          const preview = await createBackgroundRemovalPreview(source);
          if (preview.removedRatio <= 0) {
            updateCandidate(record.id, {
              confidence: preview.confidence,
              borderUniformity: preview.borderUniformity,
              removedRatio: preview.removedRatio,
              safe: false,
              reason: preview.reason,
              status: 'skipped'
            });
          } else {
            const compressed = await compressCanvasForFirestore(preview.canvas, preview.sourceByteLength);
            updateCandidate(record.id, {
              resultDataUrl: compressed.dataUrl,
              resultBytes: compressed.byteLength,
              storageFormat: compressed.storageFormat,
              confidence: preview.confidence,
              borderUniformity: preview.borderUniformity,
              removedRatio: preview.removedRatio,
              safe: preview.safe,
              reason: preview.reason,
              status: 'ready'
            });
          }
        } catch (candidateError) {
          updateCandidate(record.id, {
            reason: candidateError instanceof Error ? candidateError.message : 'This image could not be processed.',
            status: 'error'
          });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const safeCount = backgroundCandidates.filter((candidate) => candidate.status === 'ready' && candidate.safe).length;
      const reviewCount = backgroundCandidates.filter((candidate) => candidate.status === 'ready' && !candidate.safe).length;
      backgroundMessage = `${safeCount} safe result${safeCount === 1 ? '' : 's'} ready · ${reviewCount} need${reviewCount === 1 ? 's' : ''} individual review. Nothing has been saved yet.`;
    } catch (backgroundError) {
      console.error('Could not prepare background removal:', backgroundError);
      backgroundMessage = 'Safe backups are unavailable. No images were processed or changed. Deploy the updated Firestore rules, then try again.';
    } finally {
      backgroundBusy = false;
    }
  }

  async function persistCandidate(candidate: BackgroundCandidate): Promise<boolean> {
    if (!activeUserId || !candidate.resultDataUrl || candidate.status !== 'ready') return false;
    updateCandidate(candidate.id, { status: 'saving', saveError: '' });
    try {
      const itemReference = doc(db, 'users', activeUserId, 'items', candidate.id);
      const backupId = await immutableBackupId(candidate.id, candidate.originalImageBase64 || candidate.originalImageUrl);
      const backupReference = doc(db, 'users', activeUserId, 'imageBackups', backupId);
      await runTransaction(db, async (transaction) => {
        const itemSnapshot = await transaction.get(itemReference);
        const backupSnapshot = await transaction.get(backupReference);
        if (!itemSnapshot.exists()) throw new Error('The wardrobe item no longer exists.');
        const current = itemSnapshot.data();
        const currentBase64 = String(current.imageBase64 ?? '').trim();
        const currentUrl = String(current.imageUrl ?? '').trim();
        if (currentBase64 !== candidate.originalImageBase64 || currentUrl !== candidate.originalImageUrl) {
          throw new Error('The image changed after analysis. Analyze it again before saving.');
        }
        if (!backupSnapshot.exists()) {
          transaction.set(backupReference, {
            itemId: candidate.id,
            name: candidate.name,
            originalImageBase64: candidate.originalImageBase64,
            originalImageUrl: candidate.originalImageUrl,
            createdAt: serverTimestamp(),
            removalVersion: BACKGROUND_REMOVAL_VERSION
          });
        }
        transaction.update(itemReference, {
          imageBase64: candidate.resultDataUrl,
          imageBackgroundRemovedAt: serverTimestamp(),
          imageBackgroundRemovalVersion: BACKGROUND_REMOVAL_VERSION
        });
      });
      if (!imageBackups.some((backup) => backup.id === backupId)) {
        imageBackups = [{
          id: backupId,
          itemId: candidate.id,
          name: candidate.name,
          originalImageBase64: candidate.originalImageBase64,
          originalImageUrl: candidate.originalImageUrl,
          createdAtMillis: Date.now()
        }, ...imageBackups];
      }
      updateLocalItem(candidate.id, {
        imageBase64: candidate.resultDataUrl,
        imageBackgroundRemovalVersion: BACKGROUND_REMOVAL_VERSION
      });
      updateCandidate(candidate.id, { status: 'saved' });
      return true;
    } catch (saveError) {
      console.error('Could not save transparent image:', saveError);
      updateCandidate(candidate.id, {
        status: 'ready',
        saveError: saveError instanceof Error ? saveError.message : 'The result could not be saved. No data was changed.'
      });
      return false;
    }
  }

  async function saveOneCandidate(candidate: BackgroundCandidate) {
    if (backgroundSaving || backgroundBusy) return;
    backgroundSaving = true;
    const saved = await persistCandidate(candidate);
    backgroundMessage = saved
      ? `${candidate.name} was saved with an immutable original backup.`
      : `${candidate.name} was not changed.`;
    backgroundSaving = false;
  }

  async function saveAllSafeCandidates() {
    if (backgroundSaving || backgroundBusy) return;
    const candidates = backgroundCandidates.filter((candidate) => candidate.status === 'ready' && candidate.safe);
    if (!candidates.length) return;
    if (!confirm(`Save ${candidates.length} high-confidence transparent result${candidates.length === 1 ? '' : 's'}? An immutable original backup will be created before each replacement.`)) return;
    backgroundSaving = true;
    let saved = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      backgroundMessage = `Saving ${index + 1} of ${candidates.length} with backups…`;
      if (await persistCandidate(candidates[index])) saved += 1;
    }
    backgroundMessage = `${saved} image${saved === 1 ? '' : 's'} saved safely. ${candidates.length - saved} remained unchanged.`;
    backgroundSaving = false;
  }

  async function restoreBackup(backup: ImageBackup): Promise<boolean> {
    if (!activeUserId) return false;
    try {
      const itemReference = doc(db, 'users', activeUserId, 'items', backup.itemId);
      const backupReference = doc(db, 'users', activeUserId, 'imageBackups', backup.id);
      let restoredBase64 = '';
      let restoredUrl = '';
      await runTransaction(db, async (transaction) => {
        const backupSnapshot = await transaction.get(backupReference);
        const itemSnapshot = await transaction.get(itemReference);
        if (!backupSnapshot.exists()) throw new Error('The immutable original backup is missing.');
        if (!itemSnapshot.exists()) throw new Error('The wardrobe item no longer exists.');
        const original = backupSnapshot.data();
        restoredBase64 = String(original.originalImageBase64 ?? '');
        restoredUrl = String(original.originalImageUrl ?? '');
        transaction.update(itemReference, {
          imageBase64: restoredBase64 || deleteField(),
          imageUrl: restoredUrl,
          imageBackgroundRemovedAt: deleteField(),
          imageBackgroundRemovalVersion: deleteField(),
          imageBackgroundRestoredAt: serverTimestamp()
        });
      });
      updateLocalItem(backup.itemId, {
        imageBase64: restoredBase64,
        imageUrl: restoredUrl,
        imageBackgroundRemovedAt: undefined,
        imageBackgroundRemovalVersion: undefined
      });
      updateCandidate(backup.itemId, { status: 'restored', source: restoredBase64 || restoredUrl });
      return true;
    } catch (restoreError) {
      console.error('Could not restore original image:', restoreError);
      return false;
    }
  }

  async function restoreOriginal(backup: ImageBackup) {
    if (!activeUserId || backgroundSaving || backgroundBusy) return;
    if (!confirm(`Restore the original image for ${backup.name}? The immutable backup will remain available.`)) return;
    backgroundSaving = true;
    backgroundMessage = `Restoring ${backup.name}…`;
    const restored = await restoreBackup(backup);
    backgroundMessage = restored
      ? `${backup.name} was restored. The generated cut-out is no longer stored on the wardrobe item.`
      : `${backup.name} could not be restored. No data was changed.`;
    backgroundSaving = false;
  }

  async function restoreAllOriginals() {
    if (!activeUserId || backgroundSaving || backgroundBusy || !restorableBackups.length) return;
    const targets = [...restorableBackups];
    if (!confirm(`Restore the original images for ${targets.length} background-processed item${targets.length === 1 ? '' : 's'}? The generated cut-outs will be replaced. Protected originals will remain available.`)) return;
    backgroundSaving = true;
    let restored = 0;
    for (let index = 0; index < targets.length; index += 1) {
      backgroundMessage = `Restoring original ${index + 1} of ${targets.length}…`;
      if (await restoreBackup(targets[index])) restored += 1;
    }
    backgroundMessage = `${restored} original image${restored === 1 ? '' : 's'} restored. ${targets.length - restored} item${targets.length - restored === 1 ? '' : 's'} remained unchanged. Generated cut-outs are no longer stored on restored items.`;
    backgroundSaving = false;
  }

  onMount(() => {
    browserHealth = readBrowserPerformance();
    const unsubscribe = user.subscribe((currentUser) => {
      activeUserId = currentUser?.uid ?? '';
      if (activeUserId) void scanSystem();
    });
    return unsubscribe;
  });

  $: webpMessage = health?.embeddedImageCount
    ? `${health.webpCount} of ${health.embeddedImageCount} embedded images are WebP.`
    : 'No embedded wardrobe images found.';

  $: systemNotes = health
    ? [
        health.nonWebpImages.length
          ? `${health.nonWebpImages.length} embedded image${health.nonWebpImages.length === 1 ? '' : 's'} still use a non-WebP format.`
          : 'Every embedded wardrobe image is stored as WebP.',
        browserHealth.slowResourceCount
          ? `${browserHealth.slowResourceCount} browser resource${browserHealth.slowResourceCount === 1 ? '' : 's'} took longer than one second.`
          : 'No slow browser resources were observed in this session.',
        `This read-only scan used ${scanReads} document read${scanReads === 1 ? '' : 's'}.`
      ]
    : [];

  $: safeBackgroundCount = backgroundCandidates.filter((candidate) => candidate.status === 'ready' && candidate.safe).length;
  $: reviewBackgroundCount = backgroundCandidates.filter((candidate) => candidate.status === 'ready' && !candidate.safe).length;
  $: skippedBackgroundCount = backgroundCandidates.filter((candidate) => candidate.status === 'skipped').length;
  $: blockedBackgroundCount = backgroundCandidates.filter((candidate) => candidate.status === 'error').length;
  $: restorableBackups = (() => {
    const seen = new Set<string>();
    return imageBackups.filter((backup) => {
      if (seen.has(backup.itemId)) return false;
      seen.add(backup.itemId);
      const item = wardrobeRecords.find((record) => record.id === backup.itemId);
      return Number(item?.data.imageBackgroundRemovalVersion ?? 0) === BACKGROUND_REMOVAL_VERSION;
    });
  })();
</script>

<svelte:head>
  <title>System · Trackr</title>
</svelte:head>

<main class="system-page">
  <section class="hero">
    <div>
      <p class="eyebrow">TRACKR SYSTEM</p>
      <h1>Storage, formats and speed.</h1>
      <p class="intro">Monitor your wardrobe data, improve image efficiency and create protected transparent cut-outs.</p>
    </div>
    <div class="hero-actions">
      {#if lastScanned}<span>Checked {lastScanned}</span>{/if}
      <button type="button" on:click={() => scanSystem(true)} disabled={refreshing || !activeUserId}>
        {refreshing ? 'Checking…' : 'Refresh check'}
      </button>
    </div>
  </section>

  {#if loading}
    <section class="state-card">Checking wardrobe storage and browser performance…</section>
  {:else if error}
    <section class="state-card error" role="alert">{error}</section>
  {:else if health}
    <section class="metric-grid" aria-label="System summary">
      <article class="metric-card">
        <span>Wardrobe payload</span>
        <strong>{formatBytes(health.estimatedDocumentBytes)}</strong>
        <small>{storagePercentLabel(health.estimatedFreeStoragePercent)} of the 1 GB free storage allowance</small>
      </article>
      <article class="metric-card accent">
        <span>WebP coverage</span>
        <strong>{Math.round(health.webpCoverage)}%</strong>
        <small>{webpMessage}</small>
      </article>
      <article class="metric-card">
        <span>System check</span>
        <strong>{Math.round(scanDurationMs)} ms</strong>
        <small>{scanReads} reads used for this scan</small>
      </article>
      <article class="metric-card">
        <span>Browser performance</span>
        <strong>{browserHealth.score}/100</strong>
        <small>{performanceLabel(browserHealth.score)} in this session</small>
      </article>
    </section>

    <section class="two-column">
      <article class="panel storage-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">ESTIMATED STORAGE</p>
            <h2>Free allowance</h2>
          </div>
          <strong>{formatBytes(health.estimatedDocumentBytes)} / {formatBytes(FIRESTORE_FREE_STORAGE_BYTES)}</strong>
        </div>
        <div class="storage-track" aria-label="Estimated free storage used">
          <span style={`width:${Math.max(0.25, Math.min(100, health.estimatedFreeStoragePercent))}%`}></span>
        </div>
        <div class="storage-breakdown">
          <div><span>Embedded images</span><strong>{formatBytes(health.imageBytes)}</strong></div>
          <div><span>Wardrobe documents</span><strong>{health.documentCount}</strong></div>
          <div><span>Remaining estimate</span><strong>{formatBytes(Math.max(0, FIRESTORE_FREE_STORAGE_BYTES - health.estimatedDocumentBytes))}</strong></div>
        </div>
        <p class="disclaimer">This estimates wardrobe document payloads only. Firebase metadata, indexes and other collections are included only in the official console total.</p>
      </article>

      <article class="panel format-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">IMAGE FORMATS</p>
            <h2>What is actually stored</h2>
          </div>
          <strong>{health.embeddedImageCount} embedded</strong>
        </div>
        <div class="format-list">
          {#each Object.entries(health.formats) as [format, count]}
            <div class="format-row">
              <div class="format-copy">
                <span>{formatLabels[format as StoredImageFormat]}</span>
                <strong>{count}</strong>
              </div>
              <div class="mini-track"><span style={`width:${formatPercent(count)}%`}></span></div>
            </div>
          {/each}
        </div>
      </article>
    </section>

    <section class="two-column">
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">TRAFFIC</p>
            <h2>Free-tier guardrails</h2>
          </div>
          <a href="https://console.firebase.google.com/project/trackr-9165f/firestore/usage" target="_blank" rel="noreferrer">Official usage ↗</a>
        </div>
        <div class="quota-grid">
          <div><strong>{FIRESTORE_FREE_DAILY_READS.toLocaleString()}</strong><span>reads / day</span></div>
          <div><strong>{FIRESTORE_FREE_DAILY_WRITES.toLocaleString()}</strong><span>writes / day</span></div>
          <div><strong>{formatBytes(FIRESTORE_FREE_MONTHLY_EGRESS_BYTES)}</strong><span>outbound / month</span></div>
          <div><strong>{browserHealth.firestoreRequestCount}</strong><span>observed Firebase requests</span></div>
        </div>
        <p class="disclaimer">Trackr cannot securely access your project-wide IAM metrics from the browser. The official Firebase dashboard is authoritative; browser-observed transfer bytes may be unavailable in Safari.</p>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">PERFORMANCE</p>
            <h2>This browser session</h2>
          </div>
          <span class:good={browserHealth.score >= 90} class="health-pill">{performanceLabel(browserHealth.score)}</span>
        </div>
        <div class="performance-list">
          <div><span>Initial page load</span><strong>{browserHealth.navigationMs === null ? 'Unavailable' : `${Math.round(browserHealth.navigationMs)} ms`}</strong></div>
          <div><span>Resources loaded</span><strong>{browserHealth.resourceCount}</strong></div>
          <div><span>Observed transfer</span><strong>{formatBytes(browserHealth.transferredBytes)}</strong></div>
          <div><span>Slow resources</span><strong>{browserHealth.slowResourceCount}</strong></div>
          <div><span>Long main-thread tasks</span><strong>{browserHealth.longTaskCount}</strong></div>
        </div>
      </article>
    </section>

    <section class="panel notes-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">SYSTEM NOTES</p>
          <h2>What needs attention</h2>
        </div>
      </div>
      <div class="note-grid">
        {#each systemNotes as note}<p>{note}</p>{/each}
      </div>
    </section>

    <section class="panel background-tool">
      <div class="background-tool-head">
        <div>
          <p class="eyebrow">TRANSPARENT IMAGE LAB</p>
          <h2>Remove uniform backgrounds safely</h2>
          <p>Analysis and cut-out creation happen in this browser. Nothing is saved until you approve a result, and the first save atomically protects the original in an immutable owner-only backup.</p>
        </div>
        <div class="background-actions">
          <button type="button" class="secondary-action" on:click={prepareBackgroundRemoval} disabled={backgroundBusy || backgroundSaving || !wardrobeRecords.length}>
            {backgroundBusy ? `Analyzing ${backgroundProgress}…` : backgroundCandidates.length ? 'Analyze again' : 'Analyze images'}
          </button>
          <button type="button" class="primary-action" on:click={saveAllSafeCandidates} disabled={backgroundBusy || backgroundSaving || safeBackgroundCount === 0}>
            {backgroundSaving ? 'Saving safely…' : `Save all safe (${safeBackgroundCount})`}
          </button>
          <button type="button" class="danger-action" on:click={restoreAllOriginals} disabled={backgroundBusy || backgroundSaving || restorableBackups.length === 0}>
            {backgroundSaving ? 'Working…' : `Restore all originals (${restorableBackups.length})`}
          </button>
        </div>
      </div>

      <div class="safety-strip">
        <span><b>Local processing</b>No external AI service</span>
        <span><b>Atomic protection</b>Backup and replacement succeed together</span>
        <span><b>Conservative</b>Uncertain images are never bulk-saved</span>
      </div>

      {#if backgroundMessage}
        <p class="background-message" role="status" aria-live="polite">{backgroundMessage}</p>
      {/if}

      {#if backgroundCandidates.length}
        <div class="background-summary" aria-label="Background analysis summary">
          <span class="safe"><strong>{safeBackgroundCount}</strong> safe</span>
          <span><strong>{reviewBackgroundCount}</strong> review</span>
          <span><strong>{skippedBackgroundCount}</strong> preserved</span>
          <span class="blocked"><strong>{blockedBackgroundCount}</strong> blocked</span>
        </div>

        <div class="candidate-grid">
          {#each backgroundCandidates.slice(0, 60) as candidate (candidate.id)}
            {@const backup = backupFor(candidate.id)}
            <article class="candidate-card" class:safe-result={candidate.safe && candidate.status === 'ready'} class:blocked-result={candidate.status === 'error'}>
              <header>
                <div><strong>{candidate.name}</strong><span>{candidate.reason}</span></div>
                <b class="candidate-status {candidate.status}">{candidateStatusLabel(candidate)}</b>
              </header>

              {#if candidate.resultDataUrl}
                <div class="comparison">
                  <figure><div class="checker"><img src={candidate.source} alt={`Original ${candidate.name}`} /></div><figcaption>Before</figcaption></figure>
                  <span aria-hidden="true">→</span>
                  <figure><div class="checker"><img src={candidate.resultDataUrl} alt={`Transparent preview of ${candidate.name}`} /></div><figcaption>After</figcaption></figure>
                </div>
                <div class="candidate-metrics">
                  <span>{Math.round(candidate.confidence * 100)}% confidence</span>
                  <span>{Math.round(candidate.removedRatio * 100)}% removed</span>
                  <span>{candidate.storageFormat === 'webp' ? 'WebP' : 'PNG fallback'} · {formatBytes(candidate.resultBytes)}</span>
                </div>
              {:else if candidate.status !== 'processing'}
                <div class="single-preview checker"><img src={candidate.source} alt={candidate.name} /></div>
              {/if}

              {#if candidate.saveError}<p class="candidate-error" role="alert">{candidate.saveError}</p>{/if}
              <footer>
                {#if candidate.status === 'ready'}
                  <button type="button" class="save-result" on:click={() => saveOneCandidate(candidate)} disabled={backgroundBusy || backgroundSaving}>
                    {candidate.safe ? 'Save result' : 'I reviewed it — save'}
                  </button>
                {/if}
                {#if backup}
                  <button type="button" class="restore-result" on:click={() => restoreOriginal(backup)} disabled={backgroundBusy || backgroundSaving}>Restore original</button>
                {/if}
                <button type="button" class="open-result" on:click={() => goto(itemEditHref(candidate.id, '/system'))}>Open item</button>
              </footer>
            </article>
          {/each}
        </div>
        {#if backgroundCandidates.length > 60}
          <p class="disclaimer">Showing the first 60 previews to keep Safari responsive. “Save all safe” still includes every high-confidence result.</p>
        {/if}
      {:else if !backgroundBusy}
        <div class="background-empty"><strong>No analysis has run yet.</strong><span>Use “Analyze images” to create previews. The scan itself does not write to Firestore.</span></div>
      {/if}

      {#if imageBackups.length}
        <details class="backup-vault">
          <summary>Protected originals <span>{imageBackups.length}</span></summary>
          <div class="backup-list">
            {#each imageBackups as backup (backup.id)}
              <div><span>{backup.name}</span><button type="button" on:click={() => restoreOriginal(backup)} disabled={backgroundBusy || backgroundSaving}>Restore original</button></div>
            {/each}
          </div>
        </details>
      {/if}
    </section>

    <section class="two-column lists">
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">WEBP FOLLOW-UP</p>
            <h2>Images to revisit</h2>
          </div>
          <strong>{health.nonWebpImages.length}</strong>
        </div>
        {#if health.nonWebpImages.length}
          <div class="item-list">
            {#each health.nonWebpImages.slice(0, 12) as item}
              <div class="item-row">
                <div><strong>{item.name}</strong><span>{formatLabels[item.format]} · {formatBytes(item.imageBytes)}</span></div>
                <button type="button" on:click={() => goto(itemEditHref(item.id, '/system'))}>Open item</button>
              </div>
            {/each}
          </div>
          <p class="disclaimer">Re-upload the original transparent PNG from the item editor. Trackr will use the Safari-compatible WebP encoder and confirm the saved format.</p>
        {:else}
          <p class="empty-copy">Everything embedded is already WebP.</p>
        {/if}
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">LARGEST IMAGES</p>
            <h2>Biggest payloads</h2>
          </div>
        </div>
        {#if health.largestImages.length}
          <div class="item-list">
            {#each health.largestImages as item}
              <div class="item-row static">
                <div><strong>{item.name}</strong><span>{formatLabels[item.format]}</span></div>
                <b>{formatBytes(item.imageBytes)}</b>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-copy">No embedded images to measure.</p>
        {/if}
      </article>
    </section>

    <section class="account-row">
      <div><strong>Profile and account</strong><span>Manage your name, avatar and personal details.</span></div>
      <button type="button" on:click={() => goto('/profile')}>Open profile</button>
    </section>
  {/if}
</main>

<style>
  .system-page{display:grid;gap:1rem;color:#111;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;padding-bottom:2rem}
  .hero{min-height:210px;border:1px solid #e8e8e8;border-radius:28px;padding:2rem;display:flex;justify-content:space-between;align-items:flex-end;background:radial-gradient(circle at 15% 10%,rgba(112,91,255,.15),transparent 34%),radial-gradient(circle at 88% 22%,rgba(255,190,130,.2),transparent 30%),#fff;box-shadow:0 18px 50px rgba(20,20,20,.06)}
  .eyebrow{margin:0 0 .5rem;color:#777;font-size:.72rem;letter-spacing:.14em;font-weight:800}
  h1{margin:0;max-width:690px;font-size:clamp(2.5rem,6vw,5.5rem);line-height:.92;letter-spacing:-.065em}
  .intro{max-width:620px;margin:1rem 0 0;color:#666;font-size:1rem;line-height:1.5}
  .hero-actions{display:flex;align-items:center;gap:.7rem;color:#777;font-size:.78rem;white-space:nowrap}
  button,a{font:inherit}.hero-actions button,.item-row button,.account-row button{border:1px solid #ddd;background:#111;color:#fff;border-radius:999px;padding:.65rem .95rem;cursor:pointer;font-size:.78rem;font-weight:700}.hero-actions button:disabled{opacity:.45;cursor:default}
  .state-card,.panel,.metric-card,.account-row{background:#fff;border:1px solid #e8e8e8;border-radius:22px}.state-card{padding:3rem;text-align:center;color:#666}.state-card.error{color:#a33}
  .metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}.metric-card{padding:1.25rem;min-height:125px;display:flex;flex-direction:column}.metric-card>span{color:#777;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;font-weight:800}.metric-card strong{margin:.55rem 0 .35rem;font-size:2.15rem;letter-spacing:-.05em}.metric-card small{margin-top:auto;color:#777;line-height:1.35}.metric-card.accent{background:#111;color:#fff}.metric-card.accent>span,.metric-card.accent small{color:#bbb}
  .two-column{display:grid;grid-template-columns:1.2fr .8fr;gap:1rem}.panel{padding:1.4rem;min-width:0}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1.2rem}.panel-head h2{margin:0;font-size:1.35rem;letter-spacing:-.025em}.panel-head>strong{font-size:.82rem;color:#555}.panel-head a{font-size:.78rem;color:#111;font-weight:700;text-decoration:none;border-bottom:1px solid #bbb}
  .storage-track,.mini-track{height:8px;background:#eee;border-radius:999px;overflow:hidden}.storage-track span,.mini-track span{display:block;height:100%;min-width:2px;background:linear-gradient(90deg,#181818,#7456ff);border-radius:inherit}.storage-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-top:1rem}.storage-breakdown div,.quota-grid div{padding:.8rem;background:#f7f7f5;border-radius:14px;display:grid;gap:.25rem}.storage-breakdown span,.quota-grid span{color:#777;font-size:.7rem}.storage-breakdown strong{font-size:.88rem}.disclaimer{margin:1rem 0 0;color:#888;font-size:.72rem;line-height:1.5}
  .format-list{display:grid;gap:.75rem}.format-copy{display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.28rem}.format-copy span{color:#666}.mini-track{height:5px}
  .quota-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem}.quota-grid strong{font-size:1.12rem}.health-pill{padding:.35rem .6rem;border-radius:999px;background:#fff4de;color:#8a5a00;font-size:.7rem;font-weight:800}.health-pill.good{background:#eaf6ed;color:#2f6540}.performance-list{display:grid;gap:.1rem}.performance-list div{display:flex;justify-content:space-between;padding:.72rem 0;border-bottom:1px solid #eee;font-size:.8rem}.performance-list div:last-child{border-bottom:0}.performance-list span{color:#777}
  .notes-panel{background:#f3f1ff}.note-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}.note-grid p{margin:0;padding:.9rem;background:rgba(255,255,255,.7);border-radius:14px;color:#565266;font-size:.78rem;line-height:1.45}
  .background-tool{padding:1.6rem;background:linear-gradient(145deg,#f8f7ff,#fff 45%,#f3faf6);overflow:hidden}.background-tool-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem}.background-tool-head h2{margin:0;font-size:clamp(1.7rem,3vw,2.6rem);letter-spacing:-.045em}.background-tool-head>div:first-child>p:last-child{max-width:760px;margin:.7rem 0 0;color:#696873;font-size:.8rem;line-height:1.55}.background-actions{display:flex;gap:.5rem;flex-shrink:0}.background-actions button,.candidate-card footer button,.backup-list button{border:1px solid #d8d8d4;border-radius:999px;padding:.65rem .9rem;background:#fff;color:#111;font:inherit;font-size:.72rem;font-weight:800;cursor:pointer}.background-actions .primary-action,.candidate-card footer .save-result{border-color:#171717;background:#171717;color:#fff}.background-actions button:disabled,.candidate-card footer button:disabled,.backup-list button:disabled{opacity:.42;cursor:default}.safety-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem;margin-top:1.2rem}.safety-strip span{padding:.75rem .85rem;display:grid;gap:.18rem;border-radius:14px;background:rgba(255,255,255,.82);color:#777;font-size:.65rem}.safety-strip b{color:#222;font-size:.72rem}.background-message{margin:.8rem 0 0;padding:.72rem .9rem;border-radius:12px;background:#ece9ff;color:#554a86;font-size:.75rem;font-weight:700}.background-summary{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:1rem}.background-summary span{padding:.4rem .6rem;border-radius:999px;background:#eee;color:#666;font-size:.66rem}.background-summary strong{color:#222}.background-summary .safe{background:#e3f4e9;color:#286348}.background-summary .blocked{background:#fff0ef;color:#9b3d38}
  .background-actions .danger-action{border-color:#e5b2ae;background:#fff4f3;color:#a33b34}
  .candidate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin-top:.75rem}.candidate-card{min-width:0;padding:.8rem;border:1px solid #e7e7e2;border-radius:17px;background:rgba(255,255,255,.9)}.candidate-card.safe-result{border-color:#b9dec8}.candidate-card.blocked-result{background:#fffafa}.candidate-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem}.candidate-card>header>div{display:grid;gap:.18rem;min-width:0}.candidate-card>header strong{font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.candidate-card>header span{color:#888;font-size:.63rem;line-height:1.35}.candidate-status{flex-shrink:0;padding:.27rem .45rem;border-radius:999px;background:#eee;color:#666;font-size:.56rem}.candidate-status.ready{background:#fff1d8;color:#885700}.safe-result .candidate-status{background:#e3f4e9;color:#286348}.candidate-status.saved{background:#171717;color:#fff}.candidate-status.error{background:#ffe7e5;color:#9d322d}.comparison{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:.35rem;margin:.65rem 0}.comparison>span{color:#aaa}.comparison figure{min-width:0;margin:0}.checker{background-color:#fff;background-image:linear-gradient(45deg,#e6e6e3 25%,transparent 25%),linear-gradient(-45deg,#e6e6e3 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e6e6e3 75%),linear-gradient(-45deg,transparent 75%,#e6e6e3 75%);background-size:14px 14px;background-position:0 0,0 7px,7px -7px,-7px 0}.comparison .checker,.single-preview{height:155px;border:1px solid #e2e2de;border-radius:12px;display:grid;place-items:center;overflow:hidden}.checker img{width:100%;height:100%;object-fit:contain}.comparison figcaption{margin-top:.2rem;color:#999;font-size:.55rem;text-align:center;text-transform:uppercase;font-weight:800}.single-preview{margin:.65rem 0}.candidate-metrics{display:flex;flex-wrap:wrap;gap:.25rem}.candidate-metrics span{padding:.28rem .4rem;border-radius:999px;background:#f2f2ef;color:#777;font-size:.56rem}.candidate-error{margin:.55rem 0 0;color:#a03b38;font-size:.65rem}.candidate-card footer{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.65rem}.candidate-card footer button{padding:.45rem .65rem;font-size:.62rem}.candidate-card footer .restore-result{border-color:#c9b9ef;color:#6044a0}.background-empty{min-height:150px;margin-top:1rem;display:grid;place-content:center;gap:.3rem;border:1px dashed #d7d5df;border-radius:16px;text-align:center}.background-empty span{color:#888;font-size:.72rem}.backup-vault{margin-top:1rem;border-top:1px solid #e4e2ea;padding-top:.8rem}.backup-vault summary{display:flex;justify-content:space-between;cursor:pointer;font-size:.75rem;font-weight:800}.backup-vault summary span{padding:.2rem .42rem;border-radius:999px;background:#eae6fb;color:#6044a0}.backup-list{max-height:270px;overflow:auto;margin-top:.5rem}.backup-list div{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.45rem 0;border-bottom:1px solid #eee;font-size:.7rem}.backup-list button{padding:.36rem .55rem;font-size:.6rem}.backup-list span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lists{grid-template-columns:1fr 1fr}.item-list{display:grid}.item-row{display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.72rem 0;border-bottom:1px solid #eee}.item-row:last-child{border-bottom:0}.item-row div{display:grid;gap:.2rem;min-width:0}.item-row div strong{font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item-row div span{font-size:.7rem;color:#888}.item-row button{padding:.42rem .7rem;background:#fff;color:#111;font-size:.7rem}.item-row b{font-size:.76rem}.empty-copy{color:#777;font-size:.82rem}
  .account-row{padding:1rem 1.2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}.account-row div{display:grid;gap:.2rem}.account-row span{color:#777;font-size:.76rem}
  @media(max-width:900px){.metric-grid{grid-template-columns:repeat(2,1fr)}.two-column,.lists{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column;gap:2rem}.note-grid{grid-template-columns:1fr}.background-tool-head{align-items:flex-start;flex-direction:column}.candidate-grid{grid-template-columns:1fr}}
  @media(max-width:560px){.system-page{gap:.75rem}.hero{padding:1.4rem;border-radius:22px;min-height:240px}h1{font-size:3rem}.hero-actions{width:100%;justify-content:space-between}.metric-grid{grid-template-columns:1fr 1fr;gap:.65rem}.metric-card{padding:1rem;min-height:115px}.metric-card strong{font-size:1.7rem}.panel{padding:1.1rem}.storage-breakdown{grid-template-columns:1fr}.quota-grid{grid-template-columns:1fr 1fr}.account-row{align-items:flex-start;flex-direction:column}.background-actions{width:100%;display:grid;grid-template-columns:1fr}.safety-strip{grid-template-columns:1fr}.comparison .checker,.single-preview{height:125px}}
</style>
