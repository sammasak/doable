<script lang="ts">
  import '../app.css';
  import type { LayoutData } from './$types';

  export let data: LayoutData;
</script>

<slot />

{#if data.user}
<form method="post" action="/auth/logout" style="position:fixed;top:1rem;right:1rem;z-index:100">
  <button type="submit" style="font-size:0.75rem;opacity:0.6;cursor:pointer;background:none;border:none;color:inherit">
    Sign out
  </button>
</form>
{/if}
