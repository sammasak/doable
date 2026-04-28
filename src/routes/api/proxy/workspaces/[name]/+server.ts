import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}`, {
      headers: authHeaders(locals.userId),
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(`[proxy] workspace fetch failed for ${params.name}:`, err);
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}`, {
      method: 'DELETE',
      headers: authHeaders(locals.userId),
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    console.error(`[proxy] workspace delete failed for ${params.name}:`, err);
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
