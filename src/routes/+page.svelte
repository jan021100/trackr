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
    goto('/signup');
  }
</script>

<style>
  main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 3rem 2rem;
    min-height: 100vh;
    background-color: #f5f5f3;
    font-family: system-ui, sans-serif;
    color: #111;
    text-align: center;
  }

  h1 {
    font-size: 3rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  p {
    font-size: 1.25rem;
    color: #444;
    margin-bottom: 2rem;
    max-width: 480px;
  }

  .buttons {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  button {
    border: 1px solid black;
    background-color: white;
    color: black;
    padding: 0.75rem 2rem;
    border-radius: 9999px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  button:hover {
    background-color: black;
    color: white;
  }

  .fade-in {
    animation: fadeIn 1s ease-in-out forwards;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(1rem); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>

<main>
  {#if loading}
    <p>⏳ Loading…</p>
  {:else}
    <div class="fade-in">
      <h1>Welcome to Trackr</h1>
      <p>Your journey to intentional living starts here. Track what matters.</p>
      <div class="buttons">
        <button on:click={handleLogin}>Login</button>
        <button on:click={handleSignup}>Sign up</button>
      </div>
    </div>
  {/if}
</main>