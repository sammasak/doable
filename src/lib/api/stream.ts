export type HookEventType =
  | { type: 'tool_start'; tool: string; cmd: string }
  | { type: 'file_op'; op: 'Write' | 'Edit'; path: string }
  | { type: 'goal_loop'; phase: number; pending: number }
  | { type: 'review_start'; count: number }
  | { type: 'session_end' };

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

function formatHook(hook: HookEventType): { text: string; color: string } {
  switch (hook.type) {
    case 'tool_start':
      if (hook.tool === 'bash' || hook.tool === 'Bash') {
        const cmd = hook.cmd?.slice(0, 60) ?? '';
        return { text: `$ ${cmd}`, color: 'text-gray-400' };
      }
      return { text: `[${hook.tool}]`, color: 'text-gray-400' };
    case 'file_op':
      if (hook.op === 'Write') return { text: `+ ${hook.path}`, color: 'text-green-400' };
      return { text: `~ ${hook.path}`, color: 'text-blue-400' };
    case 'goal_loop':
      return { text: `↻ ${hook.pending} pending goals`, color: 'text-yellow-400' };
    case 'review_start':
      return { text: `◎ reviewing ${hook.count} goals...`, color: 'text-purple-400' };
    case 'session_end':
      return { text: '✓ done', color: 'text-green-400' };
    default:
      return { text: JSON.stringify(hook), color: 'text-gray-500' };
  }
}

export function parseEventToActivity(event: MessageEvent): ActivityItem | null {
  const data = event.data as string;

  // Terminal signals
  if (data === '[DONE]') {
    return { id: nextId(), kind: 'done', text: '✓ Session complete', timestamp: new Date(), color: 'text-green-400' };
  }
  if (data.startsWith('[FAILED:')) {
    return { id: nextId(), kind: 'failed', text: `✗ Failed: ${data}`, timestamp: new Date(), color: 'text-red-400' };
  }

  // Hook events have event type = 'hook'
  if (event.type === 'hook') {
    try {
      const hook = JSON.parse(data) as HookEventType;
      const { text, color } = formatHook(hook);
      return { id: nextId(), kind: 'hook', text, timestamp: new Date(), color };
    } catch {
      return null;
    }
  }

  // Plain data events — Claude stream-json
  try {
    const parsed = JSON.parse(data);
    // Extract text from assistant messages
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const text = parsed.delta.text?.trim();
      if (text) {
        return { id: nextId(), kind: 'text', text, timestamp: new Date(), color: 'text-gray-100' };
      }
    }
  } catch {
    // not JSON — treat as raw text if non-empty
    const trimmed = data.trim();
    if (trimmed) {
      return { id: nextId(), kind: 'text', text: trimmed, timestamp: new Date(), color: 'text-gray-300' };
    }
  }

  return null;
}

export function createEventSource(workspaceName: string): EventSource {
  return new EventSource(`/api/proxy/workspaces/${workspaceName}/goals/stream`);
}
