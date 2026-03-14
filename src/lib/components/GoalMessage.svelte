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
    goal.status === 'done' ? '✓ Done' :
    goal.status === 'reviewed' ? '✓ Done' :
    goal.status === 'in_progress' ? '● working…' :
    goal.status === 'failed' ? '✗ failed' :
    '○ pending';

  $: renderedGoal = marked.parse(goal.goal, { breaks: true }) as string;

  // Extract the first URL from result text for the share button
  // Strip trailing punctuation that may be captured by the URL regex
  $: deployedUrl = (() => {
    if (!goal.result) return null;
    const m = goal.result.match(/https?:\/\/[^\s,]+/);
    return m ? m[0].replace(/[.,;:!?)'"]+$/, '') : null;
  })();

  let copied = false;
  function copyLink() {
    if (!deployedUrl) return;
    navigator.clipboard.writeText(deployedUrl).then(() => {
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    }).catch(() => {
      // Clipboard API unavailable — open the URL instead as fallback
      window.open(deployedUrl!, '_blank', 'noopener,noreferrer');
    });
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Escape raw text and linkify URLs — processes raw string directly to avoid
  // running a regex substitution on already-escaped HTML (which is fragile).
  function linkify(raw: string): string {
    const urlRegex = /(https?:\/\/[^\s,]+)/g;
    const parts: string[] = [];
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(raw)) !== null) {
      parts.push(escapeHtml(raw.slice(lastIndex, match.index)));
      const url = match[1].replace(/[.,;:!?)'"]+$/, '');
      const safeHref = encodeURI(url);
      parts.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color: #34d399; text-decoration: underline; word-break: break-all;">${escapeHtml(url)}</a>`);
      lastIndex = match.index + match[0].length;
    }
    parts.push(escapeHtml(raw.slice(lastIndex)));
    return parts.join('');
  }
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
    {#if (goal.status === 'done' || goal.status === 'reviewed') && goal.result}
      <div style="
        margin-left: 4px;
        margin-top: 8px;
        padding: 10px 12px;
        background: rgba(34,197,94,0.07);
        border: 1px solid rgba(34,197,94,0.15);
        border-radius: 8px;
        font-size: 12px;
        color: var(--color-text-secondary);
        line-height: 1.6;
        max-width: 100%;
      ">
        {@html linkify(goal.result.slice(0, 320) + (goal.result.length > 320 ? '…' : ''))}
      </div>
      {#if deployedUrl}
        <div style="margin-left: 4px; margin-top: 8px; display: flex; gap: 6px;">
          <a
            href={deployedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style="
              display: inline-flex; align-items: center; gap: 4px;
              font-family: var(--font-mono); font-size: 11px;
              color: var(--color-success); text-decoration: none;
              background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25);
              border-radius: 6px; padding: 4px 10px;
              transition: border-color 0.15s;
            "
          >Open ↗</a>
          <button
            on:click={copyLink}
            style="
              display: inline-flex; align-items: center; gap: 4px;
              font-family: var(--font-mono); font-size: 11px;
              color: {copied ? 'var(--color-success)' : 'var(--color-text-muted)'};
              background: rgba(255,255,255,0.04); border: 1px solid var(--color-border);
              border-radius: 6px; padding: 4px 10px; cursor: pointer;
              transition: color 0.15s, border-color 0.15s;
            "
          >{copied ? '✓ Copied' : 'Copy link'}</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>
