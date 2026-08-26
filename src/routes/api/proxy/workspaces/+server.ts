import type { RequestHandler } from '@sveltejs/kit';
import { getMeter } from '$lib/server/otel';
import { env } from '$env/dynamic/private';

const API = env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

const meter = getMeter();
const wsCreateDuration = meter.createHistogram('doable_workspace_create_duration_seconds', {
  description: 'Latency of workstation-api workspace creation calls from doable server',
  unit: 's',
});
const wsCreateTotal = meter.createCounter('doable_workspace_create_total', {
  description: 'Total workspace creation requests',
});

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const res = await fetch(`${API}/api/v1/workspaces`, {
      headers: authHeaders(locals.userId),
    });
    const body = await res.json();
    const data = Array.isArray(body) ? body : (body.workspaces ?? []);
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspaces list fetch failed:', err);
    return new Response(JSON.stringify([]), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const t0 = performance.now();
  let result = 'error';
  try {
    const body = await request.json();
    const res = await fetch(`${API}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(locals.userId) },
      body: JSON.stringify(body)
    });
    result = res.ok ? 'success' : 'error';
    wsCreateTotal.add(1, { result });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspace create failed:', err);
    wsCreateTotal.add(1, { result: 'error' });
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    wsCreateDuration.record((performance.now() - t0) / 1000);
  }
};
