import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const API = env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.userId) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}/events`, {
      headers: authHeaders(locals.userId),
    });
    if (!res.ok) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(`[proxy] events fetch failed for ${params.name}:`, err);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};
