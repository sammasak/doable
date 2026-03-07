<script lang="ts">
  import type { Workspace } from '$lib/api/workstation';

  export let workspace: Workspace | null = null;
  export let previewActive: boolean = false;

  let key = 0;

  function reload() {
    key += 1;
  }

  // Proxy URL — always relative, same origin
  $: proxyBase = workspace ? `/api/proxy/workspaces/${workspace.name}/preview/` : null;
</script>

<div class="flex flex-col h-full" style="background: var(--color-bg);">
  <!-- Browser chrome bar -->
  <div style="
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    user-select: none;
  ">
    <div style="display: flex; gap: 5px; flex-shrink: 0;">
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #FF5F56; display: block; opacity: 0.7;"></span>
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #FFBD2E; display: block; opacity: 0.7;"></span>
      <span style="width: 10px; height: 10px; border-radius: 50%; background: #28CA41; display: block; opacity: 0.7;"></span>
    </div>
    <div style="
      flex: 1;
      display: flex;
      align-items: center;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 3px 10px;
      gap: 6px;
      overflow: hidden;
    ">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--color-text-muted); opacity: {previewActive ? 1 : 0.4};">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span style="font-family: var(--font-mono); font-size: 12px; color: {previewActive ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {previewActive ? 'localhost:4300 (dev)' : 'No preview'}
      </span>
    </div>
    <button
      on:click={reload}
      title="Reload preview"
      style="
        flex-shrink: 0; width: 26px; height: 26px; border-radius: 6px;
        border: 1px solid var(--color-border); background: transparent;
        color: var(--color-text-muted); font-size: 13px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: color 0.15s, border-color 0.15s;
      "
      class="hover-border-accent"
    >↻</button>
  </div>

  <!-- iframe or placeholder -->
  <div class="flex-1 relative" style="background: var(--color-bg);">
    {#if previewActive && proxyBase}
      {#key key}
        <iframe
          src={proxyBase}
          title="Live preview"
          class="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups"
        ></iframe>
      {/key}
    {:else}
      <div class="flex flex-col items-center justify-center h-full gap-5" style="padding: 32px;">
        <div style="
          width: 220px; border: 1px solid var(--color-border);
          border-radius: 10px; overflow: hidden; opacity: 0.35;
        ">
          <div style="background: var(--color-surface-2); padding: 8px 10px; display: flex; gap: 4px; align-items: center; border-bottom: 1px solid var(--color-border);">
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #4A5068; display: block;"></span>
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #4A5068; display: block;"></span>
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #4A5068; display: block;"></span>
            <div style="flex: 1; background: var(--color-bg); border-radius: 4px; height: 12px; margin-left: 4px;"></div>
          </div>
          <div style="background: var(--color-bg); padding: 16px; height: 100px;">
            <div style="height: 8px; background: var(--color-surface-2); border-radius: 4px; width: 70%; margin-bottom: 8px;"></div>
            <div style="height: 6px; background: var(--color-surface-2); border-radius: 4px; width: 90%; margin-bottom: 6px;"></div>
            <div style="height: 6px; background: var(--color-surface-2); border-radius: 4px; width: 55%;"></div>
          </div>
        </div>
        <div class="text-center">
          <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">No preview</p>
          <p style="font-size: 12px; color: var(--color-text-muted);">Use the PREVIEW skill to start a dev server</p>
        </div>
      </div>
    {/if}
  </div>
</div>
