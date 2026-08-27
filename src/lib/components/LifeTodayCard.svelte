<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { collection, getDocs, query, where } from 'firebase/firestore';
  import { db } from '$lib/firebase';
  import { user, userReady } from '$lib/stores/user';
  import {
    isHabitComplete,
    isHabitScheduledOn,
    localDateKey,
    startOfWeek,
    taskDueState,
    type LifeEntry,
    type LifeHabit,
    type LifeTask
  } from '$lib/utils/lifeTracker';

  let loading = true;
  let available = true;
  let habits: LifeHabit[] = [];
  let tasks: LifeTask[] = [];
  let entries: LifeEntry[] = [];
  const today = localDateKey();

  $: dueHabits = habits.filter((habit) => isHabitScheduledOn(habit, today));
  $: completedHabits = dueHabits.filter((habit) => isHabitComplete(entries, habit, today)).length;
  $: dueTasks = tasks.filter((task) => {
    const state = taskDueState(task, task.lastCompletedDate
      ? [{ id: 'summary', kind: 'task', taskId: task.id, date: task.lastCompletedDate }]
      : [], today);
    return state.tone === 'new' || state.tone === 'due' || state.tone === 'overdue';
  });

  onMount(() => {
    const unsubscribe = userReady.subscribe(async (ready) => {
      if (!ready) return;
      const uid = $user?.uid;
      if (!uid) {
        loading = false;
        return;
      }
      try {
        const [habitSnap, taskSnap, entrySnap] = await Promise.all([
          getDocs(collection(db, 'users', uid, 'lifeHabits')),
          getDocs(collection(db, 'users', uid, 'lifeTasks')),
          getDocs(query(collection(db, 'users', uid, 'lifeEntries'), where('date', '>=', startOfWeek(today))))
        ]);
        habits = habitSnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeHabit)).filter((item) => !item.archived);
        tasks = taskSnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeTask)).filter((item) => !item.archived);
        entries = entrySnap.docs.map((item) => ({ id: item.id, ...item.data() } as LifeEntry));
      } catch (error) {
        console.warn('Life summary unavailable.', error);
        available = false;
      } finally {
        loading = false;
      }
    });
    return unsubscribe;
  });
</script>

<section class="life-card" aria-label="Life tracker today">
  <div>
    <p>Life · Today</p>
    {#if loading}
      <h2>Loading your day…</h2>
    {:else if !available}
      <h2>Life is ready after its security rules are published.</h2>
    {:else if !habits.length && !tasks.length}
      <h2>Build routines that leave room for real life.</h2>
      <span>Start with reading, piano practice, or a recurring household task.</span>
    {:else}
      <h2>{completedHabits} of {dueHabits.length} habits · {dueTasks.length} task{dueTasks.length === 1 ? '' : 's'} due</h2>
      <span>{dueTasks.length ? `${dueTasks[0].emoji} ${dueTasks[0].name}${dueTasks.length > 1 ? ` and ${dueTasks.length - 1} more` : ''}` : 'Nothing overdue. Your day is clear.'}</span>
    {/if}
  </div>
  <button on:click={() => goto('/life')}>{habits.length || tasks.length ? 'Open today' : 'Set up Life'}</button>
</section>

<style>
  .life-card{margin:1rem 0;padding:1.1rem 1.2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border:1px solid rgba(94,73,219,.14);border-radius:22px;background:radial-gradient(circle at 8% 10%,rgba(117,92,255,.15),transparent 32%),radial-gradient(circle at 90% 70%,rgba(76,179,135,.12),transparent 34%),rgba(255,255,255,.78);box-shadow:0 16px 45px rgba(28,22,67,.06)}
  p{margin:0 0 .35rem;color:#735be2;font-size:.66rem;font-weight:850;letter-spacing:.11em;text-transform:uppercase}
  h2{margin:0;font-size:1.08rem;letter-spacing:-.02em}
  span{display:block;margin-top:.28rem;color:#717171;font-size:.76rem}
  button{flex-shrink:0;padding:.65rem .95rem;border:0;border-radius:999px;background:#171717;color:#fff;font:inherit;font-size:.72rem;font-weight:800;cursor:pointer}
  @media(max-width:620px){.life-card{align-items:flex-start;flex-direction:column}.life-card button{width:100%}}
</style>
