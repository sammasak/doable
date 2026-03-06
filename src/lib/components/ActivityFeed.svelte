<script lang="ts">
  import type { ActivityItem } from '$lib/api/stream';
  import { afterUpdate } from 'svelte';

  export let items: ActivityItem[] = [];

  let container: HTMLElement;

  afterUpdate(() => {
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });

  function getStyle(item: ActivityItem): { borderColor: string; color: string } {
    const text = item.text || '';
    if (text.startsWith('$')) return { borderColor: '#6B7280', color: '#9CA3AF' };
    if (text.startsWith('+')) return { borderColor: '#10B981', color: '#34D399' };
    if (text.startsWith('~')) return { borderColor: '#6366F1', color: '#818CF8' };
    if (text.startsWith('↻')) return { borderColor: '#F59E0B', color: '#FCD34D' };
    if (text.startsWith('◎')) return { borderColor: '#A855F7', color: '#C084FC' };
    if (text.startsWith('✓')) return { borderColor: '#10B981', color: '#34D399' };
    return { borderColor: '#4A5068', color: '#6B7280' };
  }
</script>

<div bind:this={container} class="flex-1 overflow-y-auto" style="padding: 8px 10px; max-height: 280px;">
  {#if items.length === 0}
    <p style="color: var(--color-text-muted); font-size: 11px; font-style: italic; font-family: var(--font-mono); padding: 2px 0;">Waiting for activity…</p>
  {/if}
  {#each items as item (item.id)}
    {@const style = getStyle(item)}
    <div
      style="
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.7;
        padding: 1px 0 1px 8px;
        margin-bottom: 1px;
        word-break: break-all;
        white-space: pre-wrap;
        border-left: 2px solid {style.borderColor};
        color: {style.color};
      "
    >
      {item.text}
    </div>
  {/each}
</div>
