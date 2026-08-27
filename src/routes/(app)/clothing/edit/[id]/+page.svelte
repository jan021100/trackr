<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { itemEditHref, safeInternalReturnPath } from '$lib/utils/appNavigation';

  onMount(() => {
    const returnTo = safeInternalReturnPath($page.url.searchParams.get('returnTo'));
    goto(itemEditHref($page.params.id, returnTo), { replaceState: true });
  });
</script>

<p class="redirect-state">Opening editor…</p>

<style>.redirect-state{padding:4rem;text-align:center;color:#777}</style>
