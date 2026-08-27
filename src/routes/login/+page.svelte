<script lang="ts">
  import { auth } from '$lib/firebase';
  import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let email = '';
  let password = '';
  let mode: 'login' | 'signup' = $page.url.searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  let error = '';

  async function handleSubmit() {
    error = '';
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      goto('/');
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Login failed. Please try again.';
    }
  }
</script>

<main class="login-page">
  <section class="login-card">
    <p class="brand">Trackr</p>
    <h1>{mode === 'signup' ? 'Registrieren' : 'Einloggen'}</h1>
    <p class="intro">{mode === 'signup' ? 'Create your private Trackr account.' : 'Continue to your private dashboard.'}</p>

    <form on:submit|preventDefault={handleSubmit}>
      <label><span>Email</span><input type="email" inputmode="email" autocomplete="email" bind:value={email} placeholder="you@example.com" required /></label>
      <label><span>Passwort</span><input type="password" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} bind:value={password} placeholder="••••••••" required /></label>
      <button type="submit">{mode === 'signup' ? 'Registrieren' : 'Login'}</button>
    </form>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <p class="switcher">
      {#if mode === 'signup'}Bereits einen Account? <button type="button" on:click={() => mode = 'login'}>Login</button>
      {:else}Noch keinen Account? <button type="button" on:click={() => mode = 'signup'}>Registrieren</button>{/if}
    </p>
  </section>
</main>

<style>
  :global(html,body){margin:0;min-height:100%;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;-webkit-text-size-adjust:100%}.login-page{min-height:100vh;min-height:100dvh;box-sizing:border-box;display:grid;place-items:center;padding:max(1.2rem,env(safe-area-inset-top)) max(1rem,env(safe-area-inset-right)) max(1.2rem,env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left));background:radial-gradient(circle at 18% 10%,#ddd6ff,transparent 31%),radial-gradient(circle at 85% 88%,#d3ede0,transparent 28%),#f5f5f2}.login-card{width:min(390px,100%);box-sizing:border-box;padding:clamp(1.5rem,6vw,2.4rem);border:1px solid rgba(255,255,255,.9);border-radius:24px;background:rgba(255,255,255,.88);box-shadow:0 24px 65px rgba(0,0,0,.08);backdrop-filter:blur(16px)}.brand{margin:0;color:#777;font-size:.68rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.login-card h1{margin:.45rem 0 0;font-size:2.25rem;letter-spacing:-.055em}.intro{margin:.45rem 0 1.4rem;color:#777;font-size:.8rem}.login-card form{display:grid;gap:.85rem}.login-card label span{display:block;margin-bottom:.3rem;color:#666;font-size:.68rem;font-weight:750}.login-card input{width:100%;min-height:46px;box-sizing:border-box;padding:.7rem .8rem;border:1px solid #deded9;border-radius:12px;background:#fff;color:#171717;font:inherit;font-size:16px}.login-card form button{min-height:46px;margin-top:.2rem;border:0;border-radius:12px;background:#171717;color:#fff;font:inherit;font-weight:750;cursor:pointer}.error{padding:.7rem;border-radius:10px;background:#fff0f0;color:#9d3434;font-size:.72rem}.switcher{margin:1.2rem 0 0;color:#777;font-size:.72rem;text-align:center}.switcher button{padding:.25rem;border:0;background:transparent;color:#171717;font:inherit;font-weight:750;cursor:pointer}@media(max-width:420px){.login-card{border-radius:20px}.login-card h1{font-size:2rem}}
</style>
