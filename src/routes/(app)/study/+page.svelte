<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { user, userReady } from '$lib/stores/user';
  import SurgeryProgressChart from '$lib/components/SurgeryProgressChart.svelte';
  import { SURGERY_BLOCKS, SURGERY_EXAM_DATE, SURGERY_SYLLABUS, type SurgeryTopicDefinition } from '$lib/study/surgerySyllabus';
  import {
    createEmptySurgeryState,
    mergePatch,
    validateBackup,
    validatePatch,
    type Mastery,
    type SessionSnapshot,
    type SurgeryState,
    type TopicProgress,
    type TopicStatus
  } from '$lib/study/surgerySchema';
  import { readBackup, restoreBackup, saveSession, saveSurgeryState, saveStudyPlanProgress, subscribeToRetentionCards, subscribeToSurgerySessions, subscribeToSurgeryState, subscribeToStudyPlan } from '$lib/study/surgeryRepository';
  import { saveRetentionCards } from '$lib/study/surgeryRepository';
  import { createRetentionCard } from '$lib/study/retentionSchema';
  import type { RetentionCard } from '$lib/study/retentionSchema';
  import { recordPatchPlanProgress } from '$lib/study/studyPlanIntegration';
  import type { PlanPass, StudyPlanConfig, StudyPlanProgress } from '$lib/study/studyPlanSchema';
  import { dateKey, forecast, pacing, passCount, phaseForDate } from '$lib/study/studyPlanEngine';

  let state: SurgeryState = createEmptySurgeryState();
  let sessions: SessionSnapshot[] = [];
  let retentionCards: RetentionCard[] = [];
  let planConfig: StudyPlanConfig | null = null;
  let planProgress: StudyPlanProgress | null = null;
  let activePass: PlanPass = 'first';
  let loading = true;
  let saving = false;
  let error = '';
  let notice = '';
  let patchText = '';
  let search = '';
  let blockFilter = 'all';
  let statusFilter = 'all';
  let selected: SurgeryTopicDefinition | null = null;
  let editMastery: Mastery = 0;
  let editConfidence: Mastery = 0;
  let editStatus: TopicStatus = 'unassessed';
  let editNotes = '';
  let newGap = '';
  let ankiDate = localDateString();
  let unsubscribeState: (() => void) | null = null;
  let unsubscribeSessions: (() => void) | null = null;
  let unsubscribeCards: (() => void) | null = null;
  let unsubscribePlan: (() => void) | null = null;
  let subscribedUid = '';
  let importInput: HTMLInputElement;

  $: uid = $user?.uid as string | undefined;
  $: if ($userReady && uid && uid !== subscribedUid) subscribe(uid);
  $: if ($userReady && !uid) loading = false;

  function subscribe(userId: string) {
    unsubscribeState?.(); unsubscribeSessions?.(); unsubscribeCards?.(); unsubscribePlan?.();
    subscribedUid = userId; loading = true; error = '';
    unsubscribeState = subscribeToSurgeryState(userId, (value) => { state = value; loading = false; }, fail);
    unsubscribeSessions = subscribeToSurgerySessions(userId, (value) => sessions = value, fail);
    unsubscribeCards = subscribeToRetentionCards(userId, (value) => retentionCards = value, fail);
    unsubscribePlan = subscribeToStudyPlan(userId, (config, progress) => { planConfig = config; planProgress = progress; }, fail);
  }

  function fail(reason: unknown) {
    error = reason instanceof Error ? reason.message : 'Something went wrong.';
    loading = false; saving = false;
  }

  onDestroy(() => { unsubscribeState?.(); unsubscribeSessions?.(); unsubscribeCards?.(); unsubscribePlan?.(); });

  const activeGaps = (topic: TopicProgress) => topic.gaps.filter((gap) => !gap.resolvedAt);
  const ankiReviews = (topic: TopicProgress) => topic.ankiReviews ?? [];

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  $: topicValues = SURGERY_SYLLABUS.map((definition) => ({ definition, progress: state.topics[definition.id] }));
  $: assessed = topicValues.filter(({ progress }) => progress?.status !== 'unassessed').length;
  $: solid = topicValues.filter(({ progress }) => progress?.status === 'solid').length;
  $: averageMastery = assessed ? topicValues.reduce((sum, { progress }) => sum + (progress?.mastery ?? 0), 0) / assessed : 0;
  $: openGaps = topicValues.reduce((sum, { progress }) => sum + (progress ? activeGaps(progress).length : 0), 0);
  $: daysRemaining = Math.max(0, Math.ceil((new Date(`${SURGERY_EXAM_DATE}T00:00:00`).getTime() - Date.now()) / 86400000));
  $: dueRetentionCount = retentionCards.filter((card) => card.status === 'active' && new Date(card.dueAt).getTime() <= Date.now()).length;
  $: today = dateKey();
  $: currentPhase = planConfig ? phaseForDate(planConfig, today) : undefined;
  $: planPacing = planConfig && planProgress && currentPhase && currentPhase.type !== 'buffer' ? pacing(planConfig, planProgress, currentPhase, today) : null;
  $: activePass = currentPhase?.type === 'second-pass' ? 'second' : 'first';
  $: planCovered = planProgress ? passCount(planProgress, activePass) : 0;
  $: planProjection = planConfig && planProgress && currentPhase && currentPhase.type !== 'buffer' ? forecast(planConfig, planProgress, currentPhase, today) : null;
  $: todaySessions = sessions.filter((session) => session.date.slice(0, 10) === today);
  $: assessedTopicsToday = new Set(todaySessions.flatMap((session) => session.topicIds ?? [])).size;
  $: filtered = topicValues.filter(({ definition, progress }) => {
    const query = search.trim().toLowerCase();
    return (blockFilter === 'all' || definition.block === blockFilter) &&
      (statusFilter === 'all' || progress?.status === statusFilter) &&
      (!query || definition.id.toLowerCase().includes(query) || definition.title.toLowerCase().includes(query) || progress?.notes.toLowerCase().includes(query));
  });
  $: redZones = topicValues.filter(({ progress }) => progress && (progress.status === 'review' || (progress.attempts > 0 && progress.mastery <= 1) || activeGaps(progress).length > 0)).sort((a, b) => (a.progress.mastery - b.progress.mastery) || (activeGaps(b.progress).length - activeGaps(a.progress).length));

  function blockStats(block: string) {
    const values = topicValues.filter(({ definition }) => definition.block === block);
    const blockAssessed = values.filter(({ progress }) => progress.status !== 'unassessed').length;
    const mastery = blockAssessed ? values.reduce((sum, item) => sum + item.progress.mastery, 0) / blockAssessed : 0;
    return { assessed: blockAssessed, total: values.length, mastery };
  }

  function openTopic(definition: SurgeryTopicDefinition) {
    const progress = state.topics[definition.id];
    selected = definition; editMastery = progress.mastery; editConfidence = progress.confidence;
    editStatus = progress.status; editNotes = progress.notes; newGap = ''; ankiDate = localDateString();
  }

  async function toggleTopicPlanPass(topicId: string, pass: PlanPass) {
    if (!uid || !planProgress) return;
    const next = structuredClone(planProgress); const topic = next.topics[topicId] ?? {};
    const key = pass === 'first' ? 'firstPassCompletedAt' : 'secondPassCompletedAt';
    const sourceKey = pass === 'first' ? 'firstPassSource' : 'secondPassSource';
    const previous = topic[key]; const complete = !previous; const changedAt = new Date().toISOString();
    if (pass === 'first' && previous && topic.firstPassSource === 'baseline') { topic.firstPassSource = 'manual-confirmed'; topic.firstPassManual = true; topic.completionHistory = [...(topic.completionHistory ?? []), { pass, complete: true, changedAt, source: 'manual-confirmed', previousCompletedAt: previous }]; next.topics[topicId] = topic; next.updatedAt = changedAt; await saveStudyPlanProgress(uid, next); planProgress = next; return; }
    if (complete) { topic[key] = changedAt; topic[sourceKey] = 'manual'; } else { delete topic[key]; delete topic[sourceKey]; }
    topic.completionHistory = [...(topic.completionHistory ?? []), { pass, complete, changedAt, source: 'manual', ...(previous ? { previousCompletedAt: previous } : {}) }];
    next.topics[topicId] = topic; next.updatedAt = changedAt; await saveStudyPlanProgress(uid, next); planProgress = next;
  }

  async function persist(next: SurgeryState, session?: SessionSnapshot) {
    if (!uid) return;
    saving = true; error = ''; notice = '';
    try {
      await saveSurgeryState(uid, next);
      if (session) await saveSession(uid, session);
      state = next; notice = 'Saved to your account.';
    } catch (reason) { fail(reason); }
    finally { saving = false; }
  }

  async function saveManual() {
    if (!selected) return;
    const now = new Date().toISOString();
    const patch = validatePatch({ schemaVersion: 1, topics: [{ id: selected.id, mastery: editMastery, confidence: editConfidence, status: editStatus, notes: editNotes, lastReviewedAt: now, ...(newGap.trim() ? { addGaps: [{ text: newGap.trim() }] } : {}) }] });
    await persist(mergePatch(state, patch, now)); selected = null;
  }

  async function resolveGap(topicId: string, gapId: string) {
    const patch = validatePatch({ schemaVersion: 1, topics: [{ id: topicId, resolveGapIds: [gapId] }] });
    await persist(mergePatch(state, patch));
  }

  async function logAnkiReview() {
    if (!selected || !/^\d{4}-\d{2}-\d{2}$/.test(ankiDate) || Number.isNaN(new Date(`${ankiDate}T12:00:00`).getTime())) {
      error = 'Choose a valid Anki study date.';
      return;
    }
    const next = structuredClone(state);
    next.topics[selected.id].ankiReviews = [...ankiReviews(next.topics[selected.id]), ankiDate].sort();
    next.updatedAt = new Date().toISOString();
    await persist(next);
    notice = `Anki review #${next.topics[selected.id].ankiReviews.length} logged for ${selected.id}.`;
  }

  async function applyJsonPatch() {
    try {
      const patch = validatePatch(JSON.parse(patchText));
      const previous = state;
      const next = mergePatch(previous, patch);
      let snapshot: SessionSnapshot | undefined;
      if (patch.session) snapshot = {
        id: crypto.randomUUID(), date: new Date(patch.session.date ?? Date.now()).toISOString(), label: patch.session.label?.trim() || 'Study session', questions: patch.session.questions,
        averageMastery: Number((Object.values(next.topics).reduce((sum, topic) => sum + topic.mastery, 0) / Math.max(1, Object.values(next.topics).filter((topic) => topic.status !== 'unassessed').length)).toFixed(2)),
        assessedTopics: Object.values(next.topics).filter((topic) => topic.status !== 'unassessed').length, createdAt: new Date().toISOString(), topicIds: (patch.topics ?? []).map((topic) => topic.id),
        ...(patch.session.mode !== undefined ? { mode: patch.session.mode } : {}),
        ...(patch.session.planPass !== undefined ? { planPass: patch.session.planPass } : {})
      };
      const cards = (patch.topics ?? []).flatMap((topic) => (topic.addCards ?? []).map((card) => createRetentionCard({ ...card, topicId: topic.id, sourceSessionId: snapshot?.id })));
      await persist(next, snapshot); if (uid) await recordPatchPlanProgress(uid, previous, next, patch, snapshot?.id); patchText = '';
      if (cards.length && uid) await saveRetentionCards(uid, cards);
    } catch (reason) { fail(reason); }
  }

  function download(name: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }

  async function exportBackup() {
    if (!uid) return;
    try { download(`trackr-surgery-backup-${new Date().toISOString().slice(0, 10)}.json`, await readBackup(uid, state)); }
    catch (reason) { fail(reason); }
  }

  async function importBackup(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !uid) return;
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      if (!confirm('Replace your Surgery tracker state and session history with this backup?')) return;
      saving = true; await restoreBackup(uid, backup); notice = 'Backup restored.';
    } catch (reason) { fail(reason); }
    finally { saving = false; importInput.value = ''; }
  }

  async function copyContext() {
    const context = {
      schemaVersion: 1, examDate: state.examDate, updatedAt: state.updatedAt,
      scale: 'mastery/confidence 0-4',
      topics: topicValues.filter(({ progress }) => progress.status !== 'unassessed' || progress.notes || progress.gaps.length || ankiReviews(progress).length).map(({ definition, progress }) => ({ id: definition.id, m: progress.mastery, c: progress.confidence, s: progress.status, a: progress.attempts, ok: progress.correct, reviewed: progress.lastReviewedAt, anki: ankiReviews(progress), notes: progress.notes || undefined, gaps: activeGaps(progress).map((gap) => ({ id: gap.id, text: gap.text })) })),
      recentSessions: sessions.slice(-10)
    };
    try { await navigator.clipboard.writeText(JSON.stringify(context)); notice = 'Compact progress copied for ChatGPT.'; }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  async function copyUpdateSchema() {
    const schema = `TRACKR SURGERY UPDATE FORMAT (schemaVersion 1)

Return exactly one valid JSON object and no Markdown, commentary, or code fences.

Allowed topic IDs only:
- TO1-01 through TO1-40
- TO2-01 through TO2-72
- TO3-01 through TO3-39
- TO4-01 through TO4-45

JSON shape:
{
  "schemaVersion": 1,
  "topics": [
    {
      "id": "TO1-01",
      "mastery": 0,
      "confidence": 0,
      "status": "unassessed",
      "attemptsDelta": 0,
      "correctDelta": 0,
      "lastReviewedAt": "2026-08-09T19:30:00.000Z",
      "notes": "Concise cumulative knowledge-map note",
      "addGaps": [{ "text": "Specific unresolved knowledge gap" }],
      "resolveGapIds": ["existing-gap-id"],
      "addCards": [{ "gapId": "existing-gap-id", "front": "One focused retrieval prompt", "back": "Concise expected answer", "clinicalContext": "Optional vignette", "tags": ["oral-follow-up"] }],
      "plan": { "firstPassComplete": true, "firstPassCompletedAt": "2026-08-14T12:56:00.000Z" }
    }
  ],
  "session": {
    "date": "2026-08-09T19:30:00.000Z",
    "label": "Short study-block label",
    "questions": 8,
    "mode": "oral"
  }
}

Rules:
- mastery and confidence are integers 0-4.
- mastery: 0 unassessed, 1 fragile, 2 developing, 3 good, 4 exam-ready.
- status is exactly one of: unassessed, learning, review, solid.
- attemptsDelta and correctDelta are non-negative integers for THIS study block, not lifetime totals.
- correctDelta must not exceed attemptsDelta for the new block.
- lastReviewedAt and session.date must be valid ISO 8601 dates.
- Include only topics assessed or changed in this block.
- Omit unchanged optional fields. Never send null values.
- addGaps adds new unresolved gaps. Use short, specific gap text.
- resolveGapIds may contain only gap IDs present in the supplied Trackr progress context.
- addCards creates focused retention cards linked to the topic and optionally to a gap.
- Avoid duplicate cards and trivial fragments.
- notes should update the cumulative knowledge map without inventing performance.
- session.questions is the number of questions in this study block.
- session.mode is optional: oral, clinical-vignette, rapid-recall, classification, short-recall, multiple-choice, retention, or mixed.
- topic.plan is optional. It may explicitly set firstPassComplete or secondPassComplete to true/false and may include the matching completion timestamp when true.
- No plan field means knowledge-map assessment only. Trackr never infers pass completion from attempts, mastery, session mode, or question count.
- Multiple-choice, retention and Anki activity never mark plan coverage unless a separate explicit plan flag is deliberately supplied.
- Do not invent topic IDs or official topic titles.`;

    try {
      await navigator.clipboard.writeText(schema);
      notice = 'Update schema copied for your study chat.';
    } catch {
      error = 'Clipboard access was unavailable.';
    }
  }

  const masteryLabel = (value: number) => ['Unassessed', 'Fragile', 'Developing', 'Good', 'Exam-ready'][value];
</script>

<svelte:head><title>Surgery State Exam · Trackr</title></svelte:head>

<div class="study-shell">
  <header class="hero">
    <div><p class="eyebrow">SURGERY · STATE EXAM</p><h1>Knowledge map</h1><p class="subtitle">Persistent progress from your oral study sessions.</p></div>
    <div class="hero-actions"><div class="action-stack"><button class="review-link compact" aria-label="Open Surgery study plan" title="Study plan" on:click={() => goto('/study/plan')}><span class="review-icon">◎</span><span class="review-copy"><strong>Study plan</strong><small>{currentPhase?.name ?? 'Set up your plan'}</small></span></button><button class="review-link compact" aria-label={`${dueRetentionCount} retention cards due`} title="Review retention cards" on:click={() => goto('/study/review')}><span class="review-icon">↻</span><span class="review-copy"><strong>Retention</strong><small>{dueRetentionCount ? `${dueRetentionCount} due now` : 'Up to date'}</small></span>{#if dueRetentionCount}<b class="due-badge">{dueRetentionCount > 99 ? '99+' : dueRetentionCount}</b>{/if}</button></div><div class="exam"><strong>{daysRemaining}</strong><span>days to 8 Sep 2026</span></div></div>
  </header>

  {#if error}<div class="message error" role="alert">{error}<button on:click={() => error = ''}>Dismiss</button></div>{/if}
  {#if notice}<div class="message success" role="status">{notice}<button on:click={() => notice = ''}>Dismiss</button></div>{/if}
  {#if loading}<div class="state-card"><span class="spinner"></span>Loading your Surgery tracker…</div>
  {:else if !uid}<div class="state-card">Sign in to load and save your Surgery tracker.</div>
  {:else}
    <section class="metrics">
      <article><span>Assessed</span><strong>{assessed}<small>/196</small></strong></article>
      <article><span>Average mastery</span><strong>{averageMastery.toFixed(1)}<small>/4</small></strong></article>
      <article><span>Exam-ready</span><strong>{solid}</strong></article>
      <article><span>Open gaps</span><strong>{openGaps}</strong></article>
    </section>

    {#if planConfig && planProgress}
      <button class="plan-strip" on:click={() => goto('/study/plan')} aria-label="Open detailed Surgery study plan">
        <div class="plan-status"><span>{currentPhase?.name ?? (today === planConfig.examDate ? 'Exam day' : 'Study plan')}</span><strong class:ahead={planPacing?.status === 'ahead'} class:behind={planPacing?.status === 'behind'}>{planPacing?.status === 'ahead' ? 'Ahead' : planPacing?.status === 'behind' ? 'Behind' : currentPhase?.type === 'buffer' ? 'Buffer mode' : 'On track'}</strong><small>{planPacing?.status === 'ahead' ? `${planPacing.difference} topics ahead` : planPacing?.status === 'behind' ? `${planPacing.difference} topics behind` : currentPhase?.type === 'buffer' ? 'Focus on red zones and exam skills' : `${planPacing?.todayRemaining ?? 0} remaining today`}</small></div>
        <div class="plan-progress"><div><span>{activePass === 'second' ? 'Second pass' : 'First pass'}</span><b>{planCovered}<small>/196</small></b></div><i><b style={`width:${planCovered / 196 * 100}%`}></b></i><small>{Math.round(planCovered / 196 * 100)}% covered</small></div>
        <div class="plan-today"><span>First-pass today</span><strong>{planPacing?.todayActual ?? 0}<small> / {planPacing?.todayQuota ?? 0}</small></strong><small>{assessedTopicsToday} topics assessed</small></div>
        <div class="plan-forecast"><span>Projected finish</span><strong>{planProjection?.date ? new Date(`${planProjection.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</strong><small>{planProjection ? `${planProjection.pace.toFixed(1)}/active day` : 'Not enough data'}</small></div>
        <span class="plan-arrow">›</span>
      </button>
    {:else}
      <button class="plan-strip plan-empty" on:click={() => goto('/study/plan')}><div><span>STUDY PLAN</span><strong>Set up daily pacing</strong><small>Use your existing assessed topics as the starting baseline.</small></div><span class="plan-arrow">›</span></button>
    {/if}

    <section class="blocks">
      {#each SURGERY_BLOCKS as block}
        {@const stats = blockStats(block.id)}
        <button class:active={blockFilter === block.id} on:click={() => blockFilter = blockFilter === block.id ? 'all' : block.id}>
          <span>{block.label}</span><strong>{stats.assessed}/{stats.total}</strong>
          <i><b style={`width:${stats.total ? stats.assessed / stats.total * 100 : 0}%`}></b></i><small>{stats.mastery.toFixed(1)} mastery</small>
        </button>
      {/each}
    </section>

    <div class="main-grid">
      <section class="panel wide">
        <div class="panel-head"><div><p class="eyebrow">KNOWLEDGE MAP</p><h2>196 topics</h2></div><div class="legend"><span><i class="m0"></i>0</span><span><i class="m1"></i>1</span><span><i class="m2"></i>2</span><span><i class="m3"></i>3</span><span><i class="m4"></i>4</span></div></div>
        <div class="heatmap" aria-label="Topic mastery heatmap">
          {#each SURGERY_SYLLABUS as topic}
            <button class={`mastery-${state.topics[topic.id].mastery}`} class:has-gap={activeGaps(state.topics[topic.id]).length > 0} title={`${topic.id}: ${masteryLabel(state.topics[topic.id].mastery)} · ${ankiReviews(state.topics[topic.id]).length} Anki reviews`} on:click={() => openTopic(topic)}>{topic.id.replace('TO', '').replace('-', '·')}{#if ankiReviews(state.topics[topic.id]).length}<span class="anki-badge">{ankiReviews(state.topics[topic.id]).length > 1 ? ankiReviews(state.topics[topic.id]).length : ''}</span>{/if}</button>
          {/each}
        </div>
      </section>

      <section class="panel"><div class="panel-head"><div><p class="eyebrow">TRAJECTORY</p><h2>Progress over time</h2></div></div>{#if sessions.length || planProgress}<SurgeryProgressChart {sessions} {planProgress} />{:else}<div class="empty">A chart appears after your first study-plan completion.</div>{/if}</section>

      <section class="panel"><div class="panel-head"><div><p class="eyebrow danger-text">PRIORITY</p><h2>Red zones</h2></div><span class="count">{redZones.length}</span></div>
        {#if redZones.length}<div class="red-list">{#each redZones.slice(0, 8) as item}<button on:click={() => openTopic(item.definition)}><span>{item.definition.id}<small>{activeGaps(item.progress).length} gaps · mastery {item.progress.mastery}</small></span><b>Review</b></button>{/each}</div>{:else}<div class="empty">No weak areas or open gaps yet.</div>{/if}
      </section>

      <section class="panel wide import-panel"><div class="panel-head"><div><p class="eyebrow">CHATGPT SYNC</p><h2>Apply tracker update</h2><p>Paste a schema v1 JSON patch. Existing fields are changed only when explicitly included.</p></div></div>
        <textarea bind:value={patchText} placeholder={'{"schemaVersion":1,"topics":[{"id":"TO1-01","mastery":2,"confidence":2,"status":"learning","attemptsDelta":1,"correctDelta":1,"addGaps":[{"text":"Review indications"}]}],"session":{"questions":8,"label":"Oral exam block"}}'}></textarea>
        <div class="actions"><button class="primary" disabled={!patchText.trim() || saving} on:click={applyJsonPatch}>{saving ? 'Saving…' : 'Validate & apply patch'}</button><button on:click={copyUpdateSchema}>Copy update schema</button><button on:click={copyContext}>Copy progress for ChatGPT</button><button on:click={exportBackup}>Export full backup</button><button on:click={() => importInput.click()}>Import backup</button><input class="hidden" bind:this={importInput} type="file" accept="application/json,.json" on:change={importBackup} /></div>
      </section>

      <section class="panel wide topics-panel"><div class="panel-head"><div><p class="eyebrow">DETAILS</p><h2>Topic directory</h2></div><span>{filtered.length} shown</span></div>
        <div class="filters"><input bind:value={search} placeholder="Search ID, notes or title" /><select bind:value={blockFilter}><option value="all">All blocks</option>{#each SURGERY_BLOCKS as block}<option value={block.id}>{block.id}</option>{/each}</select><select bind:value={statusFilter}><option value="all">All statuses</option><option value="unassessed">Unassessed</option><option value="learning">Learning</option><option value="review">Review</option><option value="solid">Exam-ready</option></select></div>
        <div class="topic-list">{#each filtered as item}<button on:click={() => openTopic(item.definition)}><span class={`dot mastery-${item.progress.mastery}`}></span><span class="topic-copy"><strong>{item.definition.id}</strong><small>{item.definition.title}</small></span><span class="topic-meta">{masteryLabel(item.progress.mastery)}{#if activeGaps(item.progress).length}<b>{activeGaps(item.progress).length} gaps</b>{/if}</span></button>{/each}</div>
      </section>
    </div>
  {/if}
</div>

{#if selected}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="topic-title">
      <div class="panel-head"><div><p class="eyebrow">{selected.block} · TOPIC {selected.number}</p><h2 id="topic-title">{selected.title}</h2></div><button class="close" aria-label="Close" on:click={() => selected = null}>×</button></div>
      {#if selected.titleIsPlaceholder}<p class="placeholder-note">Official title not supplied. The stable ID is ready; update the centralized syllabus when the exact title is available.</p>{/if}
      <div class="form-grid"><label>Mastery<select bind:value={editMastery}>{#each [0,1,2,3,4] as value}<option value={value}>{value} · {masteryLabel(value)}</option>{/each}</select></label><label>Confidence<select bind:value={editConfidence}>{#each [0,1,2,3,4] as value}<option value={value}>{value} / 4</option>{/each}</select></label><label>Status<select bind:value={editStatus}><option value="unassessed">Unassessed</option><option value="learning">Learning</option><option value="review">Review</option><option value="solid">Exam-ready</option></select></label></div>
      <label>Notes<textarea class="notes" bind:value={editNotes} maxlength="5000" placeholder="Concise knowledge-map notes"></textarea></label>
      <section class="anki-section">
        <div><h3>Anki deck study</h3><p>Each log is kept separately, so repeated deck reviews count.</p></div>
        <div class="anki-log"><input type="date" bind:value={ankiDate} max={localDateString()} /><button disabled={saving} on:click={logAnkiReview}>{saving ? 'Saving…' : 'Log Anki study'}</button></div>
        {#if ankiReviews(state.topics[selected.id]).length}
          <div class="anki-history"><strong>{ankiReviews(state.topics[selected.id]).length}× studied</strong><span>{ankiReviews(state.topics[selected.id]).slice().reverse().map((date) => new Date(`${date}T12:00:00`).toLocaleDateString()).join(' · ')}</span></div>
        {/if}
      </section>
      {#if planProgress}<section class="plan-topic-section"><div><h3>Study-plan coverage</h3><p>Independent of oral mastery and retention.</p></div><div class="plan-topic-state"><span><b>Oral mastery</b>{state.topics[selected.id].mastery} / 4</span><span><b>First pass</b>{planProgress.topics[selected.id]?.firstPassCompletedAt ? `Completed ${new Date(planProgress.topics[selected.id].firstPassCompletedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not complete'}</span><span><b>Second pass</b>{planProgress.topics[selected.id]?.secondPassCompletedAt ? `Completed ${new Date(planProgress.topics[selected.id].secondPassCompletedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not complete'}</span></div><div class="actions"><button on:click={() => toggleTopicPlanPass(selected!.id, 'first')}>{planProgress.topics[selected.id]?.firstPassCompletedAt ? 'Mark first pass incomplete' : 'Mark first pass complete'}</button><button on:click={() => toggleTopicPlanPass(selected!.id, 'second')}>{planProgress.topics[selected.id]?.secondPassCompletedAt ? 'Mark second pass incomplete' : 'Mark second pass complete'}</button></div></section>{/if}
      <div class="gaps"><h3>Knowledge gaps</h3>{#each activeGaps(state.topics[selected.id]) as gap}<div><span>{gap.text}</span><button on:click={() => resolveGap(selected!.id, gap.id)}>Resolve</button></div>{/each}<input bind:value={newGap} maxlength="500" placeholder="Add a specific gap" /></div>
      <div class="actions end"><button on:click={() => selected = null}>Cancel</button><button class="primary" disabled={saving} on:click={saveManual}>{saving ? 'Saving…' : 'Save topic'}</button></div>
    </div>
  </div>
{/if}

<style>
  .hero-actions{display:flex;align-items:stretch;gap:10px}.review-link{position:relative;display:flex;align-items:center;gap:10px;border:1px solid #282d39;background:rgba(24,27,36,.72);color:#e7e9f1;border-radius:16px;padding:10px 15px;cursor:pointer;backdrop-filter:blur(16px)}.review-link:hover{border-color:#59637a;background:#1c202a}.review-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#262b37;color:#9ca6ff;font-size:1.15rem}.review-copy{text-align:left}.review-copy strong,.review-copy small{display:block}.review-copy strong{font-size:.78rem}.review-copy small{font-size:.66rem;color:#8e95a9;margin-top:3px}.due-badge{position:absolute;top:-8px;right:-8px;display:grid;place-items:center;min-width:21px;height:21px;box-sizing:border-box;padding:0 5px;border-radius:999px;background:#ff3b5c;color:#fff;font-size:.68rem;line-height:1;box-shadow:0 0 0 3px #0b0d12}
  :global(body){background:#0b0d12!important;color:#eef0f7!important}.study-shell{max-width:1180px;margin:0 auto;padding:12px 0 80px;color:#eef0f7}.hero{display:flex;justify-content:space-between;align-items:flex-end;padding:30px 4px 26px}.eyebrow{font-size:.68rem;font-weight:750;letter-spacing:.17em;color:#8e95a9;margin:0 0 8px}.hero h1{font-size:clamp(2rem,5vw,4rem);letter-spacing:-.055em;margin:0;line-height:.95}.subtitle{color:#8e95a9;margin:12px 0 0}.exam{text-align:right;padding:14px 18px;border:1px solid #282d39;border-radius:16px;background:rgba(24,27,36,.72);backdrop-filter:blur(16px)}.exam strong{font-size:2rem;display:block}.exam span{font-size:.75rem;color:#9ba2b5}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px}.metrics article,.panel,.blocks button,.state-card{background:linear-gradient(145deg,rgba(27,31,41,.94),rgba(17,20,27,.94));border:1px solid #292e3a;border-radius:18px;box-shadow:0 14px 38px rgba(0,0,0,.18)}.metrics article{padding:18px}.metrics span{display:block;color:#9299ab;font-size:.74rem}.metrics strong{display:block;font-size:1.75rem;margin-top:9px}.metrics small{font-size:.75rem;color:#747c90;margin-left:4px}.blocks{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px}.blocks button{text-align:left;color:inherit;padding:15px;cursor:pointer}.blocks button.active{border-color:#7888ff;box-shadow:0 0 0 1px #7888ff}.blocks button span,.blocks button strong{font-size:.8rem}.blocks button strong{float:right}.blocks i{height:5px;background:#292e39;border-radius:9px;display:block;margin:12px 0 8px;overflow:hidden}.blocks i b{display:block;height:100%;background:linear-gradient(90deg,#6c7cff,#9d7dff)}.blocks small{color:#8e95a9}.main-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:10px}.panel{padding:20px;min-width:0}.wide{grid-column:1/-1}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:17px}.panel h2{margin:0;font-size:1.12rem}.panel-head p:not(.eyebrow){color:#8e95a9;font-size:.8rem;margin:7px 0 0}.legend{display:flex;gap:8px;color:#8e95a9;font-size:.66rem}.legend span{display:flex;align-items:center;gap:3px}.legend i,.dot{width:9px;height:9px;border-radius:3px;display:inline-block}.m0,.mastery-0{background:#282d37!important}.m1,.mastery-1{background:#62394d!important}.m2,.mastery-2{background:#9a633f!important}.m3,.mastery-3{background:#61744d!important}.m4,.mastery-4{background:#3f8f71!important}.heatmap{display:grid;grid-template-columns:repeat(28,minmax(24px,1fr));gap:5px}.heatmap button{position:relative;aspect-ratio:1;border:1px solid transparent;border-radius:5px;color:rgba(255,255,255,.72);font-size:.54rem;cursor:pointer;padding:0}.anki-badge{position:absolute;top:-4px;right:-4px;display:grid!important;place-items:center;min-width:10px;height:10px;padding:0 2px;box-sizing:border-box;border-radius:999px;background:#ff3b5c!important;color:#fff;font-size:7px!important;font-weight:800;line-height:1;box-shadow:0 0 0 2px #20242e;z-index:2}.heatmap button:hover{transform:scale(1.15);border-color:#fff;z-index:3}.heatmap button.has-gap{box-shadow:inset 0 0 0 1px #ff6a7a}.empty{min-height:180px;display:grid;place-items:center;text-align:center;color:#777f91;font-size:.82rem}.danger-text{color:#ff7685}.count{background:#43252d;color:#ff8c98;border-radius:999px;padding:4px 9px;font-size:.75rem}.red-list{display:flex;flex-direction:column;gap:6px}.red-list button{display:flex;justify-content:space-between;text-align:left;background:#171a22;border:1px solid #2a2e38;border-radius:10px;color:#f0f1f5;padding:10px;cursor:pointer}.red-list small{display:block;color:#8e95a9;margin-top:4px}.red-list b{color:#ff8490;font-size:.7rem}.import-panel textarea{width:100%;box-sizing:border-box;min-height:170px;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions.end{justify-content:flex-end}.actions button,.gaps button,.message button,.close,.anki-log button{border:1px solid #353b49;background:#222630;color:#e7e9f1;border-radius:10px;padding:10px 13px;cursor:pointer}.actions .primary,.anki-log button{background:#7787ff;border-color:#7787ff;color:#080a10;font-weight:750}.actions button:disabled,.anki-log button:disabled{opacity:.45;cursor:not-allowed}.filters{display:grid;grid-template-columns:1fr auto auto;gap:8px}.filters input,.filters select,textarea,.form-grid select,.notes,.gaps input,.anki-log input{background:#11141b;color:#edf0f7;border:1px solid #303541;border-radius:10px;padding:11px;font:inherit}.topic-list{margin-top:12px;max-height:560px;overflow:auto}.topic-list>button{width:100%;display:flex;align-items:center;gap:11px;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid #262b35;padding:11px 6px;cursor:pointer}.topic-copy{display:flex;flex-direction:column;flex:1}.topic-copy small{color:#858c9e;margin-top:3px}.topic-meta{text-align:right;color:#aab0bf;font-size:.72rem}.topic-meta b{display:block;color:#ff8490;margin-top:3px}.message{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;margin-bottom:10px;border-radius:12px}.message.error{background:#3c2027;border:1px solid #743842}.message.success{background:#18372e;border:1px solid #2a6653}.message button{padding:5px 8px}.state-card{padding:50px;text-align:center;color:#9299ab}.spinner{display:inline-block;width:14px;height:14px;border:2px solid #495063;border-top-color:#8793ff;border-radius:50%;animation:spin .8s linear infinite;margin-right:8px}.modal-backdrop{position:fixed;inset:0;background:rgba(2,3,6,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px;z-index:100}.modal{width:min(680px,100%);max-height:88vh;overflow:auto;background:#171a22;border:1px solid #343a48;border-radius:20px;padding:22px;color:#eef0f7;box-shadow:0 28px 80px #000}.close{font-size:1.4rem;padding:3px 10px}.placeholder-note{background:#28241c;border:1px solid #4c422c;color:#d6c18a;padding:10px;border-radius:10px;font-size:.8rem}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:17px 0}.modal label{display:flex;flex-direction:column;gap:7px;font-size:.76rem;color:#aab0bf}.notes{min-height:100px;resize:vertical}.anki-section{margin:16px 0;padding:14px;background:#11141b;border:1px solid #292e39;border-radius:12px}.anki-section h3,.gaps h3{font-size:.83rem;margin:0 0 4px}.anki-section p{font-size:.73rem;color:#858c9e;margin:0}.anki-log{display:flex;gap:8px;margin-top:12px}.anki-log input{flex:1;color-scheme:dark}.anki-history{display:flex;justify-content:space-between;gap:10px;margin-top:11px;font-size:.72rem}.anki-history span{color:#858c9e;text-align:right;overflow-wrap:anywhere}.gaps>div{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#11141b;border-radius:9px;padding:8px 10px;margin:6px 0;font-size:.78rem}.gaps button{padding:5px 8px}.gaps input{width:100%;box-sizing:border-box;margin-top:7px}.hidden{display:none}@keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:800px){.metrics{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}.wide{grid-column:auto}.heatmap{grid-template-columns:repeat(14,1fr)}.blocks{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:1fr}.hero{align-items:flex-start}.exam{padding:10px}.exam strong{font-size:1.4rem}.form-grid{grid-template-columns:1fr}}
  @media(max-width:480px){.study-shell{padding-top:0}.hero{padding-top:12px}.subtitle{font-size:.8rem}.metrics article{padding:13px}.heatmap{grid-template-columns:repeat(10,1fr)}.panel{padding:14px}.legend{display:none}}
  /* Compact hero controls and at-a-glance study-plan summary. */
  .action-stack{display:grid;grid-template-rows:1fr 1fr;gap:7px;width:176px}.review-link.compact{width:100%;box-sizing:border-box;border-radius:12px;padding:7px 10px;min-height:0}.hero{padding-bottom:20px}.metrics article{padding:13px 16px}.metrics span{font-size:.7rem}.metrics strong{font-size:1.42rem;margin-top:5px}.metrics small{font-size:.7rem;margin-left:3px}
  .plan-strip{position:relative;width:100%;display:grid;grid-template-columns:1.15fr 1.6fr .75fr .85fr auto;align-items:center;gap:22px;box-sizing:border-box;text-align:left;color:#eef0f7;background:linear-gradient(110deg,rgba(31,36,49,.96),rgba(18,22,30,.96));border:1px solid #303746;border-radius:18px;padding:16px 19px;margin:0 0 10px;cursor:pointer}.plan-strip:hover{border-color:#59637a}.plan-strip span,.plan-strip small{display:block;color:#9299ab}.plan-strip>div>span{font-size:.66rem;text-transform:uppercase;letter-spacing:.08em}.plan-strip strong{display:block;margin:5px 0 3px;font-size:1.12rem}.plan-strip strong.ahead{color:#63d6ae}.plan-strip strong.behind{color:#ff7d8e}.plan-strip small{font-size:.68rem}.plan-progress>div{display:flex;justify-content:space-between;align-items:end}.plan-progress>div b{font-size:1rem}.plan-progress>div b small,.plan-today strong small{display:inline;color:#788197;margin-left:2px}.plan-progress>i{display:block;height:6px;background:#2a303d;border-radius:8px;overflow:hidden;margin:8px 0 5px}.plan-progress>i b{display:block;height:100%;margin:0;background:linear-gradient(90deg,#6c7cff,#9d7dff)}.plan-today strong{font-size:1.35rem}.plan-forecast strong{font-size:1.1rem}.plan-arrow{font-size:1.9rem!important;color:#7787ff!important}.plan-empty{grid-template-columns:1fr auto}.plan-empty strong{margin:4px 0}
  @media(max-width:800px){.plan-strip{grid-template-columns:1fr 1fr;gap:14px}.plan-arrow{display:none!important}.hero-actions{width:100%}.action-stack{flex:1;width:auto}.exam{min-width:120px}}
  @media(max-width:480px){.hero-actions{flex-direction:column}.action-stack{width:100%}.exam{text-align:center}.metrics article{padding:11px 13px}.plan-strip{grid-template-columns:1fr}.plan-progress{order:3}}
  .plan-topic-section{margin:16px 0;padding:14px;background:#11141b;border:1px solid #292e39;border-radius:12px}.plan-topic-section h3{font-size:.83rem;margin:0 0 4px}.plan-topic-section p{font-size:.73rem;color:#858c9e;margin:0}.plan-topic-state{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.plan-topic-state span{background:#171b24;border-radius:9px;padding:9px;color:#aab0bf;font-size:.72rem}.plan-topic-state b{display:block;color:#eef0f7;margin-bottom:4px}@media(max-width:480px){.plan-topic-state{grid-template-columns:1fr}}
</style>
