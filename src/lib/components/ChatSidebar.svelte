<script lang="ts">
  import { createEventDispatcher, afterUpdate } from 'svelte';
  import type { Goal } from '$lib/api/workstation';
  import type { ActivityItem } from '$lib/api/stream';
  import ActivityFeed from './ActivityFeed.svelte';
  import GoalMessage from './GoalMessage.svelte';

  export let goals: Goal[] = [];
  export let activity: ActivityItem[] = [];
  export let disabled: boolean = false;
  export let workspaceName: string;

  const dispatch = createEventDispatcher<{ prompt: string }>();

  let input = '';
  let messageList: HTMLElement;

  afterUpdate(() => {
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  });

  function submit() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    dispatch('prompt', trimmed);
    input = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  $: isWorking = goals.some(g => g.status === 'in_progress' || g.status === 'pending');
</script>

<div class="flex flex-col h-full" style="background: var(--color-surface); border-right: 1px solid var(--color-border);">
  <!-- Header -->
  <div style="padding: 10px 14px; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: 8px;">
    <span style="font-family: var(--font-mono); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">{workspaceName}</span>
    {#if isWorking}
      <!-- Animated working indicator -->
      <div style="display: flex; align-items: center; gap: 5px;">
        <span style="font-size: 10px; color: #F59E0B; font-family: var(--font-mono);">working</span>
        <div style="display: flex; gap: 2px; align-items: center;">
          <span class="thinking-dot" style="--delay: 0ms;"></span>
          <span class="thinking-dot" style="--delay: 160ms;"></span>
          <span class="thinking-dot" style="--delay: 320ms;"></span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Goals + Activity -->
  <div bind:this={messageList} class="flex-1 overflow-y-auto" style="padding: 12px; display: flex; flex-direction: column; gap: 2px;">
    {#if goals.length === 0 && !isWorking}
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 24px;">
        <span style="font-size: 24px; color: var(--color-accent); opacity: 0.5;">◆</span>
        <p style="font-size: 12px; color: var(--color-text-muted); line-height: 1.5;">Send a prompt below to<br/>start building</p>
      </div>
    {/if}

    {#each goals as goal (goal.id)}
      <GoalMessage {goal} isUser={true} />
      <GoalMessage {goal} isUser={false} />
    {/each}

    {#if activity.length > 0}
      <div style="margin-top: 4px; border: 1px solid var(--color-border); border-radius: 8px; background: rgba(8,11,20,0.6); overflow: hidden;">
        <ActivityFeed items={activity} />
      </div>
    {/if}
  </div>

  <!-- Input -->
  <div style="padding: 10px 12px; border-top: 1px solid var(--color-border);">
    <div class="flex gap-2 items-end">
      <textarea
        bind:value={input}
        on:keydown={handleKeydown}
        placeholder={disabled ? 'Claude is working…' : 'Follow-up prompt…'}
        {disabled}
        rows={2}
        class="chat-textarea"
      ></textarea>
      <button
        on:click={submit}
        disabled={disabled || !input.trim()}
        class="send-btn"
        title="Send (Enter)"
        style="opacity: {disabled || !input.trim() ? '0.3' : '1'};"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .thinking-dot {
    display: block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #F59E0B;
    animation: thinkingBounce 0.9s ease infinite both;
    animation-delay: var(--delay, 0ms);
  }

  @keyframes thinkingBounce {
    0%, 100% { opacity: 0.2; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(-3px); }
  }
</style>
