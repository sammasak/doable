<script lang="ts">
  import type { Workspace } from '$lib/api/workstation';
  import { getDeployedUrl } from '$lib/api/workstation';

  export let workspace: Workspace | null = null;
  export let previewActive: boolean = false;
  export let isWorking: boolean = false;
  export let isReady: boolean = false;

  let key = 0;
  let bannerDismissed = false;
  let prevIsReady = false;
  type Tab = 'dev' | 'deployed';

  // Default: dev if preview is active, otherwise deployed
  let activeTab: Tab = previewActive ? 'dev' : 'deployed';

  let deployedUrl: string | null = null;
  let deployedUrlLoading = true;

  function reload() {
    key += 1;
  }

  function setTab(tab: Tab) {
    if (tab === 'dev' && !previewActive) return;
    if (tab === 'deployed' && !deployedUrl) return;
    activeTab = tab;
  }

  // Auto-switch to deployed when dev becomes unavailable
  $: if (!previewActive && activeTab === 'dev') {
    activeTab = 'deployed';
  }

  // Proxy URL — always relative, same origin
  $: proxyBase = workspace ? `/api/proxy/workspaces/${workspace.name}/preview/` : null;

  // Address bar text
  $: addressText = activeTab === 'dev'
    ? (previewActive ? 'localhost:4300 (dev)' : 'No preview')
    : (deployedUrl ?? (deployedUrlLoading ? 'Loading…' : 'No deployment yet'));

  // Fetch deployed URL when workspace changes
  $: if (workspace?.name) {
    deployedUrlLoading = true;
    getDeployedUrl(workspace.name).then(url => {
      deployedUrl = url;
      deployedUrlLoading = false;
    });
  }

  // Reset banner only on isReady false→true transition (not level-triggered)
  $: {
    if (isReady && !prevIsReady) bannerDismissed = false;
    prevIsReady = isReady;
  }

  // Re-fetch deployed URL when goal completes — Claude may have just published the URL
  $: if (isReady && workspace?.name && !deployedUrl) {
    getDeployedUrl(workspace.name).then(url => {
      if (url) {
        deployedUrl = url;
        deployedUrlLoading = false;
        activeTab = 'deployed';
      }
    });
  }
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

    <!-- Dev / Deployed toggle -->
    <div style="
      display: flex;
      flex-shrink: 0;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      overflow: hidden;
    ">
      <button
        on:click={() => setTab('dev')}
        disabled={!previewActive}
        style="
          padding: 3px 9px;
          font-size: 11px;
          font-family: var(--font-mono);
          border: none;
          border-right: 1px solid var(--color-border);
          background: {activeTab === 'dev' && previewActive ? 'var(--color-accent)' : 'transparent'};
          color: {activeTab === 'dev' && previewActive ? '#fff' : 'var(--color-text-muted)'};
          cursor: {previewActive ? 'pointer' : 'not-allowed'};
          opacity: {!previewActive ? 0.4 : 1};
          transition: background 0.15s, color 0.15s, opacity 0.15s;
          line-height: 1.5;
        "
      >Dev</button>
      <button
        on:click={() => setTab('deployed')}
        disabled={!deployedUrl}
        style="
          padding: 3px 9px;
          font-size: 11px;
          font-family: var(--font-mono);
          border: none;
          background: {activeTab === 'deployed' && deployedUrl ? 'var(--color-accent)' : 'transparent'};
          color: {activeTab === 'deployed' && deployedUrl ? '#fff' : 'var(--color-text-secondary)'};
          cursor: {deployedUrl ? 'pointer' : 'not-allowed'};
          opacity: {!deployedUrl ? 0.4 : 1};
          transition: background 0.15s, color 0.15s, opacity 0.15s;
          line-height: 1.5;
          display: flex; align-items: center; gap: 4px;
        "
        title={deployedUrl ? 'View deployed app' : 'No deployment yet'}
      >↗ Deployed</button>
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
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; color: var(--color-text-muted); opacity: {activeTab === 'deployed' || previewActive ? 1 : 0.4};">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span style="font-family: var(--font-mono); font-size: 12px; color: {activeTab === 'dev' && !previewActive ? 'var(--color-text-muted)' : 'var(--color-text-secondary)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {addressText}
      </span>
    </div>
    {#if activeTab === 'deployed' && deployedUrl}
      <a
        href={deployedUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in new tab"
        style="
          flex-shrink: 0; height: 26px; border-radius: 6px;
          border: 1px solid var(--color-border); background: transparent;
          color: var(--color-text-muted); font-size: 11px; font-family: var(--font-mono);
          display: flex; align-items: center; gap: 4px;
          padding: 0 8px;
          cursor: pointer; transition: color 0.15s, border-color 0.15s;
          text-decoration: none; white-space: nowrap;
        "
        class="hover-border-accent"
      >Open ↗</a>
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
    {#if activeTab === 'dev' && previewActive && proxyBase}
      {#key key}
        <iframe
          src={proxyBase}
          title="Live preview"
          class="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups"
        ></iframe>
      {/key}
    {:else if activeTab === 'deployed' && deployedUrl}
      {#if isReady && !bannerDismissed}
        <div style="
          padding: 8px 14px;
          background: rgba(34,197,94,0.08);
          border-bottom: 1px solid rgba(34,197,94,0.2);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-shrink: 0;
        ">
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--color-success);">
            ✓ Your app is live!
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a
              href={deployedUrl}
              target="_blank"
              rel="noopener noreferrer"
              style="font-family: var(--font-mono); font-size: 11px; color: var(--color-success); text-decoration: underline; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            >{deployedUrl.replace('https://', '')}</a>
            <button
              on:click={() => bannerDismissed = true}
              style="background: none; border: none; cursor: pointer; color: var(--color-text-muted); font-size: 14px; line-height: 1; padding: 0;"
              title="Dismiss"
            >×</button>
          </div>
        </div>
      {/if}
      {#key key}
        <iframe
          src={deployedUrl}
          title="Deployed preview"
          class="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
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
          {#if activeTab === 'deployed' && deployedUrlLoading}
            <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">Checking for deployment…</p>
          {:else if activeTab === 'deployed'}
            <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">No deployment yet</p>
            {#if isWorking}
              <p style="font-size: 12px; color: var(--color-text-muted);">Claude will deploy your app here automatically when it's ready</p>
            {:else}
              <p style="font-size: 12px; color: var(--color-text-muted);">Your deployed app will appear here once Claude finishes building</p>
            {/if}
          {:else}
            <p style="font-size: 14px; color: var(--color-text-secondary); margin-bottom: 6px; font-weight: 500;">No preview available</p>
            <p style="font-size: 12px; color: var(--color-text-muted);">Your app will appear here once it's running</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
