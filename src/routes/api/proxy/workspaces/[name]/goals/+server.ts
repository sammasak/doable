import type { RequestHandler } from '@sveltejs/kit';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

async function resolveIP(name: string): Promise<string | null> {
  const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`);
  if (!res.ok) return null;
  const ws = await res.json();
  return ws.ipAddress ?? null;
}

export const GET: RequestHandler = async ({ params }) => {
  const ip = await resolveIP(params.name);
  if (!ip) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const res = await fetch(`http://${ip}:4200/goals`);
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('[]', { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  const ip = await resolveIP(params.name);
  if (!ip) return new Response('Worker not ready', { status: 503 });

  const body = await request.json();
  try {
    const res = await fetch(`http://${ip}:4200/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.text();
    return new Response(data, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('Worker not ready', { status: 503 });
  }
};
