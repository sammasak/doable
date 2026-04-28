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

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}/heartbeat`, {
      method: 'POST',
      headers: authHeaders(locals.userId),
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    console.error(`[proxy] heartbeat failed for ${params.name}:`, err);
    return new Response(null, { status: 502 });
  }
};
