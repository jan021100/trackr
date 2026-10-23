<script lang="ts">
 import {onMount} from 'svelte';
 import {auth} from '$lib/firebase';
 export let uid:string;
 let ready=false,busy=false,error='',path='',notice='',owner=uid;
 $: feedUrl=path&&typeof window!=='undefined'?new URL(path,window.location.origin).href:'';
 $: subscribeUrl=feedUrl.replace(/^https?:/,'webcal:');
 onMount(()=>{void update('GET');});
 async function update(method:'GET'|'POST'|'DELETE'){
  if(busy)return;busy=true;error='';notice='';
  try{const account=auth.currentUser;if(!account||account.uid!==uid||uid!==owner)throw new Error('Bitte erneut anmelden.');const token=await account.getIdToken();
   const response=await fetch('/api/medicine/calendar',{method,headers:{Authorization:`Bearer ${token}`}});const data=await response.json();if(!response.ok)throw new Error(data.error??'Kalender nicht erreichbar.');
   if(auth.currentUser?.uid!==owner)return;path=data.enabled?data.path:'';ready=true;if(method==='DELETE')notice='Abo-Link deaktiviert. Bereits heruntergeladene Termine entfernt Apple dadurch nicht zwingend; das Abo bei Bedarf in Kalender entfernen.';
  }catch(e){error=e instanceof Error?e.message:'Kalender nicht erreichbar.';}finally{busy=false;}
 }
 async function copy(){try{await navigator.clipboard.writeText(feedUrl);notice='Privaten Abo-Link kopiert.';}catch{notice='Bitte den Link im Feld manuell kopieren.';}}
</script>
<section class="calendar" aria-labelledby="calendar-title">
 <h2 id="calendar-title">Lernzeiten im Kalender.</h2>
 <p>Ein eigener Kalender für abgeschlossene Medizin-Sessions. Start bis Ende, inklusive Pausen. Liegen weniger als 15 Minuten dazwischen, werden Sessions zu einem Block zusammengefasst. Laufende und abgebrochene Timer erscheinen nicht.</p>
 {#if error}<p role="alert" class="error">{error}</p><button disabled={busy} on:click={()=>update('GET')}>Erneut versuchen</button>{/if}
 {#if notice}<p role="status">{notice}</p>{/if}
 {#if !ready&&!error}<p role="status">Kalenderstatus wird geladen…</p>{:else if !path}
 <p>Beim Aktivieren entsteht ein privater Abo-Link. Wer den Link kennt, kann deine Lernzeiträume sehen. Falltexte, Fachbewertungen und Lücken werden nicht übertragen.</p>
 <button class="primary" disabled={busy} on:click={()=>update('POST')}>Privaten Kalender-Link aktivieren</button>
 {:else}
 <ol><li>„In Apple Kalender abonnieren“ öffnen oder den Link kopieren und auf dem Mac unter <strong>Ablage → Neues Kalenderabonnement</strong> einfügen.</li><li>Als Ort <strong>iCloud</strong> wählen, damit das Abo auch auf dem iPhone erscheint.</li><li>Automatisch aktualisieren einstellen. Neue Lernblöcke erscheinen nach der nächsten Aktualisierung.</li></ol>
 <div class="actions"><a class="primary" href={subscribeUrl} referrerpolicy="no-referrer">In Apple Kalender abonnieren</a><button on:click={copy}>Abo-Link kopieren</button></div>
 <details><summary>Privaten Link anzeigen / manuell kopieren</summary><input readonly value={feedUrl} aria-label="Privater Kalender-Abo-Link" autocomplete="off" spellcheck="false"/></details>
 <p class="small">Das Abo ist schreibgeschützt. Es enthält auch bereits gespeicherte Medizin-Lernzeiten und benötigt kein iCloud-Passwort in Trackr. Ein deaktivierter Link lässt sich nicht mehr abrufen; erneutes Aktivieren erzeugt einen neuen.</p>
 <button disabled={busy} on:click={()=>update('DELETE')}>Abo-Link deaktivieren</button>
 {/if}
</section>
<style>
 .calendar{max-width:760px}h2{font-size:1.35rem;margin:0 0 12px;color:#edf0f6}p,li{font-size:.88rem;line-height:1.7;color:#adb7c9}li{margin:10px 0}ol{padding-left:24px}.small{font-size:.76rem}button,a{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:44px;padding:10px 14px;border:1px solid #303b4d;border-radius:8px;background:#1d2533;color:#e9ecf5;font:inherit;font-size:.82rem;text-decoration:none;cursor:pointer;touch-action:manipulation}.primary{background:#b4adff;color:#1b1631;border-color:#b4adff;font-weight:700}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}button:disabled{opacity:.5;cursor:wait}summary{font-size:.8rem;line-height:1.5;cursor:pointer;min-height:44px;display:flex;align-items:center}input{width:100%;box-sizing:border-box;min-height:44px;background:#111824;color:#edf0f6;border:1px solid #303b4d;border-radius:8px;padding:10px;font-size:16px}.error{color:#ffc3d2}:is(button,a,input,summary):focus-visible{outline:2px solid #c6beff;outline-offset:4px}@media(max-width:600px){.actions>*{width:100%}}@media(hover:hover)and(pointer:fine){button:not(:disabled):hover{background:#373247}.primary:hover{background:#cbc4ff}}
</style>
