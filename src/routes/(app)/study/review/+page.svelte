<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { SURGERY_SYLLABUS } from '$lib/study/surgerySyllabus';
  import { cardIntervalPreviews, cardsFromTsv, cardsToTsv, createRetentionCard, removeDuplicateCardInputs, retentionCardFingerprint, reviewCard, todayLocal, validateCardImport, type CardRating, type RetentionCard, type RetentionCardStatus } from '$lib/study/retentionSchema';
  import { deleteRetentionCard, saveRetentionCard, saveRetentionCards, subscribeToRetentionCards } from '$lib/study/surgeryRepository';

  let cards: RetentionCard[] = [];
  let loading = true; let saving = false; let error = ''; let notice = '';
  let subscribedUid = ''; let unsubscribe: (() => void) | null = null;
  let mode: 'review' | 'library' | 'create' = 'review'; let revealed = false;
  let topicFilter = 'all'; let statusFilter: 'all' | RetentionCardStatus = 'active'; let search = '';
  let front = ''; let back = ''; let context = ''; let tags = ''; let topicId = SURGERY_SYLLABUS[0].id; let gapId = '';
  let importInput: HTMLInputElement;
  let chatGptJson = '';
  $: uid = $user?.uid as string | undefined;
  $: if (uid && uid !== subscribedUid) { unsubscribe?.(); subscribedUid = uid; loading = true; unsubscribe = subscribeToRetentionCards(uid, (value) => { cards = value; loading = false; }, fail); }
  onDestroy(() => unsubscribe?.());
  const titleFor = (id: string) => SURGERY_SYLLABUS.find((topic) => topic.id === id)?.title ?? id;
  $: dueCards = cards.filter((card) => card.status === 'active' && new Date(card.dueAt).getTime() <= Date.now()).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
  $: current = dueCards[0];
  $: intervals = current ? cardIntervalPreviews(current) : null;
  $: filtered = cards.filter((card) => (topicFilter === 'all' || card.topicId.startsWith(topicFilter)) && (statusFilter === 'all' || card.status === statusFilter) && (!search.trim() || `${card.front} ${card.back} ${card.tags.join(' ')} ${card.topicId}`.toLowerCase().includes(search.toLowerCase()))).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  $: stats = { due: dueCards.length, active: cards.filter(c => c.status === 'active').length, reviewed: cards.reduce((n,c) => n+c.reviews.length,0), leeches: cards.filter(c => c.lapses >= 4).length };

  function fail(reason: unknown) { error = reason instanceof Error ? reason.message : 'Something went wrong.'; loading = false; saving = false; }
  async function rate(rating: CardRating) { if (!uid || !current || saving) return; revealed = false; saving = true; try { await saveRetentionCard(uid, reviewCard(current, rating)); } catch(e){ fail(e); } finally { saving=false; } }
  function handleShortcut(event: KeyboardEvent) {
    if (mode !== 'review' || !current || saving || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (revealed) void rate('good'); else revealed = true;
      return;
    }
    if (!revealed) return;
    const ratings: Record<string, CardRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
    const rating = ratings[event.key];
    if (rating) { event.preventDefault(); void rate(rating); }
  }
  onMount(() => { window.addEventListener('keydown', handleShortcut); return () => window.removeEventListener('keydown', handleShortcut); });
  async function createCard() { if (!uid) return; saving=true; try { const card=createRetentionCard({topicId,gapId:gapId||undefined,front,back,clinicalContext:context,tags:tags.split(/[,\s]+/).filter(Boolean)}); if(cards.some(existing=>retentionCardFingerprint(existing)===retentionCardFingerprint(card)))throw new Error('An equivalent card already exists for this topic.'); await saveRetentionCard(uid,card); front='';back='';context='';tags='';gapId='';notice='Retention card created.';mode='library'; } catch(e){fail(e)} finally{saving=false} }
  async function setStatus(card: RetentionCard, status: RetentionCardStatus) { if(!uid)return; await saveRetentionCard(uid,{...card,status,updatedAt:new Date().toISOString()}); }
  function download(name:string,text:string){const blob=new Blob([text],{type:'text/tab-separated-values;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
  function exportTsv(){download(`trackr-retention-cards-${todayLocal()}.txt`,cardsToTsv(filtered))}
  async function importTsv(event:Event){const file=(event.currentTarget as HTMLInputElement).files?.[0];if(!file||!uid)return;try{const inputs=cardsFromTsv(await file.text(),topicId);const {unique,skipped}=removeDuplicateCardInputs(inputs,cards);const created=unique.map(i=>createRetentionCard(i));if(created.length)await saveRetentionCards(uid,created);notice=`Imported ${created.length} cards${skipped?`; skipped ${skipped} duplicate${skipped===1?'':'s'}`:''}.`;}catch(e){fail(e)}finally{importInput.value=''}}
  async function importChatGptCards(){if(!uid)return;try{const payload=validateCardImport(JSON.parse(chatGptJson));const {unique,skipped}=removeDuplicateCardInputs(payload.cards,cards);const created=unique.map(input=>createRetentionCard(input));if(!created.length)throw new Error(`No new cards to import; ${skipped} duplicate${skipped===1?' was':'s were'} skipped.`);saving=true;await saveRetentionCards(uid,created);chatGptJson='';notice=`Imported ${created.length} ChatGPT-generated cards; skipped ${skipped} duplicate${skipped===1?'':'s'}.`;}catch(e){fail(e)}finally{saving=false}}
  async function removeCard(card:RetentionCard){if(!uid||saving)return;if(!confirm(`Delete this retention card?\n\n${card.front}\n\nIts review history will also be deleted. The linked topic and knowledge gap will remain.`))return;saving=true;try{await deleteRetentionCard(uid,card.id);notice='Retention card deleted.';}catch(e){fail(e)}finally{saving=false}}
  async function copyCardPrompt(){const prompt=`You generate retention cards for my Trackr Surgery State Exam tracker.

Return exactly one valid JSON object. Do not use Markdown, commentary, or code fences.

FORMAT:
{
  "kind": "trackr-retention-cards",
  "schemaVersion": 1,
  "cards": [
    {
      "id": "optional-stable-unique-id",
      "topicId": "TO2-16",
      "gapId": "optional-existing-knowledge-gap-id",
      "sourceSessionId": "optional-source-session-id",
      "front": "One focused retrieval question",
      "back": "Concise expected answer",
      "clinicalContext": "Optional short vignette or context",
      "tags": ["weakspot", "differential-diagnosis", "oral-follow-up"]
    }
  ]
}

ALLOWED TOPIC IDS:
- TO1-01 through TO1-40
- TO2-01 through TO2-72
- TO3-01 through TO3-39
- TO4-01 through TO4-45

RULES:
- Every card must contain topicId, front, and back.
- Use gapId only when I provide an existing Trackr gap ID; never invent a gap ID.
- Use sourceSessionId only when I provide one.
- Each card tests one important missed concept or clinically useful distinction.
- Prefer active recall, oral follow-ups, decisions, indications, contraindications, complications, diagnostic distinctions, and management sequences.
- Keep answers concise but sufficient for safe recall.
- Do not create trivial cards, duplicates, vague prompts, yes/no questions, or cards with several unrelated facts.
- Put vignette information in clinicalContext when helpful.
- Use short lowercase hyphenated tags. Trackr automatically adds the topic ID and retention tags.
- Do not infer that card success equals oral-exam mastery.
- Generate only cards justified by the study material, mistakes, or weak spots I give you.`;try{await navigator.clipboard.writeText(prompt);notice='Card-generation prompt copied for ChatGPT.';}catch{error='Clipboard access was unavailable.'}}
</script>

<svelte:head><title>Retention Review · Trackr</title></svelte:head>
<main class="review-shell">
  <header><div><button class="back" on:click={()=>goto('/study')}>← Study overview</button><p>RETENTION LAB</p><h1>Review weak spots</h1><span>Cards reinforce specific misses; oral mastery remains separate.</span></div><nav><button class:active={mode==='review'} on:click={()=>mode='review'}>Review</button><button class="retention-admin-control" class:active={mode==='library'} on:click={()=>mode='library'}>Library</button><button class="retention-admin-control" class:active={mode==='create'} on:click={()=>mode='create'}>New card</button></nav></header>
  {#if error}<div class="message error">{error}<button on:click={()=>error=''}>Dismiss</button></div>{/if}{#if notice}<div class="message success">{notice}<button on:click={()=>notice=''}>Dismiss</button></div>{/if}
  <section class="stats"><article><span>Due now</span><strong>{stats.due}</strong></article><article><span>Active cards</span><strong>{stats.active}</strong></article><article><span>Total reviews</span><strong>{stats.reviewed}</strong></article><article><span>Leeches</span><strong>{stats.leeches}</strong></article></section>
  {#if loading}<section class="panel empty">Loading retention cards…</section>
  {:else if mode==='review'}
    <section class="review-area">{#if current}<div class="card"><div class="meta"><b>{current.topicId}</b><span>{titleFor(current.topicId)}</span>{#if current.gapId}<i>Weak spot linked</i>{/if}</div>{#if current.clinicalContext}<div class="context">{current.clinicalContext}</div>{/if}<div class="prompt">{current.front}</div>{#if revealed && intervals}<div class="answer">{current.back}</div><div class="ratings"><button class="again" on:click={()=>rate('again')}><kbd>1</kbd><span>Again</span><small>{intervals.again.label}</small></button><button on:click={()=>rate('hard')}><kbd>2</kbd><span>Hard</span><small>{intervals.hard.label}</small></button><button on:click={()=>rate('good')}><kbd>3</kbd><span>Good</span><small>{intervals.good.label}</small></button><button class="easy" on:click={()=>rate('easy')}><kbd>4</kbd><span>Easy</span><small>{intervals.easy.label}</small></button></div><p class="shortcut-hint"><kbd>Space</kbd> = Good</p>{:else}<button class="reveal" on:click={()=>revealed=true}>Reveal answer <kbd>Space</kbd></button>{/if}</div>{:else}<div class="panel empty"><strong>Review queue complete</strong><span>No active cards are due right now.</span></div>{/if}</section>
  {:else if mode==='create'}
    <div class="create-grid"><section class="panel form"><h2>Create linked retention card</h2><div class="two"><label>Topic<select bind:value={topicId}>{#each SURGERY_SYLLABUS as t}<option value={t.id}>{t.id} · {t.title}</option>{/each}</select></label><label>Gap ID (optional)<input bind:value={gapId} placeholder="Links this card to a weak spot" /></label></div><label>Front<textarea bind:value={front} placeholder="One focused retrieval prompt"></textarea></label><label>Back<textarea bind:value={back} placeholder="Concise expected answer"></textarea></label><label>Clinical context (optional)<textarea bind:value={context}></textarea></label><label>Tags<input bind:value={tags} placeholder="oral-follow-up differential-diagnosis" /></label><button class="primary" disabled={saving||!front.trim()||!back.trim()} on:click={createCard}>Create card</button></section><section class="panel form"><div class="import-title"><div><p>CHATGPT IMPORT</p><h2>Import generated cards</h2></div><button on:click={copyCardPrompt}>Copy card-generation prompt</button></div><span class="hint">Paste the JSON returned by ChatGPT. Trackr validates every topic ID and metadata field before saving anything.</span><textarea class="json" bind:value={chatGptJson} placeholder={'{"kind":"trackr-retention-cards","schemaVersion":1,"cards":[{"topicId":"TO2-16","front":"…","back":"…","tags":["weakspot"]}]}' }></textarea><button class="primary" disabled={saving||!chatGptJson.trim()} on:click={importChatGptCards}>Validate & import cards</button></section></div>
  {:else}
    <section class="panel"><div class="tools"><input bind:value={search} placeholder="Search cards and tags"/><select bind:value={topicFilter}><option value="all">All blocks</option><option>TO1</option><option>TO2</option><option>TO3</option><option>TO4</option></select><select bind:value={statusFilter}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="mastered">Mastered</option><option value="archived">Archived</option></select><button on:click={exportTsv}>Export Anki TSV</button><button on:click={()=>importInput.click()}>Import Anki TSV</button><input class="hidden" bind:this={importInput} type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" on:change={importTsv}/></div><p class="hint">Anki format: Front, tab, Back. Trackr exports extra Tags, TopicID, GapID and CardID columns for lossless round trips. Duplicate cards are skipped automatically.</p><div class="library">{#each filtered as card}<article><div><b>{card.topicId}</b><h3>{card.front}</h3><p>{card.back}</p><small>Due {card.dueDate} · {card.reviews.length} reviews · {card.tags.join(' · ')}</small></div><div class="card-actions"><select value={card.status} on:change={(e)=>setStatus(card,(e.currentTarget as HTMLSelectElement).value as RetentionCardStatus)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="mastered">Mastered</option><option value="archived">Archived</option></select><button class="delete" disabled={saving} on:click={()=>removeCard(card)}>Delete</button></div></article>{/each}</div></section>
  {/if}
</main>

<style>
  .create-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.import-title{display:flex;justify-content:space-between;gap:12px;align-items:start}.import-title p{font-size:.65rem;letter-spacing:.16em;color:#929aff;font-weight:800;margin:0 0 5px}.import-title h2{margin:0}.import-title button{border:1px solid #343a48;background:#212630;color:#eef0f7;border-radius:9px;padding:9px;cursor:pointer}.json{min-height:300px!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important;font-size:.76rem!important}
  .card-actions{display:flex;align-items:center;gap:7px;flex-shrink:0}.card-actions .delete{border:1px solid #62343e;background:#342028;color:#ff8c98;border-radius:9px;padding:10px;cursor:pointer}.card-actions .delete:hover{background:#472630}.card-actions .delete:disabled{opacity:.45;cursor:not-allowed}
  :global(body){background:#0b0d12!important;color:#eef0f7!important}.review-shell{max-width:1050px;margin:auto;padding:28px 0 90px}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}header p{color:#8d95aa;font-size:.68rem;letter-spacing:.18em;font-weight:800}h1{font-size:clamp(2rem,5vw,3.7rem);letter-spacing:-.05em;margin:4px 0}header span,.hint{color:#8991a4;font-size:.8rem}.back{background:none!important;border:0!important;color:#929aff!important;padding:0!important}nav{display:flex;gap:6px}button,select,input,textarea{font:inherit}nav button,.tools button,.back{border:1px solid #343a48;background:#1a1e27;color:#b1b7c6;padding:9px 12px;border-radius:10px;cursor:pointer}nav button.active,.primary,.reveal{background:#7888ff!important;color:#090b10!important;border-color:#7888ff!important}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:10px}.stats article,.panel,.card{background:linear-gradient(145deg,#1b1f29,#12151c);border:1px solid #2b303c;border-radius:17px}.stats article{padding:16px}.stats span{display:block;color:#8e95a9;font-size:.72rem}.stats strong{display:block;font-size:1.7rem;margin-top:7px}.panel{padding:20px}.empty{min-height:250px;display:grid;place-content:center;text-align:center;gap:8px;color:#8e95a9}.card{max-width:720px;margin:32px auto;padding:26px}.meta{display:flex;gap:9px;align-items:center;color:#969eb1;font-size:.74rem}.meta b{color:#9ca6ff}.meta i{margin-left:auto;color:#ff8794}.prompt{font-size:1.5rem;line-height:1.35;padding:42px 8px;text-align:center}.context,.answer{background:#10131a;border:1px solid #2b303c;border-radius:11px;padding:15px}.answer{font-size:1.05rem;line-height:1.55;margin-bottom:14px}.reveal,.primary{display:block;border:1px solid;border-radius:10px;padding:12px 17px;font-weight:750;cursor:pointer;margin:0 auto}.ratings{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.ratings button{border:1px solid #343a48;background:#212630;color:#eef0f7;border-radius:9px;padding:10px;cursor:pointer}.ratings small{display:block}.ratings .again{color:#ff8390}.ratings .easy{color:#75d6ac}.form{display:flex;flex-direction:column;gap:13px}.form h2{margin-top:0}.form label{display:flex;flex-direction:column;gap:6px;color:#aab0bf;font-size:.78rem}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}input,select,textarea{background:#10131a;border:1px solid #303643;color:#eef0f7;border-radius:9px;padding:10px}.form textarea{min-height:80px}.form .primary{margin-left:0}.tools{display:flex;gap:7px;flex-wrap:wrap}.tools input{flex:1;min-width:190px}.hidden{display:none}.library article{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #292e39;padding:15px 4px}.library h3{font-size:.94rem;margin:6px 0}.library p{color:#b3b8c5;font-size:.82rem;white-space:pre-wrap}.library small{color:#798194}.message{display:flex;justify-content:space-between;padding:11px;border-radius:10px;margin-bottom:10px}.error{background:#42232b}.success{background:#18372e}.message button{background:none;border:0;color:#fff}.hint{margin:12px 0 4px}@media(max-width:700px){header{display:block}nav{margin-top:18px}.stats{grid-template-columns:1fr 1fr}.two{grid-template-columns:1fr}.ratings{grid-template-columns:1fr 1fr}.review-shell{padding:16px 0 80px}.meta{flex-wrap:wrap}.meta i{margin-left:0}.tools>*{width:100%}}
  /* Compact review chrome: keep attention on the active card. */
  .review-shell>header{margin-bottom:14px;align-items:center}.review-shell>header h1{font-size:clamp(1.75rem,3.5vw,2.7rem);margin:2px 0}.review-shell>header p{margin:8px 0 3px}.review-shell>header span{display:block}.stats{margin-bottom:4px}.stats article{padding:11px 15px}.stats strong{font-size:1.35rem;margin-top:4px}.review-area .card{max-width:none;width:100%;box-sizing:border-box;margin:18px 0;padding:24px}.meta{margin-bottom:14px}.context{margin-bottom:8px}.prompt{padding:34px 8px}.reveal kbd{margin-left:8px}kbd{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 3px;border:1px solid #4a5160;border-radius:4px;background:#11141b;color:#aeb5c5;font:600 .67rem ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:inset 0 -1px #343a47}.ratings button{display:grid;grid-template-columns:28px 1fr 48px;align-items:center;text-align:left;min-height:54px;padding:8px 12px}.ratings button kbd{justify-self:start}.ratings button span{justify-self:center;font-weight:650}.ratings button small{justify-self:end;color:#9299ab;font-size:.72rem}.ratings .again small{color:#ff8390}.ratings .easy small{color:#75d6ac}.shortcut-hint{text-align:center;color:#747d90;font-size:.7rem;margin:11px 0 0}
  @media(max-width:850px){.create-grid{grid-template-columns:1fr}.import-title{display:block}.import-title button{margin-top:10px}}
  @media(max-width:700px){
    .retention-admin-control{display:none}
    header nav{margin-top:12px}
    header nav button{width:100%}
    .stats article{padding:10px 12px}
    .review-area .card{margin:10px 0;padding:16px}
    .prompt{padding:28px 4px;font-size:1.25rem}
    .ratings button{grid-template-columns:24px 1fr 42px;padding:8px}
    .shortcut-hint,.reveal kbd{display:none}
  }
</style>
