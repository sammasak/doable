import type { RequestHandler } from '@sveltejs/kit';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

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
  if (!ip) {
    return new Response(JSON.stringify({ url: null }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Try ports in order: 4200 (claude-worker main), 8080 (updated claude-worker with /deployed-url)
  for (const port of [4200, 8080]) {
    try {
      const res = await fetch(`http://${ip}:${port}/deployed-url`, {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          return new Response(JSON.stringify({ url: data.url }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    } catch {
      // try next port
    }
  }
  return new Response(JSON.stringify({ url: null }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
