<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Workspace } from '$lib/api/workstation';
  import WorkspaceStatus from './WorkspaceStatus.svelte';

  export let workspaces: Workspace[] = [];

  const dispatch = createEventDispatcher<{ select: string; delete: string }>();

  const PHASE_LABELS: Record<string, string> = {
    Ready: 'Ready',
    Booting: 'Starting up',
    Scheduling: 'Getting ready',
    Starting: 'Getting ready',
    Error: 'Error',
    Stopped: 'Stopped',
    Halted: 'Paused',
  };
</script>

<div class="space-y-3">
  {#each workspaces as ws, i (ws.name)}
    <div
      class="project-card flex items-center justify-between"
      style="--i: {i}"
      role="button"
      tabindex="0"
      on:click={() => dispatch('select', ws.name)}
      on:keypress={(e) => e.key === 'Enter' && dispatch('select', ws.name)}
    >
      <div>
        <p style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-text-primary);">{ws.name}</p>
        <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 2px; font-family: var(--font-mono);">{PHASE_LABELS[ws.phase] ?? 'Getting ready'}</p>
      </div>
      <div class="flex items-center gap-3">
        <WorkspaceStatus status={ws.vmStatus || ws.phase} />
        <button
          on:click|stopPropagation={() => dispatch('delete', ws.name)}
          class="btn-delete"
          title="Delete"
        >✕</button>
      </div>
    </div>
  {/each}
</div>
