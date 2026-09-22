<script lang="ts">
  import { coverageFromReviews } from '$lib/paediatrics/reviewCoverage';
  import { onDestroy, onMount } from 'svelte';
  import { ORAL_BANDS, ORAL_DOMAINS, oralSummary, oralPriority, scoreOralAssessment } from '$lib/paediatrics/oralAssessment';
  import { goto } from '$app/navigation';
  import { makePaediatricsLearningBrief, makePaediatricsImagingPrompt, makePaediatricsGapOnlyPrompt, makePaediatricsAssessmentOnlyPrompt, withPaediatricsStudyApproach, PAEDIATRICS_EXAM_FORMAT, PAEDIATRICS_EXAM_REQUIREMENTS_URL } from '$lib/paediatrics/studyApproach';
  import { user, userReady } from '$lib/stores/user';
  import AnkiStatsPanel from '$lib/components/AnkiStatsPanel.svelte';
  import PaediatricsProgressChart from '$lib/components/PaediatricsProgressChart.svelte';
  import { PAEDIATRICS_BLOCKS, PAEDIATRICS_EXAM_DATE, PAEDIATRICS_SYLLABUS, PAEDIATRICS_RESOURCES, type PaediatricsTopicDefinition } from '$lib/paediatrics/paediatricsSyllabus';
  import {
    createEmptyPaediatricsState,
    mergePatch,
    validateBackup,
    validatePatch,
    type Mastery,
    type SessionSnapshot,
    type PaediatricsState,
    type TopicProgress,
    type TopicStatus
  } from '$lib/paediatrics/paediatricsSchema';
  import { readBackup, restoreBackup, saveSession, saveSessions, savePaediatricsReview, savePaediatricsReviews, savePaediatricsSimulation, savePaediatricsState, saveStudyPlanProgress, subscribeToRetentionCards, subscribeToPaediatricsReviews, subscribeToPaediatricsSessions, subscribeToPaediatricsSimulations, subscribeToPaediatricsState, subscribeToStudyPlan } from '$lib/paediatrics/paediatricsRepository';
  import { discardActiveStudyTimer, saveRetentionCards } from '$lib/paediatrics/paediatricsRepository';
  import { createRetentionCard, removeDuplicateCardInputs } from '$lib/paediatrics/retentionSchema';
  import type { RetentionCard } from '$lib/paediatrics/retentionSchema';
  import { recordPatchPlanProgress } from '$lib/paediatrics/studyPlanIntegration';
  import { PLAN_PASSES, PASS_DETAILS, passCompletionKey, passCoverageAt, acquisitionCoveredByRecall, passSourceKey, passForPhase, nextTopicPass } from '$lib/paediatrics/studyPlanSchema';
  import type { PlanPass, StudyPlanConfig, StudyPlanProgress } from '$lib/paediatrics/studyPlanSchema';
  import { dateKey, forecast, pacing, passCount, phaseForProgress } from '$lib/paediatrics/studyPlanEngine';
  import { finishStudyTimer, formatStudyDuration, formatStudyDurationCompact, isAnkiStudyTimer, isTopicStudyTimer, pauseStudyTimer, resumeStudyTimer, startStudyTimer, timerElapsedSeconds } from '$lib/paediatrics/studyTimer';
  import { buildGapRepairBatch, buildGapRepairQueue, buildRapidGapRepairBatch, buildReviewQueue, buildStudyQueue, gapRepairCooldownSummary, latestReviews, makeGapRepairPrompt, makeRapidGapRepairPrompt, makeStudyChatPrompt, reviewCounts, type GapPriority, type ReviewOutcome, type RecallOutcome, type PaediatricsReviewEvent, type PaediatricsSimulation } from '$lib/paediatrics/paediatricsReview';
  import { DEFAULT_ANKI_CONNECT_URL, DEFAULT_ANKI_GAP_DECK, DEFAULT_ANKI_GAP_MODEL, readAnkiGapProgress, readAnkiStudyTime, requestAnkiPermission, sendGapCardsToAnki, type AnkiConnectSettings } from '$lib/paediatrics/ankiConnect';
  import { applyAnkiGapClassifications, classifyAnkiGapProgress, makeAnkiGapCardPrompt, validateAnkiGapCardImport, type AnkiGapSelection } from '$lib/paediatrics/ankiGapStudy';
  import { summarizeAnkiGapCards } from '$lib/paediatrics/ankiGapStats';
  import { ankiStudyDayKey, ankiTimeSessionId, DEFAULT_ANKI_DAY_START_HOUR, normalizeAnkiDayStartHour, shiftDateKey, type AnkiDailyStudyTime } from '$lib/paediatrics/ankiStudyTime';
  import { groupPaediatricsSessionsByDay } from '$lib/paediatrics/paediatricsChart';

  let state: PaediatricsState = createEmptyPaediatricsState();
  let sessions: SessionSnapshot[] = [];
  let retentionCards: RetentionCard[] = [];
  let reviewEvents: PaediatricsReviewEvent[] = [];
  let simulations: PaediatricsSimulation[] = [];
  let planConfig: StudyPlanConfig | null = null;
  let storedPlanProgress: StudyPlanProgress | null = null;
  $: planProgress = coverageFromReviews(storedPlanProgress, reviewEvents, sessions);
  let activePass: PlanPass = 'first';
  let loading = true;
  let saving = false;
  let error = '';
  let notice = '';
  let patchText = '';
  let search = '';
  let blockFilter = 'all';
  let statusFilter = 'all';
  let selected: PaediatricsTopicDefinition | null = null;
  let editMastery: Mastery = 0;
  let editConfidence: Mastery = 0;
  let editStatus: TopicStatus = 'unassessed';
  let editNotes = '';
  let newGap = '';
  let newGapPriority: GapPriority = 'normal';
  let showSimulation = false;
  let simulationOutcome: RecallOutcome = 'passed';
  let simulationTopics = '';
  let simulationMinutes = '';
  let simulationErrors = '';
  let simulationNotes = '';
  let ankiDate = localDateString();
  let unsubscribeState: (() => void) | null = null;
  let unsubscribeSessions: (() => void) | null = null;
  let unsubscribeCards: (() => void) | null = null;
  let unsubscribePlan: (() => void) | null = null;
  let unsubscribeReviews: (() => void) | null = null;
  let unsubscribeSimulations: (() => void) | null = null;
  let subscribedUid = '';
  let importInput: HTMLInputElement;
  let timerNow = Date.now();
  let gapQueueNow = new Date().toISOString();
  let studyMode: 'screen' | 'gap-repair' | 'rapid-gap-repair' | 'anki-gap' = 'screen';
  let gapBatchSize = 3;
  let rapidGapTarget = 8;
  let ignoreRetests = false;
  let randomizeEqualPriority = false;
  let randomOrderSeed = '';
  let ankiBatchSize = 20;
  let ankiCardJson = '';
  let ankiPromptSelection: AnkiGapSelection[] = [];
  let showAnkiImport = false;
  let ankiBusy = false;
  let ankiConnected = false;
  let ankiApiKey = '';
  let ankiDeckName = DEFAULT_ANKI_GAP_DECK;
  let ankiModelName = DEFAULT_ANKI_GAP_MODEL;
  let ankiDayStartHour = DEFAULT_ANKI_DAY_START_HOUR;
  let ankiLastSyncAt = '';
  let ankiLastSyncSummary = '';

  $: uid = $user?.uid as string | undefined;
  $: if ($userReady && uid && uid !== subscribedUid) subscribe(uid);
  $: if ($userReady && !uid) { unsubscribeState?.(); unsubscribeSessions?.(); unsubscribeCards?.(); unsubscribePlan?.(); unsubscribeReviews?.(); unsubscribeSimulations?.(); subscribedUid=''; state=createEmptyPaediatricsState(); sessions=[]; retentionCards=[]; reviewEvents=[]; simulations=[]; planConfig=null; storedPlanProgress=null; loading=false; }

  function subscribe(userId: string) {
    unsubscribeState?.(); unsubscribeSessions?.(); unsubscribeCards?.(); unsubscribePlan?.(); unsubscribeReviews?.(); unsubscribeSimulations?.();
    subscribedUid = userId; loading = true; error = ''; state=createEmptyPaediatricsState(); sessions=[]; retentionCards=[]; reviewEvents=[]; simulations=[]; planConfig=null; storedPlanProgress=null;
    unsubscribeState = subscribeToPaediatricsState(userId, (value) => { state = value; loading = false; }, fail);
    unsubscribeSessions = subscribeToPaediatricsSessions(userId, (value) => sessions = value, fail);
    unsubscribeCards = subscribeToRetentionCards(userId, (value) => retentionCards = value, fail);
    unsubscribePlan = subscribeToStudyPlan(userId, (config, progress) => { planConfig = config; storedPlanProgress = progress; }, fail);
    unsubscribeReviews = subscribeToPaediatricsReviews(userId, (value) => reviewEvents = value, fail);
    unsubscribeSimulations = subscribeToPaediatricsSimulations(userId, (value) => simulations = value, fail);
  }

  function fail(reason: unknown) {
    error = reason instanceof Error ? reason.message : 'Something went wrong.';
    loading = false; saving = false;
  }

  function canonicalAnkiGapCards(cards: RetentionCard[]) {
    const byGap = new Map<string, RetentionCard>();
    for (const card of cards) {
      if (!card.gapId || card.status === 'archived' || (!card.id.startsWith('anki-gap-') && !card.anki)) continue;
      const key = gapPair(card.topicId, card.gapId);
      const current = byGap.get(key);
      const dedicated = card.id.startsWith('anki-gap-');
      const currentDedicated = current?.id.startsWith('anki-gap-') ?? false;
      if (!current || (dedicated && !currentDedicated) || (!!card.anki?.noteId && !current.anki?.noteId && dedicated === currentDedicated)) byGap.set(key, card);
    }
    return [...byGap.values()];
  }

  onMount(() => {
    const savedMode = window.localStorage.getItem('trackr-paediatrics-study-mode');
    if (savedMode === 'screen' || savedMode === 'gap-repair' || savedMode === 'rapid-gap-repair' || savedMode === 'anki-gap') studyMode = savedMode;
    ignoreRetests = window.localStorage.getItem('trackr-paediatrics-ignore-retests') === 'true';
    randomizeEqualPriority = window.localStorage.getItem('trackr-paediatrics-random-order') === 'true';
    randomOrderSeed = window.localStorage.getItem('trackr-paediatrics-random-order-seed') ?? '';
    if (randomizeEqualPriority && !randomOrderSeed) {
      randomOrderSeed = `${Date.now()}-${window.crypto.randomUUID()}`;
      window.localStorage.setItem('trackr-paediatrics-random-order-seed', randomOrderSeed);
    }
    ankiApiKey = window.localStorage.getItem('trackr-anki-connect-key') ?? '';
    ankiDeckName = window.localStorage.getItem('trackr-paediatrics-anki-gap-deck') ?? DEFAULT_ANKI_GAP_DECK;
    ankiModelName = window.localStorage.getItem('trackr-paediatrics-anki-gap-model') ?? DEFAULT_ANKI_GAP_MODEL;
    ankiDayStartHour = normalizeAnkiDayStartHour(Number(window.localStorage.getItem('trackr-anki-day-start-hour') ?? DEFAULT_ANKI_DAY_START_HOUR));
    const interval = window.setInterval(() => timerNow = Date.now(), 1000);
    const gapQueueInterval = window.setInterval(() => gapQueueNow = new Date().toISOString(), 60000);
    return () => { window.clearInterval(interval); window.clearInterval(gapQueueInterval); };
  });
  onDestroy(() => { unsubscribeState?.(); unsubscribeSessions?.(); unsubscribeCards?.(); unsubscribePlan?.(); unsubscribeReviews?.(); unsubscribeSimulations?.(); });

  const activeGaps = (topic: TopicProgress) => topic.gaps.filter((gap) => !gap.resolvedAt);
  const ankiReviews = (topic: TopicProgress) => topic.ankiReviews ?? [];

  function selectStudyMode(mode: 'screen' | 'gap-repair' | 'rapid-gap-repair' | 'anki-gap') {
    studyMode = mode;
    if (typeof window !== 'undefined') window.localStorage.setItem('trackr-paediatrics-study-mode', mode);
  }

  function setIgnoreRetests(value: boolean) {
    ignoreRetests = value;
    if (typeof window !== 'undefined') window.localStorage.setItem('trackr-paediatrics-ignore-retests', String(value));
  }

  function setRandomOrder(value: boolean) {
    randomizeEqualPriority = value;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('trackr-paediatrics-random-order', String(value));
    if (value) {
      randomOrderSeed = `${Date.now()}-${window.crypto.randomUUID()}`;
      window.localStorage.setItem('trackr-paediatrics-random-order-seed', randomOrderSeed);
    }
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function gapCooldownLabel(nextEligibleAt?: string) {
    if (!nextEligibleAt) return '';
    const minutes = Math.max(1, Math.ceil((new Date(nextEligibleAt).getTime() - new Date(gapQueueNow).getTime()) / 60000));
    if (minutes < 60) return `Next in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `Next in ${hours}h${remainder ? ` ${remainder}m` : ''}`;
  }

  function currentAnkiSettings(): AnkiConnectSettings {
    return { url: DEFAULT_ANKI_CONNECT_URL, deckName: ankiDeckName.trim() || DEFAULT_ANKI_GAP_DECK, modelName: ankiModelName.trim() || DEFAULT_ANKI_GAP_MODEL, ...(ankiApiKey.trim() ? { apiKey: ankiApiKey.trim() } : {}) };
  }

  function gapPair(topicId: string, gapId: string) { return `${topicId}\u0000${gapId}`; }

  function selectUnlinkedAnkiGaps(limit: number): AnkiGapSelection[] {
    const linked = new Set(retentionCards.filter((card) => card.gapId && card.status !== 'archived').map((card) => gapPair(card.topicId, card.gapId!)));
    const pools = gapRepairQueue.map((entry) => ({ entry, gaps: entry.openGaps.filter((gap) => !linked.has(gapPair(entry.topicId, gap.id))) }));
    const selected: AnkiGapSelection[] = [];
    let round = 0;
    while (selected.length < limit) {
      let added = false;
      for (const pool of pools) {
        const gap = pool.gaps[round];
        if (!gap) continue;
        selected.push({ topicId: pool.entry.topicId, topicTitle: pool.entry.title, gapId: gap.id, gapText: gap.text, priority: gap.priority });
        added = true;
        if (selected.length >= limit) break;
      }
      if (!added) break;
      round += 1;
    }
    return selected;
  }
  $: topicValues = PAEDIATRICS_SYLLABUS.map((definition) => ({ definition, progress: state.topics[definition.id] }));
  $: assessed = topicValues.filter(({ progress }) => progress?.status !== 'unassessed').length;
  $: averageMastery = assessed ? topicValues.reduce((sum, { progress }) => sum + (progress?.mastery ?? 0), 0) / assessed : 0;
  $: oralAssessedTopics = topicValues.filter(({ progress }) => !!progress.oralAssessment);
  $: averageOral = oralAssessedTopics.length ? oralAssessedTopics.reduce((sum, { progress }) => sum + oralPriority(progress), 0) / oralAssessedTopics.length : undefined;
  $: masteryDistribution = ORAL_BANDS.map((band) => {
    const count = topicValues.filter(({ progress }) => oralSummary(progress).band.key === band.key).length;
    return { ...band, count, percentage: topicValues.length ? count / topicValues.length * 100 : 0 };
  });
  $: masteryGradient = (() => {
    let start = 0;
    return `conic-gradient(${masteryDistribution.map((item) => {
      const end = start + item.percentage;
      const segment = `${item.color} ${start}% ${end}%`;
      start = end;
      return segment;
    }).join(',')})`;
  })();
  $: openGaps = topicValues.reduce((sum, { progress }) => sum + (progress ? activeGaps(progress).length : 0), 0);
  $: examDate = planConfig?.examDate || PAEDIATRICS_EXAM_DATE;
  $: daysRemaining = examDate ? Math.max(0, Math.ceil((new Date(`${examDate}T00:00:00`).getTime() - Date.now()) / 86400000)) : null;
  $: dueRetentionCount = retentionCards.filter((card) => card.status === 'active' && new Date(card.dueAt).getTime() <= Date.now()).length;
  $: today = dateKey();
  $: currentPhase = planConfig && planProgress ? phaseForProgress(planConfig, planProgress, today) : undefined;
  $: planPacing = planConfig?.examDate && planProgress && currentPhase && currentPhase.type !== 'buffer' ? pacing(planConfig, planProgress, currentPhase, today) : null;
  $: activePass = currentPhase?.type === 'buffer' ? 'third' : passForPhase(currentPhase?.type);
  $: planCovered = planProgress ? passCount(planProgress, activePass) : 0;
  $: activePassCoverageLabel = activePass === 'first' ? 'Pass 0 coverage' : PASS_DETAILS[activePass].label;
  $: planProjection = planConfig?.examDate && planProgress && currentPhase && currentPhase.type !== 'buffer' ? forecast(planConfig, planProgress, currentPhase, today) : null;
  $: roundDeadline = currentPhase?.endDate || examDate;
  $: projectionDaysFromToday = planProjection ? Math.max(0, Math.round((new Date(`${planProjection.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)) : 0;
  $: examDaysFromToday = planConfig ? Math.max(0, Math.round((new Date(`${roundDeadline}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)) : 0;
  $: forecastScaleDays = Math.max(1, projectionDaysFromToday, examDaysFromToday);
  $: projectionLate = !!planProjection && !!planConfig && planProjection.date > roundDeadline;
  $: forecastTargetX = 10 + (examDaysFromToday / forecastScaleDays) * 220;
  $: forecastProjectionX = 10 + (projectionDaysFromToday / forecastScaleDays) * 220;
  $: forecastStartY = 58 - Math.min(1, planCovered / 120) * 48;
  $: todaySessions = sessions.filter((session) => session.date.slice(0, 10) === today);
  $: assessedTopicsToday = new Set(todaySessions.flatMap((session) => session.topicIds ?? [])).size;
  $: activeTimer = state.activeStudyTimer;
  $: activeTimerTopic = isTopicStudyTimer(activeTimer) ? PAEDIATRICS_SYLLABUS.find((topic) => topic.id === activeTimer.topicId) : undefined;
  $: activeTimerIsAnki = isAnkiStudyTimer(activeTimer);
  $: activeTimerSeconds = activeTimer ? timerElapsedSeconds(activeTimer, timerNow) : 0;
  $: localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague';
  $: dailyStudyTime = groupPaediatricsSessionsByDay(sessions, localTimeZone);
  $: currentAnkiStudyDay = ankiStudyDayKey(timerNow, ankiDayStartHour, localTimeZone);
  $: calendarTodayTime = dailyStudyTime.find((day) => day.date === today);
  $: currentAnkiDayTime = dailyStudyTime.find((day) => day.date === currentAnkiStudyDay);
  $: completedStudySecondsToday = (calendarTodayTime?.guidedDurationSeconds ?? 0) + (currentAnkiDayTime?.ankiDurationSeconds ?? 0);
  $: activeStudySecondsToday = activeTimer?.startedAt.slice(0,10) === today ? activeTimerSeconds : 0;
  $: studySecondsToday = completedStudySecondsToday + activeStudySecondsToday;
  $: ankiStudySecondsToday = (currentAnkiDayTime?.ankiDurationSeconds ?? 0) + (activeTimerIsAnki ? activeTimerSeconds : 0);
  $: calendarSevenDayStart = shiftDateKey(today, -6);
  $: ankiSevenDayStart = shiftDateKey(currentAnkiStudyDay, -6);
  $: studySecondsLast7Days = dailyStudyTime.reduce((sum, day) => sum + (day.date >= calendarSevenDayStart ? day.guidedDurationSeconds : 0) + (day.date >= ankiSevenDayStart ? day.ankiDurationSeconds : 0), 0) + activeStudySecondsToday;
  $: reviewQueue = buildReviewQueue(state, planProgress, reviewEvents, today);
  $: screeningQueue = buildStudyQueue(reviewQueue, currentPhase?.type==='buffer' ? 'review' : activePass, ignoreRetests, randomizeEqualPriority ? randomOrderSeed : undefined);
  $: gapRepairQueue = buildGapRepairQueue(state, planProgress, reviewEvents, today, gapQueueNow);
  $: gapCooldown = gapRepairCooldownSummary(state, reviewEvents, gapQueueNow);
  $: nextGapReadyIn = gapCooldownLabel(gapCooldown.nextEligibleAt);
  $: gapRepairBatch = buildGapRepairBatch(gapRepairQueue, gapBatchSize);
  $: gapRepairBatchGapCount = gapRepairBatch.reduce((sum, entry) => sum + entry.openGaps.length, 0);
  $: rapidGapRepairBatch = buildRapidGapRepairBatch(gapRepairQueue, rapidGapTarget);
  $: rapidGapRepairBatchGapCount = rapidGapRepairBatch.reduce((sum, entry) => sum + entry.openGaps.length, 0);
  $: criticalOpenGaps = gapRepairQueue.reduce((sum, entry) => sum + entry.criticalGapCount, 0);
  $: linkedAnkiGapCards = canonicalAnkiGapCards(retentionCards);
  $: ankiStats = summarizeAnkiGapCards(retentionCards);
  $: linkedAnkiGapPairs = new Set(linkedAnkiGapCards.map((card) => gapPair(card.topicId, card.gapId!)));
  $: readyUnlinkedAnkiGaps = gapRepairQueue.reduce((sum, entry) => sum + entry.openGaps.filter((gap) => !linkedAnkiGapPairs.has(gapPair(entry.topicId, gap.id))).length, 0);
  $: ankiGapSelection = selectUnlinkedAnkiGaps(ankiBatchSize);
  $: ankiStableCards = linkedAnkiGapCards.filter((card) => card.anki?.status === 'stable').length;
  $: ankiLearningCards = linkedAnkiGapCards.filter((card) => card.anki?.status === 'learning' || card.anki?.status === 'unseen').length;
  $: ankiFragileCards = linkedAnkiGapCards.filter((card) => card.anki?.status === 'fragile' || card.anki?.status === 'reopened').length;
  $: ankiMissingCards = linkedAnkiGapCards.filter((card) => card.anki?.status === 'missing').length;
  $: storedAnkiSyncAt = linkedAnkiGapCards.map((card) => card.anki?.lastSyncedAt ?? '').sort().at(-1) ?? '';
  $: resolvedGapsToday = topicValues.reduce((sum, { progress }) => sum + progress.gaps.filter((gap) => gap.resolvedAt?.slice(0,10) === today).length, 0);
  $: latestReviewByTopic = latestReviews(reviewEvents);
  $: missingOralAssessments = topicValues.filter(({ definition, progress }) => !progress.oralAssessment && (!!latestReviewByTopic[definition.id] || !!planProgress?.topics[definition.id]?.secondPassCompletedAt));
  $: nextStudy = screeningQueue[0];
  $: reviewsToday = reviewCounts(reviewEvents, today);
  $: dueRetests = reviewQueue.filter((entry) => entry.kind === 'retest' || (entry.kind === 'critical' && entry.dueDate && entry.dueDate <= today));
  $: filtered = topicValues.filter(({ definition, progress }) => {
    const query = search.trim().toLowerCase();
    return (blockFilter === 'all' || definition.block === blockFilter) &&
      (statusFilter === 'all' ||
        (statusFilter === 'weak-oral' && (progress.oralAssessment ? oralPriority(progress) < 12 : progress.mastery > 0 && progress.mastery <= 2)) ||
        (statusFilter === 'missing-oral' && missingOralAssessments.some(item => item.definition.id === definition.id)) ||
        (statusFilter === 'needs-first-pass' && !planProgress?.topics[definition.id]?.firstPassCompletedAt && !acquisitionCoveredByRecall(planProgress?.topics[definition.id])) ||
        (statusFilter === 'first-pass-complete' && !!planProgress?.topics[definition.id]?.firstPassCompletedAt) ||
        (statusFilter === 'first-pass-superseded' && !planProgress?.topics[definition.id]?.firstPassCompletedAt && acquisitionCoveredByRecall(planProgress?.topics[definition.id])) ||
        (statusFilter === 'needs-second-pass' && !planProgress?.topics[definition.id]?.secondPassCompletedAt) ||
        (statusFilter === 'second-pass-complete' && !!planProgress?.topics[definition.id]?.secondPassCompletedAt) ||
        (statusFilter === 'needs-third-pass' && !planProgress?.topics[definition.id]?.thirdPassCompletedAt) ||
        (statusFilter === 'third-pass-complete' && !!planProgress?.topics[definition.id]?.thirdPassCompletedAt) ||
        (statusFilter === 'retest-due' && dueRetests.some((entry) => entry.topicId === definition.id)) ||
        (statusFilter === 'anki-done' && ankiReviews(progress).length > 0) ||
        progress?.status === statusFilter) &&
      (!query || definition.id.toLowerCase().includes(query) || definition.title.toLowerCase().includes(query) || progress?.notes.toLowerCase().includes(query));
  });
  $: redZones = topicValues.filter(({ progress }) => progress && (progress.status === 'review' || (progress.oralAssessment ? oralPriority(progress) < 12 : progress.attempts > 0 && progress.mastery <= 1) || activeGaps(progress).length > 0)).sort((a, b) => (oralPriority(a.progress) - oralPriority(b.progress)) || (activeGaps(b.progress).length - activeGaps(a.progress).length));

  function blockStats(block: string, progress: StudyPlanProgress | null) {
    const values = topicValues.filter(({ definition }) => definition.block === block);
    const blockAssessed = values.filter(({ progress }) => progress.status !== 'unassessed').length;
    const firstPass = values.filter(({ definition }) => !!passCoverageAt(progress?.topics[definition.id], 'first')).length;
    const missingFirstPass = values.filter(({ definition }) => !passCoverageAt(progress?.topics[definition.id], 'first')).map(({ definition }) => definition.id);
    const mastery = blockAssessed ? values.reduce((sum, item) => sum + item.progress.mastery, 0) / blockAssessed : 0;
    const oralValues = values.filter(item => item.progress.oralAssessment).map(item => oralPriority(item.progress));
    const oralAverage = oralValues.length ? oralValues.reduce((sum, n) => sum + n, 0) / oralValues.length : undefined;
    return { assessed: blockAssessed, firstPass, missingFirstPass, total: values.length, mastery, oralAverage };
  }

  function blockPassCount(block: string, pass: PlanPass) { return PAEDIATRICS_SYLLABUS.filter(topic=>topic.block===block && passCoverageAt(planProgress?.topics[topic.id], pass)).length; }

  function openTopic(definition: PaediatricsTopicDefinition) {
    const progress = state.topics[definition.id];
    selected = definition; editMastery = progress.mastery; editConfidence = progress.confidence;
    editStatus = progress.status; editNotes = progress.notes; newGap = ''; ankiDate = localDateString();
  }

  async function toggleTopicPlanPass(topicId: string, pass: PlanPass) {
    if (!uid || !planProgress) return;
    const next = structuredClone(planProgress); const topic = next.topics[topicId] ?? {};
    const key = passCompletionKey(pass);
    const sourceKey = passSourceKey(pass);
    const previous = topic[key]; const complete = !previous; const changedAt = new Date().toISOString();
    if (pass === 'first' && previous && topic.firstPassSource === 'baseline') { topic.firstPassSource = 'manual-confirmed'; topic.firstPassManual = true; topic.completionHistory = [...(topic.completionHistory ?? []), { pass, complete: true, changedAt, source: 'manual-confirmed', previousCompletedAt: previous }]; next.topics[topicId] = topic; next.updatedAt = changedAt; await saveStudyPlanProgress(uid, next); storedPlanProgress = next; return; }
    if (complete) { topic[key] = changedAt; topic[sourceKey] = 'manual'; } else { delete topic[key]; delete topic[sourceKey]; }
    topic.completionHistory = [...(topic.completionHistory ?? []), { pass, complete, changedAt, source: 'manual', ...(previous ? { previousCompletedAt: previous } : {}) }];
    next.topics[topicId] = topic; next.updatedAt = changedAt; await saveStudyPlanProgress(uid, next); storedPlanProgress = next;
  }

  async function persist(next: PaediatricsState, session?: SessionSnapshot, silent = false) {
    if (!uid) return;
    saving = true; error = ''; notice = '';
    try {
      await savePaediatricsState(uid, next);
      if (session) await saveSession(uid, session);
      state = next; if (!silent) notice = 'Saved to your account.';
    } catch (reason) { fail(reason); }
    finally { saving = false; }
  }

  function timedSnapshot(next: PaediatricsState, topicId: string, startedAt: string, endedAt: string, durationSeconds: number): SessionSnapshot {
    const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === topicId);
    const assessedCount = Object.values(next.topics).filter((item) => item.status !== 'unassessed').length;
    const mastery = Object.values(next.topics).reduce((sum, item) => sum + item.mastery, 0) / Math.max(1, assessedCount);
    return { id: crypto.randomUUID(), date: endedAt, label: `${topicId} · ${topic?.title ?? 'Timed study'}`, questions: 0, averageMastery: Number(mastery.toFixed(2)), assessedTopics: assessedCount, createdAt: endedAt, topicIds: [topicId], durationSeconds, studyStartedAt: startedAt, studyEndedAt: endedAt, studySource: 'trackr' };
  }

  function ankiTimedSnapshot(next: PaediatricsState, startedAt: string, endedAt: string, durationSeconds: number, topicIds: string[], gapIds: string[]): SessionSnapshot {
    const assessedCount = Object.values(next.topics).filter((item) => item.status !== 'unassessed').length;
    const mastery = Object.values(next.topics).reduce((sum, item) => sum + item.mastery, 0) / Math.max(1, assessedCount);
    return { id: crypto.randomUUID(), date: endedAt, label: 'Anki gap study', questions: 0, averageMastery: Number(mastery.toFixed(2)), assessedTopics: assessedCount, createdAt: endedAt, mode: 'retention', planPass: 'review', topicIds, gapIds, durationSeconds, studyStartedAt: startedAt, studyEndedAt: endedAt, studySource: 'anki', studyTimeOrigin: 'timer' };
  }

  function ankiConnectSnapshot(day: AnkiDailyStudyTime, syncedAt: string): SessionSnapshot {
    const assessedCount = Object.values(state.topics).filter((item) => item.status !== 'unassessed').length;
    const mastery = Object.values(state.topics).reduce((sum, item) => sum + item.mastery, 0) / Math.max(1, assessedCount);
    const id = ankiTimeSessionId(day.date);
    const existing = sessions.find((session) => session.id === id);
    return {
      id,
      date: `${day.date}T12:00:00.000Z`,
      label: 'Anki Paediatrics-gap review time',
      questions: 0,
      averageMastery: Number(mastery.toFixed(2)),
      assessedTopics: assessedCount,
      createdAt: existing?.createdAt ?? syncedAt,
      mode: 'retention',
      planPass: 'review',
      durationSeconds: day.durationSeconds,
      studyStartedAt: day.firstReviewAt,
      studyEndedAt: day.lastReviewAt,
      studySource: 'anki',
      studyTimeOrigin: 'anki-connect',
      studyDay: day.date,
      ankiDeckName: currentAnkiSettings().deckName,
      ankiReviewCount: day.reviewCount,
      ankiDayStartHour,
      syncedAt
    };
  }

  async function completeActiveStudyTimer(syncAnki = false) {
    if (!state.activeStudyTimer || saving) return;
    const result = finishStudyTimer(state, new Date());
    const timer = result.timer!;
    const snapshot = isAnkiStudyTimer(timer)
      ? ankiTimedSnapshot(result.state, timer.startedAt, result.endedAt, result.durationSeconds, timer.topicIds, timer.gapIds)
      : timedSnapshot(result.state, timer.topicId, timer.startedAt, result.endedAt, result.durationSeconds);
    await persist(result.state, snapshot);
    notice = `${isAnkiStudyTimer(timer) ? 'Anki gap study' : timer.topicId} finished · ${formatStudyDuration(result.durationSeconds)} recorded.`;
    if (syncAnki && isAnkiStudyTimer(timer)) await syncAnkiProgress();
  }

  async function cancelActiveStudyTimer() {
    if (!uid || !state.activeStudyTimer || saving || ankiBusy) return;
    const timer = state.activeStudyTimer;
    saving = true; error = ''; notice = '';
    try {
      if (await discardActiveStudyTimer(uid, timer)) {
        notice = 'Timer cancelled. No study time saved; topic progress unchanged.';
      } else {
        error = 'The active timer changed. Please check it and try again.';
      }
    } catch (reason) { fail(reason); }
    finally { saving = false; }
  }

  async function beginTopicStudy(topicId: string) {
    if (!uid || saving) return;
    if (isTopicStudyTimer(state.activeStudyTimer) && state.activeStudyTimer.topicId === topicId) {
      if (state.activeStudyTimer.status === 'paused') await resumeTopicStudy();
      return;
    }
    const runningTimer = state.activeStudyTimer;
    if (runningTimer) {
      const current = isTopicStudyTimer(runningTimer) ? PAEDIATRICS_SYLLABUS.find((item) => item.id === runningTimer.topicId) : undefined;
      if (!confirm(`Finish the active ${current ? `${current.id} ` : 'Anki '}timer and start this topic?`)) return;
      await completeActiveStudyTimer();
    }
    const next = structuredClone(state); const now = new Date();
    next.activeStudyTimer = startStudyTimer(topicId, now); next.updatedAt = now.toISOString();
    await persist(next, undefined, true);
  }

  async function pauseTopicStudy() {
    if (!state.activeStudyTimer || state.activeStudyTimer.status !== 'running' || saving) return;
    const next = structuredClone(state); const now = new Date();
    next.activeStudyTimer = pauseStudyTimer(next.activeStudyTimer!, now); next.updatedAt = now.toISOString();
    await persist(next, undefined, true);
  }

  async function resumeTopicStudy() {
    if (!state.activeStudyTimer || state.activeStudyTimer.status !== 'paused' || saving) return;
    const next = structuredClone(state); const now = new Date();
    next.activeStudyTimer = resumeStudyTimer(next.activeStudyTimer!, now); next.updatedAt = now.toISOString();
    await persist(next, undefined, true);
  }

  async function completeTopicStudy() {
    if (!isTopicStudyTimer(state.activeStudyTimer)) return;
    await completeActiveStudyTimer();
  }

  async function saveManual() {
    if (!selected) return;
    const now = new Date().toISOString();
    const patch = validatePatch({ schemaVersion: 1, topics: [{ id: selected.id, mastery: state.topics[selected.id].oralAssessment ? state.topics[selected.id].mastery : editMastery, confidence: editConfidence, status: editStatus, notes: editNotes, lastReviewedAt: now, ...(newGap.trim() ? { addGaps: [{ text: newGap.trim(), priority: newGapPriority }] } : {}) }] });
    await persist(mergePatch(state, patch, now)); selected = null;
  }

  async function resolveGap(topicId: string, gapId: string) {
    const patch = validatePatch({ schemaVersion: 1, topics: [{ id: topicId, resolveGapIds: [gapId] }] });
    await persist(mergePatch(state, patch));
  }

  async function setGapPriority(topicId: string, gapId: string, priority: GapPriority) {
    const next = structuredClone(state);
    const gap = next.topics[topicId].gaps.find((item) => item.id === gapId);
    if (!gap) return;
    gap.priority = priority; next.updatedAt = new Date().toISOString();
    await persist(next, undefined, true);
  }

  async function recordReview(topicId: string, outcome: ReviewOutcome, source: 'manual' | 'assistant' = 'manual', reviewedAt = new Date().toISOString(), sourceSessionId?: string, notes?: string) {
    if (!uid) return;
    const event: PaediatricsReviewEvent = { id: crypto.randomUUID(), topicId, reviewedAt, outcome, pass: outcome==='studied'?'first':(nextTopicPass(planProgress?.topics[topicId])==='first'?'review':nextTopicPass(planProgress?.topics[topicId])), source, createdAt: new Date().toISOString(), ...(sourceSessionId ? { sourceSessionId } : {}), ...(notes ? { notes } : {}) };
    await savePaediatricsReview(uid, event);
    notice = `${topicId} review recorded as ${outcome}.`;
  }

  async function copyNextStudyPrompt() {
    if (!nextStudy) return;
    try {
      await navigator.clipboard.writeText(makeStudyChatPrompt(nextStudy, state, planProgress));
      await beginTopicStudy(nextStudy.topicId);
      notice = `${nextStudy.topicId} study prompt copied · timer started.`;
    }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  async function copyTopicStudyPrompt(topicId: string, requestedPass?: 'second') {
    const entry = reviewQueue.find((item) => item.topicId === topicId);
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(makeStudyChatPrompt(entry, state, planProgress, requestedPass));
      await beginTopicStudy(topicId);
      notice = `${topicId}${requestedPass ? ' Pass 1' : ''} study prompt copied · timer started.`;
    }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  async function copyGapRepairBatchPrompt() {
    if (!gapRepairBatch.length) return;
    try {
      await navigator.clipboard.writeText(makeGapRepairPrompt(gapRepairBatch, state, planProgress));
      await beginTopicStudy(gapRepairBatch[0].topicId);
      notice = `Gap-repair batch copied · timer started with ${gapRepairBatch[0].topicId}.`;
    }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  async function copyRapidGapRepairBatchPrompt() {
    if (!rapidGapRepairBatch.length) return;
    try {
      await navigator.clipboard.writeText(makeRapidGapRepairPrompt(rapidGapRepairBatch, state, planProgress));
      await beginTopicStudy(rapidGapRepairBatch[0].topicId);
      notice = `Rapid gap-repair batch copied · timer started with ${rapidGapRepairBatch[0].topicId}.`;
    }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  function rememberAnkiSettings() {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('trackr-paediatrics-anki-gap-deck', ankiDeckName.trim() || DEFAULT_ANKI_GAP_DECK);
    window.localStorage.setItem('trackr-paediatrics-anki-gap-model', ankiModelName.trim() || DEFAULT_ANKI_GAP_MODEL);
    ankiDayStartHour = normalizeAnkiDayStartHour(Number(ankiDayStartHour));
    window.localStorage.setItem('trackr-anki-day-start-hour', String(ankiDayStartHour));
    if (ankiApiKey.trim()) window.localStorage.setItem('trackr-anki-connect-key', ankiApiKey.trim());
    else window.localStorage.removeItem('trackr-anki-connect-key');
  }

  async function ensureAnkiConnection() {
    rememberAnkiSettings();
    await requestAnkiPermission(currentAnkiSettings());
    ankiConnected = true;
  }

  async function connectAnki() {
    if (ankiBusy) return;
    ankiBusy = true; error = '';
    try {
      await ensureAnkiConnection();
      notice = 'Anki Desktop connected. Trackr can now send cards and validate reviews.';
    } catch (reason) { ankiConnected = false; fail(reason); }
    finally { ankiBusy = false; }
  }

  async function copyAnkiGapCardPrompt() {
    if (!ankiGapSelection.length) return;
    try {
      ankiPromptSelection = structuredClone(ankiGapSelection);
      await navigator.clipboard.writeText(makeAnkiGapCardPrompt(ankiPromptSelection));
      notice = `Card prompt copied for ${ankiPromptSelection.length} gaps. Paste ChatGPT’s JSON back into “Import generated cards”.`;
    } catch { error = 'Clipboard access was unavailable.'; }
  }

  function openAnkiCardImport() {
    if (!ankiPromptSelection.length) ankiPromptSelection = structuredClone(ankiGapSelection);
    ankiCardJson = '';
    showAnkiImport = true;
  }

  async function importGeneratedAnkiCards() {
    if (!uid || !ankiCardJson.trim() || !ankiPromptSelection.length || saving) return;
    saving = true; error = '';
    try {
      const parsed = parsePatchInput(ankiCardJson);
      const payload = validateAnkiGapCardImport(parsed.value, ankiPromptSelection);
      const { unique, skipped } = removeDuplicateCardInputs(payload.cards, retentionCards);
      const created = unique.map((input) => createRetentionCard(input));
      if (created.length) await saveRetentionCards(uid, created);
      retentionCards = [...retentionCards, ...created];
      showAnkiImport = false; ankiCardJson = '';
      notice = `${created.length} gap ${created.length === 1 ? 'card' : 'cards'} saved in Trackr${skipped ? `; ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}${parsed.repaired ? '; trailing ]} repaired' : ''}. Send them to Anki when Anki Desktop is open.`;
    } catch (reason) { fail(reason); }
    finally { saving = false; }
  }

  async function sendCardsToAnki() {
    if (!uid || !linkedAnkiGapCards.length || ankiBusy) return;
    ankiBusy = true; error = '';
    try {
      await ensureAnkiConnection();
      const links = await sendGapCardsToAnki(currentAnkiSettings(), linkedAnkiGapCards, (topicId) => PAEDIATRICS_SYLLABUS.find((topic) => topic.id === topicId)?.title ?? topicId);
      const linkedAt = new Date().toISOString();
      const exportBatchId = `connect-${crypto.randomUUID()}`;
      const byId = new Map(links.map((link) => [link.cardId, link]));
      const updated = linkedAnkiGapCards.map((card) => {
        const link = byId.get(card.id);
        if (!link) return card;
        return { ...card, updatedAt: linkedAt, ankiExportedAt: card.ankiExportedAt ?? linkedAt, ankiExportBatchId: card.ankiExportBatchId ?? exportBatchId, anki: { ...card.anki, noteId: link.noteId, cardIds: link.cardIds, deckName: currentAnkiSettings().deckName, modelName: currentAnkiSettings().modelName, linkedAt: card.anki?.linkedAt ?? linkedAt } };
      });
      await saveRetentionCards(uid, updated);
      retentionCards = retentionCards.map((card) => updated.find((item) => item.id === card.id) ?? card);
      notice = `${links.length} linked gap ${links.length === 1 ? 'card is' : 'cards are'} present in Anki. Existing notes were reused.`;
    } catch (reason) { ankiConnected = false; fail(reason); }
    finally { ankiBusy = false; }
  }

  async function syncAnkiProgress() {
    if (!uid || !linkedAnkiGapCards.length || ankiBusy) return;
    ankiBusy = true; error = '';
    try {
      await ensureAnkiConnection();
      const syncedAt = new Date().toISOString();
      const [progress, importedTime] = await Promise.all([
        readAnkiGapProgress(currentAnkiSettings(), linkedAnkiGapCards),
        readAnkiStudyTime(currentAnkiSettings(), retentionCards, ankiDayStartHour, localTimeZone)
      ]);
      const syncStudyDay = ankiStudyDayKey(Date.now(), ankiDayStartHour, localTimeZone);
      const dailyTime = importedTime.some((day) => day.date === syncStudyDay)
        ? importedTime
        : [...importedTime, { date: syncStudyDay, durationSeconds: 0, reviewCount: 0, firstReviewAt: syncedAt, lastReviewAt: syncedAt }].sort((a, b) => a.date.localeCompare(b.date));
      const progressById = new Map(progress.map((item) => [item.trackrCardId, item]));
      const classifications = progress.flatMap((item) => {
        const card = linkedAnkiGapCards.find((candidate) => candidate.id === item.trackrCardId);
        return !item.missing && card?.gapId ? [{ topicId: card.topicId, gapId: card.gapId, classification: classifyAnkiGapProgress(item.reviews) }] : [];
      });
      const applied = applyAnkiGapClassifications(state, classifications, syncedAt);
      const updatedCards = linkedAnkiGapCards.map((card) => {
        const item = progressById.get(card.id);
        if (!item) return card;
        const classification = item.missing ? undefined : classifyAnkiGapProgress(item.reviews);
        const previousStatus = card.anki?.status;
        const status = item.missing ? 'missing' as const : classification!.status;
        const details = item.card;
        return {
          ...card,
          updatedAt: syncedAt,
          anki: {
            ...card.anki,
            ...(item.noteId !== undefined ? { noteId: item.noteId } : card.anki?.noteId !== undefined ? { noteId: card.anki.noteId } : {}),
            cardIds: item.cardIds,
            deckName: currentAnkiSettings().deckName,
            modelName: currentAnkiSettings().modelName,
            linkedAt: card.anki?.linkedAt ?? syncedAt,
            lastSyncedAt: syncedAt,
            status,
            reviewCount: item.reviews.filter((review) => review.type !== 4).length,
            strongRecallWindows: classification?.successfulWindowsAfterReset ?? 0,
            ...(classification?.latestReviewAt ? { lastReviewAt: classification.latestReviewAt } : {}),
            ...(classification?.latestRating ? { lastEase: classification.latestRating } : {}),
            ...(details ? { intervalDays: details.interval, repetitions: details.reps, lapses: details.lapses, cardType: details.type, queue: details.queue } : {}),
            ...(item.due !== undefined ? { due: item.due } : {}),
            ...(typeof details?.['prop:r'] === 'number' ? { retrievability: details['prop:r'] } : {}),
            ...(typeof details?.['prop:s'] === 'number' ? { stability: details['prop:s'] } : {}),
            ...(typeof details?.['prop:d'] === 'number' ? { difficulty: details['prop:d'] } : {}),
            ...(previousStatus !== status ? { lastStatusChangedAt: syncedAt } : {})
          }
        } as RetentionCard;
      });
      const ankiTimeSessions = dailyTime.map((day) => ankiConnectSnapshot(day, syncedAt));
      await Promise.all([savePaediatricsState(uid, applied.state), saveRetentionCards(uid, updatedCards), saveSessions(uid, ankiTimeSessions)]);
      state = applied.state;
      retentionCards = retentionCards.map((card) => updatedCards.find((item) => item.id === card.id) ?? card);
      const importedIds = new Set(ankiTimeSessions.map((session) => session.id));
      sessions = [...sessions.filter((session) => !importedIds.has(session.id)), ...ankiTimeSessions].sort((a, b) => a.date.localeCompare(b.date));
      const resolved = applied.changes.filter((change) => change.gapChange === 'resolved').length;
      const reopened = applied.changes.filter((change) => change.gapChange === 'reopened').length;
      const reviewed = progress.filter((item) => item.reviews.length > 0).length;
      const currentDayTime = dailyTime.find((day) => day.date === syncStudyDay)!;
      ankiLastSyncAt = syncedAt;
      ankiLastSyncSummary = `${reviewed} cards reviewed · ${resolved} stabilized · ${reopened} reopened · ${formatStudyDurationCompact(currentDayTime.durationSeconds)} across ${currentDayTime.reviewCount} answers today`;
      notice = `Anki progress validated: ${ankiLastSyncSummary}. Oral mastery and pass counters were not changed.`;
    } catch (reason) { ankiConnected = false; fail(reason); }
    finally { ankiBusy = false; }
  }

  async function finishAnkiStudy() {
    if (!isAnkiStudyTimer(state.activeStudyTimer)) return;
    await completeActiveStudyTimer(true);
  }

  function openNextStudy() {
    const topic = nextStudy ? PAEDIATRICS_SYLLABUS.find((item) => item.id === nextStudy.topicId) : undefined;
    if (topic) openTopic(topic);
  }

  async function logSimulation() {
    if (!uid) return;
    const topicIds = [...new Set(simulationTopics.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const invalid = topicIds.filter((id) => !PAEDIATRICS_SYLLABUS.some((topic) => topic.id === id));
    if (invalid.length) { error = `Unknown topic ID${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`; return; }
    const minutes = simulationMinutes.trim() ? Number(simulationMinutes) : undefined;
    if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)) { error = 'Simulation duration must be a positive number.'; return; }
    await savePaediatricsSimulation(uid, { id: crypto.randomUUID(), date: new Date().toISOString(), outcome: simulationOutcome, topicIds, ...(minutes !== undefined ? { durationMinutes: minutes } : {}), ...(simulationErrors.trim() ? { criticalErrors: simulationErrors.trim() } : {}), ...(simulationNotes.trim() ? { notes: simulationNotes.trim() } : {}), createdAt: new Date().toISOString() });
    simulationTopics = ''; simulationMinutes = ''; simulationErrors = ''; simulationNotes = ''; showSimulation = false; notice = 'Oral simulation recorded.';
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
      const parsed = parsePatchInput(patchText);
      const patch = validatePatch(parsed.value);
      const previous = state;
      let next = mergePatch(previous, patch);
      const patchTimer = next.activeStudyTimer;
      const timerMatchesPatch = isTopicStudyTimer(patchTimer) && (patch.topics ?? []).some((topic) => topic.id === patchTimer.topicId && (topic.plan?.firstPassComplete === true || topic.plan?.secondPassComplete === true || topic.plan?.thirdPassComplete === true || !!topic.review));
      const timerResult = timerMatchesPatch ? finishStudyTimer(next, new Date()) : undefined;
      if (timerResult) next = timerResult.state;
      let snapshot: SessionSnapshot | undefined;
      if (patch.session) snapshot = {
        id: crypto.randomUUID(), date: new Date(patch.session.date ?? Date.now()).toISOString(), label: patch.session.label?.trim() || 'Study session', questions: patch.session.questions,
        averageMastery: Number((Object.values(next.topics).reduce((sum, topic) => sum + topic.mastery, 0) / Math.max(1, Object.values(next.topics).filter((topic) => topic.status !== 'unassessed').length)).toFixed(2)),
        assessedTopics: Object.values(next.topics).filter((topic) => topic.status !== 'unassessed').length, createdAt: new Date().toISOString(), topicIds: (patch.topics ?? []).map((topic) => topic.id),
        ...(patch.session.mode !== undefined ? { mode: patch.session.mode } : {}),
        ...(patch.session.planPass !== undefined ? { planPass: patch.session.planPass } : {}),
        ...(timerResult?.timer && isTopicStudyTimer(timerResult.timer) ? { durationSeconds: timerResult.durationSeconds, studyStartedAt: timerResult.timer.startedAt, studyEndedAt: timerResult.endedAt, studySource: 'trackr' as const } : {})
      };
      else if (timerResult?.timer && isTopicStudyTimer(timerResult.timer)) snapshot = timedSnapshot(next, timerResult.timer.topicId, timerResult.timer.startedAt, timerResult.endedAt, timerResult.durationSeconds);
      const cardInputs = (patch.topics ?? []).flatMap((topic) => (topic.addCards ?? []).map((card) => ({ ...card, topicId: topic.id, sourceSessionId: snapshot?.id })));
      const { unique: uniqueCardInputs, skipped: skippedCards } = removeDuplicateCardInputs(cardInputs, retentionCards);
      const cards = uniqueCardInputs.map((card) => createRetentionCard(card));
      await persist(next, snapshot); if (uid) await recordPatchPlanProgress(uid, previous, next, patch, snapshot?.id); patchText = '';
      if (cards.length && uid) await saveRetentionCards(uid, cards);
      const importedReviews: PaediatricsReviewEvent[] = (patch.topics ?? []).filter((topic) => !!topic.review).map((topic) => ({ id: crypto.randomUUID(), topicId: topic.id, reviewedAt: topic.review!.reviewedAt ?? snapshot?.date ?? new Date().toISOString(), outcome: topic.review!.outcome, pass: topic.review!.pass, source: 'assistant', createdAt: new Date().toISOString(), ...(snapshot?.id ? { sourceSessionId: snapshot.id } : {}), ...(topic.review!.notes ? { notes: topic.review!.notes } : {}), ...(topic.review!.gapResults?.length ? { gapResults: topic.review!.gapResults } : {}), ...(topic.oralAssessment ? { oralAssessment: next.topics[topic.id].oralAssessment } : {}), ...(patch.session?.mode ? { mode: patch.session.mode } : {}) }));
      if (importedReviews.length && uid) await savePaediatricsReviews(uid, importedReviews);
      if (timerResult?.timer && isTopicStudyTimer(timerResult.timer)) notice = `${timerResult.timer.topicId} patch applied · ${formatStudyDuration(timerResult.durationSeconds)} recorded.`;
      else if (parsed.repaired) notice = 'Patch applied · trailing ]} repaired automatically.';
      else if (skippedCards) notice = `Patch applied · ${skippedCards} duplicate retention ${skippedCards === 1 ? 'card was' : 'cards were'} ignored.`;
    } catch (reason) { fail(reason); }
  }

  function parsePatchInput(input: string): { value: unknown; repaired: boolean } {
    const source = input.trim();
    try { return { value: JSON.parse(source), repaired: false }; }
    catch (originalError) {
      if (!source.endsWith(']}')) throw originalError;
      try { return { value: JSON.parse(source.slice(0, -2)), repaired: true }; }
      catch { throw originalError; }
    }
  }

  function handlePatchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    event.preventDefault();
    if (patchText.trim() && !saving) void applyJsonPatch();
  }

  function download(name: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }

  async function exportBackup() {
    if (!uid) return;
    try { download(`trackr-paediatrics-backup-${new Date().toISOString().slice(0, 10)}.json`, await readBackup(uid, state)); }
    catch (reason) { fail(reason); }
  }

  async function importBackup(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !uid) return;
    try {
      const backup = validateBackup(JSON.parse(await file.text()));
      if (!confirm('Replace your Paediatrics tracker state and session history with this backup?')) return;
      saving = true; await restoreBackup(uid, backup); notice = 'Backup restored.';
    } catch (reason) { fail(reason); }
    finally { saving = false; importInput.value = ''; }
  }

  async function copyLearningBrief() {
    try { await navigator.clipboard.writeText(makePaediatricsLearningBrief()); notice='Learning brief copied: full-topic study, secure propedeutics and gap tracking from Pass 1.'; }
    catch { error='Clipboard access was unavailable.'; }
  }
  async function copyAssessmentOnlyPrompt() {
    try { await navigator.clipboard.writeText(makePaediatricsAssessmentOnlyPrompt()); notice='Assessment-only prompt copied. Use the original study chat so it can assess your actual answers without logging the session again.'; }
    catch { error='Clipboard access was unavailable.'; }
  }
  async function copyGapOnlyPrompt() {
    try { await navigator.clipboard.writeText(makePaediatricsGapOnlyPrompt()); notice='Gap-only prompt copied. Use it in your existing study chat, then apply the returned patch once.'; }
    catch { error='Clipboard access was unavailable.'; }
  }
  async function copyImagingPrompt() {
    try { await navigator.clipboard.writeText(makePaediatricsImagingPrompt()); notice='Imaging prompt copied. Use it with a real teaching image in your study chat.'; }
    catch { error='Clipboard access was unavailable.'; }
  }
  async function copyContext() {
    const context = {
      schemaVersion: 1, subject: 'paediatrics', topicCount: PAEDIATRICS_SYLLABUS.length, resources: PAEDIATRICS_RESOURCES, syllabus: PAEDIATRICS_SYLLABUS.map(({id,title})=>({id,title})), examDate, updatedAt: state.updatedAt,
      learningBrief: makePaediatricsLearningBrief(), examFormat: PAEDIATRICS_EXAM_FORMAT,
      learningRounds: PASS_DETAILS, planProgress: planProgress?.topics ?? {},
      scale: 'oralAssessment: five domains 0-4, capped total /20; legacy mastery/confidence 0-4',
      topics: topicValues.filter(({ progress }) => progress.status !== 'unassessed' || progress.notes || progress.gaps.length || ankiReviews(progress).length).map(({ definition, progress }) => ({ id: definition.id, m: progress.mastery, c: progress.confidence, s: progress.status, a: progress.attempts, ok: progress.correct, reviewed: progress.lastReviewedAt, ...(progress.oralAssessment ? { oralAssessment: progress.oralAssessment, oralScore: oralSummary(progress).score } : {}), anki: ankiReviews(progress), notes: progress.notes || undefined, gaps: progress.gaps.map((gap) => ({ id: gap.id, text: gap.text, priority: gap.priority ?? 'normal', createdAt: gap.createdAt, ...(gap.resolvedAt ? { resolvedAt: gap.resolvedAt } : {}) })) })),
      recentSessions: sessions.slice(-10)
    };
    try { await navigator.clipboard.writeText(JSON.stringify(context)); notice = 'Compact progress copied for ChatGPT.'; }
    catch { error = 'Clipboard access was unavailable.'; }
  }

  async function copyUpdateSchema() {
    const examplePass = selected ? nextTopicPass(planProgress?.topics[selected.id]) : 'second';
    const acquisition = examplePass === 'first';
    const example = {
      schemaVersion: 1,
      topics: [{
        id: selected?.id ?? '1a', oralAssessment: { ratings: { coverage: 0, accuracy: 0, independence: 0, clinicalReasoning: 0, propedeutics: 0 }, safetyCriticalError: false, evidence: 'Replace every placeholder with actual pre-teaching evidence.' },
        attemptsDelta: 0, correctDelta: 0, notes: 'Concise cumulative knowledge-map note',
        ...(acquisition ? {} : {
          addGaps: [{ text: 'Specific demonstrated recall gap; replace with actual evidence', priority: 'important' }],
          resolveGapIds: ['existing-gap-id']
        }),
        review: {
          outcome: acquisition ? 'studied' : 'prompted', pass: examplePass,
          notes: 'Actual guided learning or independent recall evidence',
          ...(acquisition ? {} : { gapResults: [{ gapId: 'existing-gap-id', outcome: 'resolved', note: 'Later independent recall before teaching; replace with actual evidence' }] })
        },
        ...(examplePass === 'review' ? {} : { plan: { [`${examplePass}PassComplete`]: true } })
      }],
      session: { label: 'Short study-block label', questions: 0, mode: acquisition ? 'mixed' : 'oral', planPass: examplePass }
    };
    const schema = `TRACKR PAEDIATRICS UPDATE FORMAT (schemaVersion 1)

Return exactly one valid JSON object and no Markdown, commentary, or code fences. This is a field template, not actual performance data: omit unused fields and replace examples with real evidence. Use plan only after a completed whole-topic session, never for a narrow repair.

Allowed topic IDs only:
- 1a, 1b, 1c through 40a, 40b, 40c
- Every lettered subquestion is a separate topic (120 topics total).

Example stage: ${selected ? `${selected.id}: ${examplePass === 'review' ? 'ongoing review' : PASS_DETAILS[examplePass].label}` : 'Pass 1 (illustrative only; no topic selected)'}. Determine the actual stage separately for every topic from supplied planProgress. The overall plan phase must not override a topic that has already advanced to Pass 1 or later.

JSON shape:
${JSON.stringify(example, null, 2)}

Rules:
- Every completed full-topic Pass 0-or-later session must include oralAssessment: ratings for coverage, accuracy, independence, clinicalReasoning and propedeutics (each integer 0-4), safetyCriticalError (boolean) and evidence (up to 1500 characters). Score only the cold answer plus independently answered neutral follow-ups before teaching; exclude later correction, explanation and prompted repair. Trackr calculates /20 and its safety/independence limits. Omit the legacy mastery field. Do not extrapolate from narrow gap/card practice.
- Legacy mastery and confidence remain integers 0-4; they are not /20 scores.
- mastery: 0 unassessed, 1 fragile, 2 developing, 3 good, 4 exam-ready.
- status is exactly one of: unassessed, learning, review, solid.
- attemptsDelta and correctDelta are non-negative integers for THIS study block, not lifetime totals.
- correctDelta must not exceed attemptsDelta for the new block.
- lastReviewedAt and session.date must be valid ISO 8601 dates.
- Include only topics assessed or changed in this block.
- Omit unchanged optional fields. Never send null values.
- Pass 0: omit addGaps, resolveGapIds, review.gapResults and gap cards; describe learning difficulties only in the summary/review.notes.
- From Pass 1 onward: every final whole-topic recall patch must include addGaps with all new demonstrated gaps (text and priority; omit id), or [] when none. Record one precise, testable target per gap for later Anki, including both topic knowledge and propedeutics. Keep gaps found before teaching open after the explanation; avoid duplicates. Never replace structured gap fields with prose.
- gap priority is exactly critical, important, or normal. Critical means fail-critical or unsafe; important materially affects the exam answer; normal is a detail.
- resolveGapIds may contain only gap IDs present in the supplied Trackr progress context.
- addCards creates focused retention cards linked to the topic and optionally to a gap.
- Avoid duplicate cards and irrelevant fragments; a demonstrated gap in a basic term, examination finding or common example is important.
- notes should update the cumulative knowledge map without inventing performance.
- session.questions is the number of questions in this study block.
- session.mode is optional: oral, clinical-vignette, rapid-recall, classification, short-recall, multiple-choice, retention, or mixed.
- topic.plan is optional. It may explicitly set firstPassComplete, secondPassComplete or thirdPassComplete to true/false and may include the matching completion timestamp when true.
- A direct Pass 1 sets secondPassComplete only. Pass 0 then becomes unnecessary, but it was not performed: never add firstPassComplete merely because a later pass is complete.
- topic.review is optional and belongs on the final patch of a complete guided Pass 0 session, whole-topic recall review or targeted gap-repair session. Targeted gap repair uses pass:"review" and must never set plan completion flags. outcome is studied (guided Pass 0 only), failed, prompted, passed, or fluent; pass is first, second, third, or review. Stored first means Pass 0, second means Pass 1, and third means Pass 2.
- In Pass 1, Pass 2 and later reviews, review.gapResults records every tested existing open gap as resolved or unchanged (or [] if none were tested). Resolve only after a later independent uncued retest before teaching; immediate repetition, pass completion and card creation do not resolve gaps. Leave untested gaps unchanged. A resolved result must also be listed in resolveGapIds; an unchanged result must never be listed there.
- A normal single-question patch must not include review or plan. The final whole-topic patch may include review and the matching firstPassComplete, secondPassComplete or thirdPassComplete flag. Use the actual per-topic pass; the template is not evidence of completion or gap resolution.
- Review meaning: studied = full-topic guided acquisition with understanding checks, not independent mastery; failed = blackout/wrong direction/unsafe error; prompted = material help required; passed = independent pass-level answer; fluent = structured, stable, follow-up ready.
- No plan field means knowledge-map assessment only. Trackr never infers pass completion from attempts, mastery, session mode, or question count.
- Multiple-choice, retention, Anki and image-only activity never mark theory plan coverage. A completion flag requires full-topic work appropriate to its stage: guided acquisition and understanding checks for Pass 0; full-topic recall for Pass 1 or 2.
- Do not invent topic IDs or official topic titles.`;

    try {
      await navigator.clipboard.writeText(withPaediatricsStudyApproach(schema, 'brief'));
      notice = 'Update schema copied for your study chat.';
    } catch {
      error = 'Clipboard access was unavailable.';
    }
  }

  const masteryLabel = (value: number) => ['Unassessed', 'Fragile', 'Developing', 'Good', 'Exam-ready'][value];
</script>

<svelte:head><title>Paediatrics State Exam · Trackr</title></svelte:head>

<div class="study-shell">
  <header class="hero">
    <div><p class="eyebrow">PAEDIATRICS · STATE EXAM</p><h1>Knowledge map</h1><p class="subtitle">40 tickets · 120 topics · Each a, b and c counts separately.</p></div>
    <div class="hero-actions"><div class="action-stack"><button class="review-link compact desktop-study-control" aria-label="Open Paediatrics study plan" title="Study plan" on:click={() => goto('/study/plan')}><span class="review-icon">◎</span><span class="review-copy"><strong>Study plan</strong><small>{currentPhase?.name ?? 'Set up your plan'}</small></span></button><button class="review-link compact" aria-label={`${dueRetentionCount} retention cards due`} title="Review retention cards" on:click={() => goto('/study/review')}><span class="review-icon">↻</span><span class="review-copy"><strong>Retention</strong><small>{dueRetentionCount ? `${dueRetentionCount} due now` : 'Up to date'}</small></span>{#if dueRetentionCount}<b class="due-badge">{dueRetentionCount > 99 ? '99+' : dueRetentionCount}</b>{/if}</button></div><div class="exam"><strong>{daysRemaining ?? '—'}</strong>{#if examDate}<span>days to {new Date(examDate+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>{:else}<button class="back" on:click={() => goto('/study/plan')}>Set exam date</button>{/if}</div></div>
  </header>

  <details class="study-approach">
    <summary>Study focus · Pass 0 → Pass 1 → Pass 2</summary>
    <p>Pass 0: learn and understand with your iBook and Notes, without recording gaps yet. From Pass 1: recall the full topic and record specific gaps for Anki and focused review. Pass 2 and later: keep adding, retesting and managing gaps. Keep propedeutics secure throughout, with delayed reviews and regular imaging alongside all three rounds.</p>
    <div class="actions"><button on:click={copyLearningBrief}>Copy learning brief</button><button on:click={copyImagingPrompt}>Copy imaging prompt</button><a href={PAEDIATRICS_EXAM_REQUIREMENTS_URL} target="_blank" rel="noreferrer">Official exam requirements ↗</a></div>
  </details>

  {#if error}<div class="message error" role="alert">{error}<button on:click={() => error = ''}>Dismiss</button></div>{/if}
  {#if notice}<div class="message success" role="status">{notice}<button on:click={() => notice = ''}>Dismiss</button></div>{/if}
  {#if loading}<div class="state-card"><span class="spinner"></span>Loading your Paediatrics tracker…</div>
  {:else if !uid}<div class="state-card">Sign in to load and save your Paediatrics tracker.</div>
  {:else}
    <section class="metrics">
      <article><span>Oral mastery</span><strong>{averageOral === undefined ? '—' : averageOral.toFixed(1)}<small>/20</small></strong><small>{oralAssessedTopics.length}/120 topics scored</small></article>
      <article class="mastery-metric">
        <div class="mastery-ring" style={`background:${masteryGradient}`} aria-label="Oral mastery distribution"><i><b>{averageOral === undefined ? '—' : averageOral.toFixed(1)}</b><small>/20 avg</small></i></div>
        <div class="mastery-summary"><span>Oral mastery</span><div>{#each masteryDistribution.filter((item) => item.count > 0) as item}<small><i style={`background:${item.color}`}></i><b>{item.label}</b> {item.count}</small>{/each}</div></div>
      </article>
      <article><span>Open gaps</span><strong>{openGaps}</strong></article>
      <article class="time-metric"><span>Studied today</span><strong>{formatStudyDurationCompact(studySecondsToday)}</strong><small>{formatStudyDurationCompact(studySecondsLast7Days)} in 7 days{ankiStudySecondsToday ? ` · ${formatStudyDurationCompact(ankiStudySecondsToday)} Anki today` : ''}</small></article>
      <article class="forecast-metric">
        <div class="forecast-metric-head"><span>{PASS_DETAILS[activePass].label} forecast</span><strong class:late={projectionLate}>{planProjection?.date ? new Date(`${planProjection.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</strong></div>
        {#if planProjection && planConfig}
          <svg viewBox="0 0 240 66" role="img" aria-label={`Target ${roundDeadline}; projected finish ${planProjection.date}`}>
            <line class="forecast-axis" x1="10" y1="58" x2="230" y2="58"></line>
            <line class="target-path" x1="10" y1={forecastStartY} x2={forecastTargetX} y2="8"></line>
            <line class:late={projectionLate} class="projection-path" x1="10" y1={forecastStartY} x2={forecastProjectionX} y2="8"></line>
            <circle class="start-dot" cx="10" cy={forecastStartY} r="3"></circle>
            <circle class="target-dot" cx={forecastTargetX} cy="8" r="3"></circle>
            <circle class:late={projectionLate} class="projection-dot" cx={forecastProjectionX} cy="8" r="4"></circle>
          </svg>
          <div class="forecast-key"><span><i class="target-key"></i>Target {roundDeadline}</span><span><i class:late={projectionLate} class="projection-key"></i>{planProjection.pace.toFixed(1)}/active day</span></div>
        {:else}<small>Not enough recent data</small>{/if}
      </article>
    </section>

    {#if planConfig && planProgress}
      <button class="plan-strip desktop-study-control" on:click={() => goto('/study/plan')} aria-label="Open detailed Paediatrics study plan">
        <div class="plan-status"><span>{currentPhase?.name ?? (today === planConfig.examDate ? 'Exam day' : 'Study plan')}</span><strong class:ahead={planPacing?.status === 'ahead'} class:behind={planPacing?.status === 'behind'}>{!examDate ? 'Ready to begin' : planPacing?.status === 'ahead' ? 'Ahead' : planPacing?.status === 'behind' ? 'Behind' : currentPhase?.type === 'buffer' ? 'Buffer mode' : 'On track'}</strong><small>{!examDate ? 'Set an exam date for daily targets' : planPacing?.status === 'ahead' ? `${planPacing.difference} topics ahead` : planPacing?.status === 'behind' ? `${planPacing.difference} topics behind` : currentPhase?.type === 'buffer' ? 'Focus on red zones and exam skills' : `${planPacing?.todayRemaining ?? 0} remaining today`}</small></div>
        <div class="plan-progress"><div><span>{activePassCoverageLabel}</span><b>{planCovered}<small>/120</small></b></div><i><b style={`width:${planCovered / 120 * 100}%`}></b></i><small>{Math.round(planCovered / 120 * 100)}% covered</small></div>
        <div class="plan-today"><span>{`${activePassCoverageLabel} today`}</span><div class="plan-today-main"><i class="daily-ring" style={`--daily-progress:${planPacing?.todayQuota ? Math.min(100, (planPacing.todayActual / planPacing.todayQuota) * 100) : 0}%`} title={`${planPacing?.todayActual ?? 0} of ${planPacing?.todayQuota ?? 0} covered today`} aria-hidden="true"></i><strong>{planPacing?.todayActual ?? 0}<small> / {planPacing?.todayQuota ?? 0}</small></strong></div><small>{assessedTopicsToday} topics assessed</small></div>
        <div class="plan-forecast"><span>Target finish</span><strong>{roundDeadline ? new Date(roundDeadline+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : 'Set exam date'}</strong><small>{roundDeadline ? 'Current round deadline' : 'Daily pacing starts after setup'}</small></div>
        <span class="plan-arrow">›</span>
      </button>
    {:else}
      <button class="plan-strip plan-empty desktop-study-control" on:click={() => goto('/study/plan')}><div><span>STUDY PLAN</span><strong>Set up daily pacing</strong><small>Use your existing assessed topics as the starting baseline.</small></div><span class="plan-arrow">›</span></button>
    {/if}

    <section class="review-control">
        <div class="study-mode-tabs" role="tablist" aria-label="Study mode">
          <button class:active={studyMode === 'screen'} on:click={() => selectStudyMode('screen')}>{currentPhase?.type==='buffer'?'Ongoing review':`${PASS_DETAILS[activePass].label} & retest`}</button>
          <button class:active={studyMode === 'gap-repair'} on:click={() => selectStudyMode('gap-repair')}>Gap repair <span>{openGaps}</span></button>
          <button class:active={studyMode === 'rapid-gap-repair'} on:click={() => selectStudyMode('rapid-gap-repair')}>Rapid gap repair <span>{openGaps}</span></button>
          <button class:active={studyMode === 'anki-gap'} on:click={() => selectStudyMode('anki-gap')}>Anki gaps <span>{openGaps}</span></button>
        </div>
        {#if studyMode === 'screen' && nextStudy}
          <div class="review-next">
            <div class="screen-heading"><p class="eyebrow">NEXT STUDY STEP</p></div>
            <div class="next-title"><span class={`queue-kind ${nextStudy.kind}`}>{nextStudy.nextPass==='review'?'Review':PASS_DETAILS[nextStudy.nextPass].label}</span><strong>{nextStudy.topicId} · {nextStudy.title}</strong></div>
            <p>{nextStudy.reasons.slice(0, 4).join(' · ')}</p>
            <div class="actions"><button class="primary" on:click={copyNextStudyPrompt}>Copy study prompt</button><button on:click={openNextStudy}>Open topic</button></div>
            {#if currentPhase?.type!=='buffer' && dueRetests.length}<p>Due retests stay tracked. Use Gap repair or Rapid gap repair for short targeted practice alongside {PASS_DETAILS[activePass].label}.</p>{/if}
            <div class="queue-options"><span>QUEUE OPTIONS</span><label class="queue-toggle"><span><b>Ignore retests</b><small>Unfinished {PASS_DETAILS[activePass].label} only</small></span><input type="checkbox" checked={ignoreRetests} on:change={(event) => setIgnoreRetests(event.currentTarget.checked)} /><i aria-hidden="true"></i></label><label class="queue-toggle"><span><b>Random order</b><small>Within equal priority only</small></span><input type="checkbox" checked={randomizeEqualPriority} on:change={(event) => setRandomOrder(event.currentTarget.checked)} /><i aria-hidden="true"></i></label></div>
          </div>
          <div class="review-overview">
            <article><span>{activePassCoverageLabel}</span><strong>{planProgress ? passCount(planProgress, activePass) : 0}<small>/120</small></strong></article>
            <article><span>Due retests</span><strong>{dueRetests.length}</strong></article>
            <article><span>Reviews today</span><strong>{reviewsToday.total}</strong><small>{reviewsToday.studied} learned · {reviewsToday.failed} failed · {reviewsToday.prompted} prompted</small></article>
            <article><span>Simulations</span><strong>{simulations.length}</strong></article>
          </div>
          <div class="queue-preview">
            <div class="queue-head"><strong>Up next</strong><small>{currentPhase?.type==='buffer' ? 'Weakest and due topics first' : `${PASS_DETAILS[activePass].label} coverage first · later retests follow`}</small></div>
            {#each screeningQueue.slice(0, 5) as entry, index}
              <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === entry.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{entry.topicId}</strong><small>{entry.title}</small></span><em class={entry.kind}>{entry.kind}</em></button>
            {/each}
          </div>
        {:else if studyMode === 'screen'}
          <div class="review-next"><div class="screen-heading"><p class="eyebrow">NEXT STUDY STEP</p></div><div class="empty compact-empty">All {PASS_DETAILS[activePass].label} topics are complete. Turn off “Ignore retests” to continue with targeted later reviews.</div><div class="queue-options"><span>QUEUE OPTIONS</span><label class="queue-toggle"><span><b>Ignore retests</b><small>Unfinished {PASS_DETAILS[activePass].label} only</small></span><input type="checkbox" checked={ignoreRetests} on:change={(event) => setIgnoreRetests(event.currentTarget.checked)} /><i aria-hidden="true"></i></label><label class="queue-toggle"><span><b>Random order</b><small>Within equal priority only</small></span><input type="checkbox" checked={randomizeEqualPriority} on:change={(event) => setRandomOrder(event.currentTarget.checked)} /><i aria-hidden="true"></i></label></div></div>
        {:else if studyMode === 'gap-repair'}
          <div class="review-next gap-repair-next">
            <div class="gap-repair-heading"><div><p class="eyebrow">NEXT GAP-REPAIR BATCH</p><h3>{gapRepairBatch.length} topics · {gapRepairBatchGapCount} gaps</h3></div><label>Batch size<select bind:value={gapBatchSize}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label></div>
            {#if gapRepairBatch.length}
              <div class="gap-batch-list">
                {#each gapRepairBatch as entry, index}
                  <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === entry.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{entry.topicId} · {entry.title}</strong><small>{entry.openGaps.length} gaps · {oralSummary(state.topics[entry.topicId]).label} · {entry.recallAgeDays === undefined ? 'no dated recall' : `${entry.recallAgeDays}d since recall`}</small></span></button>
                {/each}
              </div>
              <p>Cold-retrieve each gap, then 1–2 non-leading adjacent safety checks. Unrecalled gaps stay open.</p>
              <div class="actions"><button class="primary" on:click={copyGapRepairBatchPrompt}>Copy gap-repair prompt</button><button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === gapRepairBatch[0]?.topicId); if (topic) openTopic(topic); }}>Open first topic</button></div>
            {:else if gapCooldown.coolingDownCount}<div class="empty compact-empty">No gaps are ready yet. {gapCooldown.coolingDownCount} {gapCooldown.coolingDownCount === 1 ? 'gap is' : 'gaps are'} cooling down · {nextGapReadyIn}.</div>
            {:else}<div class="empty compact-empty">No open gaps. The current gap-repair queue is complete.</div>{/if}
          </div>
          <div class="review-overview gap-overview">
            <article><span>Open gaps</span><strong>{openGaps}</strong></article>
            <article><span>Ready now</span><strong>{gapCooldown.readyCount}</strong><small>{criticalOpenGaps} critical</small></article>
            <article><span>Cooling down</span><strong>{gapCooldown.coolingDownCount}</strong><small>{nextGapReadyIn}</small></article>
            <article><span>Resolved today</span><strong>{resolvedGapsToday}</strong></article>
          </div>
          <div class="queue-preview">
            <div class="queue-head"><strong>Gap priority</strong><small>Ready ≥2h · critical · weakest · oldest recall</small></div>
            {#each gapRepairQueue.slice(0, 5) as entry, index}
              <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === entry.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{entry.topicId}</strong><small>{entry.title}</small></span><em class:critical={entry.criticalGapCount > 0} class="gap-count">{entry.openGaps.length} gaps</em></button>
            {/each}
          </div>
        {:else if studyMode === 'rapid-gap-repair'}
          <div class="review-next gap-repair-next rapid-gap-next">
            <div class="gap-repair-heading"><div><p class="eyebrow">NEXT RAPID GAP BATCH</p><h3>{rapidGapRepairBatchGapCount} targeted gaps · {rapidGapRepairBatch.length} topics</h3></div><label>Gap target<select bind:value={rapidGapTarget}><option value={6}>6</option><option value={8}>8</option><option value={10}>10</option><option value={12}>12</option></select></label></div>
            {#if rapidGapRepairBatch.length}
              <div class="gap-batch-list rapid-gap-list">
                {#each rapidGapRepairBatch as entry, index}
                  <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === entry.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{entry.topicId} · {entry.title}</strong><small>{entry.openGaps.length} selected of {activeGaps(state.topics[entry.topicId]).length} open · {oralSummary(state.topics[entry.topicId]).label}</small></span></button>
                {/each}
              </div>
              <p>1–3 focused examiner questions per selected gap when needed. No whole-topic cold screen; unrecalled gaps stay open for a delayed retest.</p>
              <div class="actions"><button class="primary" on:click={copyRapidGapRepairBatchPrompt}>Copy rapid prompt</button><button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === rapidGapRepairBatch[0]?.topicId); if (topic) openTopic(topic); }}>Open first topic</button></div>
            {:else if gapCooldown.coolingDownCount}<div class="empty compact-empty">No gaps are ready yet. {gapCooldown.coolingDownCount} {gapCooldown.coolingDownCount === 1 ? 'gap is' : 'gaps are'} cooling down · {nextGapReadyIn}.</div>
            {:else}<div class="empty compact-empty">No open gaps. The current rapid gap-repair queue is complete.</div>{/if}
          </div>
          <div class="review-overview gap-overview">
            <article><span>Open gaps</span><strong>{openGaps}</strong></article>
            <article><span>Ready now</span><strong>{gapCooldown.readyCount}</strong><small>{rapidGapRepairBatchGapCount} selected</small></article>
            <article><span>Cooling down</span><strong>{gapCooldown.coolingDownCount}</strong><small>{nextGapReadyIn}</small></article>
            <article><span>Resolved today</span><strong>{resolvedGapsToday}</strong></article>
          </div>
          <div class="queue-preview">
            <div class="queue-head"><strong>Rapid batch</strong><small>Ready ≥2h · up to 2 gaps per topic</small></div>
            {#each rapidGapRepairBatch as entry, index}
              <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === entry.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{entry.topicId}</strong><small>{entry.title}</small></span><em class:critical={entry.criticalGapCount > 0} class="gap-count">{entry.openGaps.length} selected</em></button>
            {/each}
          </div>
        {:else if studyMode === 'anki-gap'}
          <div class="review-next anki-prepare">
            <div class="gap-repair-heading"><div><p class="eyebrow">NEXT ANKI CARD BATCH</p><h3>{ankiGapSelection.length} gaps · {new Set(ankiGapSelection.map((gap) => gap.topicId)).size} topics</h3></div><label>Batch<select bind:value={ankiBatchSize}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label></div>
            {#if ankiGapSelection.length}
              <div class="gap-batch-list anki-gap-list">
                {#each ankiGapSelection.slice(0, 4) as gap, index}
                  <button on:click={() => { const topic = PAEDIATRICS_SYLLABUS.find((item) => item.id === gap.topicId); if (topic) openTopic(topic); }}><b>{index + 1}</b><span><strong>{gap.topicId} · {gap.topicTitle}</strong><small>{gap.priority ?? 'normal'} · {gap.gapText}</small></span></button>
                {/each}
              </div>
              {#if ankiGapSelection.length > 4}<p>+ {ankiGapSelection.length - 4} more prioritized gaps in this exact batch.</p>{/if}
              <div class="actions"><button class="primary" on:click={copyAnkiGapCardPrompt}>Copy card prompt</button><button on:click={openAnkiCardImport}>Import generated cards</button></div>
            {:else}<div class="empty compact-empty">{readyUnlinkedAnkiGaps ? 'Choose a larger batch.' : 'Every currently ready open gap already has a linked Trackr card.'}</div>{/if}
          </div>
          <div class="review-overview anki-overview">
            <article><span>Open gaps</span><strong>{openGaps}</strong><small>{readyUnlinkedAnkiGaps} ready without card</small></article>
            <article><span>Gap cards</span><strong>{linkedAnkiGapCards.length}</strong><small>{ankiStats.total} linked · {ankiMissingCards} missing</small></article>
            <article><span>Learning</span><strong>{ankiLearningCards}</strong><small>Needs another independent recall</small></article>
            <article><span>Stable / fragile</span><strong>{ankiStableCards}<small> / {ankiFragileCards}</small></strong><small>Stable closes; Again reopens</small></article>
          </div>
          <div class="anki-connect-panel">
            <div class="anki-connection-head"><div><strong>Anki Desktop</strong><small>{ankiConnected ? 'Connected locally' : 'Connect on this Mac'}</small></div><i class:connected={ankiConnected}></i></div>
            <p>Trackr validates gap-card history and imports Anki’s recorded review time. It never changes oral mastery or pass completion.</p>
            <div class="anki-settings"><label>Deck<input bind:value={ankiDeckName} on:change={rememberAnkiSettings} /></label><details><summary>Connection settings</summary><label>Note type<input bind:value={ankiModelName} on:change={rememberAnkiSettings} /></label><label>Anki day starts at<input type="number" min="0" max="23" step="1" bind:value={ankiDayStartHour} on:change={rememberAnkiSettings} /></label><label>API key (only if enabled)<input type="password" autocomplete="off" bind:value={ankiApiKey} on:change={rememberAnkiSettings} /></label><small>Default 04:00 · match Anki Preferences. AnkiConnect add-on code: 2055492159</small></details></div>
            {#if ankiLastSyncAt || storedAnkiSyncAt}<div class="anki-sync-result"><span>Last validation {new Date(ankiLastSyncAt || storedAnkiSyncAt).toLocaleString()}</span>{#if ankiLastSyncSummary}<small>{ankiLastSyncSummary}</small>{/if}</div>{/if}
            <div class="actions anki-actions"><button disabled={ankiBusy} on:click={connectAnki}>{ankiConnected ? 'Reconnect' : 'Connect Anki'}</button><button disabled={ankiBusy || !linkedAnkiGapCards.length} on:click={sendCardsToAnki}>Send / reconcile cards</button><button disabled={ankiBusy || !linkedAnkiGapCards.length} on:click={syncAnkiProgress}>Validate progress & time</button></div>
            <div class="anki-timer-action">{#if activeTimerIsAnki}<div><span>{activeTimer?.status === 'paused' ? 'Legacy Anki timer paused' : 'Legacy Anki timer running'}</span><strong>{formatStudyDuration(activeTimerSeconds)}</strong></div><button class="primary" disabled={saving || ankiBusy} on:click={finishAnkiStudy}>Finish & validate</button><button disabled={saving || ankiBusy} title="Discard this session without saving study time" on:click={cancelActiveStudyTimer}>Cancel</button>{:else}<div><span>Anki review time</span><small>Refreshed on validation from graded-card time; the same Anki day is overwritten, never added twice.</small></div><strong>{formatStudyDurationCompact(ankiStudySecondsToday)} today</strong>{/if}</div>
          </div>
          <AnkiStatsPanel stats={ankiStats} lastValidatedAt={ankiLastSyncAt || storedAnkiSyncAt} />
        {/if}
      </section>

    <section class="blocks">
      {#each PAEDIATRICS_BLOCKS as block}
        {@const stats = blockStats(block.id, planProgress)}
        {@const passValue = planProgress ? blockPassCount(block.id,activePass) : stats.assessed}
        <button class:active={blockFilter === block.id} title={`${PASS_DETAILS[activePass].label}: ${passValue}/${stats.total} complete`} on:click={() => blockFilter = blockFilter === block.id ? 'all' : block.id}>
          <span>{block.label}</span><strong>{passValue}/{stats.total}</strong>
          <i><b style={`width:${stats.total ? passValue / stats.total * 100 : 0}%`}></b></i><small>{planProgress ? `${PASS_DETAILS[activePass].label} · ` : ''}{stats.oralAverage === undefined ? '—' : stats.oralAverage.toFixed(1)}/20 oral</small>
        </button>
      {/each}
    </section>

    <div class="main-grid">
      <section class="panel wide desktop-study-control">
        <div class="panel-head"><div><p class="eyebrow">KNOWLEDGE MAP</p><h2>120 topics</h2></div><div class="map-legends"><div class="legend mastery-legend"><b>Oral mastery /20</b>{#each ORAL_BANDS as band}<span><i style={`background:${band.color}`}></i>{band.range} {band.label}</span>{/each}</div>{#if planProgress}<div class="legend coverage-legend"><b>{PASS_DETAILS[activePass].label}</b><span><i class="coverage-needed"></i>Needed</span><span><i class="coverage-done">✓</i>Completed</span>{#if activePass === 'first'}<span><i class="coverage-superseded">P1</i>Not required</span>{/if}<span><i class="gap-key"></i>Open gap</span></div><div class="legend review-legend"><b>Last recall</b><span><i class="review-failed"></i>Failed</span><span><i class="review-prompted"></i>Prompted</span><span><i class="review-passed"></i>Passed</span><span><i class="review-fluent"></i>Fluent</span></div>{/if}</div></div>
        <p class="map-assessment-note">{activePass === 'first' ? 'Pale tiles still need Pass 0; solid grey tiles completed it. P1 means Pass 1 made Pass 0 unnecessary without recording it as completed. ' : ''}Tile numbers show oral assessment, ticks show actual round completion, and dots show the last recall result. A dash means no oral score; older ratings remain labelled /4.</p>
        {#if missingOralAssessments.length}<p class="map-assessment-note">{missingOralAssessments.length} topic(s) have logged recall without a detailed oral assessment. <button on:click={() => statusFilter = 'missing-oral'}>Show topics</button> <button on:click={copyAssessmentOnlyPrompt}>Copy assessment-only prompt</button></p>{/if}
        <div class="heatmap" aria-label="Topic mastery heatmap">
          {#each PAEDIATRICS_SYLLABUS as topic}
            {@const passDone = !!planProgress?.topics[topic.id]?.[passCompletionKey(activePass)]}
            {@const passSuperseded = activePass === 'first' && !passDone && acquisitionCoveredByRecall(planProgress?.topics[topic.id])}
            {@const passSatisfied = passDone || passSuperseded}
            <button style={`--oral-color:${oralSummary(state.topics[topic.id]).band.color}`} class={`mastery-${state.topics[topic.id].mastery}`} class:has-gap={activeGaps(state.topics[topic.id]).length > 0} class:needs-first-pass={!!planProgress && !passSatisfied} class:first-pass-complete={!!planProgress && passDone} class:pass-zero-superseded={passSuperseded} class:pass-zero-pending={activePass === 'first' && !passSatisfied && !state.topics[topic.id].oralAssessment} class:pass-zero-covered={activePass === 'first' && passDone && !state.topics[topic.id].oralAssessment} title={`${topic.id}: ${oralSummary(state.topics[topic.id]).label} · ${PASS_DETAILS[activePass].label} ${passDone ? 'completed' : passSuperseded ? 'not required after Pass 1' : 'needed'} · ${latestReviewByTopic[topic.id]?.outcome ?? 'no structured recall result'} · ${activeGaps(state.topics[topic.id]).length} open gaps`} on:click={() => openTopic(topic)}><span>{topic.id}</span><small class="map-oral-score">{oralSummary(state.topics[topic.id]).short}</small>{#if latestReviewByTopic[topic.id]}<span class={`review-badge ${latestReviewByTopic[topic.id].outcome}`}></span>{/if}</button>
          {/each}
        </div>
      </section>

      <section class="panel"><div class="panel-head"><div><p class="eyebrow">TRAJECTORY</p><h2>Progress over time</h2></div></div>{#if sessions.length || planProgress}<PaediatricsProgressChart {sessions} {planProgress} {reviewEvents} />{:else}<div class="empty">A chart appears after your first study-plan completion.</div>{/if}</section>

      <section class="panel mobile-readonly-panel"><div class="panel-head"><div><p class="eyebrow danger-text">PRIORITY</p><h2>Red zones</h2></div><span class="count">{redZones.length}</span></div>
        {#if redZones.length}<div class="red-list">{#each redZones.slice(0, 8) as item}<button on:click={() => openTopic(item.definition)}><span>{item.definition.id}<small>{activeGaps(item.progress).length} gaps · {oralSummary(item.progress).label}</small></span><b>Review</b></button>{/each}</div>{:else}<div class="empty">No weak areas or open gaps yet.</div>{/if}
      </section>

      <section class="panel wide import-panel"><div class="panel-head"><div><p class="eyebrow">CHATGPT SYNC</p><h2>Apply tracker update</h2><p>Paste a schema v1 JSON patch. Existing fields are changed only when explicitly included.</p></div></div>
        <textarea bind:value={patchText} on:keydown={handlePatchKeydown} placeholder="Paste the JSON update from your study chat. Use a gap-only or assessment-only patch to supplement a session already logged."></textarea>
        <small class="patch-shortcut">Enter to validate and apply · Shift+Enter for a new line</small>
        <div class="actions"><button class="primary mobile-patch-apply" disabled={!patchText.trim() || saving} on:click={applyJsonPatch}>{saving ? 'Saving…' : 'Validate & apply patch'}</button><button class="patch-admin-control" on:click={copyUpdateSchema}>Copy update schema</button><button class="patch-admin-control" on:click={copyGapOnlyPrompt}>Copy gap-only prompt</button><button class="patch-admin-control" on:click={copyAssessmentOnlyPrompt}>Copy assessment-only prompt</button><button class="patch-admin-control" on:click={copyContext}>Copy progress for ChatGPT</button><button class="patch-admin-control" on:click={exportBackup}>Export full backup</button><button class="patch-admin-control" on:click={() => importInput.click()}>Import backup</button><input class="hidden patch-admin-control" bind:this={importInput} type="file" accept="application/json,.json" on:change={importBackup} /></div>
      </section>

      <section class="panel wide topics-panel"><div class="panel-head"><div><p class="eyebrow">DETAILS</p><h2>Topic directory</h2></div><span>{filtered.length} shown</span></div>
        <div class="filters"><input bind:value={search} placeholder="Search ID, notes or title" /><select bind:value={blockFilter}><option value="all">All blocks</option>{#each PAEDIATRICS_BLOCKS as block}<option value={block.id}>{block.id}</option>{/each}</select><select bind:value={statusFilter}><option value="all">All statuses</option><option value="weak-oral">Weak oral topics</option><option value="missing-oral">Missing oral assessment</option><option value="needs-second-pass">Needs Pass 1</option><option value="second-pass-complete">Pass 1 complete</option><option value="needs-third-pass">Needs Pass 2</option><option value="third-pass-complete">Pass 2 complete</option><option value="retest-due">Retest due</option><option value="anki-done">Anki done</option><option value="needs-first-pass">Needs Pass 0</option><option value="first-pass-complete">Pass 0 completed</option><option value="first-pass-superseded">Pass 0 not required</option><option value="unassessed">Unassessed</option><option value="learning">Learning</option><option value="review">Review</option><option value="solid">Exam-ready</option></select></div>
        <div class="topic-list">{#each filtered as item}{@const directoryPassDone = !!planProgress?.topics[item.definition.id]?.[passCompletionKey(activePass)]}{@const directoryPassSuperseded = activePass === 'first' && !directoryPassDone && acquisitionCoveredByRecall(planProgress?.topics[item.definition.id])}<button on:click={() => openTopic(item.definition)}><span class="dot" style={`background:${oralSummary(item.progress).band.color}`}></span><span class="topic-copy"><strong>{item.definition.id}</strong><small>{item.definition.title}</small></span><span class="topic-meta">{oralSummary(item.progress).label}<em class:pass-done={directoryPassDone || directoryPassSuperseded}>{PASS_DETAILS[activePass].label} {directoryPassDone ? 'done' : directoryPassSuperseded ? 'not required' : 'needed'}</em>{#if activeGaps(item.progress).length}<b>{activeGaps(item.progress).length} gaps</b>{/if}</span></button>{/each}</div>
      </section>
    </div>
  {/if}
</div>

{#if activeTimer}
  <aside class="floating-timer" class:paused={activeTimer.status === 'paused'} aria-live="polite">
    {#if activeTimerTopic && isTopicStudyTimer(activeTimer)}<button class="timer-topic" on:click={() => openTopic(activeTimerTopic!)}><i></i><span><small>{activeTimer.status === 'paused' ? 'PAUSED' : 'STUDYING'}</small><strong>{activeTimer.topicId} · {activeTimerTopic.title}</strong></span></button>{:else}<div class="timer-topic anki-timer-topic"><i></i><span><small>{activeTimer.status === 'paused' ? 'ANKI PAUSED' : 'ANKI STUDY'}</small><strong>Paediatrics gap cards</strong></span></div>{/if}
    <b>{formatStudyDuration(activeTimerSeconds)}</b>
    <div>{#if activeTimer.status === 'running'}<button disabled={saving} on:click={pauseTopicStudy}>Pause</button>{:else}<button disabled={saving} on:click={resumeTopicStudy}>Resume</button>{/if}<button disabled={saving || ankiBusy} on:click={() => activeTimerIsAnki ? finishAnkiStudy() : completeTopicStudy()}>{activeTimerIsAnki ? 'Finish & validate' : 'Finish'}</button><button disabled={saving || ankiBusy} title="Discard this session without saving study time" on:click={cancelActiveStudyTimer}>Cancel</button></div>
  </aside>
{/if}

{#if selected}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="topic-title">
      <div class="panel-head"><div><p class="eyebrow">{selected.block} · TOPIC {selected.number}</p><h2 id="topic-title">{selected.title}</h2></div><button class="close" aria-label="Close" on:click={() => selected = null}>×</button></div>
      {#if selected.titleIsPlaceholder}<p class="placeholder-note">Official title not supplied. The stable ID is ready; update the centralized syllabus when the exact title is available.</p>{/if}
      <section class="topic-timer" class:active={isTopicStudyTimer(activeTimer) && activeTimer.topicId === selected.id}>
        {#if isTopicStudyTimer(activeTimer) && activeTimer.topicId === selected.id}
          <div><span>{activeTimer.status === 'paused' ? 'Study paused' : 'Studying now'}</span><strong>{formatStudyDuration(activeTimerSeconds)}</strong></div>
          <div class="timer-actions">{#if activeTimer.status === 'running'}<button disabled={saving} on:click={pauseTopicStudy}>Pause</button>{:else}<button disabled={saving} on:click={resumeTopicStudy}>Resume</button>{/if}<button disabled={saving} on:click={completeTopicStudy}>Finish</button><button disabled={saving || ankiBusy} title="Discard this session without saving study time" on:click={cancelActiveStudyTimer}>Cancel</button></div>
        {:else}
          <div><span>Focused study timer</span><small>Pauses are excluded. Importing a patch that includes this topic finishes the timer automatically.</small></div>
          <button class="start-timer" disabled={saving} on:click={() => beginTopicStudy(selected!.id)}>{activeTimer ? 'Switch timer to this topic' : 'Start studying'}</button>
        {/if}
      </section>
      <div class="topic-study-action"><div class="actions"><button class="primary" disabled={saving} on:click={() => copyTopicStudyPrompt(selected!.id)}>Copy study prompt</button><button disabled={saving} on:click={() => copyTopicStudyPrompt(selected!.id, 'second')}>Copy Pass 1 prompt</button></div><small>Both start with cold recall and record oral mastery from pre-teaching performance. Pass 1 also records gaps. Choosing it directly makes Pass 0 unnecessary without recording it as completed. Coverage updates when you import the completed session.</small></div>
      <section class="oral-assessment-panel"><h3>Oral mastery · {oralSummary(state.topics[selected.id]).label}</h3>
        {#if state.topics[selected.id].oralAssessment}
          {@const assessment = state.topics[selected.id].oralAssessment!}
          {@const result = scoreOralAssessment(assessment)}
          <div class="oral-domain-grid">{#each ORAL_DOMAINS as domain}<span>{domain.label}<b>{assessment.ratings[domain.key]}/4</b></span>{/each}</div>
          {#if result.limits.length}<p>Raw total {result.raw}/20 · limited by: {result.limits.join('; ')}.</p>{/if}
          <p>{assessment.evidence}</p>
          {#if assessment.assessedAt}<small>Assessed {new Date(assessment.assessedAt).toLocaleString()}</small>{/if}
        {:else}<p>{latestReviewByTopic[selected.id] ? 'The session is logged, but its patch did not include a detailed oral assessment.' : 'The next full-topic session will score the cold answer and neutral pre-teaching follow-ups.'}</p>{/if}
        <button on:click={copyAssessmentOnlyPrompt}>Copy assessment-only prompt</button>
      </section>
      <div class="form-grid"><label>Earlier mastery /4<select disabled={!!state.topics[selected.id].oralAssessment} bind:value={editMastery}>{#each [0,1,2,3,4] as value}<option value={value}>{value} · {masteryLabel(value)}</option>{/each}</select></label><label>Confidence<select bind:value={editConfidence}>{#each [0,1,2,3,4] as value}<option value={value}>{value} / 4</option>{/each}</select></label><label>Status<select bind:value={editStatus}><option value="unassessed">Unassessed</option><option value="learning">Learning</option><option value="review">Review</option><option value="solid">Exam-ready</option></select></label></div>
      <label>Notes<textarea class="notes" bind:value={editNotes} maxlength="5000" placeholder="Concise knowledge-map notes"></textarea></label>
      <section class="anki-section">
        <div><h3>Anki deck study</h3><p>Each log is kept separately, so repeated deck reviews count.</p></div>
        <div class="anki-log"><input type="date" bind:value={ankiDate} max={localDateString()} /><button disabled={saving} on:click={logAnkiReview}>{saving ? 'Saving…' : 'Log Anki study'}</button></div>
        {#if ankiReviews(state.topics[selected.id]).length}
          <div class="anki-history"><strong>{ankiReviews(state.topics[selected.id]).length}× studied</strong><span>{ankiReviews(state.topics[selected.id]).slice().reverse().map((date) => new Date(`${date}T12:00:00`).toLocaleDateString()).join(' · ')}</span></div>
        {/if}
      </section>
      {#if planProgress}<section class="plan-topic-section"><div><h3>Study-plan coverage</h3><p>Guided acquisition and two recall rounds, independent of oral mastery and retention.</p></div><div class="plan-topic-state"><span><b>Oral mastery</b>{oralSummary(state.topics[selected.id]).label}</span>{#each PLAN_PASSES as pass}<span><b>{PASS_DETAILS[pass].label}</b>{pass === 'first' && !planProgress.topics[selected.id]?.firstPassCompletedAt && acquisitionCoveredByRecall(planProgress.topics[selected.id]) ? 'Not required after recall' : planProgress.topics[selected.id]?.[passCompletionKey(pass)] ? `Completed ${new Date(planProgress.topics[selected.id][passCompletionKey(pass)]!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not complete'}</span>{/each}</div><div class="actions">{#each PLAN_PASSES as pass}<button disabled={pass === 'first' && !planProgress.topics[selected.id]?.firstPassCompletedAt && acquisitionCoveredByRecall(planProgress.topics[selected.id])} on:click={() => toggleTopicPlanPass(selected!.id, pass)}>{pass === 'first' && !planProgress.topics[selected.id]?.firstPassCompletedAt && acquisitionCoveredByRecall(planProgress.topics[selected.id]) ? 'Pass 0 not required' : `Mark ${PASS_DETAILS[pass].label} ${planProgress.topics[selected.id]?.[passCompletionKey(pass)] ? 'incomplete' : 'complete'}`}</button>{/each}</div></section>{/if}
      <section class="review-result-section"><div><h3>Latest active-recall result</h3><p>{latestReviewByTopic[selected.id] ? `${latestReviewByTopic[selected.id].outcome} · ${new Date(latestReviewByTopic[selected.id].reviewedAt).toLocaleDateString()}` : 'No independent recall result yet.'}</p></div><div class="outcome-buttons">{#if nextTopicPass(planProgress?.topics[selected.id])==='first'}<button on:click={() => recordReview(selected!.id, 'studied')}>Log guided learning</button>{/if}<button class="failed" on:click={() => recordReview(selected!.id, 'failed')}>Failed</button><button class="prompted" on:click={() => recordReview(selected!.id, 'prompted')}>Prompted</button><button class="passed" on:click={() => recordReview(selected!.id, 'passed')}>Passed</button><button class="fluent" on:click={() => recordReview(selected!.id, 'fluent')}>Fluent</button></div></section>
      <div class="gaps"><h3>Knowledge gaps</h3><p>Record specific recall gaps from Pass 1 onward for Anki and focused review. Resolve them after a later independent retest.</p>{#each activeGaps(state.topics[selected.id]) as gap}<div><span><i class={`priority-dot ${gap.priority ?? 'normal'}`}></i>{gap.text}</span><select aria-label="Gap priority" value={gap.priority ?? 'normal'} on:change={(event) => setGapPriority(selected!.id, gap.id, (event.currentTarget as HTMLSelectElement).value as GapPriority)}><option value="critical">Critical</option><option value="important">Important</option><option value="normal">Normal</option></select><button on:click={() => resolveGap(selected!.id, gap.id)}>Resolve</button></div>{/each}<div class="new-gap-row"><input bind:value={newGap} maxlength="500" placeholder="Add a specific gap" /><select bind:value={newGapPriority}><option value="critical">Critical</option><option value="important">Important</option><option value="normal">Normal</option></select></div></div>
      <div class="actions end"><button on:click={() => selected = null}>Cancel</button><button class="primary" disabled={saving} on:click={saveManual}>{saving ? 'Saving…' : 'Save topic'}</button></div>
    </div>
  </div>
{/if}

{#if showAnkiImport}
  <div class="modal-backdrop">
    <div class="modal anki-import-modal" role="dialog" aria-modal="true" aria-labelledby="anki-import-title">
      <div class="panel-head"><div><p class="eyebrow">ANKI GAP CARDS</p><h2 id="anki-import-title">Import generated cards</h2><p>Expected: exactly one card for each of the {ankiPromptSelection.length} selected gaps. Trackr verifies every permanent ID before saving.</p></div><button class="close" aria-label="Close" on:click={() => showAnkiImport = false}>×</button></div>
      <div class="anki-import-summary">{#each ankiPromptSelection.slice(0, 6) as gap}<span><b>{gap.topicId}</b>{gap.gapId}</span>{/each}{#if ankiPromptSelection.length > 6}<span>+ {ankiPromptSelection.length - 6} more</span>{/if}</div>
      <label>ChatGPT JSON<textarea class="anki-json" bind:value={ankiCardJson} placeholder={'{"kind":"trackr-anki-gap-cards","schemaVersion":1,"batchId":"…","cards":[…]}'}></textarea></label>
      <p class="anki-import-note">Cards are saved in Trackr first. “Send / reconcile cards” then creates only missing Anki notes, so retrying cannot duplicate them.</p>
      <div class="actions end"><button on:click={() => showAnkiImport = false}>Cancel</button><button class="primary" disabled={saving || !ankiCardJson.trim()} on:click={importGeneratedAnkiCards}>{saving ? 'Validating…' : 'Validate & save cards'}</button></div>
    </div>
  </div>
{/if}

{#if showSimulation}
  <div class="modal-backdrop"><div class="modal simulation-modal" role="dialog" aria-modal="true" aria-labelledby="simulation-title"><div class="panel-head"><div><p class="eyebrow">EXAM PRACTICE</p><h2 id="simulation-title">Log oral simulation</h2></div><button class="close" aria-label="Close" on:click={() => showSimulation = false}>×</button></div><div class="form-grid"><label>Outcome<select bind:value={simulationOutcome}><option value="failed">Failed</option><option value="prompted">Prompted</option><option value="passed">Passed</option><option value="fluent">Fluent</option></select></label><label>Duration (minutes)<input type="number" min="1" bind:value={simulationMinutes} placeholder="Optional" /></label><label>Topic IDs<input bind:value={simulationTopics} placeholder="1a, 1b, 1c" /></label></div><label>Critical errors<textarea class="notes" bind:value={simulationErrors} placeholder="Unsafe or fail-critical errors"></textarea></label><label>Notes<textarea class="notes" bind:value={simulationNotes} placeholder="Concise simulation notes"></textarea></label><div class="actions end"><button on:click={() => showSimulation = false}>Cancel</button><button class="primary" on:click={logSimulation}>Save simulation</button></div></div></div>
{/if}

<style>
  .study-approach{margin:0 0 1rem;padding:.85rem 1rem;border:1px solid #30394c;border-radius:12px;background:#141a25;color:#c2cadb}.study-approach summary{cursor:pointer;font-size:.9rem;font-weight:600}.study-approach p{max-width:1000px;font-size:.95rem;line-height:1.5}.study-approach .actions{flex-wrap:wrap;align-items:center}.study-approach a{color:#aeb7ff;font-size:.875rem;padding:.6rem 0}

  .floating-timer{position:fixed;right:18px;bottom:76px;z-index:90;width:min(390px,calc(100vw - 36px));box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px 12px;border:1px solid #43514c;border-radius:15px;background:rgba(18,23,29,.94);color:#eef0f7;box-shadow:0 18px 55px rgba(0,0,0,.45);backdrop-filter:blur(18px)}.floating-timer.paused{border-color:#514b3a}.timer-topic{min-width:0;display:flex;align-items:center;gap:9px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0}.timer-topic i{width:8px;height:8px;flex:none;border-radius:50%;background:#62d3a8;box-shadow:0 0 0 4px rgba(98,211,168,.12)}.paused .timer-topic i{background:#d1b66f;box-shadow:0 0 0 4px rgba(209,182,111,.12)}.timer-topic span{min-width:0}.timer-topic small,.timer-topic strong{display:block}.timer-topic small{color:#65cfa9;font-size:.55rem;font-weight:850;letter-spacing:.13em}.paused .timer-topic small{color:#d1b66f}.timer-topic strong{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem}.floating-timer>b{font:750 1.12rem ui-monospace,SFMono-Regular,Menlo,monospace}.floating-timer>div{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px}.floating-timer>div button,.topic-timer button{border:1px solid #38414c;border-radius:8px;background:#232a33;color:#edf0f5;padding:7px 10px;cursor:pointer}.floating-timer button:disabled,.topic-timer button:disabled{opacity:.45;cursor:not-allowed}.topic-timer{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0 16px;padding:13px 14px;border:1px solid #303744;border-radius:12px;background:#11151c}.topic-timer.active{border-color:#3f5d52;background:#121b19}.topic-timer span,.topic-timer small{display:block}.topic-timer span{font-size:.72rem;font-weight:750}.topic-timer small{margin-top:4px;color:#848da0;font-size:.67rem}.topic-timer strong{display:block;margin-top:4px;font:750 1.35rem ui-monospace,SFMono-Regular,Menlo,monospace}.timer-actions{display:flex;gap:7px}.topic-timer .start-timer{background:#7787ff;border-color:#7787ff;color:#090b10;font-weight:750}
  .hero-actions{display:flex;align-items:stretch;gap:10px}.review-link{position:relative;display:flex;align-items:center;gap:10px;border:1px solid #282d39;background:rgba(24,27,36,.72);color:#e7e9f1;border-radius:16px;padding:10px 15px;cursor:pointer;backdrop-filter:blur(16px)}.review-link:hover{border-color:#59637a;background:#1c202a}.review-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#262b37;color:#9ca6ff;font-size:1.15rem}.review-copy{text-align:left}.review-copy strong,.review-copy small{display:block}.review-copy strong{font-size:.78rem}.review-copy small{font-size:.66rem;color:#8e95a9;margin-top:3px}.due-badge{position:absolute;top:-8px;right:-8px;display:grid;place-items:center;min-width:21px;height:21px;box-sizing:border-box;padding:0 5px;border-radius:999px;background:#ff3b5c;color:#fff;font-size:.68rem;line-height:1;box-shadow:0 0 0 3px #0b0d12}
  :global(body){background:#0b0d12!important;color:#eef0f7!important}
  .study-shell{max-width:1180px;margin:0 auto;padding:12px 0 80px;color:#eef0f7}
  .hero{display:flex;justify-content:space-between;align-items:flex-end;padding:30px 4px 26px}
  .eyebrow{font-size:.68rem;font-weight:750;letter-spacing:.17em;color:#8e95a9;margin:0 0 8px}
  .hero h1{font-size:clamp(2rem,5vw,4rem);letter-spacing:-.055em;margin:0;line-height:.95}
  .subtitle{color:#8e95a9;margin:12px 0 0}
  .exam{text-align:right;padding:14px 18px;border:1px solid #282d39;border-radius:16px;background:rgba(24,27,36,.72);backdrop-filter:blur(16px)}
  .exam strong{font-size:2rem;display:block}.exam span{font-size:.75rem;color:#9ba2b5}
  .metrics{display:grid;grid-template-columns:minmax(130px,.65fr) minmax(250px,1.3fr) minmax(130px,.65fr) minmax(170px,.85fr) minmax(270px,1.4fr);gap:10px;margin-bottom:10px}
  .metrics article,.panel,.blocks button,.state-card{background:linear-gradient(145deg,rgba(27,31,41,.94),rgba(17,20,27,.94));border:1px solid #292e3a;border-radius:18px;box-shadow:0 14px 38px rgba(0,0,0,.18)}
  .metrics article{padding:18px}.metrics span{display:block;color:#9299ab;font-size:.74rem}.metrics strong{display:block;font-size:1.75rem;margin-top:9px}.metrics small{font-size:.75rem;color:#747c90;margin-left:4px}.mastery-metric{display:flex!important;align-items:center;gap:14px}.mastery-ring{position:relative;width:64px;height:64px;flex:none;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.05)}.mastery-ring:after{content:'';position:absolute;inset:10px;border-radius:50%;background:#171b23;box-shadow:inset 0 0 0 1px #292f3a}.mastery-ring>i{position:absolute;inset:10px;z-index:1;display:grid;place-content:center;text-align:center;font-style:normal}.mastery-ring b{font-size:.82rem;line-height:1}.mastery-ring small{margin:2px 0 0!important;font-size:.48rem!important;color:#747d90!important}.mastery-summary{min-width:0;flex:1}.mastery-summary>span{margin-bottom:7px}.mastery-summary>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px}.mastery-summary small{display:flex;align-items:center;gap:4px;margin:0!important;white-space:nowrap;font-size:.56rem!important;color:#8e96a8!important}.mastery-summary small i{width:7px;height:7px;flex:none;border-radius:2px}.mastery-summary small b{color:#d9dce6}
  .blocks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px}
  .blocks button{text-align:left;color:inherit;padding:15px;cursor:pointer}.blocks button.active{border-color:#7888ff;box-shadow:0 0 0 1px #7888ff}.blocks button span,.blocks button strong{font-size:.8rem}.blocks button strong{float:right}.blocks i{height:5px;background:#292e39;border-radius:9px;display:block;margin:12px 0 8px;overflow:hidden}.blocks i b{display:block;height:100%;background:linear-gradient(90deg,#6c7cff,#9d7dff)}.blocks small{color:#8e95a9}
  .main-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:10px}.panel{padding:20px;min-width:0}.wide{grid-column:1/-1}
  .panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:17px}.panel h2{margin:0;font-size:1.12rem}.panel-head p:not(.eyebrow){color:#8e95a9;font-size:.8rem;margin:7px 0 0}
  .map-legends{display:grid;justify-items:end;gap:7px}.legend{display:flex;gap:8px;color:#8e95a9;font-size:.66rem}.legend b{color:#6f778a;font-size:.58rem;text-transform:uppercase;letter-spacing:.08em}.legend span{display:flex;align-items:center;gap:3px}.legend i,.dot{width:9px;height:9px;border-radius:3px;display:inline-block}
  .coverage-legend i{box-sizing:border-box}.coverage-needed{background:#59615d;border:1px solid #747c77}.coverage-done{display:grid!important;place-items:center;background:#477a6b;color:#d9fff1;font-size:7px;font-style:normal}.coverage-superseded{display:grid!important;place-items:center;background:#304154;color:#9dccff;font-size:5px!important;font-style:normal;font-weight:900}.gap-key{background:transparent;border:1px solid #ff6a7a}
  .m0,.mastery-0{background:#282d37!important}.m1,.mastery-1{background:#62394d!important}.m2,.mastery-2{background:#9a633f!important}.m3,.mastery-3{background:#61744d!important}.m4,.mastery-4{background:#3f8f71!important}
  .heatmap{display:grid;grid-template-columns:repeat(28,minmax(24px,1fr));gap:5px}.heatmap button{position:relative;overflow:visible;aspect-ratio:1;border:1px solid transparent;border-radius:5px;color:rgba(255,255,255,.72);font-size:.54rem;cursor:pointer;padding:0}.heatmap button.first-pass-complete:before{content:'✓';position:absolute;left:3px;top:2px;color:#bff3df;font-size:7px;font-weight:900;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.55)}.anki-badge{position:absolute;top:-4px;right:-4px;display:grid!important;place-items:center;min-width:10px;height:10px;padding:0 2px;box-sizing:border-box;border-radius:999px;background:#ff3b5c!important;color:#fff;font-size:7px!important;font-weight:800;line-height:1;box-shadow:0 0 0 2px #20242e;z-index:2}.heatmap button:hover{transform:scale(1.15);border-color:#fff;z-index:3}.heatmap button.has-gap{box-shadow:inset 0 0 0 1px #ff6a7a}
  .empty{min-height:180px;display:grid;place-items:center;text-align:center;color:#777f91;font-size:.82rem}.danger-text{color:#ff7685}.count{background:#43252d;color:#ff8c98;border-radius:999px;padding:4px 9px;font-size:.75rem}
  .red-list{display:flex;flex-direction:column;gap:6px}.red-list button{display:flex;justify-content:space-between;text-align:left;background:#171a22;border:1px solid #2a2e38;border-radius:10px;color:#f0f1f5;padding:10px;cursor:pointer}.red-list small{display:block;color:#8e95a9;margin-top:4px}.red-list b{color:#ff8490;font-size:.7rem}
  .import-panel textarea{width:100%;box-sizing:border-box;min-height:170px;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions.end{justify-content:flex-end}.actions button,.gaps button,.message button,.close,.anki-log button{border:1px solid #353b49;background:#222630;color:#e7e9f1;border-radius:10px;padding:10px 13px;cursor:pointer}.actions .primary,.anki-log button{background:#7787ff;border-color:#7787ff;color:#080a10;font-weight:750}.actions button:disabled,.anki-log button:disabled{opacity:.45;cursor:not-allowed}
  .filters{display:grid;grid-template-columns:1fr auto auto;gap:8px}.filters input,.filters select,textarea,.form-grid select,.notes,.gaps input,.anki-log input{background:#11141b;color:#edf0f7;border:1px solid #303541;border-radius:10px;padding:11px;font:inherit}
  .topic-list{margin-top:12px;max-height:560px;overflow:auto}.topic-list>button{width:100%;display:flex;align-items:center;gap:11px;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid #262b35;padding:11px 6px;cursor:pointer}.topic-copy{display:flex;flex-direction:column;flex:1}.topic-copy small{color:#858c9e;margin-top:3px}.topic-meta{text-align:right;color:#aab0bf;font-size:.72rem}.topic-meta em{display:block;margin-top:3px;color:#d6a65f;font-size:.62rem;font-style:normal}.topic-meta em.pass-done{color:#69b79d}.topic-meta b{display:block;color:#ff8490;margin-top:3px}
  .message{display:flex;justify-content:space-between;align-items:center;padding:12px 15px;margin-bottom:10px;border-radius:12px}.message.error{background:#3c2027;border:1px solid #743842}.message.success{background:#18372e;border:1px solid #2a6653}.message button{padding:5px 8px}.state-card{padding:50px;text-align:center;color:#9299ab}.spinner{display:inline-block;width:14px;height:14px;border:2px solid #495063;border-top-color:#8793ff;border-radius:50%;animation:spin .8s linear infinite;margin-right:8px}
  .modal-backdrop{position:fixed;inset:0;background:rgba(2,3,6,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px;z-index:100}.modal{width:min(680px,100%);max-height:88vh;overflow:auto;background:#171a22;border:1px solid #343a48;border-radius:20px;padding:22px;color:#eef0f7;box-shadow:0 28px 80px #000}.close{font-size:1.4rem;padding:3px 10px}.placeholder-note{background:#28241c;border:1px solid #4c422c;color:#d6c18a;padding:10px;border-radius:10px;font-size:.8rem}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:17px 0}.modal label{display:flex;flex-direction:column;gap:7px;font-size:.76rem;color:#aab0bf}.notes{min-height:100px;resize:vertical}
  .anki-section{margin:16px 0;padding:14px;background:#11141b;border:1px solid #292e39;border-radius:12px}.anki-section h3,.gaps h3{font-size:.83rem;margin:0 0 4px}.anki-section p{font-size:.73rem;color:#858c9e;margin:0}.anki-log{display:flex;gap:8px;margin-top:12px}.anki-log input{flex:1;color-scheme:dark}.anki-history{display:flex;justify-content:space-between;gap:10px;margin-top:11px;font-size:.72rem}.anki-history span{color:#858c9e;text-align:right;overflow-wrap:anywhere}
  .gaps>div{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#11141b;border-radius:9px;padding:8px 10px;margin:6px 0;font-size:.78rem}.gaps button{padding:5px 8px}.gaps input{width:100%;box-sizing:border-box;margin-top:7px}.hidden{display:none}@keyframes spin{to{transform:rotate(360deg)}}
  .patch-shortcut{display:block;margin-top:6px;color:#737c90;font-size:.65rem}.topic-study-action{display:flex;align-items:center;gap:10px;margin:-5px 0 16px}.topic-study-action button{border:1px solid #7787ff;border-radius:10px;background:#7787ff;color:#080a10;padding:9px 12px;font-weight:750;cursor:pointer}.topic-study-action button:disabled{opacity:.45;cursor:not-allowed}.topic-study-action small{color:#7f8799;font-size:.65rem}
  @media(max-width:800px){.metrics{grid-template-columns:repeat(2,1fr)}.forecast-metric{grid-column:1/-1}.main-grid{grid-template-columns:1fr}.wide{grid-column:auto}.heatmap{grid-template-columns:repeat(14,1fr)}.blocks{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:1fr}.hero{align-items:flex-start}.exam{padding:10px}.exam strong{font-size:1.4rem}.form-grid{grid-template-columns:1fr}}
  @media(max-width:480px){.study-shell{padding-top:0}.hero{padding-top:12px}.subtitle{font-size:.8rem}.metrics article{padding:13px}.heatmap{grid-template-columns:repeat(10,1fr)}.panel{padding:14px}.legend{display:none}}
  @media(max-width:560px){.floating-timer{right:10px;bottom:72px;width:calc(100vw - 20px)}.topic-timer{align-items:flex-start;flex-direction:column}.timer-actions,.topic-timer .start-timer{width:100%}.timer-actions button{flex:1}}
  /* Compact hero controls and at-a-glance study-plan summary. */
  .action-stack{display:grid;grid-template-rows:1fr 1fr;gap:7px;width:176px}.review-link.compact{width:100%;box-sizing:border-box;border-radius:12px;padding:7px 10px;min-height:0}.hero{padding-bottom:20px}.metrics article{padding:13px 16px}.metrics span{font-size:.7rem}.metrics strong{font-size:1.42rem;margin-top:5px}.metrics small{font-size:.7rem;margin-left:3px}
  .plan-strip{position:relative;width:100%;display:grid;grid-template-columns:1.15fr 1.6fr .9fr .85fr auto;align-items:center;gap:22px;box-sizing:border-box;text-align:left;color:#eef0f7;background:linear-gradient(110deg,rgba(31,36,49,.96),rgba(18,22,30,.96));border:1px solid #303746;border-radius:18px;padding:16px 19px;margin:0 0 10px;cursor:pointer}.plan-strip:hover{border-color:#59637a}.plan-strip span,.plan-strip small{display:block;color:#9299ab}.plan-strip>div>span{font-size:.66rem;text-transform:uppercase;letter-spacing:.08em}.plan-strip strong{display:block;margin:5px 0 3px;font-size:1.12rem}.plan-strip strong.ahead{color:#63d6ae}.plan-strip strong.behind{color:#ff7d8e}.plan-strip small{font-size:.68rem}.plan-progress>div{display:flex;justify-content:space-between;align-items:end}.plan-progress>div b{font-size:1rem}.plan-progress>div b small,.plan-today strong small{display:inline;color:#788197;margin-left:2px}.plan-progress>i{display:block;height:6px;background:#2a303d;border-radius:8px;overflow:hidden;margin:8px 0 5px}.plan-progress>i b{display:block;height:100%;margin:0;background:linear-gradient(90deg,#6c7cff,#9d7dff)}.plan-today-main{display:flex;align-items:center;gap:9px}.plan-today strong{font-size:1.35rem}.daily-ring{position:relative;display:block;width:30px;height:30px;flex:none;border-radius:50%;background:conic-gradient(#7d89ff var(--daily-progress),#2b313e 0);box-shadow:0 0 0 1px rgba(125,137,255,.15)}.daily-ring:after{content:'';position:absolute;inset:5px;border-radius:50%;background:#171c25}.plan-forecast strong{font-size:1.1rem}.plan-arrow{font-size:1.9rem!important;color:#7787ff!important}.plan-empty{grid-template-columns:1fr auto}.plan-empty strong{margin:4px 0}
  @media(max-width:800px){.plan-strip{grid-template-columns:1fr 1fr;gap:14px}.plan-arrow{display:none!important}.hero-actions{width:100%}.action-stack{flex:1;width:auto}.exam{min-width:120px}}
  @media(max-width:480px){.hero-actions{flex-direction:column}.action-stack{width:100%}.exam{text-align:center}.metrics article{padding:11px 13px}.plan-strip{grid-template-columns:1fr}.plan-progress{order:3}}
  .plan-topic-section{margin:16px 0;padding:14px;background:#11141b;border:1px solid #292e39;border-radius:12px}.plan-topic-section h3{font-size:.83rem;margin:0 0 4px}.plan-topic-section p{font-size:.73rem;color:#858c9e;margin:0}.plan-topic-state{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.plan-topic-state span{background:#171b24;border-radius:9px;padding:9px;color:#aab0bf;font-size:.72rem}.plan-topic-state b{display:block;color:#eef0f7;margin-bottom:4px}@media(max-width:480px){.plan-topic-state{grid-template-columns:1fr}}
  @media(max-width:700px){
    .desktop-study-control,.topics-panel,.patch-admin-control{display:none!important}
    .study-shell{padding-bottom:72px}
    .hero{display:block;padding:10px 0 14px}
    .hero h1{font-size:2.2rem}
    .subtitle{display:none}
    .hero-actions{margin-top:14px;display:grid;grid-template-columns:1fr auto;align-items:stretch}
    .action-stack{display:block;width:auto}
    .review-link.compact{min-height:58px}
    .exam{min-width:82px;display:grid;place-content:center}
    .metrics{gap:7px}
    .blocks{display:flex;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x proximity}
    .blocks button{min-width:145px;scroll-snap-align:start}
    .main-grid{display:block}
    .main-grid>.panel{margin-top:8px}
    .import-panel{padding:16px}
    .import-panel .panel-head{margin-bottom:12px}
    .import-panel textarea{min-height:150px;font-size:16px}
    .import-panel .patch-shortcut{display:none}
    .import-panel .actions{display:block}
    .import-panel .mobile-patch-apply{width:100%;min-height:48px}
    .mobile-readonly-panel .red-list button{pointer-events:none;cursor:default}
    .mobile-readonly-panel .red-list b{display:none}
  }
  @media(min-width:801px){.metrics{grid-template-columns:minmax(130px,.65fr) minmax(250px,1.3fr) minmax(130px,.65fr) minmax(170px,.85fr) minmax(270px,1.4fr)}}
  .time-metric strong{white-space:nowrap}.time-metric>small{display:block;margin:3px 0 0}.forecast-metric{display:grid!important;grid-template-columns:minmax(92px,.75fr) minmax(150px,1.35fr);grid-template-rows:auto 1fr;column-gap:14px;align-items:center}.forecast-metric-head{align-self:start}.forecast-metric-head strong{font-size:1.18rem!important;white-space:nowrap}.forecast-metric-head strong.late{color:#ff7d8e}.forecast-metric svg{display:block;width:100%;height:54px;overflow:visible}.forecast-axis{stroke:#303746;stroke-width:1}.target-path{stroke:#8992a6;stroke-width:2;stroke-dasharray:4 4}.projection-path{stroke:#7787ff;stroke-width:3}.projection-path.late{stroke:#ff7d8e}.start-dot{fill:#8992a6}.target-dot{fill:#11151c;stroke:#b5bbca;stroke-width:2}.projection-dot{fill:#7787ff}.projection-dot.late{fill:#ff7d8e}.forecast-key{grid-column:2;display:flex;justify-content:space-between;gap:8px;color:#858da0;font-size:.56rem}.forecast-key span{display:flex;align-items:center;gap:4px;white-space:nowrap}.forecast-key i{display:inline-block;width:11px;height:2px}.target-key{border-top:2px dashed #8992a6}.projection-key{background:#7787ff}.projection-key.late{background:#ff7d8e}
  .review-control{display:grid;grid-template-columns:1.35fr .95fr .9fr;gap:12px;margin:0 0 10px;padding:18px;background:linear-gradient(125deg,rgba(28,34,47,.98),rgba(16,20,28,.98));border:1px solid #343c4d;border-radius:18px;box-shadow:0 16px 45px rgba(0,0,0,.22)}.study-mode-tabs{grid-column:1/-1;display:flex;gap:5px;padding:3px;width:max-content;max-width:100%;background:#10141c;border:1px solid #2b3240;border-radius:10px}.study-mode-tabs button{border:0;border-radius:7px;padding:7px 11px;background:transparent;color:#8d95a8;font-size:.66rem;font-weight:750;cursor:pointer}.study-mode-tabs button.active{background:#293047;color:#f2f4fa}.study-mode-tabs span{display:inline-grid;place-items:center;min-width:18px;margin-left:4px;padding:1px 5px;border-radius:999px;background:#3a2f25;color:#efba71;font-size:.56rem}.review-next{min-width:0}.screen-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.queue-options{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:auto;padding-top:13px;border-top:1px solid #2a313e}.queue-options>span{grid-column:1/-1;color:#70798d;font-size:.5rem;font-weight:850;letter-spacing:.12em}.queue-toggle{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:9px 10px;border:1px solid #2a313e;border-radius:10px;background:#121720;cursor:pointer}.queue-toggle>span{min-width:0}.queue-toggle b,.queue-toggle small{display:block}.queue-toggle b{color:#dce1ec;font-size:.61rem}.queue-toggle small{margin-top:2px;color:#7f889b;font-size:.51rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.queue-toggle input{position:absolute;opacity:0;pointer-events:none}.queue-toggle i{position:relative;flex:none;width:31px;height:18px;border-radius:999px;background:#343b49;box-shadow:inset 0 0 0 1px #424a5a;transition:.18s ease}.queue-toggle i:after{content:'';position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#aab1bf;transition:.18s ease}.queue-toggle input:checked+i{background:#6978ef;box-shadow:inset 0 0 0 1px #8490ff}.queue-toggle input:checked+i:after{left:16px;background:#fff}.queue-toggle:focus-within{outline:2px solid rgba(124,136,255,.55);outline-offset:2px}.next-title{display:flex;align-items:center;gap:9px}.next-title strong{font-size:1rem;line-height:1.25}.review-next>p:not(.eyebrow){color:#9299ab;font-size:.72rem;margin:9px 0}.queue-kind,.queue-preview em{border-radius:999px;padding:4px 7px;text-transform:uppercase;font-size:.54rem;font-weight:850;letter-spacing:.07em}.critical{color:#ff8794;background:#43252d}.retest{color:#f1bf74;background:#3b3020}.screen{color:#9aa7ff;background:#272e50}.maintenance{color:#8fd1b9;background:#1e3a31}.review-overview{display:grid;grid-template-columns:1fr 1fr;gap:7px}.review-overview article{padding:10px;border-radius:11px;background:#121720;border:1px solid #2a313e}.review-overview span,.review-overview small{display:block;color:#8992a6;font-size:.62rem}.review-overview strong{display:block;margin-top:5px;font-size:1.15rem}.review-overview strong small{display:inline;margin-left:2px}.review-overview article>small{margin-top:4px}.queue-preview{display:flex;flex-direction:column;gap:4px}.queue-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}.queue-head small{color:#7f889b;font-size:.58rem}.queue-preview button{display:flex;align-items:center;gap:8px;width:100%;padding:6px;border:0;border-radius:8px;background:#141922;color:#eef0f7;text-align:left;cursor:pointer}.queue-preview button>b{display:grid;place-items:center;width:18px;height:18px;border-radius:6px;background:#252b37;color:#8992a6;font-size:.6rem}.queue-preview button>span{min-width:0;flex:1}.queue-preview button strong,.queue-preview button small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.queue-preview button strong{font-size:.67rem}.queue-preview button small{color:#858e9f;font-size:.57rem;margin-top:2px}.queue-preview em{font-style:normal}.queue-preview .gap-count{color:#e6b36d;background:#382f25}.queue-preview .gap-count.critical{color:#ff8794;background:#43252d}.gap-repair-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.gap-repair-heading h3{margin:5px 0 0;font-size:1.05rem}.gap-repair-heading label{display:flex;align-items:center;gap:6px;color:#8992a6;font-size:.6rem}.gap-repair-heading select{padding:5px 22px 5px 7px;border:1px solid #343b49;border-radius:7px;background:#121720;color:#eef0f7}.gap-batch-list{display:grid;gap:4px;margin-top:9px}.gap-batch-list button{display:flex;align-items:center;gap:8px;width:100%;padding:7px;border:0;border-radius:8px;background:#141922;color:#eef0f7;text-align:left;cursor:pointer}.gap-batch-list button>b{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#3a3024;color:#e7b269;font-size:.6rem}.gap-batch-list button>span{min-width:0}.gap-batch-list strong,.gap-batch-list small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gap-batch-list strong{font-size:.69rem}.gap-batch-list small{margin-top:2px;color:#8992a6;font-size:.57rem}.compact-empty{padding:18px 0}
  .review-result-section{margin:16px 0;padding:14px;background:#11141b;border:1px solid #292e39;border-radius:12px}.review-result-section h3{margin:0;font-size:.83rem}.review-result-section p{margin:4px 0 0;color:#858c9e;font-size:.7rem;text-transform:capitalize}.outcome-buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:11px}.outcome-buttons button{border:1px solid #343a46;border-radius:9px;background:#20252f;color:#eef0f7;padding:9px;cursor:pointer}.outcome-buttons .failed{color:#ff8794}.outcome-buttons .prompted{color:#f2bd70}.outcome-buttons .passed{color:#7fd1b3}.outcome-buttons .fluent{color:#93a3ff}.gaps>div>span{flex:1;display:flex;align-items:center;gap:7px}.gaps select,.new-gap-row select,.simulation-modal input{background:#11141b;color:#edf0f7;border:1px solid #303541;border-radius:9px;padding:7px}.priority-dot{display:inline-block;width:7px;height:7px;border-radius:50%}.priority-dot.critical{background:#ff6175}.priority-dot.important{background:#e0a653}.priority-dot.normal{background:#6e778a}.new-gap-row{display:grid!important;grid-template-columns:1fr auto;background:transparent!important;padding:0!important;margin-top:8px!important}.new-gap-row input{margin:0!important}.simulation-modal label{margin-top:10px}.simulation-modal .form-grid{grid-template-columns:repeat(3,1fr)}
  .review-badge{position:absolute;left:3px;bottom:3px;width:5px;height:5px;border-radius:50%;box-shadow:0 0 0 1px rgba(10,12,16,.7)}.review-badge.failed,.review-failed{background:#ff6578!important}.review-badge.prompted,.review-prompted{background:#e3a653!important}.review-badge.passed,.review-passed{background:#64c6a3!important}.review-badge.fluent,.review-fluent{background:#8494ff!important}.review-legend i{border-radius:50%}
  .study-mode-tabs{overflow-x:auto}.study-mode-tabs button{flex:0 0 auto;white-space:nowrap}.rapid-gap-next>p{max-width:62ch}.rapid-gap-list button>b{background:#26374a;color:#79b9e8}.rapid-gap-list button{border-left:2px solid rgba(89,161,211,.5)}
  .anki-gap-list button{border-left:2px solid rgba(143,126,238,.55)}.anki-gap-list button>b{background:#302b4a;color:#b2a7ff}.anki-connect-panel{min-width:0;align-self:start;padding:12px;border:1px solid #2c3443;border-radius:13px;background:#11161f}.anki-connection-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.anki-connection-head strong,.anki-connection-head small{display:block}.anki-connection-head strong{font-size:.78rem}.anki-connection-head small{margin-top:3px;color:#838da0;font-size:.6rem}.anki-connection-head i{width:9px;height:9px;border-radius:50%;background:#5c6474;box-shadow:0 0 0 4px rgba(92,100,116,.12)}.anki-connection-head i.connected{background:#62d3a8;box-shadow:0 0 0 4px rgba(98,211,168,.12)}.anki-connect-panel>p{margin:9px 0;color:#8d96a9;font-size:.63rem;line-height:1.4}.anki-settings>label,.anki-settings details label{display:grid;gap:4px;color:#8992a6;font-size:.57rem}.anki-settings input{box-sizing:border-box;width:100%;padding:7px 8px;border:1px solid #303746;border-radius:8px;background:#0e131a;color:#eef0f7;font-size:.65rem}.anki-settings details{margin-top:7px;color:#828b9e;font-size:.59rem}.anki-settings summary{cursor:pointer}.anki-settings details label{margin-top:7px}.anki-settings details>small{display:block;margin-top:7px;color:#767f92}.anki-actions{gap:5px}.anki-actions button{padding:7px 8px;font-size:.59rem}.anki-timer-action{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #29303d}.anki-timer-action span,.anki-timer-action small,.anki-timer-action strong{display:block}.anki-timer-action span{font-size:.62rem;color:#aab1c0}.anki-timer-action small{margin-top:3px;color:#788120;font-size:.55rem}.anki-timer-action strong{margin-top:3px;font:750 .85rem ui-monospace,SFMono-Regular,Menlo,monospace}.anki-timer-action button{margin:0;padding:8px 10px;font-size:.63rem}.anki-sync-result{margin-top:8px;padding:7px 8px;border-radius:8px;background:#161c27}.anki-sync-result span,.anki-sync-result small{display:block;font-size:.57rem}.anki-sync-result span{color:#aeb5c3}.anki-sync-result small{margin-top:3px;color:#76caaa}.anki-timer-topic{cursor:default}.anki-import-modal{width:min(760px,100%)}.anki-import-summary{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 14px}.anki-import-summary span{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 7px;border-radius:7px;background:#11161e;color:#858ea1;font-size:.58rem}.anki-import-summary b{margin-right:5px;color:#aaa2ff}.anki-json{box-sizing:border-box;width:100%;min-height:300px;margin-top:6px;resize:vertical;background:#0e1219;color:#e9ecf3;border:1px solid #303746;border-radius:10px;padding:12px;font:600 .7rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.anki-import-note{color:#7f889b;font-size:.65rem;line-height:1.45}
  @media(max-width:900px){.review-control{grid-template-columns:1fr 1fr}.queue-preview{grid-column:1/-1}.simulation-modal .form-grid{grid-template-columns:1fr}}
  @media(max-width:600px){.review-control{grid-template-columns:1fr;padding:13px}.queue-preview{grid-column:auto}.review-overview{grid-template-columns:1fr 1fr}.outcome-buttons{grid-template-columns:1fr 1fr}}

  /* Keep the gap-review workspace compact, balanced, and safely contained. */
  .review-control{grid-template-columns:minmax(0,1.15fr) minmax(220px,.7fr) minmax(0,1.45fr);align-items:start;gap:16px}
  .review-control>*{min-width:0}
  .review-next,.queue-preview{overflow:hidden}
  .review-next{align-self:stretch;display:flex;flex-direction:column}
  .review-overview{align-self:start;align-content:start}
  .review-overview article{box-sizing:border-box;min-height:82px}
  .gap-batch-list{grid-template-columns:repeat(2,minmax(0,1fr))}
  .gap-batch-list button,.queue-preview button{box-sizing:border-box;min-width:0;overflow:hidden}
  .gap-batch-list button>b,.queue-preview button>b{flex:none}
  .gap-batch-list button>span{width:0;min-width:0;flex:1 1 auto}
  .queue-preview{align-self:start}
  .queue-preview button>em{flex:none}
  .queue-head{align-items:baseline}

  @media(max-width:1320px){
    .review-control{grid-template-columns:minmax(0,1.35fr) minmax(220px,.65fr)}
    .queue-preview{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
    .queue-head{grid-column:1/-1;margin-bottom:1px}
  }

  @media(max-width:600px){
    .review-control{grid-template-columns:minmax(0,1fr);gap:12px}
    .study-mode-tabs{width:100%;box-sizing:border-box}
    .study-mode-tabs button{flex:1 0 auto}
    .gap-batch-list{grid-template-columns:1fr}
    .queue-preview{grid-column:auto;display:flex}
    .queue-head{grid-column:auto}
    .review-overview article{min-height:0}
    .queue-options{grid-template-columns:1fr}
    .queue-options>span{grid-column:auto}
  }
  .map-legends{min-width:0}.mastery-legend{flex-wrap:wrap;justify-content:flex-end}
  .heatmap button{background:var(--oral-color)!important;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#fff}
  .heatmap button.pass-zero-pending{background:#1b2028!important;border-color:#252c37;color:#70798a}
  .heatmap button.pass-zero-covered{background:#3b424e!important;border-color:#4d5665;color:#f1f3f7}
  .heatmap button.pass-zero-superseded:before{content:'P1';position:absolute;left:3px;top:2px;color:#9dccff;font-size:5px;font-weight:900;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.55)}
  .heatmap .map-oral-score{font-size:.47rem;line-height:1;opacity:.92}
  .map-assessment-note{color:#9299ab;font-size:.7rem;line-height:1.5;margin:5px 0 12px}.map-assessment-note button{padding:4px 7px;font-size:.65rem}
  .oral-assessment-panel{padding:14px;border:1px solid #343d4c;border-radius:12px;background:#111720;margin:12px 0}.oral-assessment-panel h3{font-size:.9rem;margin:0 0 10px}.oral-assessment-panel p,.oral-assessment-panel small{font-size:.74rem;color:#a3acbf;line-height:1.5}.oral-domain-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.oral-domain-grid span{display:flex;justify-content:space-between;gap:7px;padding:8px;background:#1b2330;border-radius:7px;font-size:.72rem}.oral-domain-grid b{white-space:nowrap;color:#e5ecff}
</style>
