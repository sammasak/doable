<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { getWorkspace, getGoals, addGoal, heartbeat, getWorkspaceEvents, getPreviewStatus, deleteWorkspace, WorkerNotReadyError } from '$lib/api/workstation';
  import type { Goal, Workspace } from '$lib/api/workstation';
  import { createEventSource, parseEventToActivity } from '$lib/api/stream';
  import type { ActivityItem } from '$lib/api/stream';
  import ChatSidebar from '$lib/components/ChatSidebar.svelte';
  import LivePreview from '$lib/components/LivePreview.svelte';
  import WorkspaceStatus from '$lib/components/WorkspaceStatus.svelte';

  export let data: PageData;

  const workspaceName = data.name;
  let workspace: Workspace | null = data.workspace;
  let goals: Goal[] = [];
  let activity: ActivityItem[] = [];
  let schedulingFailed = false;
  let isProvisioning = true;
  let isReady = false;
  let error = '';

  let previewActive = false;
  let isDeploying = false;
  let deployGoalId: string | null = null;
  let previewPollInterval: ReturnType<typeof setInterval>;

  let pollInterval: ReturnType<typeof setInterval>;
  let heartbeatInterval: ReturnType<typeof setInterval>;
  let goalRetryInterval: ReturnType<typeof setInterval>;
  let goalPollInterval: ReturnType<typeof setInterval>;
  let confirmationInterval: ReturnType<typeof setInterval>;
  let staleActivityInterval: ReturnType<typeof setInterval>;
  let lastRealActivityAt = 0;
  let eventSource: EventSource | null = null;
  // Suppress replays of the same activity text within this window (handles SSE reconnect re-sends).
  // 30 seconds prevents rapid duplicates while allowing the same message to recur in later steps.
  const ACTIVITY_DEDUP_MS = 30_000;
  const recentActivityTexts = new Map<string, number>();

  // Polling and timeout intervals (ms)
  const POLL_FAST_MS = 5_000;       // workspace poll while provisioning
  const POLL_SLOW_MS = 15_000;      // workspace poll after VM is running
  const HEARTBEAT_MS = 30_000;      // keepalive ping to prevent VM halt
  const GOAL_RETRY_MS = 5_000;      // retry interval for posting a goal
  const GOAL_POLL_MS = 2_000;       // fallback goal status poll during streaming
  const CONFIRMATION_POLL_MS = 2_000; // poll interval while confirming goal picked up
  const STALE_ACTIVITY_MS = 40_000;  // inject a patience message after this much silence
  const STALE_SUBSEQUENT_MS = 25_000; // interval between subsequent stale messages
  const CONFIRMATION_TIMEOUT_MS = 20_000; // warn if goal not picked up within this time
  const SPEC_GOAL_TIMEOUT_MS = 120_000;   // 2 min: give up waiting for controller to post spec goal

  let goalRetries = 0;       // generic HTTP errors — fast cap (10 × 5s = 50s)
  const MAX_GOAL_RETRIES = 10;
  let workerWarmRetries = 0; // 503/warming errors — generous cap for slow VM boot (24 × 5s = 2 min)
  const MAX_WORKER_WARM_RETRIES = 24;
  let isWorkerWarming = false;
  let pollingActive = false;
  let confirmationStartedAt: number = 0;
  let confirmationWarning = false;
  let streamStartedAt: number = 0;
  let elapsedSeconds: number = 0;
  let elapsedBasis: number = 0;
  let elapsedInterval: ReturnType<typeof setInterval>;
  let waitStartedAt: number = 0;
  let waitElapsedSeconds: number = 0;
  let waitElapsedInterval: ReturnType<typeof setInterval>;
  // Persists across stream reconnects so the cap is honoured for the full session.
  let staleActivityCount = 0;
  // Tracks the ID of the current stale synthetic message (for reference).
  // Module-level so it survives multiple connectStream() calls within one session.
  let staleMessageId: string | null = null;
  // Tracks ALL stale message IDs so they can be purged when the goal completes.
  const staleMessageIds = new Set<string>();
  // Timestamp of the last stale message injection — used to space subsequent stale messages
  // at STALE_SUBSEQUENT_MS rather than re-waiting the full STALE_ACTIVITY_MS threshold.
  let lastStaleAt = 0;
  // Mobile tab switcher (preview vs chat, hidden on md+ screens)
  let mobileTab: 'preview' | 'chat' = 'preview';
  // Rotating tip shown in the provisioning overlay to break the silence during long VM boots.
  let provisioningTipIndex = 0;
  let provisioningTipInterval: ReturnType<typeof setInterval>;
  const PROVISIONING_TIPS = [
    'Usually ready in 1–3 minutes — sometimes longer on busy days.',
    'Claude will start building as soon as your project is ready.',
    'You can close this tab — we\'ll keep working in the background.',
    'Your project URL is saved. Come back any time.',
    'We\'ll keep your project going even if you close this tab.',
  ];

  // State machine
  type Phase = 'provisioning' | 'posting_goal' | 'streaming' | 'confirming_goal' | 'idle';
  let phase: Phase = 'provisioning';
  // Seed pendingPrompt from SSR data immediately so the provisioning overlay shows the goal
  // on first paint (including page reloads). The controller posts spec.goal to the VM — we
  // must NOT call addGoal() for it.
  // If goalPosted is already true, the goal was already delivered — don't show the "Submitting…"
  // spinner even if spec.goal is still present on the CRD.
  const _specGoalAlreadyPosted = !!data.workspace?.goalPosted;
  let pendingPrompt: string | null = (_specGoalAlreadyPosted ? null : (data.workspace?.goal ?? null));
  // True when pendingPrompt came from workspace.spec.goal — the controller posts it,
  // so we must NOT call addGoal() for it. False when it came from the chat input.
  let pendingPromptIsSpecGoal: boolean = !_specGoalAlreadyPosted && !!data.workspace?.goal;
  // Timestamp when we first started waiting for the controller to post the spec goal.
  // Used to add a timeout/fallback if the controller never delivers.
  let specGoalWaitStartedAt: number = 0;

  onMount(async () => {
    // Clean up legacy localStorage keys from the old ?goal= redirect approach.
    // The initial goal is now carried in workspace.spec.goal and posted by the controller.
    const pendingKey = `doable:pendingGoal:${workspaceName}`;
    localStorage.removeItem(pendingKey);
    localStorage.removeItem(`doable:initialGoal:${workspaceName}`);
    sessionStorage.removeItem(`initial_prompt_${workspaceName}`);

    // Track total wait time from page load (covers provisioning + queuing + confirming phases)
    waitStartedAt = Date.now();
    waitElapsedInterval = setInterval(() => {
      waitElapsedSeconds = Math.floor((Date.now() - waitStartedAt) / 1000);
    }, 1000);

    // Start polling workspace status
    await pollWorkspace();
    pollInterval = setInterval(pollWorkspace, POLL_FAST_MS);

    // Heartbeat to prevent idle VM halt
    heartbeatInterval = setInterval(() => heartbeat(workspaceName), HEARTBEAT_MS);

    // Rotate provisioning tips every 40s to break the silence during long VM boots
    provisioningTipInterval = setInterval(() => {
      if (isProvisioning) {
        provisioningTipIndex = (provisioningTipIndex + 1) % PROVISIONING_TIPS.length;
      }
    }, 40_000);
  });

  onDestroy(() => {
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    clearInterval(goalRetryInterval);
    clearInterval(goalPollInterval);
    clearInterval(confirmationInterval);
    clearInterval(previewPollInterval);
    clearInterval(provisioningTipInterval);
    clearInterval(elapsedInterval);
    clearInterval(waitElapsedInterval);
    clearInterval(staleActivityInterval);
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
        schedulingFailed = false;
        isReady = false; // preview might not be up yet
        clearInterval(pollInterval);

        // Start preview status polling (every 5s)
        clearInterval(previewPollInterval);
        previewPollInterval = setInterval(async () => {
          if (!workspace?.ipAddress) return;
          const status = await getPreviewStatus(workspaceName);
          previewActive = status.active;
        }, POLL_FAST_MS);
        // Also check immediately
        getPreviewStatus(workspaceName).then(s => { previewActive = s.active; });

        // Fetch initial goals
        await loadGoals();

        // Show the spec goal as pendingPrompt during the wait so the user sees their goal.
        // Don't post it — the controller posts it automatically via spec.goal.
        if (!pendingPrompt && workspace?.goal) {
          pendingPrompt = workspace.goal;
          pendingPromptIsSpecGoal = true;
        }

        const hasActiveGoal = goals.some(g => g.status === 'pending' || g.status === 'in_progress');
        if (hasActiveGoal) {
          // A goal is already queued/running (controller posted the spec goal, or a prior session)
          // Clear the spec-goal display since the real goal object is now visible
          if (pendingPromptIsSpecGoal) {
            pendingPrompt = null;
            pendingPromptIsSpecGoal = false;
          }
          phase = 'streaming';
          connectStream();
        } else if (goals.length > 0 && pendingPromptIsSpecGoal) {
          // Goals exist but none are active — spec goal was already posted and completed.
          // Clear the "Submitting your goal…" spinner so the user sees the completed state.
          pendingPrompt = null;
          pendingPromptIsSpecGoal = false;
          phase = 'idle';
        } else if (pendingPrompt && !pendingPromptIsSpecGoal) {
          // A follow-up goal was posted via handlePrompt before the VM became ready
          phase = 'posting_goal';
          await postGoalWithRetry(pendingPrompt);
        } else {
          // Waiting for the controller to pick up spec.goal, or truly idle
          if (pendingPromptIsSpecGoal && specGoalWaitStartedAt === 0) {
            specGoalWaitStartedAt = Date.now(); // start the timeout clock
          }
          phase = 'idle';
        }

        // Resume polling — stay fast if we're still waiting for the controller to post spec.goal
        pollInterval = setInterval(pollWorkspace, pendingPromptIsSpecGoal ? POLL_FAST_MS : POLL_SLOW_MS);
      } else if (running && phase === 'idle' && pendingPromptIsSpecGoal) {
        // VM is running, we're waiting for the controller to post the spec goal.
        // Check if it has appeared yet and start streaming if so.
        await loadGoals();
        const hasActiveGoal = goals.some(g => g.status === 'pending' || g.status === 'in_progress');
        if (hasActiveGoal) {
          pendingPrompt = null;
          pendingPromptIsSpecGoal = false;
          phase = 'streaming';
          connectStream();
        } else if (goals.length > 0) {
          // Goals exist but none are active — spec goal was already posted and completed.
          pendingPrompt = null;
          pendingPromptIsSpecGoal = false;
        } else if (workspace.goalPostingError && pendingPromptIsSpecGoal) {
          // Controller tried to post the spec goal but the worker rejected it.
          error = `Something went wrong starting your project. Type your goal below to try again.`;
          pendingPromptIsSpecGoal = false;
          pendingPrompt = null;
        } else if (specGoalWaitStartedAt > 0 && Date.now() - specGoalWaitStartedAt > SPEC_GOAL_TIMEOUT_MS) {
          // Waited 2 minutes with no goals appearing — controller may have failed.
          // Fall back to idle so the user can post the goal manually via the chat input.
          // Keep pendingPrompt so the goal text remains pre-filled in the textarea.
          pendingPromptIsSpecGoal = false;
          specGoalWaitStartedAt = 0;
          error = 'Your project took too long to start. Type your goal below to try again, or refresh to check if it arrived.';
        }
      } else if (!running) {
        clearInterval(previewPollInterval);
        previewActive = false;
        // Show K8s events during boot
        try {
          const fetchedEvents = await getWorkspaceEvents(workspaceName);
          const hasSchedulingFailure = fetchedEvents.some((e: unknown) => {
            const ev = e as Record<string, unknown>;
            return typeof ev.reason === 'string' &&
              (ev.reason.includes('FailedScheduling') || ev.reason.includes('Unschedulable'));
          });
          const lowerPhase = (workspace?.phase ?? '').toLowerCase();
          const isStillScheduling = ['scheduling', 'pending', 'queuing'].includes(lowerPhase);
          if (hasSchedulingFailure && isStillScheduling) {
            schedulingFailed = true;
          } else if (schedulingFailed && !isStillScheduling) {
            // VM has moved past scheduling phase — scheduling succeeded
            schedulingFailed = false;
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      // Suppress transient workspace fetch errors during provisioning and streaming —
      // brief 502s from the workspace API are normal during VM scheduling and don't
      // represent actionable failures for the user
      if (phase === 'idle') {
        error = 'Lost connection — please refresh the page.';
      }
    } finally {
      pollingActive = false;
    }
  }

  async function loadGoals() {
    try {
      goals = await getGoals(workspaceName);
      // Clear deploy state when deploy goal completes
      if (deployGoalId) {
        const dg = goals.find(g => g.id === deployGoalId);
        if (dg && (dg.status === 'done' || dg.status === 'reviewed')) {
          isDeploying = false;
          deployGoalId = null;
        } else if (dg && dg.status === 'failed') {
          isDeploying = false;
          deployGoalId = null;
          error = 'Deploy failed. Check the activity log or click Deploy to try again.';
        }
      }
      if (goals.some(g => g.status === 'done' || g.status === 'reviewed')) {
        isReady = true;
      }
      // Fallback: if we're stuck in streaming/posting phase but all goals are finished, go idle
      if ((phase === 'streaming' || phase === 'posting_goal' || phase === 'confirming_goal') && goals.length > 0 && !goals.some(g => g.status === 'pending' || g.status === 'in_progress')) {
        phase = 'idle';
        clearInterval(goalPollInterval);
        clearInterval(confirmationInterval);
        clearInterval(elapsedInterval);
        clearInterval(staleActivityInterval);
        staleMessageIds.clear();
      }
    } catch { /* worker may not be ready yet */ }
  }

  async function postGoalWithRetry(prompt: string) {
    goalRetries = 0;
    workerWarmRetries = 0;
    clearInterval(goalRetryInterval);
    clearInterval(goalPollInterval);

    const tryPost = async () => {
      try {
        const goal = await addGoal(workspaceName, prompt);
        goals = [...goals, goal];
        pendingPrompt = null;
        clearInterval(goalRetryInterval);
        isWorkerWarming = false;
        // Goal accepted — clear the pending key so reloads don't re-post it
        localStorage.removeItem(`doable:pendingGoal:${workspaceName}`);
        phase = 'confirming_goal';
        startConfirmation(goal.id);
      } catch (e) {
        if (e instanceof WorkerNotReadyError) {
          workerWarmRetries++;
          if (workerWarmRetries >= MAX_WORKER_WARM_RETRIES) {
            clearInterval(goalRetryInterval);
            error = 'Claude took too long to wake up. Please try again.';
            pendingPrompt = null;
            phase = 'idle';
            isWorkerWarming = false;
          } else {
            isWorkerWarming = true;
          }
        } else {
          isWorkerWarming = false;
          goalRetries++;
          if (goalRetries >= MAX_GOAL_RETRIES) {
            clearInterval(goalRetryInterval);
            error = `Couldn't reach Claude. Please try again.`;
            pendingPrompt = null;
            phase = 'idle';
          }
        }
      }
    };

    await tryPost();
    if (phase === 'posting_goal') {
      goalRetryInterval = setInterval(tryPost, GOAL_RETRY_MS);
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
          confirmationWarning = false;
          phase = 'idle';
          isReady = true;
          await loadGoals();
        } else if (Date.now() - confirmationStartedAt > CONFIRMATION_TIMEOUT_MS) {
          // Still pending after 20s — show warning but keep waiting
          confirmationWarning = true;
        }
      } catch { /* worker may not be ready yet */ }
    }, CONFIRMATION_POLL_MS);
  }

  function connectStream() {
    streamStartedAt = Date.now();
    lastRealActivityAt = Date.now();
    clearInterval(elapsedInterval);
    elapsedInterval = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - streamStartedAt) / 1000);
    }, 1000);
    eventSource?.close();
    clearInterval(goalPollInterval);
    clearInterval(staleActivityInterval);
    eventSource = createEventSource(workspaceName);

    // Show an initial message immediately so the feed isn't blank while Claude starts
    if (activity.length === 0) {
      activity = [{
        id: String(Date.now()),
        kind: 'hook' as const,
        text: '⚙ Claude is reading your request…',
        timestamp: new Date(),
        color: 'text-yellow-400',
      }];
    }

    function addActivityItem(item: ActivityItem) {
      // Suppress replays within a 5-minute window — handles SSE reconnect re-sending prior events
      // and consecutive duplicates during long build phases.
      // Normalize key: strip file-op sigil (+/~) so Write then Edit on the same path
      // don't both appear as separate items for the same conceptual step.
      const dedupKey = item.text.startsWith('+ ') || item.text.startsWith('~ ')
        ? item.text.slice(2)
        : item.text;
      const now = Date.now();
      const lastSeen = recentActivityTexts.get(dedupKey);
      if (lastSeen && now - lastSeen < ACTIVITY_DEDUP_MS) return;
      recentActivityTexts.set(dedupKey, now);
      lastRealActivityAt = Date.now();
      activity = [...activity, item];
    }

    // Inject a patience message if no real activity appears for STALE_ACTIVITY_MS.
    // The FIRST stale message fires after STALE_ACTIVITY_MS of silence.
    // Subsequent stale messages fire every STALE_SUBSEQUENT_MS (25s) — faster reassurance.
    // staleActivityCount and staleMessageId are module-level so they survive reconnects.
    staleActivityInterval = setInterval(() => {
      if (phase !== 'streaming') return;
      const now = Date.now();
      const silenceDuration = now - lastRealActivityAt;
      const isFirstStale = lastStaleAt === 0;
      const shouldFire = isFirstStale
        ? silenceDuration >= STALE_ACTIVITY_MS
        : now - lastStaleAt >= STALE_SUBSEQUENT_MS;
      if (!shouldFire) return;

      staleActivityCount += 1;
      const staleMessages = [
        '⚙ Claude is reading your request and planning the app…',
        '⚙ Writing the code — this takes a few minutes for first builds',
        '⚙ Still working — you can close this tab and come back later',
        '⚙ Building in the background — complex apps can take 5–10 minutes',
        '⚙ Hang tight, this one is taking a while…',
      ];
      const newId = String(Date.now());
      const idx = staleActivityCount - 1;
      if (idx >= staleMessages.length) {
        // All initial stale messages shown — stop adding more
        // The footer "Claude is coding in the background…" handles ongoing state
        return;
      }
      const newText = staleMessages[idx];
      const newItem = {
        id: newId,
        kind: 'hook' as const,
        text: newText,
        timestamp: new Date(),
        color: 'text-yellow-400',
      };
      // Accumulate stale messages (don't replace old ones) — gives a
      // growing history so the feed never looks frozen. Cap at 10 total.
      activity = [...activity, newItem].slice(-10);
      staleMessageId = newId;
      staleMessageIds.add(newId);
      lastStaleAt = now; // track when the last stale message was injected
    }, 10_000);

    eventSource.onmessage = (e) => {
      const item = parseEventToActivity(e);
      if (item) {
        addActivityItem(item);
        if (item.kind === 'done' || item.kind === 'failed') {
          phase = 'idle';
          isReady = true;
          clearInterval(goalPollInterval);
          clearInterval(elapsedInterval);
          clearInterval(staleActivityInterval);
          staleMessageIds.clear();
          loadGoals();
        }
      }
    };

    eventSource.addEventListener('hook', (e) => {
      const item = parseEventToActivity(e as MessageEvent);
      if (item) addActivityItem(item);
    });

    eventSource.onerror = () => {
      // EventSource will auto-reconnect; immediately check goal status in case we missed [DONE]
      loadGoals();
    };

    // Poll goal statuses every 2s while streaming as a fallback
    // (catches cases where [DONE] event is missed or SSE connection is unreliable)
    goalPollInterval = setInterval(loadGoals, GOAL_POLL_MS);
  }

  async function cancelWorkspace() {
    try {
      await deleteWorkspace(workspaceName);
    } catch { /* ignore errors */ }
    goto('/');
  }

  async function handlePrompt(e: CustomEvent<string>) {
    const prompt = e.detail;
    if (phase !== 'idle') return;

    if (!workspace?.ipAddress) {
      error = 'Your project is not ready yet — please wait a moment.';
      return;
    }

    phase = 'posting_goal';
    activity = []; // clear for new session
    recentActivityTexts.clear();
    clearInterval(staleActivityInterval);
    lastRealActivityAt = 0;
    lastStaleAt = 0;
    staleActivityCount = 0; // reset cap for new goal session
    staleMessageId = null;
    staleMessageIds.clear();
    schedulingFailed = false;
    pendingPrompt = prompt;
    pendingPromptIsSpecGoal = false; // user-entered follow-up goal — must call addGoal()
    await postGoalWithRetry(prompt);
  }

  async function handleDeploy() {
    if (phase !== 'idle' || isDeploying || !workspace?.ipAddress) return;
    isDeploying = true;
    deployGoalId = null;
    try {
      const goal = await addGoal(workspaceName, 'Deploy the current app to production');
      goals = [...goals, goal];
      deployGoalId = goal.id;
      activity = [];
      recentActivityTexts.clear();
      clearInterval(staleActivityInterval);
      lastRealActivityAt = 0;
      lastStaleAt = 0;
      staleActivityCount = 0;
      staleMessageId = null;
      staleMessageIds.clear();
      schedulingFailed = false;
      phase = 'confirming_goal';
      startConfirmation(goal.id);
    } catch (e) {
      isDeploying = false;
      error = 'Deploy failed. Please try again.';
    }
  }

  $: vmStatus = provisioningFailed ? 'Error' : (workspace?.vmStatus ?? (isProvisioning ? 'Provisioning' : 'Unknown'));
  $: isWorking = phase === 'posting_goal' || phase === 'confirming_goal' || phase === 'streaming';
  // Provisioning timeout states — shown when VM takes longer than expected
  $: provisioningOverdue = isProvisioning && waitElapsedSeconds >= 300;  // > 5 min
  $: provisioningFailed = isProvisioning && waitElapsedSeconds >= 660;   // > 11 min
  $: waitElapsedStr = waitElapsedSeconds > 0
    ? (waitElapsedSeconds < 60 ? `${waitElapsedSeconds}s` : `${Math.floor(waitElapsedSeconds/60)}m ${waitElapsedSeconds%60}s`)
    : '';
  // Use server-side started_at for elapsed time if available — avoids resetting on page reload
  $: activeGoal = goals.find(g => g.status === 'in_progress');
  // void elapsedSeconds ensures Svelte tracks it as a dependency and re-evaluates every second tick
  $: {
    void elapsedSeconds;
    elapsedBasis = activeGoal?.started_at
      ? Math.floor((Date.now() - new Date(activeGoal.started_at).getTime()) / 1000)
      : elapsedSeconds;
  }
  $: elapsedStr = (elapsedBasis > 0 || elapsedSeconds > 0)
    ? (() => { const s = elapsedBasis > 0 ? elapsedBasis : elapsedSeconds; return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; })()
    : '';
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
    <span style="font-weight: 600; color: var(--color-text-primary); font-size: 14px; letter-spacing: -0.02em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;" class="md:max-w-xs">{workspaceName}</span>
    <WorkspaceStatus status={isWorking ? 'Building' : vmStatus} />
    {#if isWorkerWarming}
      <span class="hidden md:flex" style="font-size: 11px; color: #60A5FA; font-family: var(--font-mono); align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #60A5FA; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        Claude is waking up…
      </span>
    {:else if phase === 'posting_goal'}
      <span class="hidden md:flex" style="font-size: 11px; color: #F59E0B; font-family: var(--font-mono); align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #F59E0B; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        Connecting to Claude…
      </span>
    {:else if phase === 'confirming_goal'}
      <span class="hidden md:flex" style="font-size: 11px; color: #A78BFA; font-family: var(--font-mono); align-items: center; gap: 4px;">
        <span style="width: 6px; height: 6px; border-radius: 50%; background: #A78BFA; animation: pulse 1.5s ease infinite; display: inline-block;"></span>
        {confirmationWarning ? 'Your request is queued — Claude will start soon' : 'Sending your request to Claude…'}
      </span>
    {/if}
    {#if phase === 'streaming' && elapsedStr}
      <span class="hidden md:inline" style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); margin-left: 4px;">
        {elapsedStr}
      </span>
    {/if}
    {#if isWorking}
      <button
        on:click={() => {
          if (confirm('Stop building and delete this project? This can\'t be undone.')) {
            cancelWorkspace();
          }
        }}
        style="
          margin-left: auto; font-size: 11px; color: var(--color-text-muted); background: transparent;
          border: 1px solid var(--color-border); border-radius: 5px;
          padding: 2px 8px; cursor: pointer; font-family: var(--font-mono);
          transition: color 0.15s, border-color 0.15s;
        "
      >✕ Cancel</button>
    {/if}
    {#if error}
      <span style="font-size: 13px; font-weight: 500; color: #F87171; margin-left: 4px; font-family: var(--font-mono);">{error}</span>
    {/if}
  </header>

  <!-- Body: sidebar + preview -->
  <div class="{isProvisioning ? '' : 'pb-12'} md:pb-0 flex flex-1 overflow-hidden">
    <!-- Provisioning overlay -->
    {#if isProvisioning}
      <div class="flex-1 flex flex-col items-center justify-center gap-6" style="color: var(--color-text-muted);">
        <!-- Spinning ring (hidden in error state) -->
        {#if !provisioningFailed}
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
        {/if}
        {#if provisioningFailed}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: #F87171; margin-bottom: 6px; letter-spacing: -0.02em;">We're having trouble finding a machine</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">Your request is saved — give it a moment and try again.</p>
          </div>
        {:else if schedulingFailed && !provisioningOverdue}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Our machines are a little busy right now</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">Finding one for you — your request is saved. This usually resolves in a minute or two.</p>
          </div>
        {:else if provisioningOverdue}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Still getting your machine ready…</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">This can take a few minutes on busy days. You can close this tab and come back.</p>
          </div>
        {:else}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Getting your project ready</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">{PROVISIONING_TIPS[provisioningTipIndex]}</p>
          </div>
        {/if}
        {#if pendingPrompt}
          <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 10px 14px; max-width: 380px; text-align: left;">
            <p style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); margin-bottom: 4px; letter-spacing: 0.06em; text-transform: uppercase;">Your request</p>
            <p style="font-size: 13px; color: var(--color-text-secondary); line-height: 1.5;">{pendingPrompt.slice(0, 160)}{pendingPrompt.length > 160 ? '…' : ''}</p>
          </div>
        {/if}
        {#if waitElapsedStr && !provisioningFailed}
          <p style="font-size: 12px; color: var(--color-text-muted); font-family: var(--font-mono);">⏱ {waitElapsedStr}</p>
        {/if}
        {#if provisioningFailed}
          <button
            on:click={() => {
              const goalToSave = pendingPrompt || workspace?.goal || data.workspace?.goal;
              if (goalToSave) localStorage.setItem('doable:retryGoal', goalToSave);
              cancelWorkspace();
            }}
            style="
              font-size: 13px; color: white; background: var(--color-accent);
              border: none; border-radius: 6px;
              padding: 8px 20px; cursor: pointer; font-family: var(--font-sans);
            "
          >Try again</button>
        {:else}
          <button
            on:click={cancelWorkspace}
            style="
              font-size: 11px; color: var(--color-text-muted); background: transparent;
              border: 1px solid var(--color-border); border-radius: 6px;
              padding: 4px 12px; cursor: pointer; font-family: var(--font-mono);
              transition: color 0.15s, border-color 0.15s;
            "
          >Cancel</button>
        {/if}
      </div>
    {:else}
      <!-- Left: Chat sidebar (320px, hidden on mobile unless chat tab active) -->
      <div class="{mobileTab === 'chat' ? 'flex w-full' : 'hidden'} md:flex md:w-80 md:shrink-0 flex-col overflow-hidden">
        <ChatSidebar
          {goals}
          {activity}
          disabled={isWorking}
          {workspaceName}
          pendingGoal={pendingPrompt}
          on:prompt={handlePrompt}
        />
      </div>

      <!-- Right: Live preview (hidden on mobile when chat tab active) -->
      <div class="{mobileTab === 'preview' ? 'flex w-full' : 'hidden'} md:flex flex-1 overflow-hidden">
        <LivePreview {workspace} {previewActive} {isWorking} {isReady} {isDeploying} on:deploy={handleDeploy} />
      </div>
    {/if}
  </div>

  <!-- Mobile tab bar (hidden on md+) -->
  {#if !isProvisioning}
    <div class="md:hidden fixed bottom-0 left-0 right-0 flex border-t" style="background: var(--color-surface); border-color: var(--color-border); z-index: 10;">
      <button
        on:click={() => mobileTab = 'preview'}
        class="flex-1 py-3 text-sm font-medium"
        style="color: {mobileTab === 'preview' ? 'var(--color-accent)' : 'var(--color-text-muted)'};"
      >Preview</button>
      <button
        on:click={() => mobileTab = 'chat'}
        class="flex-1 py-3 text-sm font-medium"
        style="color: {mobileTab === 'chat' ? 'var(--color-accent)' : 'var(--color-text-muted)'};"
      >Chat</button>
    </div>
  {/if}
</div>
