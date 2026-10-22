<script lang="ts">
 import {page} from '$app/stores';
 let archivesOpen=false;
 let archiveMenu:HTMLDetailsElement;
 $: path=$page.url.pathname;
 $: archiveActive=path.startsWith('/study/paediatrics')||path.startsWith('/study/surgery');
 function outside(e:PointerEvent){if(archivesOpen&&archiveMenu&&!archiveMenu.contains(e.target as Node))archivesOpen=false;}
</script>
<svelte:window on:pointerdown={outside} on:keydown={e=>{if(e.key==='Escape')archivesOpen=false;}}/>
<nav class="study-nav" aria-label="Lernbereiche">
 <div class="subjects"><a href="/study/czech" class:active={path.startsWith('/study/czech')} aria-current={path.startsWith('/study/czech')?'page':undefined}>Tschechisch</a><a href="/study/medicine" class:active={path.startsWith('/study/medicine')} aria-current={path.startsWith('/study/medicine')?'page':undefined}>Medizin</a></div>
 <details bind:this={archiveMenu} bind:open={archivesOpen} class:current={archiveActive}><summary>Archive<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="archive-menu"><a href="/study/paediatrics" on:click={()=>archivesOpen=false} aria-current={path.startsWith('/study/paediatrics')?'page':undefined}><strong>Pädiatrie</strong><span>Bestanden · eingefroren</span></a><a href="/study/surgery" on:click={()=>archivesOpen=false} aria-current={path.startsWith('/study/surgery')?'page':undefined}><strong>Chirurgie</strong><span>Bestanden · eingefroren</span></a></div></details>
</nav>
<slot/>
<style>
 .study-nav{max-width:1360px;margin:0 auto 12px;padding:4px 20px 0;display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #303746;color:#aeb8ca;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.subjects{display:flex;gap:28px}.subjects>a{color:#aeb8ca;text-decoration:none;font-size:.95rem;font-weight:600;min-height:48px;display:flex;align-items:center;border-bottom:2px solid transparent;padding:4px 0;margin-bottom:-1px}.subjects>a.active{color:#eeeaff;border-color:#b4adff}details{position:relative;flex-shrink:0}summary{list-style:none;display:flex;gap:8px;align-items:center;cursor:pointer;min-height:48px;padding:4px 0;font-size:.85rem}summary::-webkit-details-marker{display:none}.current summary{color:#eeeaff}.archive-menu{position:absolute;z-index:30;right:0;top:100%;min-width:235px;background:#1b2230;border:1px solid #3b465a;border-radius:12px;padding:6px;box-shadow:0 14px 36px #0005}.archive-menu a{display:grid;gap:6px;padding:12px;color:#eef0f7;text-decoration:none;border-radius:7px;font-size:.85rem;min-height:44px}.archive-menu span{font-size:.72rem;color:#aab6ca}.archive-menu a[aria-current=page]{background:#343047}a:focus-visible,summary:focus-visible{outline:2px solid #c3bcff;outline-offset:4px}@media(hover:hover)and(pointer:fine){.subjects>a:hover{color:#fff}.archive-menu a:hover{background:#2b3446}}@media(max-width:600px){.study-nav{padding:0 8px;gap:16px}.subjects{gap:22px}.subjects>a{font-size:.9rem}}
</style>
