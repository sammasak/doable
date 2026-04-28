import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';
const PREVIEW_PORT = 8080;

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

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  // Accept ?ip= to skip the resolveIP() round-trip when caller already knows the IP.
  const ip = url.searchParams.get('ip') || await resolveIP(params.name, locals.userId);
  if (!ip) return new Response(JSON.stringify({ active: false, reason: 'no_ip' }), {
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    const res = await fetch(`http://${ip}:${PREVIEW_PORT}/`, {
      signal: AbortSignal.timeout(1500)
    });
    const active = res.ok;
    const body = active ? { active, port: PREVIEW_PORT } : { active, reason: 'not_ready' };
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ active: false, reason: 'port_closed' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
