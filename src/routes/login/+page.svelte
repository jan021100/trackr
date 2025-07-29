<script lang="ts">
  import { auth } from '$lib/firebase';
  import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let email = '';
  let password = '';
  let mode: 'login' | 'signup' = 'login';
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
    } catch (e) {
      error = e.message;
    }
  }
</script>

<h1>{mode === 'signup' ? 'Registrieren' : 'Einloggen'}</h1>

<form on:submit|preventDefault={handleSubmit}>
  <input type="email" bind:value={email} placeholder="Email" required />
  <input type="password" bind:value={password} placeholder="Passwort" required />
  <button type="submit">{mode === 'signup' ? 'Registrieren' : 'Login'}</button>
</form>

{#if error}
  <p style="color:red">{error}</p>
{/if}

<p>
  {#if mode === 'signup'}
    Bereits einen Account? <a href="#" on:click={() => mode = 'login'}>Login</a>
  {:else}
    Noch kein Account? <a href="#" on:click={() => mode = 'signup'}>Registrieren</a>
  {/if}
</p>