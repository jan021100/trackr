<script lang="ts">
  import { user } from '$lib/stores/user';
  import { auth, db } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { doc, getDoc, updateDoc } from 'firebase/firestore';
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';

  let name = '';
  let gender = '';
  let height = '';
  let weight = '';
  let customUrl = '';
  let selectedDefault = '';
  let ready = false;

  const defaultAvatars = [
    '/avatars/doctor1.png',
    '/avatars/doctor2.png',
    '/avatars/female1.png',
    '/avatars/female2.png'
  ];

  const unsubscribe = user.subscribe(async (u) => {
  if (u && !ready) {
    const userRef = doc(db, 'users', u.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      name = data.name ?? '';
      gender = data.gender ?? '';
      height = data.height?.toString() ?? '';
      weight = data.weight?.toString() ?? '';
      const rawUrl = data.photoURL ?? '';
      selectedDefault = defaultAvatars.includes(rawUrl) ? rawUrl : '';
      customUrl = !selectedDefault ? rawUrl : '';
    }

    ready = true;
  }
});

  onDestroy(() => {
    unsubscribe();
  });

  async function logout() {
    await auth.signOut();
    goto('/login');
  }

  async function saveChanges() {
    const currentUser = get(user);
    if (!currentUser) return;

    const uid = currentUser.uid;
    const userRef = doc(db, 'users', uid);

    const updates: any = {};
    if (name.trim()) updates.name = name.trim();
    if (gender) updates.gender = gender;
    if (height) updates.height = height;
    if (weight) updates.weight = weight;
    if (selectedDefault || customUrl) updates.photoURL = selectedDefault || customUrl;

    await updateDoc(userRef, updates);
    location.reload();
  }
</script>

<main>
  {#if ready}
  <h1>Your Profile</h1>

  <div class="profile-card">
    <img class="avatar-large" src={selectedDefault || customUrl || '/avatar-default.png'} />

    <div class="field">
      <label>Choose a default avatar:</label>
      <select bind:value={selectedDefault}>
        <option value="">– None –</option>
        {#each defaultAvatars as url}
          <option value={url}>{url}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label>Or use a custom URL:</label>
      <input type="text" bind:value={customUrl} placeholder="https://example.com/image.jpg" />
    </div>

    <div class="field">
      <label>Name:</label>
      <input type="text" bind:value={name} />
    </div>

    <div class="field">
      <label>Gender:</label>
      <select bind:value={gender}>
        <option value="">–</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="other">Other</option>
      </select>
    </div>

    <div class="field">
      <label>Height (cm):</label>
      <input type="number" bind:value={height} />
    </div>

    <div class="field">
      <label>Weight (kg):</label>
      <input type="number" bind:value={weight} />
    </div>

    <button class="btn" on:click={saveChanges}>💾 Save changes</button>
    <button class="btn logout" on:click={logout}>🚪 Log out</button>
  </div>
{:else}
  <p>Loading user data…</p>
{/if}
</main>

<style>
  main {
    padding: 1.5rem;
  }

  h1 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
  }

  .profile-card {
    background: white;
    padding: 1.5rem;
    border-radius: 1rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    text-align: center;
  }

  .avatar-large {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid #ccc;
    margin-bottom: 1rem;
  }

  .field {
    margin: 0.8rem 0;
    text-align: left;
  }

  .field label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.3rem;
    color: #333;
  }

  .field input,
  .field select {
    width: 100%;
    padding: 0.4rem;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 0.5rem;
  }

  .btn {
    margin-top: 1rem;
    padding: 0.6rem 1.2rem;
    background: #0a84ff;
    color: white;
    border: none;
    border-radius: 0.7rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn:hover {
    background: #006edc;
  }

  .btn.logout {
    background: #d70015;
    margin-left: 0.5rem;
  }
</style>