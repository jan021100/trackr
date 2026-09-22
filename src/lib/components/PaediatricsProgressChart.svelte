<script lang="ts">
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import type { SessionSnapshot } from '$lib/paediatrics/paediatricsSchema';
  import type { StudyPlanProgress } from '$lib/paediatrics/studyPlanSchema';
  import type { PaediatricsReviewEvent } from '$lib/paediatrics/paediatricsReview';
  import { groupPaediatricsSessionsByDay, structuredActivityByDay } from '$lib/paediatrics/paediatricsChart';

  export let sessions: SessionSnapshot[] = [];
  export let planProgress: StudyPlanProgress | null = null;
  export let reviewEvents: PaediatricsReviewEvent[] = [];
  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  $: sessionDays = groupPaediatricsSessionsByDay(sessions, Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague');
  $: structuredDays = structuredActivityByDay(planProgress, reviewEvents);
  $: dates = [...new Set([...sessionDays.map((day) => day.date), ...structuredDays.map((day) => day.date)])].sort();
  $: daily = dates.map((date) => {
    const exact = sessionDays.find((day) => day.date === date);
    const latest = [...sessionDays].reverse().find((day) => day.date <= date);
    const activity = structuredDays.find((day) => day.date === date);
    return { date, snapshot: exact ?? latest, firstPasses: activity?.firstPasses ?? 0, secondPasses: activity?.secondPasses ?? 0, thirdPasses: activity?.thirdPasses ?? 0, gapRepairTopics: activity?.gapRepairTopics ?? 0, gapRepairEquivalent: activity?.gapRepairEquivalent ?? 0, gapsTested: activity?.gapsTested ?? 0, gapsResolved: activity?.gapsResolved ?? 0, studySeconds: exact?.durationSeconds ?? 0, guidedStudySeconds: exact?.guidedDurationSeconds ?? 0, ankiStudySeconds: exact?.ankiDurationSeconds ?? 0 };
  });

  const labelFor = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = (seconds: number) => { const hours=Math.floor(seconds/3600),minutes=Math.round((seconds%3600)/60); return hours?`${hours}h ${minutes}m`:`${minutes}m`; };

  function data() {
    return {
      labels: daily.map((day) => labelFor(day.date)),
      datasets: [
        {
          type: 'bar' as const, label: 'Pass 2 · Exam recall', data: daily.map((day) => day.thirdPasses),
          backgroundColor: 'rgba(57,164,182,.30)', borderColor: 'rgba(80,191,207,.80)', borderWidth: 1,
          borderRadius: 5, categoryPercentage: .78, barPercentage: .86, maxBarThickness: 38, yAxisID: 'topics', stack: 'passes', order: 2
        },
        {
          type: 'bar' as const, label: 'Pass 0 · Learned', data: daily.map((day) => day.firstPasses),
          backgroundColor: 'rgba(111,145,103,.28)', borderColor: 'rgba(137,174,126,.72)', borderWidth: 1,
          borderRadius: 5, categoryPercentage: .78, barPercentage: .86, maxBarThickness: 38, yAxisID: 'topics', stack: 'passes', order: 2
        },
        {
          type: 'bar' as const, label: 'Pass 1 · Recalled', data: daily.map((day) => day.secondPasses),
          backgroundColor: 'rgba(63,174,139,.30)', borderColor: 'rgba(82,211,169,.80)', borderWidth: 1,
          borderRadius: 5, categoryPercentage: .78, barPercentage: .86, maxBarThickness: 38, yAxisID: 'topics', stack: 'passes', order: 2
        },
        {
          type: 'bar' as const, label: 'Gap repair (¼ topic each)', data: daily.map((day) => day.gapRepairEquivalent),
          backgroundColor: 'rgba(100,130,210,.32)', borderColor: 'rgba(126,157,239,.82)', borderWidth: 1,
          borderRadius: 5, categoryPercentage: .78, barPercentage: .86, maxBarThickness: 38, yAxisID: 'topics', stack: 'passes', order: 2
        },
        {
          type: 'line' as const, label: 'Guided study time', data: daily.map((day) => day.guidedStudySeconds > 0 ? Number((day.guidedStudySeconds / 3600).toFixed(2)) : null),
          borderColor: '#e0a467', backgroundColor: 'rgba(224,164,103,.12)', tension: .28, spanGaps: false,
          pointBackgroundColor: '#171b23', pointBorderColor: '#e0a467', pointBorderWidth: 2,
          pointRadius: daily.length > 20 ? 2 : 3, pointHoverRadius: 5, borderWidth: 2.5, yAxisID: 'time', order: 1
        },
        {
          type: 'line' as const, label: 'Anki review time', data: daily.map((day) => day.ankiStudySeconds > 0 ? Number((day.ankiStudySeconds / 3600).toFixed(2)) : null),
          borderColor: '#9b8cff', backgroundColor: 'rgba(155,140,255,.10)', tension: .28, spanGaps: false,
          pointBackgroundColor: '#171b23', pointBorderColor: '#9b8cff', pointBorderWidth: 2,
          pointRadius: daily.length > 20 ? 2 : 3, pointHoverRadius: 5, borderWidth: 2.5, borderDash: [5, 3], yAxisID: 'time', order: 1
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
          tooltip: { callbacks: {
            label: (item) => item.dataset.label === 'Guided study time'
              ? `Guided time: ${timeLabel(daily[item.dataIndex]?.guidedStudySeconds ?? 0)}`
              : item.dataset.label === 'Anki review time'
                ? `Anki review time: ${timeLabel(daily[item.dataIndex]?.ankiStudySeconds ?? 0)}`
                : `${item.dataset.label}: ${item.formattedValue}`,
            afterBody: (items) => {
              const day = daily[items[0]?.dataIndex];
              if (!day) return [];
              const structuredTopics=day.firstPasses+day.secondPasses+day.thirdPasses+day.gapRepairEquivalent;
              const efficiency = structuredTopics > 0 && day.studySeconds > 0 ? `${Math.round(day.studySeconds / 60 / structuredTopics)} min per topic-equivalent` : null;
              const gapDetail = day.gapsTested > 0 ? `${day.gapRepairTopics} gap-repair topics (${day.gapRepairEquivalent.toFixed(2)} equivalent) · ${day.gapsTested} gaps tested · ${day.gapsResolved} resolved` : null;
              return [efficiency,gapDetail,day.studySeconds === 0 ? 'No tracked timer data for this day' : null].filter((line): line is string => Boolean(line));
            }
          } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#8e95a9', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, title: { display: true, text: 'Study day', color: '#71798c' } },
          topics: { stacked: true, position: 'left', beginAtZero: true, suggestedMax: 10, ticks: { precision: 0, stepSize: 1, color: '#718f86' }, grid: { color: 'rgba(142,149,169,.12)' }, title: { display: true, text: 'Topic-equivalent output', color: '#718f86' } },
          time: { position: 'right', beginAtZero: true, suggestedMax: 1, ticks: { color: '#a88c72', callback: (value) => `${value}h` }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Tracked study time', color: '#a88c72' } }
        }
      }
    });
  }

  onMount(() => { render(); return () => chart?.destroy(); });
  $: if (canvas && daily) render();
</script>

<div class="chart-note"><strong>Output versus effort</strong><span>Pass 0, 1 and 2 each count as one topic completed in that round; blue Gap Repair counts as ¼ topic per reviewed topic. Orange is guided study time; violet is Anki review time imported during validation. Same-day passes are never duplicated as Gap Repair.</span></div>
<div class="chart"><canvas bind:this={canvas}></canvas></div>

<style>.chart-note{display:flex;align-items:baseline;gap:9px;margin:0 0 8px;color:#8e95a9;font-size:.65rem}.chart-note strong{color:#e7eaf2;font-size:.7rem}.chart{position:relative;width:100%;height:clamp(280px,32vw,370px)}@media(max-width:600px){.chart-note{display:block}.chart-note span{display:block;margin-top:4px;line-height:1.4}.chart{height:310px}}</style>
