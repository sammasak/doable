export interface ActivityItem {
  id: string;
  kind: 'hook' | 'text' | 'done' | 'failed' | 'error' | 'tool';
  text: string;
  timestamp: Date;
  color: string;
  dim?: boolean;
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
      return { text: `Working on your project…`, color: 'text-yellow-400' };
    case 'review_start':
      return { text: `Reviewing your app…`, color: 'text-purple-400' };
    case 'session_end':
      return { text: '✓ Done', color: 'text-green-400' };
    default:
      return null;
  }
}

function translateToolUse(name: string, input: Record<string, unknown>): string | null {
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') {
    const path = (input?.file_path || input?.path || '') as string;
    if (path) {
      const parts = path.split('/');
      const short = parts.slice(-2).join('/');
      return `Writing ${short}`;
    }
  }
  if (name === 'Bash') {
    const cmd = ((input?.command || '') as string).trim().split('\n')[0].slice(0, 80);
    if (cmd.includes('pip install') || cmd.includes('uv install')) return 'Installing dependencies…';
    if (cmd.includes('buildah build')) return 'Building container image…';
    if (cmd.includes('buildah push')) return 'Uploading your app…';
    if (cmd.includes('kubectl') || cmd.includes('flux reconcile')) return 'Publishing your app…';
    if (cmd.includes('git push')) return 'Pushing code…';
    if (cmd.includes('git clone') || cmd.includes('gh repo clone')) return 'Cloning repository…';
    if (cmd.includes('nix develop') || cmd.includes('nix run')) return 'Setting up build environment…';
    if (cmd.includes('curl') && cmd.includes('health')) return 'Verifying deployment…';
    // Don't show generic bash commands
    return null;
  }
  if (name === 'Read' || name === 'Glob' || name === 'Grep') {
    return null; // Too noisy — suppress file reads
  }
  return null;
}

export function parseEventToActivity(event: MessageEvent): ActivityItem | null {
  const data = event.data as string;

  // Terminal signals from process exit
  if (data === '[DONE]') {
    return { id: nextId(), kind: 'done', text: '✓ Done', timestamp: new Date(), color: 'text-green-400' };
  }
  if (data.startsWith('[FAILED:')) {
    return { id: nextId(), kind: 'failed', text: '✗ Something went wrong', timestamp: new Date(), color: 'text-red-400' };
  }

  // Structured hook events (progress, goal lifecycle, etc.)
  if (event.type === 'hook') {
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

  // Dim fallback: parse Claude CLI tool_use events from raw SSE lines.
  // These show activity when no explicit progress events are flowing.
  // Only reached when event.type !== 'hook' (raw claude output lines).
  try {
    const msg = JSON.parse(data);
    if (msg.type === 'tool_use') {
      const label = translateToolUse(msg.name, msg.input ?? {});
      if (label) {
        return { id: nextId(), kind: 'tool', text: label, dim: true, timestamp: new Date(), color: 'text-gray-500' };
      }
    }
  } catch {
    // Not JSON — ignore
  }
  return null;
}

export function createEventSource(workspaceName: string): EventSource {
  return new EventSource(`/api/proxy/workspaces/${workspaceName}/goals/stream`);
}
