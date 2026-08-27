<script lang="ts">
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  import { sportsWellnessSeries, type SportsWellness } from '$lib/utils/sports';

  export let wellness: SportsWellness[] = [];

  let loadCanvas: HTMLCanvasElement;
  let formCanvas: HTMLCanvasElement;
  let loadChart: Chart | null = null;
  let formChart: Chart | null = null;
  let mounted = false;
  $: seriesKey = wellness.map((entry) => `${entry.date}:${entry.fitness}:${entry.fatigue}:${entry.form}`).join('|');
  $: if (mounted && seriesKey) renderCharts();

  function commonOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      interaction: { intersect: false, mode: 'index' as const },
      elements: { point: { radius: 0, hitRadius: 10 }, line: { borderWidth: 2, tension: .28 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          titleFont: { size: 10 },
          bodyFont: { size: 10 },
          padding: 8
        }
      }
    };
  }

  function renderCharts() {
    if (!loadCanvas || !formCanvas) return;
    const series = sportsWellnessSeries(wellness);
    loadChart?.destroy();
    formChart?.destroy();
    loadChart = new Chart(loadCanvas, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          { label: 'Fitness', data: series.fitness, borderColor: '#56b7df', backgroundColor: 'rgba(86,183,223,.1)', fill: true },
          { label: 'Fatigue', data: series.fatigue, borderColor: '#7658e8', backgroundColor: 'transparent' }
        ]
      },
      options: {
        ...commonOptions(),
        scales: {
          x: { display: false, grid: { display: false } },
          y: { beginAtZero: true, ticks: { display: false }, border: { display: false }, grid: { color: 'rgba(22,25,22,.06)', drawTicks: false } }
        }
      }
    });
    formChart = new Chart(formCanvas, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [{ label: 'Form', data: series.form, borderColor: '#778bea', backgroundColor: 'transparent' }]
      },
      options: {
        ...commonOptions(),
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { maxTicksLimit: 4, maxRotation: 0, color: '#8b8f8b', font: { size: 8 }, callback: (_value, index) => series.shortLabels[index] }
          },
          y: {
            suggestedMin: -20,
            suggestedMax: 15,
            ticks: { display: false },
            border: { display: false },
            grid: { color: (context) => context.tick.value === 0 ? 'rgba(22,25,22,.18)' : 'rgba(22,25,22,.045)', drawTicks: false }
          }
        }
      }
    });
  }

  onMount(() => {
    mounted = true;
    renderCharts();
    return () => { loadChart?.destroy(); formChart?.destroy(); };
  });
</script>

<div class="history-chart" aria-label="Fitness, fatigue and form history">
  <div class="chart-key"><span class="fitness">Fitness</span><span class="fatigue">Fatigue</span><span class="form">Form</span></div>
  <div class="load-chart"><canvas bind:this={loadCanvas}></canvas></div>
  <div class="form-chart"><span>FORM</span><canvas bind:this={formCanvas}></canvas></div>
</div>

<style>
  .history-chart{margin-top:1.15rem;padding-top:.75rem;border-top:1px solid #eceeea}.chart-key{display:flex;gap:.75rem;margin-bottom:.35rem;color:#777;font-size:.5rem;font-weight:800;text-transform:uppercase}.chart-key span{display:flex;align-items:center;gap:.25rem}.chart-key span::before{content:"";width:12px;height:2px;border-radius:99px;background:#56b7df}.chart-key .fatigue::before{background:#7658e8}.chart-key .form::before{background:#778bea}.load-chart{height:92px}.form-chart{position:relative;height:61px;margin-top:3px;padding-top:3px;border-top:1px solid #eef0ec;background:linear-gradient(to bottom,rgba(255,205,87,.06),rgba(86,183,223,.045) 40%,rgba(85,204,117,.045) 72%,rgba(238,86,86,.035))}.form-chart>span{position:absolute;z-index:1;top:7px;left:4px;color:#999;font-size:.43rem;font-weight:850;letter-spacing:.08em}.load-chart canvas,.form-chart canvas{width:100%!important;height:100%!important}
</style>
