<!--
FILE: trackr/src/routes/(app)/+layout.svelte
Authenticated layout — MAAP-style light UI
-->

<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import UniversalItemEditorModal from '$lib/components/UniversalItemEditorModal.svelte';
  import { withImageSavedNotice } from '$lib/utils/appNavigation';

  type TabKey = 'dashboard' | 'clothing' | 'life' | 'sports' | 'study' | 'system';

  const tabs: Array<{ name: string; path: string; key: TabKey }> = [
    { name: 'Dashboard', path: '/dashboard', key: 'dashboard' },
    { name: 'Clothing', path: '/clothing', key: 'clothing' },
    { name: 'Life', path: '/life', key: 'life' },
    { name: 'Sports', path: '/sports', key: 'sports' },
    { name: 'Study', path: '/study', key: 'study' },
    { name: 'System', path: '/system', key: 'system' }
  ];

  let imageSaveToast = '';
  let imageToastTimer: ReturnType<typeof setTimeout> | undefined;
  $: globalEditItemId = $page.url.searchParams.get('editItem');

  function editorReturnPath() {
    const url = new URL($page.url);
    url.searchParams.delete('editItem');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function closeGlobalEditor() {
    goto(editorReturnPath(), { replaceState: true, noScroll: true });
  }

  function finishGlobalEditor(storageFormat: 'webp' | 'png' | null = null) {
    window.location.assign(withImageSavedNotice(editorReturnPath(), storageFormat));
  }

  afterNavigate(({ to }) => {
    if (!to) return;
    const format = to.url.searchParams.get('imageSaved');
    if ((format !== 'webp' && format !== 'png') || to.url.pathname === '/clothing') return;
    imageSaveToast = format === 'webp'
      ? 'Image successfully saved as WebP'
      : 'Image successfully saved using transparent PNG fallback';
    if (imageToastTimer) clearTimeout(imageToastTimer);
    imageToastTimer = setTimeout(() => (imageSaveToast = ''), 3500);
    const cleanUrl = new URL(to.url);
    cleanUrl.searchParams.delete('imageSaved');
    goto(`${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });
  });
</script>

<div class="app-container" class:study-mode={$page.url.pathname.startsWith('/study')}>
  <!-- TOP BAR -->
  <header class="top-bar">
    <button class="top-left" aria-label="Open dashboard" on:click={() => goto('/dashboard')}>
      <span class="brand-text">Trackr</span>
      <span class="mobile-mode-label">Lite</span>
    </button>

    {#if $user}
      <button class="user-button" on:click={() => goto('/profile')}>
        <span class="user-name">{$user.name}</span>
        <img
          src={$user.photoURL || '/avatars/doctor1.png'}
          alt="Avatar"
          class="user-avatar"
        />
      </button>
    {/if}
  </header>

  <main class="main-content">
    <slot />
  </main>

  <!-- TAB BAR -->
  <nav class="tab-bar">
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:mobile-secondary={tab.key === 'system'}
        class:active={$page.url.pathname.startsWith(tab.path)}
        aria-label={tab.name}
        aria-current={$page.url.pathname.startsWith(tab.path) ? 'page' : undefined}
        on:click={() => goto(tab.path)}
      >
        <span class="tab-label">{tab.name}</span>
      </button>
    {/each}
  </nav>

  {#if imageSaveToast}
    <div class="global-save-toast" role="status" aria-live="polite">✓ {imageSaveToast}</div>
  {/if}
</div>

{#if globalEditItemId}
  <UniversalItemEditorModal itemId={globalEditItemId} on:close={closeGlobalEditor} on:saved={(event) => finishGlobalEditor(event.detail.storageFormat)} on:removed={() => finishGlobalEditor()} />
{/if}

<style>
:root{
  /* MAAP store palette */
  --bg:#f7f7f7;
  --surface:#ffffff;
  --border:#e8e8e8;

  --text:#111;
  --muted:#777;

  --radius:12px;
}

/* GLOBAL BASE */
:global(html,body){
  margin:0;
  padding:0;
  width:100%;
  min-height:100%;
  overflow-x:clip;
  background:var(--bg);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;
  -webkit-text-size-adjust:100%;
  -webkit-tap-highlight-color:transparent;
}

:global(button),:global(a),:global(input),:global(select),:global(textarea){touch-action:manipulation}

/* APP CONTAINER */

.app-container{
  display:flex;
  flex-direction:column;
  min-height:100vh;
  min-height:100dvh;
  background:var(--bg);
}

.global-save-toast{
  position:fixed;
  right:1.25rem;
  bottom:calc(5.7rem + env(safe-area-inset-bottom));
  z-index:1200;
  max-width:min(360px,calc(100vw - 2rem));
  padding:.75rem 1rem;
  border-radius:999px;
  background:#171717;
  color:#fff;
  box-shadow:0 12px 35px rgba(0,0,0,.2);
  font-size:.78rem;
  font-weight:700;
}

/* The Surgery tracker has its own dark visual system. This class is route-scoped,
   so the clothing and analytics surfaces keep their existing light appearance. */
.app-container.study-mode{
  --bg:#0b0d12;
  --surface:#12151c;
  --border:#282d39;
  --text:#eef0f7;
  --muted:#9299ab;
  background:#0b0d12;
  color:#eef0f7;
}

.study-mode .top-bar{
  background:rgba(13,15,21,.92);
  border-bottom-color:#262b36;
  color:#eef0f7;
  backdrop-filter:blur(18px);
}

.study-mode .user-name{ color:#aeb4c3; }

.study-mode .main-content{
  max-width:none;
  box-sizing:border-box;
  background:
    radial-gradient(circle at 50% -20%,rgba(104,118,255,.13),transparent 34rem),
    #0b0d12;
}

.study-mode .tab-bar{
  background:rgba(13,15,21,.94);
  border-top-color:#282d39;
  backdrop-filter:blur(18px);
}

.study-mode .tab-btn{ color:#777f91; }
.study-mode .tab-btn.active{ color:#eef0f7; }

/* TOP BAR — MAAP style */

.top-bar{
  min-height:calc(56px + env(safe-area-inset-top));
  box-sizing:border-box;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:env(safe-area-inset-top) max(1.2rem,env(safe-area-inset-right)) 0 max(1.2rem,env(safe-area-inset-left));

  background:#fff;
  border-bottom:1px solid var(--border);

  position:sticky;
  top:0;
  z-index:10;
}

.top-left{min-height:44px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer}

.brand-text{
  font-size:1rem;
  font-weight:600;
  letter-spacing:.02em;
}

.mobile-mode-label{display:none}

.user-button{
  display:flex;
  align-items:center;
  gap:.5rem;
  border:none;
  background:transparent;
  cursor:pointer;
}

.user-name{
  font-size:.85rem;
  color:var(--muted);
}

.user-avatar{
  width:28px;
  height:28px;
  border-radius:999px;
  object-fit:cover;
}

/* MAIN */

.main-content{
  flex:1;
  box-sizing:border-box;
  padding:1.4rem;
  padding-bottom:calc(72px + env(safe-area-inset-bottom));
  max-width:1200px;
  margin:0 auto;
  width:100%;
}

/* TAB BAR — MAAP minimal */

.tab-bar{
  position:fixed;
  bottom:0;
  left:0;
  right:0;
  z-index:20;

  height:calc(60px + env(safe-area-inset-bottom));
  box-sizing:border-box;
  padding:0 max(.35rem,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(.35rem,env(safe-area-inset-left));
  background:#fff;
  border-top:1px solid var(--border);

  display:flex;
  justify-content:space-around;
  align-items:center;
}

.tab-btn{
  min-width:0;
  min-height:44px;
  flex:1;
  border:none;
  background:transparent;
  font-size:.75rem;
  color:#888;
  cursor:pointer;
  padding:.4rem .6rem;
}

.tab-btn.active{
  color:#111;
  font-weight:600;
}

@media(max-width:760px){
  .main-content{padding:.7rem;padding-bottom:calc(72px + env(safe-area-inset-bottom))}
  .top-bar{padding-left:max(.85rem,env(safe-area-inset-left));padding-right:max(.85rem,env(safe-area-inset-right))}
  .top-left{display:flex;align-items:center;gap:.45rem}
  .mobile-mode-label{display:inline-flex;align-items:center;height:20px;padding:0 .48rem;border-radius:999px;background:#eeeaff;color:#5c45bd;font-size:.58rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
  .tab-btn.mobile-secondary{display:none}
  .tab-btn{padding:.35rem .2rem;font-size:.67rem}
  :global(input),:global(select),:global(textarea){font-size:16px!important}
}

@media(max-width:420px){
  .user-name{display:none}
  .tab-btn{font-size:.62rem;letter-spacing:-.01em}
  .global-save-toast{left:1rem;right:1rem;max-width:none;text-align:center}
}

@media(display-mode:standalone){
  .top-bar{background:rgba(255,255,255,.92);backdrop-filter:blur(18px)}
  .tab-bar{background:rgba(255,255,255,.94);backdrop-filter:blur(18px)}
}
</style>
