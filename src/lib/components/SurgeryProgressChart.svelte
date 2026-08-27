<script lang="ts">
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import type { SessionSnapshot } from '$lib/study/surgerySchema';
  import type { StudyPlanProgress } from '$lib/study/studyPlanSchema';
  import { firstPassCompletionsByDay, groupSurgerySessionsByDay } from '$lib/study/surgeryChart';

  export let sessions: SessionSnapshot[] = [];
  export let planProgress: StudyPlanProgress | null = null;
  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  $: sessionDays = groupSurgerySessionsByDay(sessions, Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague');
  $: firstPassCounts = firstPassCompletionsByDay(planProgress);
  $: dates = [...new Set([...sessionDays.map((day) => day.date), ...Object.keys(firstPassCounts)])].sort();
  $: daily = dates.map((date) => {
    const exact = sessionDays.find((day) => day.date === date);
    const latest = [...sessionDays].reverse().find((day) => day.date <= date);
    return { date, snapshot: exact ?? latest, firstPasses: firstPassCounts[date] ?? 0 };
  });

  const labelFor = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function data() {
    return {
      labels: daily.map((day) => labelFor(day.date)),
      datasets: [
        {
          type: 'line' as const, label: 'Average oral mastery', data: daily.map((day) => day.snapshot?.averageMastery ?? null),
          borderColor: '#7c8cff', backgroundColor: 'rgba(124,140,255,.12)', fill: true, tension: .28,
          pointRadius: daily.length > 20 ? 2 : 3, pointHoverRadius: 5, borderWidth: 2.5, yAxisID: 'mastery', order: 1
        },
        {
          type: 'bar' as const, label: 'First passes completed', data: daily.map((day) => day.firstPasses),
          backgroundColor: 'rgba(103,211,174,.20)', borderColor: 'rgba(103,211,174,.55)', borderWidth: 1,
          borderRadius: 4, maxBarThickness: 22, yAxisID: 'activity', order: 2
        }
      ]
    };
  }

  function render() {
    if (!canvas) return;
    if (chart) {
      chart.data = data();
      chart.update('none');
      return;
    }
    chart = new Chart(canvas, {
      type: 'bar', data: data(),
      options: {
        responsive: true, maintainAspectRatio: false, resizeDelay: 80, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', align: 'start', labels: { color: '#8e95a9', usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 16 } },
          tooltip: { callbacks: { afterBody: (items) => { const day = daily[items[0]?.dataIndex]; if (!day) return []; return [`${day.firstPasses} first-pass ${day.firstPasses === 1 ? 'topic' : 'topics'} completed`, ...(day.snapshot ? [`${day.snapshot.assessedTopics} topics assessed in total`] : [])]; } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8e95a9', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, title: { display: true, text: 'Study day', color: '#71798c' } },
          mastery: { position: 'left', min: 0, max: 4, ticks: { stepSize: 1, color: '#8e95a9' }, grid: { color: 'rgba(142,149,169,.12)' }, title: { display: true, text: 'Average oral mastery (0–4)', color: '#8e95a9' } },
          activity: { position: 'right', beginAtZero: true, suggestedMax: 10, ticks: { precision: 0, stepSize: 1, color: '#718f86' }, grid: { display: false }, title: { display: true, text: 'First passes that day', color: '#718f86' } }
        }
      }
    });
  }

  onMount(() => { render(); return () => chart?.destroy(); });
  $: if (canvas && daily) render();
</script>

<div class="chart"><canvas bind:this={canvas}></canvas></div>

<style>.chart{position:relative;width:100%;height:clamp(250px,28vw,330px)}</style>
