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
  // For pool VMs already Running when claimed, SSR data has vmStatus+ipAddress — skip overlay immediately.
  let isProvisioning = !(data.workspace?.vmStatus === 'Running' && !!data.workspace?.ipAddress);
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
  const STALE_ACTIVITY_MS = 15_000;  // inject a patience message after this much silence
  const STALE_SUBSEQUENT_MS = 25_000; // interval between subsequent stale messages
  const CONFIRMATION_TIMEOUT_MS = 20_000; // warn if goal not picked up within this time
  const SPEC_GOAL_TIMEOUT_MS = 45_000;    // 45s: give up waiting for controller to post spec goal

  let goalRetries = 0;       // generic HTTP errors — fast cap (10 × 5s = 50s)
  const MAX_GOAL_RETRIES = 10;
  let workerWarmRetries = 0; // 503/warming errors — generous cap for slow VM boot (24 × 5s = 2 min)
  const MAX_WORKER_WARM_RETRIES = 24;
  let isWorkerWarming = false;
  let pollingActive = false;
  let prevVmStatus: string | null = null;
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
  // Completion notification banner — shown instead of force-switching tab on mobile
  let completionBanner = false;
  // Desktop completion toast — shown for 10s when isReady first becomes true
  let showCompletionToast = false;
  let prevIsReadyToast = false;
  let completionToastTimer: ReturnType<typeof setTimeout> | null = null;
  $: {
    if (isReady && !prevIsReadyToast) {
      showCompletionToast = true;
      completionToastTimer = setTimeout(() => { showCompletionToast = false; }, 10_000);
    }
    prevIsReadyToast = isReady;
  }
  // Rotating tip shown in the provisioning overlay to break the silence during long VM boots.
  let provisioningTipIndex = 0;
  let provisioningTipInterval: ReturnType<typeof setInterval>;
  const PROVISIONING_TIPS = [
    "You can close this tab and come back — we'll keep going.",
    'Claude will start building as soon as your machine is ready.',
    'Your project URL is saved — come back any time.',
    'No downloads or installs needed — everything runs in the cloud.',
    'Your app will have its own web address you can share.',
  ];

  // Patience messages shown in the slim activity bar while Claude builds.
  // Defined at module scope so the template can reference STALE_MESSAGES.length.
  // After these are exhausted, POST_STALE_MESSAGES cycles to prevent a frozen bar.
  const STALE_MESSAGES = [
    '⚙ Claude is reading your request and planning the app…',
    '⚙ Writing the code — this takes a few minutes for first builds',
    '⚙ Still working — you can close this tab and come back later',
    '⚙ Building in the background — complex apps can take 5–10 minutes',
    '⚙ Still building — the final steps are hard to predict…',
  ];
  // Cycles after STALE_MESSAGES are exhausted — honest, permission to close tab
  const POST_STALE_MESSAGES = [
    '⚙ Still building — you can close this tab and come back later…',
    '⚙ Still working — the URL will be ready when you return…',
    '⚙ Taking longer than expected — we\'ll keep going in the background…',
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

    // Fast-path for pool VMs: SSR already confirmed the VM is Running with an IP.
    // Skip the getWorkspace() round-trip — call initRunningVm() immediately so the
    // preview iframe and stream connect without waiting ~500ms for a network fetch.
    if (workspace?.vmStatus === 'Running' && workspace?.ipAddress && phase === 'provisioning') {
      await initRunningVm(workspace); // sets up pollInterval internally
    } else {
      await pollWorkspace();
      pollInterval = setInterval(pollWorkspace, POLL_FAST_MS);
    }

    // Heartbeat to prevent idle VM halt
    heartbeatInterval = setInterval(() => heartbeat(workspaceName), HEARTBEAT_MS);

    // Rotate provisioning tips every 20s to break the silence during long VM boots
    provisioningTipInterval = setInterval(() => {
      if (isProvisioning) {
        provisioningTipIndex = (provisioningTipIndex + 1) % PROVISIONING_TIPS.length;
      }
    }, 20_000);
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
    if (completionToastTimer !== null) clearTimeout(completionToastTimer);
    eventSource?.close();
    historyEventSource?.close();
  });

  // Handles all state transitions when the VM becomes Running (called from both
  // the onMount fast-path and pollWorkspace). Owns preview polling, goal loading,
  // and stream connection so the logic isn't duplicated.
  async function initRunningVm(ws: Workspace) {
    // Capture IP now — used in interval closures to avoid reading the reactive `workspace` var
    // which may update while the interval is running (stale IP or null on reschedule).
    const capturedIp = ws.ipAddress ?? undefined;
    try {
      isProvisioning = false;
      schedulingFailed = false;
      isReady = false; // preview might not be up yet
      clearInterval(pollInterval);

      // Kick off preview check immediately, passing the known IP to skip resolveIP().
      clearInterval(previewPollInterval);
      previewPollInterval = setInterval(async () => {
        const s = await getPreviewStatus(workspaceName, capturedIp);
        previewActive = s.active;
      }, POLL_FAST_MS);
      getPreviewStatus(workspaceName, capturedIp).then(s => { previewActive = s.active; });

      // Fetch initial goals from the VM.
      await loadGoals();

      // Show the spec goal as pendingPrompt so the user sees their goal while Claude starts.
      if (!pendingPrompt && ws.goal) {
        pendingPrompt = ws.goal;
        pendingPromptIsSpecGoal = true;
      }

      const hasActiveGoal = goals.some(g => g.status === 'pending' || g.status === 'in_progress');
      if (hasActiveGoal) {
        if (pendingPromptIsSpecGoal) {
          pendingPrompt = null;
          pendingPromptIsSpecGoal = false;
        }
        phase = 'streaming';
        connectStream();
      } else if (goals.length > 0 && pendingPromptIsSpecGoal) {
        pendingPrompt = null;
        pendingPromptIsSpecGoal = false;
        phase = 'idle';
        isReady = true;
        loadStreamHistory();
      } else if (pendingPrompt && !pendingPromptIsSpecGoal) {
        phase = 'posting_goal';
        await postGoalWithRetry(pendingPrompt);
      } else {
        if (pendingPromptIsSpecGoal && specGoalWaitStartedAt === 0) {
          specGoalWaitStartedAt = Date.now();
        }
        if (goals.length > 0 && !goals.some(g => g.status === 'pending' || g.status === 'in_progress')) {
          isReady = true;
          loadStreamHistory();
        }
        phase = 'idle';
      }

      // Resume polling — fast if still waiting for spec goal, slow otherwise.
      pollInterval = setInterval(pollWorkspace, pendingPromptIsSpecGoal ? POLL_FAST_MS : POLL_SLOW_MS);
    } catch (e) {
      // If initRunningVm throws (e.g. unexpected error), fall back to regular polling
      // so the page doesn't get stuck with no interval running.
      console.error('initRunningVm failed, falling back to pollWorkspace:', e);
      pollInterval = setInterval(pollWorkspace, POLL_FAST_MS);
      await pollWorkspace();
    }
  }

  async function pollWorkspace() {
    if (pollingActive) return;
    pollingActive = true;
    try {
      workspace = await getWorkspace(workspaceName);
      const running = workspace.vmStatus === 'Running' && workspace.ipAddress;

      // Emit activity items when VM phase transitions during provisioning — fills the
      // silent gap while KubeVirt schedules and boots the VM (can be 2-7 minutes).
      const newVmStatus = workspace.vmStatus ?? null;
      if (newVmStatus !== prevVmStatus && isProvisioning && !running) {
        const STATUS_MESSAGES: Record<string, string> = {
          'Scheduling': 'Finding an available machine…',
          'Starting':   'Starting your build environment…',
          'Booting':    'Loading your project…',
        };
        const msg = newVmStatus ? STATUS_MESSAGES[newVmStatus] : null;
        const itemId = `vm-status-${newVmStatus}`;
        if (msg && !activity.some(a => a.id === itemId)) {
          activity = [...activity, {
            id: itemId,
            kind: 'hook' as const,
            text: msg,
            timestamp: new Date(),
            color: 'text-gray-400',
          }];
        }
      }
      prevVmStatus = newVmStatus;

      if (running && phase === 'provisioning') {
        await initRunningVm(workspace);
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
          error = "We couldn't reach your build environment. Click below to retry with a fresh machine.";
          pendingPromptIsSpecGoal = false;
          pendingPrompt = null;
        } else if (specGoalWaitStartedAt > 0 && Date.now() - specGoalWaitStartedAt > SPEC_GOAL_TIMEOUT_MS) {
          // Waited 45s with no goals appearing — controller may have failed.
          // Fall back to idle so the user can post the goal manually via the chat input.
          // Keep pendingPrompt so the goal text remains pre-filled in the textarea.
          pendingPromptIsSpecGoal = false;
          specGoalWaitStartedAt = 0;
          error = "We couldn't reach your build environment. Click below to retry with a fresh machine.";
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
      goals = await getGoals(workspaceName, workspace?.ipAddress ?? undefined);
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
        // Filter stale synthetic messages from the activity feed before clearing tracking set
        activity = activity.filter(item => !staleMessageIds.has(item.id));
        staleMessageIds.clear();
        // On mobile, show a completion banner instead of force-switching tabs
        if (typeof window !== 'undefined' && window.innerWidth < 768 && mobileTab !== 'chat') completionBanner = true;
      }
    } catch { /* worker may not be ready yet */ }
  }

  async function postGoalWithRetry(prompt: string) {
    goalRetries = 0;
    workerWarmRetries = 0;
    clearInterval(goalRetryInterval);
    clearInterval(goalPollInterval);
    // Capture IP at call time so the retry interval closure doesn't read a stale reactive var.
    const capturedIp = workspace?.ipAddress ?? undefined;

    const tryPost = async () => {
      try {
        const goal = await addGoal(workspaceName, prompt, capturedIp);
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
    // Capture IP at call time so the confirmation interval closure doesn't read a stale reactive var.
    const capturedIp = workspace?.ipAddress ?? undefined;

    confirmationInterval = setInterval(async () => {
      try {
        const fetchedGoals = await getGoals(workspaceName, capturedIp);
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
    eventSource = createEventSource(workspaceName, workspace?.ipAddress ?? undefined);

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
      const newId = String(Date.now());
      const idx = staleActivityCount - 1;
      // After STALE_MESSAGES exhausted, cycle POST_STALE_MESSAGES so the bar never freezes
      const newText = idx < STALE_MESSAGES.length
        ? STALE_MESSAGES[idx]
        : POST_STALE_MESSAGES[(idx - STALE_MESSAGES.length) % POST_STALE_MESSAGES.length];
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
          // Filter stale synthetic messages from the activity feed before clearing tracking set
          activity = activity.filter(item => !staleMessageIds.has(item.id));
          staleMessageIds.clear();
          loadGoals();
          // On mobile, show a completion banner instead of force-switching tabs
          if (typeof window !== 'undefined' && window.innerWidth < 768 && mobileTab !== 'chat') completionBanner = true;
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

  // Separate EventSource for history loading — tracked so onDestroy can close it.
  let historyEventSource: EventSource | null = null;

  // Load historical activity from SSE replay buffer without entering 'streaming' phase.
  // Used when the page loads and the goal is already completed — gives the Chat tab
  // a meaningful history instead of showing nothing. Also auto-switches mobile tab to Chat.
  function loadStreamHistory() {
    if (eventSource || historyEventSource) return; // already connected
    // Use a separate dedup map for history so it doesn't poison the live-stream dedup map.
    const historyDedup = new Map<string, number>();
    const es = createEventSource(workspaceName, workspace?.ipAddress ?? undefined);
    historyEventSource = es;
    const timeout = setTimeout(() => { es.close(); historyEventSource = null; }, 6_000);
    function onEvent(e: MessageEvent) {
      const item = parseEventToActivity(e);
      if (item) {
        const dedupKey = item.text.startsWith('+ ') || item.text.startsWith('~ ')
          ? item.text.slice(2) : item.text;
        const now = Date.now();
        const lastSeen = historyDedup.get(dedupKey);
        if (!lastSeen || now - lastSeen >= ACTIVITY_DEDUP_MS) {
          historyDedup.set(dedupKey, now);
          activity = [...activity, item].slice(-10);
        }
        if (item.kind === 'done' || item.kind === 'failed') {
          clearTimeout(timeout);
          es.close();
          historyEventSource = null;
          // Auto-switch to Chat tab on mobile so result is visible immediately
          if (typeof window !== 'undefined' && window.innerWidth < 768) mobileTab = 'chat';
        }
      }
    }
    es.onmessage = onEvent;
    es.addEventListener('hook', (e) => onEvent(e as MessageEvent));
    es.onerror = () => { clearTimeout(timeout); es.close(); historyEventSource = null; };
  }

  async function cancelWorkspace() {
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    clearInterval(previewPollInterval);
    clearInterval(staleActivityInterval);
    try {
      await deleteWorkspace(workspaceName);
    } catch { /* ignore errors */ }
    await goto('/');
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
    completionBanner = false;
    pendingPrompt = prompt;
    pendingPromptIsSpecGoal = false; // user-entered follow-up goal — must call addGoal()
    await postGoalWithRetry(prompt);
  }

  async function handleDeploy() {
    if (phase !== 'idle' || isDeploying || !workspace?.ipAddress) return;
    isDeploying = true;
    deployGoalId = null;
    try {
      const goal = await addGoal(workspaceName, 'Deploy the current app to production', workspace?.ipAddress ?? undefined);
      goals = [...goals, goal];
      deployGoalId = goal.id;
      activity = [];
      recentActivityTexts.clear();
      clearInterval(staleActivityInterval);
      lastRealActivityAt = 0;
      lastStaleAt = 0;
      staleActivityCount = 0;
      staleMessageId = null;
      completionBanner = false;
      staleMessageIds.clear();
      schedulingFailed = false;
      phase = 'confirming_goal';
      startConfirmation(goal.id);
    } catch (e) {
      isDeploying = false;
      error = 'Deploy failed. Please try again.';
    }
  }

  // Show 'Error' badge when error is set (goal delivery failure, etc.)
  $: vmStatus = error ? 'Error' : (workspace?.vmStatus ?? (isProvisioning ? 'Getting Ready' : 'Unknown'));
  $: isWorking = phase === 'posting_goal' || phase === 'confirming_goal' || phase === 'streaming';
  // Extract deployed URL from goal result for the persistent live URL bar
  $: liveUrl = (() => {
    const result = goals.find(g => g.result)?.result || '';
    return result.match(/https?:\/\/[\w.-]+\.[a-z]{2,}(?:\/\S*)?/)?.[0]?.replace(/[.,;:!?)'"\s]+$/, '') || null;
  })();
  $: liveDomain = liveUrl ? liveUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
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
    <span style="font-weight: 600; color: var(--color-text-primary); font-size: 14px; letter-spacing: -0.02em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" class="max-w-[120px] md:max-w-xs">{workspaceName}</span>
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
      <button
        on:click={async () => {
          const goalText = pendingPrompt || workspace?.goal || '';
          if (goalText) localStorage.setItem('doable:retryGoal', goalText);
          // Fire-and-forget delete — don't block navigation on failure
          if (workspace?.name) {
            deleteWorkspace(workspace.name).catch(() => {});
          }
          goto('/');
        }}
        style="
          margin-top: 8px;
          padding: 6px 14px;
          border-radius: 6px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.3);
          color: var(--color-accent, #6366f1);
          font-size: 12px;
          font-family: var(--font-mono);
          cursor: pointer;
          transition: background 0.15s;
        "
      >↻ Try again with a fresh machine</button>
    {/if}
  </header>

  <!-- Body: sidebar + preview -->
  <div class="{isProvisioning ? '' : 'pb-12'} md:pb-0 flex flex-1 overflow-hidden">
    <!-- Provisioning overlay -->
    {#if isProvisioning}
      <div class="flex-1 flex flex-col items-center justify-center gap-6" style="color: var(--color-text-muted);">
        <!-- Spinning ring (hidden in error state) -->
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
        {#if provisioningFailed}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Taking a bit longer than usual…</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">We're still finding a machine for you. Your request is saved — you can close this tab and come back in a few minutes.</p>
          </div>
        {:else if schedulingFailed && !provisioningOverdue}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Our machines are a little busy right now</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">Finding one for you — this usually resolves automatically in 1–2 minutes. If it takes much longer, cancel and try again.</p>
          </div>
        {:else if provisioningOverdue}
          <div class="text-center">
            <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Still getting your machine ready…</p>
            <p style="font-size: 13px; color: var(--color-text-muted);">This can take a few minutes on busy days. You can close this tab and come back.</p>
          </div>
        {:else}
          <div class="text-center">
            <!-- Title and subtitle both update on phase transitions so users see real progress -->
            {#if !workspace?.vmStatus || workspace.vmStatus === 'Scheduling'}
              <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Finding an available machine…</p>
              <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 4px;">Setting up a build environment for your project.</p>
            {:else if workspace.vmStatus === 'Starting'}
              <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Starting your build environment…</p>
              <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 4px;">Machine found — loading tools and dependencies.</p>
            {:else if workspace.vmStatus === 'Booting'}
              <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Loading your project…</p>
              <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 4px;">Almost ready — starting the development server.</p>
            {:else}
              <p style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 6px; letter-spacing: -0.02em;">Connecting to your project…</p>
              <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 4px;">Your machine is ready — Claude is about to start.</p>
            {/if}
            <!-- Rotating tip for reassurance during all provisioning phases -->
            <p style="font-size: 12px; color: var(--color-text-muted); opacity: 0.7; margin-bottom: 4px;">
              {PROVISIONING_TIPS[provisioningTipIndex]}
            </p>
            <p style="font-size: 11px; color: var(--color-text-muted); opacity: 0.6; font-family: var(--font-mono);">{#if !workspace?.vmStatus || workspace.vmStatus === 'Scheduling'}
                Usually takes 2–5 minutes to find a machine
              {:else if workspace.vmStatus === 'Starting'}
                Usually ready in 2–4 minutes
              {:else if workspace.vmStatus === 'Booting'}
                Almost there — usually under a minute
              {:else}
                Usually ready in 5–10 minutes
              {/if}</p>
          </div>
        {/if}
        {#if pendingPrompt}
          <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 10px 14px; max-width: 380px; text-align: left;">
            <p style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); margin-bottom: 4px; letter-spacing: 0.06em; text-transform: uppercase;">Your request</p>
            <p style="font-size: 13px; color: var(--color-text-secondary); line-height: 1.5;">{pendingPrompt.slice(0, 160)}{pendingPrompt.length > 160 ? '…' : ''}</p>
          </div>
        {/if}
        {#if waitElapsedStr}
          <p style="font-size: 12px; color: var(--color-text-muted); font-family: var(--font-mono);">⏱ {waitElapsedStr}</p>
        {/if}
        <button
          on:click={cancelWorkspace}
          style="
            font-size: 11px; color: var(--color-text-muted); background: transparent;
            border: 1px solid var(--color-border); border-radius: 6px;
            padding: 4px 12px; cursor: pointer; font-family: var(--font-mono);
            transition: color 0.15s, border-color 0.15s;
          "
          >Cancel</button>
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
      <div class="{mobileTab === 'preview' ? 'flex w-full' : 'hidden'} md:flex flex-1 overflow-hidden flex-col">
        {#if showCompletionToast}
          <div
            class="hidden md:flex items-center gap-2 px-4"
            style="
              flex-shrink: 0;
              padding-top: 8px; padding-bottom: 8px;
              background: rgba(34,197,94,0.10);
              border-bottom: 1px solid rgba(34,197,94,0.25);
              font-size: 13px; color: #4ade80; font-weight: 500;
            "
          >
            <span>✓ Done — your app is ready!</span>
            <button
              on:click={() => showCompletionToast = false}
              style="margin-left: auto; font-size: 11px; font-family: var(--font-mono); color: var(--color-text-muted); background: transparent; border: none; cursor: pointer; padding: 0 2px;"
            >✕</button>
          </div>
        {/if}
        <LivePreview {workspace} {previewActive} {isWorking} {isReady} {isDeploying} on:deploy={handleDeploy} />
      </div>
    {/if}
  </div>

  <!-- Mobile tab bar (hidden on md+) -->
  {#if !isProvisioning}
    <!-- Completion notification banner — appears above tab bar when build finishes -->
    {#if completionBanner}
      <div
        class="md:hidden fixed left-0 right-0 flex items-center justify-between gap-3 px-4"
        style="
          bottom: 48px; z-index: 20;
          background: rgba(34,197,94,0.12);
          border-top: 1px solid rgba(34,197,94,0.25);
          border-bottom: 1px solid rgba(34,197,94,0.25);
          padding-top: 10px; padding-bottom: 10px;
        "
      >
        <span style="font-size: 13px; color: #4ade80; font-weight: 500;">✓ Your app is ready!</span>
        <div style="display: flex; gap: 8px;">
          <button
            on:click={() => { completionBanner = false; mobileTab = 'chat'; }}
            style="
              font-size: 11px; font-family: var(--font-mono);
              color: #4ade80; background: rgba(34,197,94,0.15);
              border: 1px solid rgba(34,197,94,0.3); border-radius: 5px;
              padding: 4px 10px; cursor: pointer;
            "
          >See what Claude built</button>
          <button
            on:click={() => completionBanner = false}
            style="
              font-size: 11px; font-family: var(--font-mono);
              color: var(--color-text-muted); background: transparent;
              border: none; padding: 4px 6px; cursor: pointer;
            "
          >✕</button>
        </div>
      </div>
    {/if}
    <!-- Persistent live URL bar — shown after completion banner dismissed, stays until navigation -->
    {#if isReady && liveUrl && !completionBanner && !isWorking}
      <div
        class="md:hidden fixed left-0 right-0 flex items-center gap-2 px-3"
        style="
          bottom: 48px; z-index: 19;
          background: rgba(15, 15, 20, 0.95);
          border-top: 1px solid rgba(34,197,94,0.2);
          padding-top: 7px; padding-bottom: 7px;
        "
      >
        <span style="color: #4ade80; font-size: 11px; flex-shrink: 0;">✓ Live:</span>
        <a
          href={liveUrl} target="_blank" rel="noopener noreferrer"
          style="font-size: 11px; color: var(--color-accent); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;"
        >{liveDomain}</a>
        <button
          on:click={() => { if (typeof navigator !== 'undefined') navigator.clipboard.writeText(liveUrl || ''); }}
          style="font-size: 10px; font-family: var(--font-mono); color: var(--color-text-muted); background: transparent; border: 1px solid var(--color-border); border-radius: 4px; padding: 2px 6px; cursor: pointer; flex-shrink: 0;"
        >Copy</button>
      </div>
    {/if}
    <!-- Mobile activity bar on Preview tab — shows latest Claude status while building -->
    {#if mobileTab === 'preview' && !completionBanner && ((isWorking && activity.length > 0) || (pendingPrompt && !isWorking))}
      <div
        class="md:hidden fixed left-0 right-0 flex items-center gap-2 px-3"
        style="
          bottom: 48px; z-index: 19;
          background: rgba(15, 15, 20, 0.92);
          border-top: 1px solid var(--color-border);
          padding-top: 8px; padding-bottom: 8px;
          backdrop-filter: blur(4px);
        "
      >
        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); display: inline-block; flex-shrink: 0; animation: pulse 1.5s ease infinite;"></span>
        <span style="font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
          {#if isWorking && activity.length > 0}
            {activity[activity.length - 1].text}
          {:else}
            Your request was received — Claude is starting…
          {/if}
        </span>
      </div>
    {/if}
    <div class="md:hidden fixed bottom-0 left-0 right-0 flex border-t" style="background: var(--color-surface); border-color: var(--color-border); z-index: 10;">
      <button
        on:click={() => mobileTab = 'preview'}
        class="flex-1 py-3 text-sm font-medium"
        style="color: {mobileTab === 'preview' ? 'var(--color-accent)' : 'var(--color-text-muted)'};"
      >Preview</button>
      <button
        on:click={() => { mobileTab = 'chat'; completionBanner = false; }}
        class="flex-1 py-3 text-sm font-medium relative"
        style="color: {mobileTab === 'chat' ? 'var(--color-accent)' : 'var(--color-text-muted)'};"
      >
        Chat
        {#if completionBanner}
          <span style="
            position: absolute; top: 8px; right: calc(50% - 22px);
            width: 8px; height: 8px; border-radius: 50%;
            background: #4ade80; display: inline-block;
          "></span>
        {/if}
      </button>
    </div>
  {/if}
</div>
