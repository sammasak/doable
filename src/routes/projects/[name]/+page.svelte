<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { getWorkspace, getGoals, addGoal, heartbeat, getWorkspaceEvents, WorkerNotReadyError } from '$lib/api/workstation';
  import type { Goal, Workspace } from '$lib/api/workstation';
  import { createEventSource, parseEventToActivity } from '$lib/api/stream';
  import type { ActivityItem } from '$lib/api/stream';
  import ChatSidebar from '$lib/components/ChatSidebar.svelte';
  import LivePreview from '$lib/components/LivePreview.svelte';
  import WorkspaceStatus from '$lib/components/WorkspaceStatus.svelte';

  export let data: PageData;

  const workspaceName = $page.params.name;
  let workspace: Workspace | null = data.workspace;
  let goals: Goal[] = [];
  let activity: ActivityItem[] = [];
  let events: unknown[] = [];
  let isProvisioning = true;
  let isReady = false;
  let error = '';

  let pollInterval: ReturnType<typeof setInterval>;
  let heartbeatInterval: ReturnType<typeof setInterval>;
  let goalRetryInterval: ReturnType<typeof setInterval>;
  let goalPollInterval: ReturnType<typeof setInterval>;
  let confirmationInterval: ReturnType<typeof setInterval>;
  let eventSource: EventSource | null = null;
  let goalRetries = 0;
  const MAX_GOAL_RETRIES = 10;
  let isWorkerWarming = false;
  let pollingActive = false;
  let confirmationStartedAt: number = 0;
  let confirmationWarning = false;

  // State machine
  type Phase = 'provisioning' | 'posting_goal' | 'streaming' | 'confirming_goal' | 'idle';
  let phase: Phase = 'provisioning';
  let pendingPrompt: string | null = null;

  onMount(async () => {
    // Check for initial prompt stored from landing page
    const stored = sessionStorage.getItem(`initial_prompt_${workspaceName}`);
    if (stored) {
      pendingPrompt = stored;
      sessionStorage.removeItem(`initial_prompt_${workspaceName}`);
    }

    // Start polling workspace status
    await pollWorkspace();
    pollInterval = setInterval(pollWorkspace, 5000);

    // Heartbeat every 30s
    heartbeatInterval = setInterval(() => heartbeat(workspaceName), 30000);
  });

  onDestroy(() => {
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    clearInterval(goalRetryInterval);
    clearInterval(goalPollInterval);
    clearInterval(confirmationInterval);
    eventSource?.close();
  });

  async function pollWorkspace() {
    if (pollingActive) return;
    pollingActive = true;
    try {
      workspace = await getWorkspace(workspaceName);
      const running = workspace.vmStatus === 'Running' && workspace.ipAddress;

      if (running && phase === 'provisioning') {
        isProvisioning = false;
        isReady = false; // preview might not be up yet
        clearInterval(pollInterval);

        // Fetch initial goals
        await loadGoals();

        // If we have a pending initial prompt, post it
        if (pendingPrompt && goals.length === 0) {
          phase = 'posting_goal';
          await postGoalWithRetry(pendingPrompt);
          pendingPrompt = null;
        } else {
          const hasActiveGoal = goals.some(g => g.status === 'pending' || g.status === 'in_progress');
          if (hasActiveGoal) {
            phase = 'streaming';
            connectStream();
          } else {
            phase = 'idle';
          }
        }

        // Resume polling slowly for status updates
        pollInterval = setInterval(pollWorkspace, 15000);
      } else if (!running) {
        // Show K8s events during boot
        try {
          events = await getWorkspaceEvents(workspaceName);
        } catch { /* ignore */ }
      }
    } catch (e) {
      error = String(e);
    } finally {
      pollingActive = false;
    }
  }

  async function loadGoals() {
    try {
      goals = await getGoals(workspaceName);
      if (goals.some(g => g.status === 'done' || g.status === 'reviewed')) {
        isReady = true;
      }
      // Fallback: if we're stuck in streaming/posting phase but all goals are finished, go idle
      if ((phase === 'streaming' || phase === 'posting_goal' || phase === 'confirming_goal') && goals.length > 0 && !goals.some(g => g.status === 'pending' || g.status === 'in_progress')) {
        phase = 'idle';
        clearInterval(goalPollInterval);
      }
    } catch { /* worker may not be ready yet */ }
  }

  async function postGoalWithRetry(prompt: string) {
    goalRetries = 0;
    clearInterval(goalRetryInterval);
    clearInterval(goalPollInterval);

    const tryPost = async () => {
      try {
        const goal = await addGoal(workspaceName, prompt);
        goals = [...goals, goal];
        clearInterval(goalRetryInterval);
        isWorkerWarming = false;
        phase = 'confirming_goal';   // stub for Task 2 — implemented next
        startConfirmation(goal.id);  // stub for Task 2 — implemented next
      } catch (e) {
        if (e instanceof WorkerNotReadyError) {
          isWorkerWarming = true;
        } else {
          isWorkerWarming = false;
          goalRetries++;
          if (goalRetries >= MAX_GOAL_RETRIES) {
            clearInterval(goalRetryInterval);
            error = `Failed to post goal after ${MAX_GOAL_RETRIES} attempts`;
            phase = 'idle';
          }
        }
      }
    };

    await tryPost();
    if (phase === 'posting_goal') {
      goalRetryInterval = setInterval(tryPost, 5000);
    }
  }

  function startConfirmation(goalId: string) {
    phase = 'confirming_goal';
    confirmationStartedAt = Date.now();
    confirmationWarning = false;
    clearInterval(confirmationInterval);

    confirmationInterval = setInterval(async () => {
      try {
        const fetchedGoals = await getGoals(workspaceName);
        const goal = fetchedGoals.find(g => g.id === goalId);
        if (!goal) return; // not visible yet, keep waiting

        if (goal.status === 'in_progress') {
          clearInterval(confirmationInterval);
          confirmationWarning = false;
          phase = 'streaming';
          connectStream();
        } else if (goal.status === 'done' || goal.status === 'failed' || goal.status === 'reviewed') {
          // Completed before we even started streaming (very fast goal)
          clearInterval(confirmationInterval);
          phase = 'idle';
          isReady = true;
          await loadGoals();
        } else if (Date.now() - confirmationStartedAt > 20_000) {
          // Still pending after 20s — show warning but keep waiting
          confirmationWarning = true;
        }
      } catch { /* worker may not be ready yet */ }
    }, 2000);
  }

  function connectStream() {
    eventSource?.close();
    clearInterval(goalPollInterval);
    eventSource = createEventSource(workspaceName);

    eventSource.onmessage = (e) => {
      const item = parseEventToActivity(e);
      if (item) {
        activity = [...activity, item];
        if (item.kind === 'done' || item.kind === 'failed') {
          phase = 'idle';
          isReady = true;
          clearInterval(goalPollInterval);
          loadGoals();
        }
      }
    };

    eventSource.addEventListener('hook', (e) => {
      const item = parseEventToActivity(e as MessageEvent);
      if (item) activity = [...activity, item];
    });

    eventSource.onerror = () => {
      // EventSource will auto-reconnect; immediately check goal status in case we missed [DONE]
      loadGoals();
    };

    // Poll goal statuses every 8s while streaming as a fallback
    // (catches cases where [DONE] event is missed or SSE connection is unreliable)
    goalPollInterval = setInterval(loadGoals, 8000);
  }

  async function handlePrompt(e: CustomEvent<string>) {
    const prompt = e.detail;
    if (phase !== 'idle') return;

    if (!workspace?.ipAddress) {
      error = 'Workspace not running';
      return;
    }

    phase = 'posting_goal';
    activity = []; // clear for new session
    await postGoalWithRetry(prompt);
  }

  $: vmStatus = workspace?.vmStatus ?? (isProvisioning ? 'Provisioning' : 'Unknown');
  $: isWorking = phase === 'posting_goal' || phase === 'confirming_goal' || phase === 'streaming';
</script>

<svelte:head>
  <title>{workspaceName} — Doable</title>
</svelte:head>

<div class="h-screen flex flex-col" style="background: var(--color-bg);">
  <!-- Header -->
  <header class="header-bar flex items-center gap-3 px-4 py-2 shrink-0">
    <button on:click={() => goto('/')} class="btn-back" style="display: flex; align-items: center; gap: 4px;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      Back
    </button>
    <span style="color: var(--color-border); font-size: 16px; line-height: 1;">/</span>
    <span style="color: var(--color-accent); font-size: 14px;">◆</span>
    <span style="font-weight: 600; color: var(--color-text-primary); font-size: 14px; letter-spacing: -0.02em;">{workspaceName}</span>
    <WorkspaceStatus status={vmStatus} />
    {#if isWorkerWarming}
      <span style="font-size: 11px; color: #60A5FA; font-family: var(--font-mono); display: flex; align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #60A5FA; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        VM warming up…
      </span>
    {:else if phase === 'posting_goal'}
      <span style="font-size: 11px; color: #F59E0B; font-family: var(--font-mono); display: flex; align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #F59E0B; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        retry {goalRetries}/{MAX_GOAL_RETRIES}
      </span>
    {/if}
    {#if phase === 'confirming_goal'}
      <span style="font-size: 11px; color: #A78BFA; font-family: var(--font-mono); display: flex; align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #A78BFA; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        {confirmationWarning ? 'Goal queued — Claude not started yet' : 'Claude is picking up your goal…'}
      </span>
    {/if}
    {#if error}
      <span style="font-size: 11px; color: #F87171; margin-left: 4px; font-family: var(--font-mono);">{error}</span>
    {/if}
  </header>

  <!-- Body: sidebar + preview -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Provisioning overlay -->
    {#if isProvisioning}
      <div class="flex-1 flex flex-col items-center justify-center gap-6" style="color: var(--color-text-muted);">
        <!-- Spinning ring -->
        <div style="position: relative; width: 56px; height: 56px;">
          <div style="
            position: absolute; inset: 0;
            border-radius: 50%;
            border: 2px solid rgba(99,102,241,0.15);
          "></div>
          <div style="
            position: absolute; inset: 0;
            border-radius: 50%;
            border: 2px solid transparent;
            border-top-color: var(--color-accent);
            animation: spinRing 1s linear infinite;
          "></div>
          <div style="
            position: absolute; inset: 10px;
            border-radius: 50%;
            background: var(--color-accent-glow);
            display: flex; align-items: center; justify-content: center;
            color: var(--color-accent); font-size: 16px;
          ">◆</div>
        </div>
        <div class="text-center">
          <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Provisioning VM</p>
          <p style="font-size: 13px; color: var(--color-text-muted);">This takes about 60 seconds</p>
        </div>
        {#if (events as Array<{reason?: string; message?: string}>).length > 0}
          <div style="
            font-family: var(--font-mono);
            font-size: 11px;
            color: var(--color-text-muted);
            max-width: 380px;
            background: rgba(14,20,34,0.8);
            border: 1px solid var(--color-border);
            border-radius: 8px;
            padding: 10px 14px;
          ">
            {#each (events as Array<{reason?: string; message?: string}>) as ev}
              <div style="padding: 1px 0; line-height: 1.6;">{ev.reason}: {ev.message}</div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <!-- Left: Chat sidebar (320px, hidden on mobile) -->
      <div class="hidden md:flex md:w-80 shrink-0 flex-col overflow-hidden">
        <ChatSidebar
          {goals}
          {activity}
          disabled={isWorking}
          {workspaceName}
          on:prompt={handlePrompt}
        />
      </div>

      <!-- Right: Live preview -->
      <div class="flex-1 overflow-hidden">
        <LivePreview {workspace} {isReady} />
      </div>
    {/if}
  </div>
</div>
