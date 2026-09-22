<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { collection, doc, getCountFromServer, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
  import { auth, db } from '$lib/firebase';
  import { firebaseAuthFetch } from '$lib/utils/firebase-auth-fetch';
  import { user, userReady } from '$lib/stores/user';
  import { bookProgress, isHabitComplete, isHabitScheduledOn, localDateKey, startOfWeek, taskDueState, type LifeBook, type LifeEntry, type LifeHabit, type LifeTask } from '$lib/utils/lifeTracker';
  import { buildWearDayIndex, type WearInsightItem } from '$lib/utils/wearInsights';
  import { PAEDIATRICS_SYLLABUS } from '$lib/paediatrics/paediatricsSyllabus';
  import type { PaediatricsState } from '$lib/paediatrics/paediatricsSchema';
  import { formatSportsDuration, sportsWeekStart, summarizeSports, type SportsActivity } from '$lib/utils/sports';

  type WardrobeItem = WearInsightItem & { worn?: number | string };

  let loading = true;
  let items: WardrobeItem[] = [];
  let habits: LifeHabit[] = [];
  let tasks: LifeTask[] = [];
  let books: LifeBook[] = [];
  let lifeEntries: LifeEntry[] = [];
  let studyState: PaediatricsState | null = null;
  let dueRetention = 0;
  let questionsToday = 0;
  let savedOutfitCount = 0;
  let sportsActivities: SportsActivity[] = [];
  let unavailable = new Set<string>();

  const today = localDateKey();
  const todayLong = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  $: firstName = $user?.name?.trim().split(/\s+/)[0] || 'there';
  $: activeItems = items.filter((item) => !['sold', 'archived', 'retired'].includes(String(item.status ?? '').toLowerCase()));
  $: totalWears = items.reduce((sum, item) => sum + (Number(item.worn ?? 0) || 0), 0);
  $: todayWears = buildWearDayIndex(items)[today] ?? [];
  $: heroItems = activeItems.filter((item) => imageFor(item)).sort((a, b) => (Number(b.worn ?? 0) || 0) - (Number(a.worn ?? 0) || 0)).slice(0, 4);
  $: wardrobeNeedsDetails = activeItems.filter((item) => !item.product || !item.brand || !imageFor(item) || !item.mainCategory || !item.lowerCategory).length;
  $: dueHabits = habits.filter((habit) => isHabitScheduledOn(habit, today));
  $: completedHabits = dueHabits.filter((habit) => isHabitComplete(lifeEntries, habit, today)).length;
  $: dueTasks = tasks.filter((task) => {
    const entries = task.lastCompletedDate ? [{ id: 'summary', kind: 'task' as const, taskId: task.id, date: task.lastCompletedDate }] : [];
    return ['new', 'due', 'overdue'].includes(taskDueState(task, entries, today).tone);
  });
  $: activeBook = books.filter((book) => book.status === 'reading').sort((a, b) => Number(b.currentPage ?? 0) - Number(a.currentPage ?? 0))[0] ?? null;
  $: finishedBooks = books.filter((book) => book.status === 'read').length;
  $: studyTopics = studyState ? Object.values(studyState.topics) : [];
  $: assessedTopics = studyTopics.filter((topic) => topic.status !== 'unassessed').length;
  $: solidTopics = studyTopics.filter((topic) => topic.status === 'solid').length;
  $: studyPercent = PAEDIATRICS_SYLLABUS.length ? Math.round((assessedTopics / PAEDIATRICS_SYLLABUS.length) * 100) : 0;
  $: sportsWeek = summarizeSports(sportsActivities.filter((activity) => sportsWeekStart(activity.startDateLocal) === sportsWeekStart(new Date().toISOString())));

  function imageFor(item: WardrobeItem | LifeBook | null) {
    if (!item) return '';
    if ('title' in item && 'author' in item) return item.coverImageBase64 || item.coverUrl || '';
    const wardrobeItem = item as WardrobeItem;
    return wardrobeItem.imageBase64 || wardrobeItem.imageUrl || '';
  }
  function itemName(item: WardrobeItem) { return item.product || item.name || 'Wardrobe piece'; }

  async function optional<T>(area: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try { return await read(); }
    catch (error) {
      console.warn(`${area} dashboard summary unavailable`, error);
      unavailable = new Set([...unavailable, area]);
      return fallback;
    }
  }

  async function loadDashboard(uid: string) {
    loading = true;
    unavailable = new Set();
    const weekStart = startOfWeek(today);
    const todayStart = `${today}T00:00:00`;
    const nowIso = new Date().toISOString();
    const [itemSnap, habitSnap, taskSnap, bookSnap, entrySnap, stateSnap, dueCardsSnap, sessionSnap, outfitCount] = await Promise.all([
      optional('wardrobe', () => getDocs(collection(db, 'users', uid, 'items')), null),
      optional('life', () => getDocs(collection(db, 'users', uid, 'lifeHabits')), null),
      optional('life', () => getDocs(collection(db, 'users', uid, 'lifeTasks')), null),
      optional('life', () => getDocs(collection(db, 'users', uid, 'lifeBooks')), null),
      optional('life', () => getDocs(query(collection(db, 'users', uid, 'lifeEntries'), where('date', '>=', weekStart))), null),
      optional('study', () => getDoc(doc(db, 'users', uid, 'paediatricsTracker', 'state')), null),
      optional('study', () => getDocs(query(collection(db, 'users', uid, 'paediatricsRetentionCards'), where('dueAt', '<=', nowIso), limit(200))), null),
      optional('study', () => getDocs(query(collection(db, 'users', uid, 'paediatricsSessions'), where('date', '>=', todayStart), limit(25))), null),
      optional('outfits', () => getCountFromServer(collection(db, 'users', uid, 'outfits')), null)
    ]);
    items = itemSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() } as WardrobeItem)) ?? [];
    habits = habitSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LifeHabit)).filter((entry) => !entry.archived) ?? [];
    tasks = taskSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LifeTask)).filter((entry) => !entry.archived) ?? [];
    books = bookSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LifeBook)).filter((entry) => !entry.archived) ?? [];
    lifeEntries = entrySnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() } as LifeEntry)) ?? [];
    studyState = stateSnap?.exists() ? stateSnap.data() as PaediatricsState : null;
    dueRetention = dueCardsSnap?.docs.filter((entry) => entry.data().status === 'active').length ?? 0;
    questionsToday = sessionSnap?.docs.reduce((sum, entry) => sum + (Number(entry.data().questions) || 0), 0) ?? 0;
    savedOutfitCount = outfitCount?.data().count ?? 0;
    loading = false;
  }

  async function loadSportsSummary() {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const response = await firebaseAuthFetch(currentUser, '/api/sports?days=14');
      if (!response.ok) throw new Error('Sports summary unavailable');
      const data = await response.json();
      sportsActivities = Array.isArray(data.activities) ? data.activities : [];
    } catch (error) {
      console.warn('Sports dashboard summary unavailable', error);
      unavailable = new Set([...unavailable, 'sports']);
    }
  }

  onMount(() => {
    const unsubscribe = userReady.subscribe((ready) => {
      if (!ready) return;
      const uid = $user?.uid;
      if (!uid) { loading = false; return; }
      loadDashboard(uid);
      loadSportsSummary();
    });
    return unsubscribe;
  });
</script>

<svelte:head><title>Dashboard · Trackr</title></svelte:head>

<main class="dashboard-shell">
  {#if loading}
    <section class="loading-card" aria-live="polite"><span></span><p>Bringing your day together…</p></section>
  {:else}
    <section class="hero">
      <div class="hero-orb violet"></div><div class="hero-orb apricot"></div>
      <div class="hero-copy">
        <p class="eyebrow">{todayLong}</p>
        <h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {firstName}.</h1>
        <p class="hero-lead">Everything you track, in one calm place. See what needs attention, continue where you left off, or simply record today.</p>
        <div class="hero-actions"><button class="primary" on:click={() => goto('/life')}>Open today</button><button on:click={() => goto('/sports')}>View training</button><button on:click={() => goto('/outfit-studio')}>Build an outfit</button><button on:click={() => goto('/study')}>Continue study</button></div>
      </div>
      <div class="hero-visual" aria-label="Most-worn wardrobe pieces">
        {#each heroItems as item, index (item.id)}
          <button class="hero-piece piece-{index}" on:click={() => goto(`/clothing?editItem=${encodeURIComponent(item.id)}`)} title={itemName(item)}><img src={imageFor(item)} alt={itemName(item)} /></button>
        {:else}<div class="hero-monogram">T</div>{/each}
      </div>
    </section>

    <section class="pulse-grid" aria-label="Trackr overview">
      <button class="pulse life" on:click={() => goto('/life')}><span class="pulse-mark">01</span><div><small>Life today</small><strong>{completedHabits}/{dueHabits.length}</strong><p>{dueTasks.length ? `${dueTasks.length} recurring task${dueTasks.length === 1 ? '' : 's'} need attention` : 'No recurring tasks overdue'}</p></div></button>
      <button class="pulse wardrobe" on:click={() => goto('/wear-calendar')}><span class="pulse-mark">02</span><div><small>Today’s wardrobe</small><strong>{todayWears.reduce((sum, entry) => sum + entry.count, 0)}</strong><p>{todayWears.length ? `${todayWears.length} different pieces recorded` : 'Nothing recorded yet'}</p></div></button>
      <button class="pulse study" on:click={() => goto('/study/review')}><span class="pulse-mark">03</span><div><small>Study recall</small><strong>{dueRetention}</strong><p>{dueRetention ? 'retention cards ready for review' : `${questionsToday} questions logged today`}</p></div></button>
      <button class="pulse sports" on:click={() => goto('/sports')}><span class="pulse-mark">04</span><div><small>Sports this week</small><strong>{sportsWeek.count}</strong><p>{sportsWeek.count ? `${formatSportsDuration(sportsWeek.duration)} · ${Math.round(sportsWeek.load)} load` : 'No activities recorded yet'}</p></div></button>
    </section>

    <section class="today-section">
      <div class="section-heading"><div><p class="eyebrow">Right now</p><h2>Your day at a glance</h2></div><p>Small signals from across Trackr—only the things worth acting on.</p></div>
      <div class="focus-grid">
        <article class="focus-card life-focus">
          <div class="focus-head"><span>Life</span><button on:click={() => goto('/life')}>Open →</button></div>
          <h3>{dueHabits.length ? `${completedHabits} of ${dueHabits.length} habits complete` : 'Make today intentional'}</h3>
          <div class="habit-list">
            {#each dueHabits.slice(0, 3) as habit (habit.id)}
              <div class:done={isHabitComplete(lifeEntries, habit, today)}><span>{habit.emoji}</span><strong>{habit.name}</strong><i>{isHabitComplete(lifeEntries, habit, today) ? 'Done' : 'Today'}</i></div>
            {:else}<p>No habits scheduled. Add reading, piano, or another routine in Life.</p>{/each}
          </div>
          {#if dueTasks.length}<p class="attention">{dueTasks[0].emoji} {dueTasks[0].name}{dueTasks.length > 1 ? ` + ${dueTasks.length - 1} more` : ''}</p>{/if}
        </article>

        <article class="focus-card reading-focus">
          <div class="focus-head"><span>Reading</span><button on:click={() => goto('/life?tab=books')}>Bookshelf →</button></div>
          {#if activeBook}
            <div class="book-layout"><div class="book-cover">{#if imageFor(activeBook)}<img src={imageFor(activeBook)} alt={`Cover of ${activeBook.title}`} />{:else}<span>{activeBook.title.slice(0, 1)}</span>{/if}</div><div><small>Currently reading</small><h3>{activeBook.title}</h3><p>{activeBook.author}</p><div class="progress"><i style={`width:${bookProgress(activeBook)}%`}></i></div><strong>{bookProgress(activeBook)}% · page {activeBook.currentPage ?? 0}{activeBook.totalPages ? ` of ${activeBook.totalPages}` : ''}</strong></div></div>
          {:else}<div class="empty-focus"><h3>Choose your next book.</h3><p>Your active book and reading progress will appear here.</p><button on:click={() => goto('/life?tab=books')}>Open bookshelf</button></div>{/if}
        </article>

        <article class="focus-card study-focus">
          <div class="focus-head"><span>Paediatrics</span><button on:click={() => goto('/study')}>Open →</button></div>
          <div class="study-ring" style={`--progress:${studyPercent * 3.6}deg`}><div><strong>{studyPercent}%</strong><span>assessed</span></div></div>
          <div class="study-copy"><h3>{solidTopics} solid topics</h3><p>{assessedTopics} of {PAEDIATRICS_SYLLABUS.length} topics assessed · {questionsToday} questions today</p>{#if dueRetention}<button on:click={() => goto('/study/review')}>Review {dueRetention} due cards</button>{:else}<button on:click={() => goto('/study/plan')}>Open study plan</button>{/if}</div>
        </article>
      </div>
    </section>

    <section class="wardrobe-feature">
      <div class="wardrobe-copy"><p class="eyebrow">Wardrobe intelligence</p><h2>{activeItems.length} active pieces.<br />{totalWears.toLocaleString()} lived moments.</h2><p>Log what you wore, see complete outfits in the calendar, understand cost per wear, and create new combinations in the visual studio.</p><div class="wardrobe-actions"><button on:click={() => goto('/wear-calendar')}>Wear calendar</button><button on:click={() => goto('/analytics')}>View analytics</button></div></div>
      <div class="wardrobe-stats"><div><span>Active wardrobe</span><strong>{activeItems.length}</strong></div><div><span>Needs details</span><strong>{wardrobeNeedsDetails}</strong></div><div><span>Saved outfits</span><strong>{savedOutfitCount}</strong></div><button on:click={() => goto('/outfit-studio')}><span>Visual Outfit Studio</span><strong>Arrange freely →</strong></button></div>
    </section>

    <section class="explore-section">
      <div class="section-heading compact"><div><p class="eyebrow">Everything in Trackr</p><h2>One place for the whole system</h2></div></div>
      <div class="module-grid">
        <button class="module featured" on:click={() => goto('/outfit-studio')}><span class="module-no">01</span><div><small>Create</small><h3>Outfit Studio</h3><p>Generate by season, arrange pieces freely, and save complete looks.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/life')}><span class="module-no">02</span><div><small>Track</small><h3>Life & habits</h3><p>Habits, interval tasks, reading sessions, and your finished bookshelf.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/study')}><span class="module-no">03</span><div><small>Learn</small><h3>Study system</h3><p>Knowledge coverage, study plans, sessions, gaps, and spaced recall.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/sports')}><span class="module-no">04</span><div><small>Train</small><h3>Sports</h3><p>Intervals.icu activities, weekly load, fitness, fatigue, and form.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/clothing')}><span class="module-no">05</span><div><small>Organize</small><h3>Wardrobe</h3><p>Search, edit, enrich, and maintain every item in your inventory.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/analytics')}><span class="module-no">06</span><div><small>Understand</small><h3>Analytics</h3><p>Rotation, category balance, value, usage, and wear insights.</p></div><b>Open →</b></button>
        <button class="module" on:click={() => goto('/system')}><span class="module-no">07</span><div><small>Protect</small><h3>System health</h3><p>Storage estimates, traffic guidance, performance, and data tools.</p></div><b>Open →</b></button>
      </div>
    </section>

    <footer class="dashboard-footer"><div><span>Books finished</span><strong>{finishedBooks}</strong></div><div><span>Wardrobe wears</span><strong>{totalWears.toLocaleString()}</strong></div><div><span>Study coverage</span><strong>{studyPercent}%</strong></div><p>{unavailable.size ? 'Some summaries could not be loaded. Your stored data was not changed.' : 'All Trackr areas are connected.'}</p></footer>
  {/if}
</main>

<style>
  :global(body){background:#f4f4f1}:global(.main-content){max-width:1440px;padding-top:1rem}.dashboard-shell{width:min(100%,1360px);margin:0 auto;padding-bottom:5rem;color:#171717;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif}button{font:inherit}.eyebrow{margin:0;color:#777;font-size:.66rem;font-weight:850;letter-spacing:.13em;text-transform:uppercase}
  .loading-card{min-height:60vh;display:grid;place-content:center;justify-items:center;gap:1rem;color:#777}.loading-card span{width:34px;height:34px;border:3px solid #ddd;border-top-color:#171717;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .hero{position:relative;min-height:390px;padding:clamp(2rem,5vw,4.6rem);box-sizing:border-box;display:flex;align-items:center;overflow:hidden;border:1px solid rgba(255,255,255,.9);border-radius:34px;background:rgba(255,255,255,.8);box-shadow:0 28px 80px rgba(23,23,23,.07)}.hero-orb{position:absolute;border-radius:50%;filter:blur(5px);opacity:.55}.hero-orb.violet{width:430px;height:430px;left:-145px;top:-185px;background:radial-gradient(circle,#dcd5ff,transparent 70%)}.hero-orb.apricot{width:460px;height:460px;right:-110px;bottom:-250px;background:radial-gradient(circle,#ffe0c9,transparent 70%)}
  .hero-copy{position:relative;z-index:2;width:min(64%,760px)}.hero h1{max-width:760px;margin:.7rem 0 1rem;font-size:clamp(3rem,6.2vw,6.3rem);line-height:.88;letter-spacing:-.075em}.hero-lead{max-width:650px;margin:0;color:#626262;font-size:clamp(.9rem,1.3vw,1.08rem);line-height:1.55}.hero-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.65rem}.hero-actions button,.wardrobe-actions button{padding:.72rem 1rem;border:1px solid rgba(0,0,0,.09);border-radius:999px;background:rgba(255,255,255,.7);color:#222;cursor:pointer}.hero-actions .primary,.wardrobe-actions button:first-child{border-color:#171717;background:#171717;color:#fff}
  .hero-visual{position:absolute;z-index:1;right:3%;bottom:4%;width:35%;height:88%;pointer-events:none}.hero-piece{position:absolute;width:47%;height:54%;padding:0;border:0;background:transparent;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 20px 18px rgba(0,0,0,.1));transition:transform .25s ease}.hero-piece:hover{transform:translateY(-7px) rotate(1deg)}.hero-piece img{width:100%;height:100%;object-fit:contain}.piece-0{right:4%;top:0}.piece-1{left:0;top:10%}.piece-2{right:22%;bottom:0}.piece-3{left:4%;bottom:-4%;width:35%;height:35%}.hero-monogram{position:absolute;right:18%;top:24%;font-size:10rem;font-weight:900;opacity:.05}
  .pulse-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem;margin-top:.75rem}.pulse{min-width:0;padding:1.15rem;display:grid;grid-template-columns:36px minmax(0,1fr);gap:.85rem;border:1px solid rgba(255,255,255,.9);border-radius:20px;background:rgba(255,255,255,.82);color:inherit;text-align:left;cursor:pointer;box-shadow:0 14px 40px rgba(0,0,0,.035);transition:transform .2s ease,box-shadow .2s ease}.pulse:hover{transform:translateY(-3px);box-shadow:0 20px 48px rgba(0,0,0,.065)}.pulse-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:#eee;color:#666;font-size:.62rem;font-weight:850}.pulse.life .pulse-mark{background:#eee9ff;color:#6550d2}.pulse.wardrobe .pulse-mark{background:#ffecdd;color:#aa5b22}.pulse.study .pulse-mark{background:#e6eeff;color:#3c5ead}.pulse.sports .pulse-mark{background:#e4f2eb;color:#307451}.pulse small,.pulse strong,.pulse p{display:block}.pulse small{color:#777;font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pulse strong{margin:.25rem 0;font-size:1.8rem;line-height:1;letter-spacing:-.05em}.pulse p{margin:0;color:#777;font-size:.68rem;line-height:1.4}
  .today-section,.explore-section{margin-top:4rem}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;margin-bottom:1.1rem}.section-heading h2{margin:.35rem 0 0;font-size:clamp(1.8rem,3vw,3rem);letter-spacing:-.055em}.section-heading>p{max-width:410px;margin:0;color:#777;font-size:.78rem;line-height:1.5}.section-heading.compact{margin-bottom:1rem}.focus-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:.75rem}.focus-card{min-height:300px;padding:1.35rem;box-sizing:border-box;border:1px solid rgba(255,255,255,.95);border-radius:25px;background:#fff;box-shadow:0 18px 55px rgba(0,0,0,.045)}.life-focus{background:radial-gradient(circle at 100% 0,rgba(122,102,255,.13),transparent 45%),#fff}.reading-focus{background:radial-gradient(circle at 0 100%,rgba(255,173,91,.14),transparent 45%),#fff}.study-focus{background:radial-gradient(circle at 100% 100%,rgba(83,126,255,.13),transparent 45%),#fff}.focus-head{display:flex;align-items:center;justify-content:space-between}.focus-head>span{font-size:.67rem;font-weight:850;letter-spacing:.11em;text-transform:uppercase}.focus-head button{border:0;background:transparent;color:#777;font-size:.68rem;cursor:pointer}.focus-card>h3,.book-layout h3{margin:1.3rem 0 .85rem;font-size:1.35rem;letter-spacing:-.04em}
  .habit-list{display:grid;gap:.4rem}.habit-list>div{padding:.62rem .7rem;display:grid;grid-template-columns:26px minmax(0,1fr) auto;align-items:center;border-radius:12px;background:rgba(245,244,250,.9)}.habit-list strong{font-size:.75rem}.habit-list i{color:#8b82b6;font-size:.59rem;font-style:normal;font-weight:800;text-transform:uppercase}.habit-list .done{opacity:.56}.habit-list p,.empty-focus p{color:#777;font-size:.75rem;line-height:1.5}.attention{margin:.7rem 0 0;padding:.55rem .7rem;border-radius:10px;background:#fff1e7;color:#99592d;font-size:.68rem;font-weight:750}
  .book-layout{display:grid;grid-template-columns:110px minmax(0,1fr);gap:1.1rem;align-items:center;height:240px}.book-cover{height:168px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#eee4d8;box-shadow:0 16px 30px rgba(0,0,0,.13)}.book-cover img{width:100%;height:100%;object-fit:cover}.book-cover span{font-size:2rem;font-weight:900}.book-layout small{color:#a1683a;font-size:.61rem;font-weight:850;text-transform:uppercase}.book-layout h3{margin:.35rem 0}.book-layout p{margin:0;color:#777;font-size:.7rem}.progress{height:5px;margin:1rem 0 .45rem;overflow:hidden;border-radius:999px;background:#e6ded7}.progress i{display:block;height:100%;border-radius:inherit;background:#171717}.book-layout>div>strong{font-size:.62rem}.empty-focus{padding-top:3rem}.empty-focus button,.study-copy button{padding:.55rem .7rem;border:0;border-radius:999px;background:#171717;color:#fff;font-size:.65rem;cursor:pointer}
  .study-focus{display:grid;grid-template-columns:145px minmax(0,1fr);grid-template-rows:auto 1fr;gap:1rem}.study-focus .focus-head{grid-column:1/-1}.study-ring{position:relative;width:135px;height:135px;align-self:center;display:grid;place-items:center;border-radius:50%;background:conic-gradient(#5977ec var(--progress),#e8ebf5 0)}.study-ring:before{content:"";position:absolute;width:105px;height:105px;border-radius:50%;background:#fff}.study-ring>div{position:relative;z-index:1;text-align:center}.study-ring strong,.study-ring span{display:block}.study-ring strong{font-size:1.7rem;letter-spacing:-.06em}.study-ring span{color:#777;font-size:.58rem;text-transform:uppercase}.study-copy{align-self:center}.study-copy h3{margin:0;font-size:1.2rem;letter-spacing:-.04em}.study-copy p{margin:.5rem 0 1rem;color:#777;font-size:.7rem;line-height:1.5}
  .wardrobe-feature{position:relative;margin-top:4rem;padding:clamp(2rem,5vw,4rem);display:grid;grid-template-columns:1.25fr .75fr;gap:4rem;overflow:hidden;border-radius:30px;background:#171717;color:#fff;box-shadow:0 25px 70px rgba(0,0,0,.16)}.wardrobe-feature:after{content:"";position:absolute;width:470px;height:470px;right:-220px;top:-220px;border-radius:50%;background:radial-gradient(circle,rgba(117,92,255,.55),transparent 70%)}.wardrobe-copy,.wardrobe-stats{position:relative;z-index:1}.wardrobe-feature .eyebrow{color:#aaa}.wardrobe-copy h2{margin:.7rem 0 1rem;font-size:clamp(2.2rem,4.6vw,4.5rem);line-height:.95;letter-spacing:-.067em}.wardrobe-copy>p:not(.eyebrow){max-width:650px;color:#aaa;font-size:.82rem;line-height:1.6}.wardrobe-actions{display:flex;gap:.5rem;margin-top:1.4rem}.wardrobe-actions button:last-child{border-color:#555;background:transparent;color:#fff}.wardrobe-stats{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;align-content:center}.wardrobe-stats>div,.wardrobe-stats>button{min-height:105px;padding:1rem;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;border:1px solid #353535;border-radius:17px;background:#222;color:#fff;text-align:left}.wardrobe-stats span{color:#999;font-size:.62rem;font-weight:750;text-transform:uppercase}.wardrobe-stats strong{font-size:1.7rem;letter-spacing:-.05em}.wardrobe-stats>button{grid-column:1/-1;min-height:90px;background:#f1efe9;color:#171717;cursor:pointer}.wardrobe-stats>button span{color:#777}.wardrobe-stats>button strong{font-size:1rem}
  .module-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}.module{position:relative;min-height:220px;padding:1.25rem;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;border:1px solid rgba(255,255,255,.95);border-radius:22px;background:rgba(255,255,255,.84);color:inherit;text-align:left;cursor:pointer;box-shadow:0 14px 42px rgba(0,0,0,.035);transition:transform .2s ease}.module:hover{transform:translateY(-4px)}.module.featured{background:radial-gradient(circle at 100% 0,rgba(118,91,255,.25),transparent 48%),#fff}.module-no{position:absolute;right:1rem;top:.8rem;color:#d1d1d1;font-size:2.2rem;font-weight:900;letter-spacing:-.08em}.module small{color:#777;font-size:.61rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.module h3{margin:.4rem 0 .5rem;font-size:1.25rem;letter-spacing:-.04em}.module p{max-width:290px;margin:0;color:#777;font-size:.72rem;line-height:1.55}.module b{font-size:.68rem}.dashboard-footer{margin-top:.75rem;padding:1.2rem 1.4rem;display:grid;grid-template-columns:repeat(3,auto) 1fr;gap:2rem;align-items:center;border-radius:18px;background:#e9e9e5}.dashboard-footer span,.dashboard-footer strong{display:block}.dashboard-footer span{color:#777;font-size:.58rem;font-weight:800;text-transform:uppercase}.dashboard-footer strong{margin-top:.15rem;font-size:1rem}.dashboard-footer p{margin:0;color:#777;font-size:.66rem;text-align:right}
  @media(max-width:1050px){.pulse-grid{grid-template-columns:repeat(2,1fr)}.focus-grid{grid-template-columns:1fr 1fr}.study-focus{grid-column:1/-1}.module-grid{grid-template-columns:repeat(2,1fr)}.wardrobe-feature{gap:2rem}.hero-copy{width:68%}.hero-visual{right:0;width:38%}}
  @media(max-width:760px){:global(.main-content){padding:.7rem;padding-bottom:72px}.dashboard-shell{padding-bottom:2rem}.hero{min-height:520px;padding:2rem;align-items:flex-start}.hero-copy{width:100%}.hero h1{font-size:clamp(3rem,14vw,5rem)}.hero-lead{max-width:90%}.hero-visual{right:2%;bottom:-1%;width:62%;height:46%;opacity:.88}.pulse-grid,.focus-grid,.wardrobe-feature,.module-grid{grid-template-columns:1fr}.today-section,.explore-section,.wardrobe-feature{margin-top:2.5rem}.section-heading{align-items:flex-start;flex-direction:column;gap:.5rem}.study-focus{grid-column:auto}.wardrobe-feature{gap:2rem}.wardrobe-stats{grid-template-columns:1fr 1fr}.dashboard-footer{grid-template-columns:repeat(3,1fr);gap:1rem}.dashboard-footer p{grid-column:1/-1;text-align:left}}
  @media(max-width:500px){.hero{min-height:560px;border-radius:25px}.hero-actions button{flex:1}.pulse-grid{grid-template-columns:1fr}.study-focus{grid-template-columns:110px minmax(0,1fr)}.study-ring{width:105px;height:105px}.study-ring:before{width:79px;height:79px}.book-layout{grid-template-columns:90px minmax(0,1fr)}.book-cover{height:140px}.wardrobe-stats{grid-template-columns:1fr}.wardrobe-stats>button{grid-column:auto}.module-grid{grid-template-columns:1fr}.dashboard-footer{grid-template-columns:1fr 1fr}.dashboard-footer p{grid-column:1/-1}}
</style>
