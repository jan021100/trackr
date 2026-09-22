<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  $: subject=$page.url.pathname.startsWith('/study/surgery')?'surgery':'paediatrics';
</script>
<div class="subject-bar"><label for="study-subject">Subject</label><select id="study-subject" value={subject} on:change={(e)=>goto(e.currentTarget.value==='surgery'?'/study/surgery':'/study')}><option value="paediatrics">Paediatrics · Active</option><option value="surgery">Surgery · Passed / frozen</option></select></div>
<slot />
<style>.subject-bar{display:flex;justify-content:flex-end;align-items:center;gap:.7rem;max-width:1500px;margin:0 auto;padding:.25rem .5rem;color:#aeb5c7;font-size:.875rem}.subject-bar select{background:#171c27;color:#f0f2fa;border:1px solid #343d51;border-radius:10px;padding:.65rem .85rem;font:inherit;min-height:44px;max-width:100%}@media(max-width:480px){.subject-bar{padding:.25rem 0}.subject-bar label{display:none}}</style>
