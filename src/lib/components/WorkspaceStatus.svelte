<script lang="ts">
  export let status: string;

  $: isDone = status === 'Done';
  $: isRunning = status === 'Running';
  $: isStarting = status === 'Provisioning' || status === 'Starting' || status === 'Scheduling' || status === 'Building';
  $: isHalted = status === 'Halted' || status === 'Stopped';
  $: isError = status === 'Error';

  $: dotColor = isDone ? '#10B981' : isRunning ? '#10B981' : isStarting ? '#F59E0B' : isError ? '#EF4444' : '#4A5068';
  $: bgColor = isDone ? 'var(--color-success-dim)' : isRunning ? 'var(--color-success-dim)' : isStarting ? 'rgba(245,158,11,0.1)' : isError ? 'rgba(239,68,68,0.1)' : 'rgba(74,80,104,0.15)';
  $: borderColor = isDone ? 'rgba(16,185,129,0.25)' : isRunning ? 'rgba(16,185,129,0.25)' : isStarting ? 'rgba(245,158,11,0.25)' : isError ? 'rgba(239,68,68,0.25)' : 'rgba(74,80,104,0.3)';
  $: textColor = isDone ? 'var(--color-success)' : isRunning ? 'var(--color-success)' : isStarting ? '#F59E0B' : isError ? '#EF4444' : 'var(--color-text-muted)';

  const STATUS_LABELS: Record<string, string> = {
    Provisioning: 'Getting ready',
    Scheduling: 'Getting ready',
    Starting: 'Getting ready',
    Running: 'Ready',
    Building: 'Building',
    Done: 'Done',
    Halted: 'Paused',
    Stopped: 'Stopped',
    Error: 'Error',
  };
  $: label = STATUS_LABELS[status] ?? 'Getting ready';
</script>

<span
  class="status-badge"
  style="background: {bgColor}; border: 1px solid {borderColor}; color: {textColor};"
>
  <span class="dot" style="background: {dotColor};"></span>
  {label}
</span>
