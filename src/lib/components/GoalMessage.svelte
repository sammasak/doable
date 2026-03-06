<script lang="ts">
  import { marked } from 'marked';
  import type { Goal } from '$lib/api/workstation';

  export let goal: Goal;
  export let isUser: boolean = false;

  $: statusColor =
    goal.status === 'done' || goal.status === 'reviewed' ? 'var(--color-success)' :
    goal.status === 'in_progress' ? '#F59E0B' :
    goal.status === 'failed' ? '#EF4444' :
    'var(--color-text-muted)';

  $: statusLabel =
    goal.status === 'done' ? '✓ done' :
    goal.status === 'reviewed' ? '✓ reviewed' :
    goal.status === 'in_progress' ? '● working...' :
    goal.status === 'failed' ? '✗ failed' :
    '○ pending';

  $: renderedGoal = marked.parse(goal.goal, { breaks: true }) as string;
</script>

<div style="margin-bottom: 12px;">
  {#if isUser}
    <div style="display: flex; justify-content: flex-end; margin-bottom: 4px;">
      <div
        style="max-width: 85%; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.2); border-radius: 12px 12px 2px 12px; padding: 10px 14px; font-size: 13px; font-family: var(--font-sans); color: var(--color-text-primary); line-height: 1.6;"
        class="prose prose-invert prose-sm max-w-none"
      >
        {@html renderedGoal}
      </div>
    </div>
  {:else}
    <div style="font-family: var(--font-mono); font-size: 11px; color: {statusColor}; margin-left: 4px; padding: 2px 0;">{statusLabel}</div>
  {/if}
</div>
