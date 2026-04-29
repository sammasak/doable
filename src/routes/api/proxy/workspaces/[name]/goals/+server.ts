import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const WORKSTATION_API = env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

async function resolveIP(name: string, userId: string | null): Promise<string | null> {
  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`, {
      headers: authHeaders(userId),
    });
    if (!res.ok) return null;
    const ws = await res.json();
    return ws.ipAddress ?? null;
  } catch {
    return null;
  }
}

async function isWorkerReady(ip: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}:4200/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!params.name) return new Response('Bad request', { status: 400 });
  const ip = await resolveIP(params.name, locals.userId);
  if (!ip) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = await fetch(`http://${ip}:4200/goals`);
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!params.name) return new Response('Bad request', { status: 400 });
  const ip = await resolveIP(params.name, locals.userId);
  if (!ip) return new Response(JSON.stringify({ reason: 'no_ip' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });

  const ready = await isWorkerReady(ip);
  if (!ready) return new Response(JSON.stringify({ reason: 'warming_up' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const res = await fetch(`http://${ip}:4200/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ reason: 'warming_up' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
