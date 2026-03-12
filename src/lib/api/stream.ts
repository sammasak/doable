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

function humanizePath(path: string, prefix: string): string {
  const basename = path.split('/').pop() ?? '';
  // Infrastructure files → describe what they do
  if (basename === 'flake.nix' || /\.nix$/.test(basename)) return `${prefix} Setting up build environment`;
  if (basename === 'Cargo.toml') return `${prefix} Configuring app dependencies`;
  if (basename === 'package.json') return `${prefix} Configuring app dependencies`;
  if (/^(requirements\.txt|pyproject\.toml|setup\.py|go\.mod)$/.test(basename)) return `${prefix} Configuring app dependencies`;
  if (basename === 'Dockerfile' || basename === 'Containerfile') return `${prefix} Packaging app for deployment`;
  if (/\.(svelte|tsx?|jsx?)$/.test(basename)) return `${prefix} Updating UI`;
  if (/\.rs$/.test(basename)) return `${prefix} Building your app`;
  if (/\.(css|scss|pcss)$/.test(basename)) return `${prefix} Styling your app`;
  if (/\.html?$/.test(basename)) return `${prefix} Updating layout`;
  // Infrastructure / GitOps file operations — suppress entirely (never user-visible)
  // Only apply basename filter when NOT inside a user project directory.
  const isUserProject = /\/projects\/[^/]+\//.test(path);
  if (/\/(apps|homelab-gitops)\//i.test(path) ||
      (!isUserProject && /\b(kustomization|namespace|service|ingress)\.ya?ml$/i.test(basename))) {
    return '';  // empty string → caller's if (text.trim()) guard suppresses it
  }
  // Known build-toolchain hidden directories — show as generic step (not user-visible project files)
  if (/\/\.(cargo|rustup|npm|yarn|pnpm|gradle|m2|cache|local\/share)\//i.test(path)) return `${prefix} Configuring build`;
  // Strip /var/lib/claude-worker/projects/{name}/ prefix — show only relative path
  const match = path.match(/\/projects\/[^/]+\/(.+)$/);
  const relPath = match ? match[1] : path;
  return `${prefix} ${relPath}`;
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

  // Claude CLI --output-format stream-json events
  try {
    const parsed = JSON.parse(data);

    // Assistant step: contains tool_use blocks (Bash, Write, Edit, Read, ...)
    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
      for (const block of parsed.message.content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_use') {
          const tool = String(block.name ?? '');
          const input = (block.input ?? {}) as Record<string, string>;
          let text = '';
          let color = 'text-gray-400';

          if (tool === 'Bash') {
            const desc = (input.command ?? '').slice(0, 120);
            // Internal state management calls — hide from user
            // Left branch: curl PUT to goals endpoint. Right branch: /goals/<id> with JSON "status" key
            if (/\bcurl\b[^"']*\bPUT\b[^"']*\/goals\/|\/goals\/[a-z0-9_-]{6,}.*"status"\s*:/i.test(desc)) return null;
            // Compilation/build steps — show as friendly progress instead of filtering
            if (/\b(build|compile|compiling)\b/i.test(desc) && /\b(binary|bin|static|release|musl|cargo|target)\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Building your app...', timestamp: new Date(), color: 'text-yellow-500' };
            }
            if (/^buildah build\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Packaging app for deployment...', timestamp: new Date(), color: 'text-blue-400' };
            }
            if (/\bbuildah push\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Uploading app image...', timestamp: new Date(), color: 'text-blue-400' };
            }
            if (/\bkubectl\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Deploying your app...', timestamp: new Date(), color: 'text-purple-400' };
            }
            if (/\bgit push\b/i.test(desc) || /\bgit commit\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Publishing changes...', timestamp: new Date(), color: 'text-green-400' };
            }
            // GitOps / CI infrastructure — translate flux to friendly message, suppress auth checks
            if (/\bflux\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Rolling out update…', timestamp: new Date(), color: 'text-purple-400' };
            }
            if (/\bgh\s+auth\b/i.test(desc) || /\bskopeo\b.*inspect\b/i.test(desc)) return null;
            // Nix/musl toolchain setup — translate to friendly label
            if (/\bpkgsMusl\b|nix\s+(develop|build|eval|shell|instantiate)\b/i.test(desc)) {
              return { id: nextId(), kind: 'hook', text: '⚙ Getting your tools ready…', timestamp: new Date(), color: 'text-blue-400' };
            }
            text = `$ ${desc.slice(0, 70)}`;
            // Filter out build-toolchain internals and absolute system paths (noise for end users)
            if (/\b(nix\b|lld\b|llvm\b|linker|wrapper|musl\b|rustflag|glibc)\b/i.test(desc)) return null;
            if (/\/var\/lib\/|\/var\/run\/|\/usr\/share\/|\/nix\/store\//.test(desc)) return null;
          } else if (tool === 'Write') {
            text = humanizePath(input.file_path ?? '', '+');
            color = 'text-green-400';
          } else if (tool === 'Edit') {
            text = humanizePath(input.file_path ?? '', '~');
            color = 'text-blue-400';
          } else if (tool === 'Read') {
            return null; // Reading files is internal navigation, not user-relevant progress
          } else if (tool === 'TaskOutput') {
            // Claude is blocking, waiting for a background subprocess (long compilation)
            return { id: nextId(), kind: 'hook', text: '⚙ Compiling… this may take a few minutes', timestamp: new Date(), color: 'text-yellow-500' };
          } else if (tool === 'Glob' || tool === 'Grep') {
            return null; // Search operations are internal, not user-relevant
          } else if (tool === 'TodoWrite' || tool === 'TodoRead') {
            return null; // Claude's internal task list — not user-visible progress
          } else {
            return null; // Unknown tool — suppress rather than show confusing [ToolName]
          }

          if (text.trim()) {
            return { id: nextId(), kind: 'hook', text, timestamp: new Date(), color };
          }
        }
      }
      // Assistant text (thinking/narration) — first non-empty line only
      for (const block of parsed.message.content as Array<Record<string, unknown>>) {
        if (block.type === 'text') {
          const firstLine = String(block.text ?? '').split('\n').find((l: string) => l.trim());
          if (firstLine) {
            // Detect retry/fix context: technical failure term AND explicit error/failure signal
            if (/\b(linker|nodefaultlibs)\b/i.test(firstLine) && /\b(fail|error|failed)\b/i.test(firstLine)) {
              return { id: nextId(), kind: 'hook', text: '↺ Adjusting build strategy…', timestamp: new Date(), color: 'text-yellow-400' };
            }
            // Suppress first-person planning/action narration (internal monologue, not user-facing status)
            if (/^(now let me|let me|i'll|i will|i'm going to|i'm now|alright[,\s]|okay[,\s]|great[,\s])/i.test(firstLine.trim())) return null;
            // Suppress technical implementation narration (tech stack names confuse non-developers)
            if (/\b(rust\b|golang\b|node\.js\b|typescript\b|axum\b|actix\b|express\b|django\b|flask\b|rails\b|spring\b|web server|webserver|binary|compile|linker|dockerfile)\b/i.test(firstLine)) return null;
            return { id: nextId(), kind: 'text', text: firstLine.trim().slice(0, 80), timestamp: new Date(), color: 'text-gray-400' };
          }
        }
      }
    }

    // Completion signal from CLI format
    if (parsed.type === 'result') {
      return { id: nextId(), kind: 'done', text: '✓ Session complete', timestamp: new Date(), color: 'text-green-400' };
    }

    // Legacy REST API streaming format (content_block_delta)
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const text = (parsed.delta.text as string)?.trim();
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
