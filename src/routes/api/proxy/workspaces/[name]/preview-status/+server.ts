import type { RequestHandler } from '@sveltejs/kit';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';
const PREVIEW_PORT = 4300;

async function resolveIP(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`);
    if (!res.ok) return null;
    const ws = await res.json();
    return ws.ipAddress ?? null;
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ params }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  const ip = await resolveIP(params.name);
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
