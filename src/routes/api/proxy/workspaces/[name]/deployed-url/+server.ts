import type { RequestHandler } from '@sveltejs/kit';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

async function resolveWorkspace(name: string): Promise<{ ipAddress: string | null; previewUrl: string | null }> {
  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`);
    if (!res.ok) return { ipAddress: null, previewUrl: null };
    const ws = await res.json();
    return { ipAddress: ws.ipAddress ?? null, previewUrl: ws.previewUrl ?? null };
  } catch {
    return { ipAddress: null, previewUrl: null };
  }
}

export const GET: RequestHandler = async ({ params }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });

  const { ipAddress: ip, previewUrl } = await resolveWorkspace(params.name);

  // Try VM endpoints first: port 4200 (claude-worker main), port 8080 (updated binary with /deployed-url)
  if (ip) {
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
  }

  // Fall back to the previewUrl from the WorkspaceClaim (Kubernetes-backed, survives VM deletion)
  if (previewUrl) {
    return new Response(JSON.stringify({ url: previewUrl }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ url: null }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
