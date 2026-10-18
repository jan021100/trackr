<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PaediatricsState } from '$lib/paediatrics/paediatricsSchema';
  import type { ReviewQueueEntry, PaediatricsReviewEvent } from '$lib/paediatrics/paediatricsReview';
  import { rapidFireQueue, makeRapidFirePrompt } from '$lib/paediatrics/rapidFire';
  export let queue: ReviewQueueEntry[];
  export let state: PaediatricsState;
  export let events: PaediatricsReviewEvent[];
  export let today: string;
  export let examDate: string;
  export let oncopy: (ids: string[]) => Promise<boolean>;
  let copying = false;
  let message = '';
  let pastedPrompt = '';
  let remaining = 300;
  let deadline = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let timedTopic = '';
  $: pending = rapidFireQueue(queue, events, today);
  $: batch = pending.slice(0,4);
  function stop() { if (interval) clearInterval(interval); interval = undefined; }
  function start(id: string) {
    stop(); timedTopic=id; remaining=300; deadline=Date.now()+300000;
    interval=setInterval(()=>{remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));if(!remaining)stop();},250);
  }
  async function copy() {
    if(copying)return;
    copying=true;
    const ids=batch.map(entry=>entry.topicId);
    pastedPrompt=makeRapidFirePrompt(batch,state,examDate);
    try {
      await navigator.clipboard.writeText(pastedPrompt);
      const started=await oncopy(ids);
      message=started?'Copied · study timer running for this block. Finish saves active time equally across these topics.':'Prompt copied; timer was not started. Check the active timer before studying.';
    } catch {message='Copy or timer start failed. Check the timer; the prompt is available below for manual copying.';}
    finally {copying=false;}
  }
  onDestroy(stop);
</script>
<section class="rapid-fire">
  <header><div><small>RAPID FIRE · 4 TOPICS × 5 MIN</small><h3>{pending.length} topics remaining today</h3></div><strong class:expired={remaining===0}>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</strong></header>
  <p>Same priority as the study queue. A limited assessment, capped at 15/20; it cannot raise your previous score or complete a normal pass.</p>
  {#each batch as entry}
    <div class="topic"><div><b>{entry.topicId} · {entry.title}</b><small>{entry.reasons.slice(0,2).join(' · ')}</small></div><button on:click={()=>start(entry.topicId)}>5 min{timedTopic===entry.topicId?' ↻':''}</button></div>
  {/each}
  {#if remaining===0}<p class="expired">Time: close {timedTopic}, record the sampled result, then move on.</p>{/if}
  {#if batch.length}<button class="copy" disabled={copying} on:click={copy}>Copy 4-topic rapid prompt</button>{:else}<p>Today's rapid sweep is complete. Use Gap repair for targeted follow-up.</p>{/if}
  <p>Start the countdown for each topic. The countdown paces each topic; the normal study timer tracks the block, including pause/resume. Finish splits active time equally across the copied topics; Cancel discards it. After importing the patch, the next four topics appear automatically. Untested topics stay in the queue.</p>
  {#if message}<p role="status">{message}</p>{/if}
  {#if pastedPrompt}<details><summary>Prompt / manual copy</summary><textarea readonly value={pastedPrompt} aria-label="Rapid Fire prompt"></textarea></details>{/if}
</section>
<style>
  .rapid-fire{grid-column:1/-1;min-width:0;color:#e7e9f1}header{display:flex;justify-content:space-between;align-items:center;gap:16px}header small{color:#929bb0;font-size:.65rem;letter-spacing:.12em}h3{margin:6px 0;font-size:1.2rem}header strong{font:700 2rem monospace;color:#aba5ff}p{color:#949eb1;font-size:.78rem;line-height:1.5}.topic{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px;margin:8px 0;border:1px solid #323a49;border-radius:12px;background:#141922}.topic div{min-width:0}.topic b{font-size:.82rem}.topic small{display:block;margin-top:5px;color:#929bb0;font-size:.7rem}button{cursor:pointer;flex-shrink:0;border:1px solid #4d526a;border-radius:9px;background:#262b3a;color:#ecedff;padding:10px;font-weight:700}.copy{background:#8580ff;color:#111326;margin-top:8px}.expired{color:#ff8294}textarea{box-sizing:border-box;width:100%;min-height:140px;background:#10141b;color:#ddd;padding:12px}summary{cursor:pointer;color:#a4abc0;font-size:.75rem}
</style>
