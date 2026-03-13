export interface ActivityItem {
  id: string;
  kind: 'hook' | 'text' | 'done' | 'failed' | 'error';
  text: string;
  timestamp: Date;
  color: string;
}

let idCounter = 0;
function nextId(): string {
  return String(++idCounter);
}

type GoalLifecycleEvent =
  | { type: 'goal_loop'; phase: number; pending?: number }
  | { type: 'review_start'; count: number }
  | { type: 'session_end' };

function formatGoalLifecycle(hook: GoalLifecycleEvent): { text: string; color: string } | null {
  switch (hook.type) {
    case 'goal_loop':
      return { text: `↻ ${hook.pending ?? 0} pending goals`, color: 'text-yellow-400' };
    case 'review_start':
      return { text: `◎ reviewing ${hook.count} goals…`, color: 'text-purple-400' };
    case 'session_end':
      return { text: '✓ done', color: 'text-green-400' };
    default:
      return null;
  }
}

export function parseEventToActivity(event: MessageEvent): ActivityItem | null {
  const data = event.data as string;

  // Terminal signals from process exit
  if (data === '[DONE]') {
    return { id: nextId(), kind: 'done', text: '✓ Session complete', timestamp: new Date(), color: 'text-green-400' };
  }
  if (data.startsWith('[FAILED:')) {
    return { id: nextId(), kind: 'failed', text: '✗ Something went wrong', timestamp: new Date(), color: 'text-red-400' };
  }

  // Only hook events from POST /events — everything else ignored
  if (event.type !== 'hook') return null;

  try {
    const hook = JSON.parse(data) as Record<string, unknown>;

    // Agent-posted progress events (from CLAUDE.md curl calls)
    if (hook.type === 'progress' && typeof hook.message === 'string' && hook.message.trim()) {
      return { id: nextId(), kind: 'hook', text: hook.message.trim(), timestamp: new Date(), color: 'text-gray-300' };
    }

    // Goal lifecycle events from check-goals.sh stop hook
    if (hook.type === 'goal_loop' || hook.type === 'review_start' || hook.type === 'session_end') {
      const fmt = formatGoalLifecycle(hook as GoalLifecycleEvent);
      if (fmt) return { id: nextId(), kind: 'hook', text: fmt.text, timestamp: new Date(), color: fmt.color };
    }

    // All other hook types (tool_start, file_op) — silently dropped
    return null;
  } catch {
    return null;
  }
}

export function createEventSource(workspaceName: string): EventSource {
  return new EventSource(`/api/proxy/workspaces/${workspaceName}/goals/stream`);
}
