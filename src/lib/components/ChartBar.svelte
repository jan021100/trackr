<script lang="ts">
  import { onMount } from 'svelte';
  import Chart from 'chart.js/auto';
  let canvas: HTMLCanvasElement;
  export let labels: string[] = [];
  export let data: number[] = [];
  let chart: Chart;

  onMount(() => {
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Worn Count',
          data,
          backgroundColor: 'rgba(0,122,255,0.6)',
          borderRadius: 10,
          barPercentage: 0.6,
          categoryPercentage: 0.6
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#222',
            titleColor: '#fff',
            bodyColor: '#fff'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  });
</script>

<canvas bind:this={canvas}></canvas>