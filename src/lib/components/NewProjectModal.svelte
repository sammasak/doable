<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{
    create: { name: string; prompt: string };
    close: void;
  }>();

  let name = '';
  let prompt = '';
  let nameError = '';

  function validateName(v: string) {
    if (!v) return 'Name is required';
    if (!/^[a-z0-9-]+$/.test(v)) return 'Only lowercase letters, numbers, and hyphens';
    if (v.length > 32) return 'Max 32 characters';
    return '';
  }

  function handleSubmit() {
    nameError = validateName(name);
    if (nameError || !prompt.trim()) return;
    dispatch('create', { name, prompt: prompt.trim() });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="modal-backdrop fixed inset-0 flex items-center justify-center z-50"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click|self={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="modal-surface w-full max-w-lg mx-4 p-6 relative">
    <button
      on:click={() => dispatch('close')}
      class="btn-close"
      aria-label="Close"
    >✕</button>

    <h2 style="font-family: var(--font-sans); font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: var(--color-text-primary); margin-bottom: 20px;">New Project</h2>

    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
      <div>
        <label for="name" style="display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px;">Project name</label>
        <input
          id="name"
          type="text"
          bind:value={name}
          placeholder="my-app"
          class="modal-input"
        />
        {#if nameError}
          <p style="color: #F87171; font-size: 12px; margin-top: 4px;">{nameError}</p>
        {/if}
      </div>

      <div>
        <label for="prompt" style="display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px;">What do you want to build?</label>
        <textarea
          id="prompt"
          bind:value={prompt}
          placeholder="Build a REST API that..."
          class="modal-input"
          style="min-height: 120px; resize: none;"
        ></textarea>
      </div>

      <div class="flex gap-3 justify-end pt-1">
        <button
          type="button"
          on:click={() => dispatch('close')}
          class="btn-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn-accent"
          disabled={!name || !prompt}
          style={!name || !prompt ? 'opacity: 0.4; cursor: not-allowed;' : ''}
        >
          Create Project
        </button>
      </div>
    </form>
  </div>
</div>
