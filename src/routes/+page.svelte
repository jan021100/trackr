<!--
FILE: trackr/src/routes/+layout.svelte
Public layout (unauthenticated)
MAAP-style light UI
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/firebase';
  import { goto } from '$app/navigation';

  let loading = true;

  onMount(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        goto('/dashboard');
      } else {
        loading = false;
      }
    });

    return () => unsubscribe();
  });

  function handleLogin() {
    goto('/login');
  }

  function handleSignup() {
    goto('/login?mode=signup');
  }
</script>

<main>
  {#if loading}
    <p class="loading">Loading…</p>
  {:else}
    <div class="card">
      <h1 class="logo">Trackr</h1>

      <p class="subtitle">
        Track what you own.<br />
        Understand how you live.
      </p>

      <div class="buttons">
        <button class="btn primary" on:click={handleLogin}>Log in</button>
        <button class="btn ghost" on:click={handleSignup}>Sign up</button>
      </div>
    </div>
  {/if}
</main>

<style>
:root{
  --bg:#f6f6f6;
  --card:#ffffff;
  --border:#e6e6e6;
  --text:#111;
  --text-sub:#666;
  --radius:12px;
}

/* global reset */
:global(html,body){
  height:100%;
  margin:0;
  padding:0;
  background:var(--bg);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;
}

main{
  min-height:100vh;
  min-height:100dvh;
  box-sizing:border-box;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:2rem;
  background:var(--bg);
}

/* loading */

.loading{
  color:var(--text-sub);
  font-size:.95rem;
}

/* card */

.card{
  width:100%;
  max-width:420px;
  box-sizing:border-box;
  padding:2.2rem;
  border-radius:var(--radius);
  background:var(--card);
  border:1px solid var(--border);
  box-shadow:0 8px 24px rgba(0,0,0,0.04);
  text-align:center;
}

/* typography */

.logo{
  font-size:1.9rem;
  font-weight:600;
  letter-spacing:-0.02em;
  margin:0 0 .6rem;
}

.subtitle{
  font-size:.95rem;
  line-height:1.5;
  color:var(--text-sub);
  margin-bottom:1.8rem;
}

/* buttons */

.buttons{
  display:flex;
  gap:.6rem;
  justify-content:center;
}

.btn{
  height:40px;
  padding:0 1.2rem;
  border-radius:8px;
  border:1px solid var(--border);
  background:#fff;
  color:var(--text);
  cursor:pointer;
  font-size:.9rem;
  font-weight:500;
  transition:all .15s ease;
}

.btn.primary{
  background:#111;
  color:#fff;
  border:none;
}

.btn.primary:hover{
  opacity:.9;
}

.btn.ghost:hover{
  background:#f0f0f0;
}

@media(max-width:520px){
  main{padding:max(1rem,env(safe-area-inset-top)) 1rem max(1rem,env(safe-area-inset-bottom))}
  .card{padding:1.6rem;border-radius:18px}
  .buttons{display:grid;grid-template-columns:1fr}
  .btn{min-height:46px}
}
</style>
