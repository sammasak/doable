<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Workspace } from '$lib/api/workstation';
  import { getDeployedUrl } from '$lib/api/workstation';

  export let workspace: Workspace | null = null;
  export let previewActive: boolean = false;
  export let isWorking: boolean = false;
  export let isDeploying: boolean = false;
  // When true, switches the preview iframe from the Vite dev proxy to the deployed URL
  export let isReady: boolean = false;

  const dispatch = createEventDispatcher<{ deploy: void }>();

  let key = 0;
  let deployedUrl: string | null = null;
  let prevIsDeploying = false;
  // Shimmer state: shown when iframe regresses to the raw Vite template while Claude is still building
  let showShimmer = false;
  let hasSeenRealContent = false;
  let iframeEl: HTMLIFrameElement | null = null;

  let prevWorkspaceName: string | undefined;
  $: if (workspace?.name !== prevWorkspaceName) {
    prevWorkspaceName = workspace?.name;
    hasSeenRealContent = false;
    showShimmer = false;
  }

  function reload() {
    key += 1;
    // Reset shimmer / real-content tracking on manual reload
    showShimmer = false;
    hasSeenRealContent = false;
  }

  function onIframeLoad() {
    if (!iframeEl) return;
    try {
      const title = iframeEl.contentDocument?.title ?? '';
      // Treat empty title (our baked template has no <title> tag) or known Vite defaults as template state
      const isTemplate = !title || title === 'Vite App' || title === 'Vite + TS' || title === 'Vite + SvelteKit';
      if (isTemplate && isWorking) {
        if (hasSeenRealContent) {
          // Regression: real content was visible but Vite reloaded back to the template
          showShimmer = true;
          // Failsafe: auto-clear after 8s in case iframe doesn't reload with real content
          setTimeout(() => { showShimmer = false; }, 8_000);
        }
        // If we haven't seen real content yet, just leave the iframe visible (first load of template is expected)
      } else if (!isTemplate) {
        // Real app content loaded
        hasSeenRealContent = true;
        showShimmer = false;
      }
    } catch {
      // Cross-origin error — can't inspect, leave as-is
    }
  }

  // Proxy URL — always relative, same origin
  $: proxyBase = workspace ? `/api/proxy/workspaces/${workspace.name}/preview/` : null;

  // Address bar text
  $: addressText = deployedUrl
    ? deployedUrl.replace('https://', '')
    : previewActive
      ? 'Dev preview'
      : 'No preview';

  // Fetch deployed URL when workspace changes
  $: if (workspace?.name) {
    getDeployedUrl(workspace.name).then(url => {
      if (url && url !== deployedUrl) deployedUrl = url;
    });
  }

  // Re-poll deployed URL when isDeploying flips to false (deployment just finished)
  $: {
    if (prevIsDeploying && !isDeploying && workspace?.name) {
      getDeployedUrl(workspace.name).then(url => {
        if (url && url !== deployedUrl) deployedUrl = url;
      });
    }
    prevIsDeploying = isDeploying;
  }

  // When isReady becomes true (goal completed), fetch the deployed URL
  let prevIsReady = false;
  $: {
    if (isReady && !prevIsReady && workspace?.name) {
      getDeployedUrl(workspace.name).then(url => {
        if (url && url !== deployedUrl) deployedUrl = url;
      });
    }
    prevIsReady = isReady; // always sync — allows re-fetch on second isReady transition
  }

  // Use deployed URL as iframe source when ready, fall back to proxy during build
  $: iframeSrc = (isReady && deployedUrl) ? deployedUrl : proxyBase;

  // When switched to deployed URL (cross-origin), mark content as real immediately
  // so the building overlay is dismissed and doesn't cover the deployed app.
  $: if (isReady && deployedUrl && iframeSrc === deployedUrl) {
    hasSeenRealContent = true;
  }

  // Force iframe reload when switching from proxy to deployed URL
  let prevIframeSrc: string | null = null;
  let prevIframeSrcInitialized = false;
  $: {
    if (prevIframeSrcInitialized && iframeSrc !== prevIframeSrc) {
      key += 1;
    }
    prevIframeSrc = iframeSrc;
    prevIframeSrcInitialized = true;
  }
</script>

<div class="flex flex-col h-full" style="background: var(--color-bg);">
  <!-- Building banner — shown whenever Claude is working and no real app content has loaded yet (hidden when iframe is active to avoid duplicate banner) -->
  {#if isWorking && !hasSeenRealContent && !previewActive}
    <div style="
      padding: 6px 12px;
      font-size: 12px;
      background: rgba(99, 102, 241, 0.08);
      border-bottom: 1px solid rgba(99, 102, 241, 0.15);
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    ">
      <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--color-accent, #6366f1); animation: buildingPulse 1.5s ease-in-out infinite;"></span>
      Claude is building your preview…
    </div>
  {/if}
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
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--color-text-muted); opacity: {previewActive || deployedUrl ? 1 : 0.4};">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span style="font-family: var(--font-mono); font-size: 12px; color: {previewActive || deployedUrl ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {addressText}
      </span>
    </div>

    <!-- Deploy button area -->
    {#if deployedUrl}
      <a
        href={deployedUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open deployed app"
        style="
          flex-shrink: 0; height: 26px; border-radius: 6px;
          border: 1px solid rgba(34,197,94,0.4); background: rgba(34,197,94,0.08);
          color: #4ade80; font-size: 11px; font-family: var(--font-mono);
          display: flex; align-items: center; gap: 4px;
          padding: 0 8px;
          cursor: pointer; transition: color 0.15s, border-color 0.15s;
          text-decoration: none; white-space: nowrap;
        "
      >↗ Open</a>
    {:else if isDeploying}
      <button
        disabled
        style="
          flex-shrink: 0; height: 26px; border-radius: 6px;
          border: 1px solid var(--color-border); background: transparent;
          color: var(--color-text-muted); font-size: 11px; font-family: var(--font-mono);
          display: flex; align-items: center; gap: 5px;
          padding: 0 8px;
          cursor: not-allowed; opacity: 0.7;
          white-space: nowrap;
        "
      >
        <span class="deploy-spinner"></span>
        Deploying…
      </button>
    {:else if previewActive}
      <button
        on:click={() => dispatch('deploy')}
        title="Deploy your app"
        style="
          flex-shrink: 0; height: 26px; border-radius: 6px;
          border: 1px solid var(--color-border); background: transparent;
          color: var(--color-text-muted); font-size: 11px; font-family: var(--font-mono);
          display: flex; align-items: center; gap: 4px;
          padding: 0 8px;
          cursor: pointer; transition: color 0.15s, border-color 0.15s;
          white-space: nowrap;
        "
        class="hover-border-accent"
      >Deploy ↗</button>
    {/if}

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
    {#if previewActive && iframeSrc}
      {#key key}
        <iframe
          src={iframeSrc}
          title="Live preview"
          class="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          bind:this={iframeEl}
          on:load={onIframeLoad}
        ></iframe>
      {/key}
      {#if isWorking && !hasSeenRealContent}
        <!-- Inline overlay for when iframe shows the raw Vite template (real content not yet detected) -->
        <div style="
          position: absolute;
          top: 0; left: 0; right: 0;
          padding: 6px 12px;
          font-size: 12px;
          background: rgba(99, 102, 241, 0.08);
          border-bottom: 1px solid rgba(99, 102, 241, 0.15);
          color: var(--color-text-muted);
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--color-accent, #6366f1); animation: buildingPulse 1.5s ease-in-out infinite;"></span>
          Claude is building your preview…
        </div>
      {/if}
      {#if showShimmer}
        <div style="
          position: absolute; inset: 0;
          background: var(--color-bg);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 14px;
          z-index: 10;
        ">
          <div style="
            width: 60%; max-width: 320px; height: 160px;
            border-radius: 10px; overflow: hidden;
            background: var(--color-surface);
            animation: shimmerPulse 1.8s ease-in-out infinite;
          "></div>
          <p style="font-size: 13px; color: var(--color-text-muted); font-family: var(--font-mono);">Claude is updating the preview…</p>
        </div>
      {/if}
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
          {#if isWorking}
            <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">Getting preview ready…</p>
            <p style="font-size: 12px; color: var(--color-text-muted);">Usually appears within 3–5 minutes</p>
          {:else}
            <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">No preview yet</p>
            <p style="font-size: 12px; color: var(--color-text-muted);">Your app will appear here once it's ready</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .deploy-spinner {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    border-top-color: currentColor;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    flex-shrink: 0;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes shimmerPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }
  @keyframes buildingPulse {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
</style>
