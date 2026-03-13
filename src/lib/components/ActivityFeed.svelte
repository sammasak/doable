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

  // Maps Tailwind text color classes (stored on ActivityItem.color) to hex values
  const COLOR_HEX: Record<string, string> = {
    'text-yellow-500': '#F59E0B',
    'text-yellow-400': '#FBBF24',
    'text-blue-400': '#60A5FA',
    'text-green-400': '#34D399',
    'text-purple-400': '#C084FC',
    'text-gray-400': '#9CA3AF',
    'text-gray-500': '#6B7280',
    'text-gray-300': '#D1D5DB',
    'text-gray-100': '#F3F4F6',
    'text-red-400': '#F87171',
  };

  function getStyle(item: ActivityItem): { borderColor: string; color: string } {
    const textColor = COLOR_HEX[item.color] ?? '#6B7280';
    const text = item.text || '';
    if (text.startsWith('$')) return { borderColor: '#6B7280', color: textColor };
    if (text.startsWith('+')) return { borderColor: '#10B981', color: textColor };
    if (text.startsWith('~')) return { borderColor: '#6366F1', color: textColor };
    if (text.startsWith('↻') || text.startsWith('↺') || text.startsWith('⚙')) return { borderColor: '#F59E0B', color: textColor };
    if (text.startsWith('◎')) return { borderColor: '#A855F7', color: textColor };
    if (text.startsWith('✓')) return { borderColor: '#10B981', color: textColor };
    return { borderColor: textColor, color: textColor };
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
        {item.dim ? 'opacity: 0.45; font-style: italic;' : ''}
      "
    >
      {item.text}
    </div>
  {/each}
</div>
