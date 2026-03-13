export interface Workspace {
  name: string;
  phase: string;
  vmStatus: string;
  ipAddress: string | null;
  uptimeSeconds: number;
  createdAt?: string;
  previewUrl?: string;
  goal?: string;
  goalPosted?: boolean;
  goalPostingError?: string;
}

export interface Goal {
  id: string;
  goal: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'reviewed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  reviewed_at: string | null;
  result: string | null;
}

export interface CreateWorkspaceRequest {
  name: string;
  containerDiskImage: string;
  bootstrapSecretName: string;
  runStrategy: string;
  idleHaltAfterMinutes: number;
  goal?: string;
}

// All calls go to /api/proxy/* which SvelteKit server routes forward to workstation-api
export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch('/api/proxy/workspaces');
  if (!res.ok) throw new Error(`Failed to list workspaces: ${res.status}`);
  return res.json();
}

export async function createWorkspace(req: CreateWorkspaceRequest): Promise<Workspace> {
  const res = await fetch('/api/proxy/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  if (!res.ok) throw new Error(`Failed to create workspace: ${res.status}`);
  return res.json();
}

export async function getWorkspace(name: string): Promise<Workspace> {
  const res = await fetch(`/api/proxy/workspaces/${name}`);
  if (!res.ok) throw new Error(`Failed to get workspace: ${res.status}`);
  return res.json();
}

export async function deleteWorkspace(name: string): Promise<void> {
  const res = await fetch(`/api/proxy/workspaces/${name}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete workspace: ${res.status}`);
}

export async function getWorkspaceEvents(name: string): Promise<unknown[]> {
  const res = await fetch(`/api/proxy/workspaces/${name}/events`);
  if (!res.ok) return [];
  return res.json();
}

export async function heartbeat(name: string): Promise<void> {
  await fetch(`/api/proxy/workspaces/${name}/heartbeat`, { method: 'POST' });
}

export async function getGoals(name: string): Promise<Goal[]> {
  const res = await fetch(`/api/proxy/workspaces/${name}/goals`);
  if (res.status === 503) return [];
  if (!res.ok) throw new Error(`Failed to get goals: ${res.status}`);
  return res.json();
}

export class WorkerNotReadyError extends Error {
  constructor() { super('Worker warming up'); }
}

export async function addGoal(name: string, goal: string): Promise<Goal> {
  const res = await fetch(`/api/proxy/workspaces/${name}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal })
  });
  if (res.status === 503) {
    throw new WorkerNotReadyError();
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to add goal (${res.status}): ${err}`);
  }
  return res.json();
}

export interface PreviewStatus {
  active: boolean;
  port?: number;
  reason?: string;
}

export async function getPreviewStatus(name: string): Promise<PreviewStatus> {
  try {
    const res = await fetch(`/api/proxy/workspaces/${name}/preview-status`);
    if (!res.ok) return { active: false };
    return res.json();
  } catch {
    return { active: false };
  }
}

export async function getDeployedUrl(name: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/proxy/workspaces/${name}/deployed-url`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}
