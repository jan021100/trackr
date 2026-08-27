<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { collection, getDocs } from 'firebase/firestore';
  import { auth, db } from '$lib/firebase';
  import { itemEditHref } from '$lib/utils/appNavigation';
  import { buildWearDayIndex, type WearDayEntry, type WearInsightItem } from '$lib/utils/wearInsights';
  import {
    WEAR_OUTFIT_SLOTS,
    WEAR_OUTFIT_SLOT_LABELS,
    buildWearDayOutfits,
    type WearDayOutfits,
    type WearOutfit
  } from '$lib/utils/wearOutfits';

  type CalendarCell = { date: string; day: number; inMonth: boolean };
  type CalendarOutfit = WearOutfit<WearInsightItem>;

  let loading = true;
  let errorMessage = '';
  let items: WearInsightItem[] = [];
  let wearIndex: Record<string, WearDayEntry[]> = {};
  const today = new Date().toISOString().slice(0, 10);
  const requestedDate = $page.url.searchParams.get('date');
  let selectedDate = isCalendarDate(requestedDate) ? requestedDate : today;
  let monthCursor = new Date();
  const [initialYear, initialMonth] = selectedDate.split('-').map(Number);
  monthCursor = new Date(initialYear, initialMonth - 1, 1);
  let calendarCells: CalendarCell[] = [];
  let selectedEntries: WearDayEntry[] = [];
  let selectedOutfits: WearDayOutfits = { casual: null, sports: null };

  $: calendarCells = makeCalendarCells(monthCursor);
  $: selectedEntries = wearIndex[selectedDate] ?? [];
  $: selectedOutfits = buildWearDayOutfits(selectedEntries);

  onMount(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        goto('/login');
        return;
      }
      loading = true;
      errorMessage = '';
      try {
        const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'items'));
        items = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        wearIndex = buildWearDayIndex(items);
      } catch (error) {
        console.error('Could not load wear calendar', error);
        errorMessage = 'Your wear calendar could not be loaded. Please try again.';
      } finally {
        loading = false;
      }
    });
    return unsubscribe;
  });

  function isCalendarDate(value: string | null): value is string {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function dateKey(year: number, month: number, day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function makeCalendarCells(cursor: Date): CalendarCell[] {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells: CalendarCell[] = [];
    const previousDays = new Date(year, month, 0).getDate();
    for (let index = mondayOffset - 1; index >= 0; index -= 1) {
      const date = new Date(year, month - 1, previousDays - index);
      cells.push({ date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) cells.push({ date: dateKey(year, month, day), day, inMonth: true });
    let nextDay = 1;
    while (cells.length % 7 !== 0 || cells.length < 42) {
      const date = new Date(year, month + 1, nextDay++);
      cells.push({ date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), inMonth: false });
    }
    return cells;
  }

  function shiftMonth(offset: number) {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    selectedDate = dateKey(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  }
  function monthLabel() { return monthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
  function selectedDateLabel() {
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function totalOn(date: string) { return (wearIndex[date] ?? []).reduce((sum, entry) => sum + entry.count, 0); }
  function outfitsOn(date: string) { return buildWearDayOutfits(wearIndex[date] ?? []); }
  function outfitGroups(outfits: WearDayOutfits): CalendarOutfit[] {
    return [outfits.casual, outfits.sports].filter((outfit): outfit is CalendarOutfit => Boolean(outfit));
  }
  function occupiedSlots(outfit: CalendarOutfit) { return WEAR_OUTFIT_SLOTS.filter((slot) => outfit.slots[slot].length > 0); }
  function itemName(item: WearInsightItem) { return item.product || item.name || 'Unnamed item'; }
  function itemImage(item: WearInsightItem) { return item.imageBase64 || item.imageUrl || ''; }
  function editItemPath(itemId: string) { return itemEditHref(itemId, `/wear-calendar?date=${selectedDate}`); }
  function outfitCategories(outfit: CalendarOutfit) {
    if (outfit.kind === 'casual') return 'Casual outfit';
    const categories = Array.from(new Set(outfit.entries.map((entry) => entry.item.mainCategory).filter(Boolean)));
    return categories.length ? categories.join(' + ') : 'Combined sports outfit';
  }
</script>

<svelte:head><title>Wear Calendar · Trackr</title></svelte:head>

<main class="calendar-page">
  <section class="calendar-hero">
    <div><p class="eyebrow">Wear history</p><h1>Your outfits, day by day.</h1><p>Casual stays separate. Every sport combines into one head-to-toe outfit for the day.</p></div>
    <button type="button" on:click={() => goto('/analytics')}>Monthly recap</button>
  </section>

  {#if loading}
    <div class="state">Loading wear history…</div>
  {:else if errorMessage}
    <div class="state error">{errorMessage}</div>
  {:else}
    <section class="calendar-layout">
      <article class="calendar-card">
        <header>
          <button type="button" on:click={() => shiftMonth(-1)} aria-label="Previous month">←</button>
          <div><p class="eyebrow">Outfit calendar</p><h2>{monthLabel()}</h2></div>
          <button type="button" on:click={() => shiftMonth(1)} aria-label="Next month">→</button>
        </header>
        <div class="calendar-board">
          <div class="calendar-inner">
            <div class="weekdays" aria-hidden="true">{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as day}<span>{day}</span>{/each}</div>
            <div class="calendar-grid">
              {#each calendarCells as cell}
                {@const wears = totalOn(cell.date)}
                {@const groups = outfitGroups(outfitsOn(cell.date))}
                <button type="button" class="day-cell" class:outside={!cell.inMonth} class:selected={cell.date === selectedDate} class:today={cell.date === today} on:click={() => (selectedDate = cell.date)} aria-label={`${cell.date}${wears ? `, ${wears} wears in ${groups.length} outfit groups` : ''}`}>
                  <span class="day-head"><b>{cell.day}</b>{#if wears}<strong>{wears}</strong>{/if}</span>
                  {#if groups.length}
                    <span class="mini-outfits" aria-hidden="true">
                      {#each groups as outfit}
                        <span class="mini-outfit {outfit.kind}">
                          <em>{outfit.kind === 'casual' ? 'C' : 'S'}</em>
                          {#each occupiedSlots(outfit) as slot}
                            <span class="mini-slot {slot}">
                              {#each outfit.slots[slot] as entry}
                                <span class="mini-piece">{#if itemImage(entry.item)}<img src={itemImage(entry.item)} alt="" />{:else}<i>{itemName(entry.item).slice(0, 1)}</i>{/if}</span>
                              {/each}
                            </span>
                          {/each}
                        </span>
                      {/each}
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        </div>
        <p class="calendar-note"><span class="casual-dot"></span> Casual <span class="sports-dot"></span> Combined sports · tap a day for the full outfit</p>
      </article>

      <aside class="day-card">
        <p class="eyebrow">Selected day</p><h2>{selectedDateLabel()}</h2>
        {#if selectedEntries.length}
          <p class="day-summary">{totalOn(selectedDate)} recorded wear{totalOn(selectedDate) === 1 ? '' : 's'} · {outfitGroups(selectedOutfits).length} outfit group{outfitGroups(selectedOutfits).length === 1 ? '' : 's'}</p>
          <div class="selected-outfits">
            {#each outfitGroups(selectedOutfits) as outfit}
              <section class="outfit-card {outfit.kind}">
                <header><div><span>{outfit.label}</span><small>{outfitCategories(outfit)}</small></div><b>{outfit.entries.length} piece{outfit.entries.length === 1 ? '' : 's'}</b></header>
                <div class="outfit-figure">
                  {#each occupiedSlots(outfit) as slot}
                    <div class="outfit-slot {slot}">
                      <span>{WEAR_OUTFIT_SLOT_LABELS[slot]}</span>
                      <div class="piece-stack" class:layered={outfit.slots[slot].length > 1}>
                        {#each outfit.slots[slot] as entry, index}
                          <button type="button" class="outfit-piece" style={`--piece-index:${index}`} on:click={() => goto(editItemPath(entry.item.id))} aria-label={`Open ${itemName(entry.item)}`} title={`${itemName(entry.item)} · ${entry.item.brand || 'Unknown brand'}`}>
                            {#if itemImage(entry.item)}<img src={itemImage(entry.item)} alt={itemName(entry.item)} />{:else}<span class="piece-fallback">{itemName(entry.item).slice(0, 1)}</span>{/if}
                            {#if entry.count > 1}<b>{entry.count}×</b>{/if}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
                <div class="outfit-names">
                  {#each outfit.entries as entry}
                    <button type="button" on:click={() => goto(editItemPath(entry.item.id))}><strong>{itemName(entry.item)}</strong><span>{entry.item.brand || 'Unknown brand'}</span></button>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else}
          <div class="empty-day"><strong>Nothing recorded</strong><span>No wear entries are saved for this date.</span></div>
        {/if}
      </aside>
    </section>
  {/if}
</main>

<style>
  :global(body){background:#f7f7f4}.calendar-page{width:min(100%,1480px);margin:0 auto;padding-bottom:5rem;color:#151515;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif}.calendar-hero{min-height:210px;padding:clamp(1.5rem,5vw,3.3rem);box-sizing:border-box;display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;border-radius:30px;border:1px solid rgba(255,255,255,.9);background:radial-gradient(circle at 18% 20%,rgba(122,102,255,.2),transparent 34%),radial-gradient(circle at 85% 50%,rgba(91,172,140,.16),transparent 31%),rgba(255,255,255,.72);box-shadow:0 24px 65px rgba(0,0,0,.05)}.eyebrow{margin:0 0 .55rem;color:#777;font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{max-width:760px;margin:0;font-size:clamp(2.4rem,5.4vw,4.7rem);line-height:.93;letter-spacing:-.065em}h2{margin:0;letter-spacing:-.035em}.calendar-hero p:not(.eyebrow){max-width:650px;margin:1rem 0 0;color:#666;line-height:1.5}.calendar-hero button{padding:.7rem 1rem;border:0;border-radius:999px;background:#171717;color:#fff;cursor:pointer;white-space:nowrap}.state{margin-top:.8rem;padding:4rem 1rem;border-radius:22px;background:#fff;color:#777;text-align:center}.state.error{color:#9c3340}
  .calendar-layout{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(330px,.58fr);gap:.8rem;margin-top:.8rem;align-items:start}.calendar-card,.day-card{padding:1.2rem;border-radius:22px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.82);box-shadow:0 18px 46px rgba(0,0,0,.045)}.calendar-card>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem}.calendar-card>header>div{text-align:center}.calendar-card>header .eyebrow{margin-bottom:.18rem}.calendar-card>header button{width:38px;height:38px;border:1px solid #e6e6e4;border-radius:50%;background:#fff;cursor:pointer}.calendar-board{width:100%;overflow-x:auto;overscroll-behavior-inline:contain}.calendar-inner{min-width:760px}.weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.weekdays span{padding:.45rem;color:#999;font-size:.62rem;font-weight:800;text-align:center;text-transform:uppercase}
  .calendar-grid{gap:.32rem}.day-cell{position:relative;min-height:154px;padding:.45rem;display:flex;flex-direction:column;border:1px solid #ececea;border-radius:14px;background:#fafaf8;color:#222;cursor:pointer;overflow:hidden}.day-cell:hover{border-color:#aaa;background:#fff}.day-cell.outside{opacity:.32}.day-cell.selected{border-color:#171717;box-shadow:inset 0 0 0 1px #171717}.day-cell.today .day-head>b{text-decoration:underline;text-underline-offset:3px}.day-head{display:flex;justify-content:space-between;align-items:flex-start;width:100%;position:relative;z-index:2}.day-head>b{font-size:.72rem}.day-head>strong{min-width:20px;height:20px;display:grid;place-items:center;border-radius:999px;background:#755cff;color:#fff;font-size:.58rem}
  .mini-outfits{flex:1;display:flex;align-items:center;justify-content:center;gap:.2rem;width:100%;padding-top:.1rem}.mini-outfit{position:relative;width:45%;max-width:48px;min-width:34px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.25rem .1rem .12rem;border-radius:10px;background:linear-gradient(180deg,rgba(117,92,255,.08),rgba(117,92,255,.015))}.mini-outfit.sports{background:linear-gradient(180deg,rgba(47,122,91,.1),rgba(47,122,91,.015))}.mini-outfit>em{position:absolute;top:2px;left:4px;color:#765cff;font-size:.45rem;font-style:normal;font-weight:900}.mini-outfit.sports>em{color:#2f7a5b}.mini-slot{min-height:12px;width:100%;display:flex;justify-content:center;align-items:center}.mini-slot+.mini-slot{margin-top:-2px}.mini-slot.upper,.mini-slot.lower{min-height:27px}.mini-slot.shoes{min-height:16px}.mini-slot.head,.mini-slot.carry{min-height:17px}.mini-slot.socks,.mini-slot.legs,.mini-slot.hands{min-height:11px}.mini-piece{width:25px;height:26px;display:grid;place-items:center;filter:drop-shadow(0 2px 2px rgba(0,0,0,.08))}.mini-piece+.mini-piece{margin-left:-11px}.mini-slot.head .mini-piece,.mini-slot.carry .mini-piece{width:19px;height:17px}.mini-slot.shoes .mini-piece{width:21px;height:16px}.mini-slot.socks .mini-piece,.mini-slot.hands .mini-piece,.mini-slot.legs .mini-piece{width:16px;height:13px}.mini-piece img{display:block;width:100%;height:100%;object-fit:contain}.mini-piece i{width:16px;height:16px;display:grid;place-items:center;border-radius:50%;background:#ddd;color:#777;font-size:.5rem;font-style:normal}.calendar-note{display:flex;align-items:center;gap:.35rem;margin:.75rem .15rem 0;color:#888;font-size:.67rem}.casual-dot,.sports-dot{width:7px;height:7px;border-radius:50%;background:#765cff}.sports-dot{margin-left:.35rem;background:#2f7a5b}
  .day-card{position:sticky;top:68px}.day-card>h2{font-size:1.35rem}.day-summary{color:#777;font-size:.75rem}.selected-outfits{display:grid;gap:.75rem;margin-top:1rem}.outfit-card{overflow:hidden;padding:.8rem;border:1px solid #e8e5fb;border-radius:18px;background:linear-gradient(145deg,#fbfaff,#fff)}.outfit-card.sports{border-color:#dcece4;background:linear-gradient(145deg,#f5fbf7,#fff)}.outfit-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem}.outfit-card>header div{display:grid;gap:.15rem}.outfit-card>header div>span{font-size:.78rem;font-weight:850}.outfit-card>header small{color:#888;font-size:.62rem}.outfit-card>header>b{padding:.25rem .45rem;border-radius:999px;background:#eeeafd;color:#654de0;font-size:.58rem;white-space:nowrap}.outfit-card.sports>header>b{background:#e3f2e9;color:#286a4f}
  .outfit-figure{display:grid;gap:.3rem;overflow:hidden;margin:.75rem 0 0;padding:.85rem .55rem 1rem;border-radius:16px;background:rgba(255,255,255,.68)}.outfit-slot{display:grid;grid-template-columns:58px minmax(0,1fr);align-items:center;min-height:54px}.outfit-slot.upper,.outfit-slot.lower{min-height:82px}.outfit-slot.head,.outfit-slot.socks,.outfit-slot.hands,.outfit-slot.legs,.outfit-slot.shoes,.outfit-slot.carry{min-height:58px}.outfit-slot>span{align-self:center;color:#999;font-size:.55rem;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.piece-stack{min-width:0;min-height:54px;display:flex;align-items:center;justify-content:center;isolation:isolate}.piece-stack.layered{padding-left:0}.outfit-slot.upper .piece-stack,.outfit-slot.lower .piece-stack{min-height:82px}.outfit-piece{position:relative;flex:0 0 auto;width:68px;height:68px;display:grid;place-items:center;padding:0;border:0;background:transparent;cursor:pointer;filter:drop-shadow(0 5px 5px rgba(0,0,0,.09));transition:transform .15s ease}.outfit-piece+.outfit-piece{margin-left:-18px}.outfit-piece:hover,.outfit-piece:focus-visible{z-index:20;transform:translateY(-4px) scale(1.04);outline:none}.outfit-piece img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}.outfit-piece>b{position:absolute;right:3px;bottom:3px;min-width:17px;height:17px;display:grid;place-items:center;border-radius:999px;background:#171717;color:#fff;font-size:.5rem}.piece-fallback{width:42px;height:42px;display:grid;place-items:center;border-radius:50%;background:#eee;color:#777;font-weight:800}.outfit-slot.upper .outfit-piece,.outfit-slot.lower .outfit-piece{width:76px;height:76px}.outfit-slot.head .outfit-piece{width:52px;height:48px}.outfit-slot.socks .outfit-piece,.outfit-slot.hands .outfit-piece,.outfit-slot.legs .outfit-piece{width:46px;height:40px}.outfit-slot.shoes .outfit-piece{width:62px;height:48px}.outfit-slot.carry .outfit-piece{width:54px;height:54px}.outfit-names{position:relative;z-index:2;display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.65rem;padding-top:.7rem;border-top:1px solid rgba(0,0,0,.06)}.outfit-names button{max-width:100%;padding:.32rem .5rem;border:1px solid #e7e7e4;border-radius:999px;background:#fff;cursor:pointer;text-align:left}.outfit-names strong,.outfit-names span{font-size:.58rem}.outfit-names span{margin-left:.25rem;color:#999}.empty-day{min-height:300px;display:grid;place-content:center;gap:.35rem;color:#888;text-align:center}.empty-day strong{color:#222}
  @media(max-width:980px){.calendar-layout{grid-template-columns:1fr}.day-card{position:static}.selected-outfits{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.calendar-hero{min-height:0;align-items:flex-start;flex-direction:column}.calendar-card,.day-card{padding:.85rem}.calendar-inner{min-width:700px}.day-cell{min-height:142px}.selected-outfits{grid-template-columns:1fr}}@media(max-width:520px){.calendar-hero{border-radius:24px}.calendar-card{margin-inline:-.55rem;border-radius:18px}.calendar-board{padding-bottom:.35rem}.calendar-note{padding-left:.25rem}.outfit-slot{grid-template-columns:52px minmax(0,1fr)}}
</style>
