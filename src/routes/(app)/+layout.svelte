<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user'; // ✅ Nur das hier

  const tabs = [
    { name: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { name: 'Clothing', path: '/clothing', icon: '🧥' },
    { name: 'Stats', path: '/analytics', icon: '📊' },
    { name: 'Settings', path: '/settings', icon: '⚙️' }
  ];
</script>

<div class="app-container">
  <header class="top-bar">
    <div class="top-left">Trackr</div>
    <div class="top-right">
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
    </div>
  </header>

  <main class="main-content">
    <slot />
  </main>

  <nav class="tab-bar">
    {#each tabs as tab}
      <button
        class:active={$page.url.pathname.startsWith(tab.path)}
        on:click={() => goto(tab.path)}
      >
        <span class="tab-icon">{tab.icon}</span>
        <span class="tab-label">{tab.name}</span>
      </button>
    {/each}
  </nav>
</div>

<style>
  :root {
    --blur-bg: rgba(255, 255, 255, 0.8);
    --active-color: #0a84ff;
    --text-color: #1c1c1e;
    --inactive: #6e6e73;
    --border: rgba(60, 60, 67, 0.29);
    --radius: 1rem;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #fefefe;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem 0.5rem;
    background: var(--blur-bg);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    font-size: 1.1rem;
    color: var(--text-color);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .top-left {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .user-name {
    font-size: 0.9rem;
    color: var(--text-color);
  }

  .user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--border);
  }

  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    padding-bottom: 6rem;
  }

  .tab-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: var(--blur-bg);
    backdrop-filter: blur(20px);
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding-bottom: env(safe-area-inset-bottom);
    z-index: 10;
  }

  .tab-bar button {
    all: unset;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--inactive);
    transition: color 0.2s;
    padding: 0.3rem 0.6rem;
    border-radius: var(--radius);
    position: relative;
  }

  .tab-bar button.active {
    color: var(--active-color);
  }

  .tab-bar button:hover {
    background-color: rgba(0, 0, 0, 0.04);
  }

  .tab-icon {
    font-size: 1.25rem;
  }

  .tab-label {
    font-size: 0.7rem;
    margin-top: 0.1rem;
  }
  
  .user-button {
  all: unset;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}
</style>