<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { listWorkspaces, createWorkspace, deleteWorkspace } from '$lib/api/workstation';
  import type { Workspace } from '$lib/api/workstation';
  import ProjectList from '$lib/components/ProjectList.svelte';

  let workspaces: Workspace[] = [];
  let loading = true;
  let error = '';
  let creating = false;

  // Inline creation form
  let name = '';
  let prompt = '';
  let nameError = '';
  let nameInput: HTMLInputElement;

  // Cross-platform submit hint
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  const submitHint = isMac ? '⌘↵' : 'Ctrl+↵';

  const examplePrompts = [
    'Build a markdown notes app with local storage',
    'Make a personal recipe collection site',
    'Create a real-time kanban board',
    'Make a link shortener with click tracking',
    'Build a pomodoro timer with stats',
  ];

  onMount(async () => {
    // Restore last-used project name from localStorage
    const savedName = localStorage.getItem('doable:lastProjectName');
    if (savedName) name = savedName;

    await refresh();
    loading = false;
  });

  function onProjectNameChange(value: string) {
    localStorage.setItem('doable:lastProjectName', value);
  }

  async function refresh() {
    try {
      workspaces = await listWorkspaces();
    } catch (e) {
      error = String(e);
    }
  }

  function validateName(v: string) {
    if (!v) return 'Name required';
    if (!/^[a-z0-9-]+$/.test(v)) return 'Lowercase letters, numbers, hyphens only';
    if (v.length > 32) return 'Max 32 characters';
    return '';
  }

  function useExample(ex: string) {
    prompt = ex;
    // Auto-generate a name from example
    if (!name) {
      name = ex
        .toLowerCase()
        .replace(/^(build|create|make|add)\s+(a|an)\s+/i, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join('-')
        .replace(/-+$/, '');
    }
  }

  async function handleCreate() {
    nameError = validateName(name);
    if (nameError) { nameInput?.focus(); return; }
    if (!prompt.trim()) return;

    creating = true;
    error = '';
    try {
      await createWorkspace({
        name,
        containerDiskImage: 'registry.sammasak.dev/agents/claude-worker:latest',
        bootstrapSecretName: 'claude-worker-bootstrap',
        runStrategy: 'Always',
        idleHaltAfterMinutes: 60,
        goal: prompt.trim() || undefined,
      });
      goto(`/projects/${name}`);
    } catch (e) {
      error = String(e);
      creating = false;
    }
  }

  async function handleDelete(e: CustomEvent<string>) {
    if (!confirm(`Delete project "${e.detail}"?`)) return;
    try {
      await deleteWorkspace(e.detail);
      await refresh();
    } catch (err) {
      error = String(err);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreate();
    }
  }

  $: canSubmit = !!name && !!prompt.trim() && !nameError && !creating;
</script>

<svelte:head>
  <title>Doable — AI Builder</title>
</svelte:head>

<div
  class="min-h-screen flex flex-col"
  style="
    background-color: var(--color-bg);
    background-image:
      radial-gradient(ellipse 900px 700px at 50% -5%, rgba(99,102,241,0.1) 0%, transparent 60%),
      radial-gradient(ellipse 600px 400px at 10% 80%, rgba(16,185,129,0.04) 0%, transparent 50%),
      radial-gradient(ellipse 500px 400px at 90% 90%, rgba(99,102,241,0.04) 0%, transparent 50%);
  "
>
  <!-- Header -->
  <header class="header-bar sticky top-0 z-10 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span style="color: var(--color-accent); font-size: 16px;">◆</span>
      <span style="font-size: 17px; font-weight: 700; letter-spacing: -0.04em; color: var(--color-text-primary);">doable</span>
    </div>
    {#if workspaces.length > 0}
      <span style="font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted);">{workspaces.length} project{workspaces.length === 1 ? '' : 's'}</span>
    {/if}
  </header>

  <!-- Hero -->
  <main class="flex-1 flex flex-col items-center px-6 pt-20 pb-16">
    <!-- Headline -->
    <div class="text-center mb-10 max-w-xl">
      <h1 style="
        font-size: clamp(36px, 6vw, 54px);
        font-weight: 700;
        letter-spacing: -0.04em;
        line-height: 1.1;
        margin-bottom: 16px;
        background: linear-gradient(135deg, #F0F2FF 0%, #A5B4FC 50%, #818CF8 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      ">Build something amazing</h1>
      <p style="font-size: 16px; color: var(--color-text-secondary); line-height: 1.6;">
        Describe what you want to create. Claude handles everything — writing the code, building it, and making it live.
      </p>
    </div>

    <!-- Creation card -->
    <div style="
      width: 100%;
      max-width: 640px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 0 0 1px rgba(99,102,241,0.05), 0 24px 48px rgba(0,0,0,0.3);
    ">
      <!-- Name row -->
      <div style="display: flex; align-items: center; gap: 0; border-bottom: 1px solid {nameError ? 'rgba(248,113,113,0.6)' : 'var(--color-border)'}; transition: border-color 0.15s;">
        <span style="padding: 0 12px 0 16px; color: var(--color-text-muted); font-family: var(--font-mono); font-size: 12px; white-space: nowrap; user-select: none;">project /</span>
        <input
          type="text"
          bind:value={name}
          bind:this={nameInput}
          on:input={() => { nameError = validateName(name); onProjectNameChange(name); }}
          placeholder="my-project"
          style="
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            padding: 12px 16px 12px 4px;
            font-family: var(--font-mono);
            font-size: 13px;
            color: var(--color-text-primary);
          "
        />
        {#if nameError}
          <span style="padding-right: 12px; font-size: 11px; color: #F87171; font-family: var(--font-mono); white-space: nowrap;">{nameError}</span>
        {/if}
      </div>

      <!-- Prompt textarea -->
      <textarea
        bind:value={prompt}
        on:keydown={handleKeydown}
        placeholder="What do you want to create?&#10;&#10;Try: Make a recipe collection site, or Build a habit tracker with streaks..."
        rows={5}
        style="
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          padding: 16px;
          font-family: var(--font-sans);
          font-size: 14px;
          color: var(--color-text-primary);
          resize: none;
          line-height: 1.6;
          box-sizing: border-box;
        "
      ></textarea>

      <!-- Examples + Submit row -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 12px; gap: 8px; flex-wrap: wrap;">
        <!-- Example chips -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; flex: 1;">
          {#each examplePrompts.slice(0, 3) as ex}
            <button
              on:click={() => useExample(ex)}
              style="
                font-family: var(--font-mono);
                font-size: 11px;
                color: var(--color-text-muted);
                background: rgba(255,255,255,0.03);
                border: 1px solid var(--color-border);
                border-radius: 20px;
                padding: 3px 10px;
                cursor: pointer;
                transition: color 0.15s, border-color 0.15s;
                white-space: nowrap;
              "
              class="hover-text hover-border-accent"
            >{ex.split(' ').slice(0, 4).join(' ')}…</button>
          {/each}
        </div>

        <!-- Submit -->
        <button
          on:click={handleCreate}
          disabled={!canSubmit}
          style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: {canSubmit ? 'var(--color-accent)' : 'rgba(99,102,241,0.3)'};
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 500;
            cursor: {canSubmit ? 'pointer' : 'not-allowed'};
            transition: opacity 0.15s, box-shadow 0.15s;
            box-shadow: {canSubmit ? '0 0 0 1px rgba(99,102,241,0.5), 0 4px 16px rgba(99,102,241,0.2)' : 'none'};
            white-space: nowrap;
            flex-shrink: 0;
          "
        >
          {#if creating}
            <span style="display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin360 0.7s linear infinite;"></span>
            Provisioning...
          {:else}
            Build →
          {/if}
        </button>
      </div>
    </div>

    <!-- Hint -->
    <p style="margin-top: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted);">
      {submitHint} to submit · Shift+Enter for newline
    </p>

    {#if error}
      <div style="margin-top: 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 10px 14px; color: #FCA5A5; font-size: 13px; max-width: 640px; width: 100%;">{error}</div>
    {/if}

    <!-- Recent projects -->
    {#if !loading && workspaces.length > 0}
      <div style="width: 100%; max-width: 640px; margin-top: 48px;">
        <h2 style="font-size: 13px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); font-family: var(--font-mono); margin-bottom: 12px;">Recent projects</h2>
        <ProjectList
          {workspaces}
          on:select={(e) => goto(`/projects/${e.detail}`)}
          on:delete={handleDelete}
        />
      </div>
    {:else if loading}
      <div style="width: 100%; max-width: 640px; margin-top: 48px;" class="space-y-3">
        {#each [1, 2] as _}
          <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 16px 20px;" class="animate-pulse">
            <div style="height: 14px; background: var(--color-surface-2); border-radius: 4px; width: 28%; margin-bottom: 8px;"></div>
            <div style="height: 11px; background: var(--color-surface-2); border-radius: 4px; width: 15%;"></div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  @keyframes spin360 {
    to { transform: rotate(360deg); }
  }
</style>
