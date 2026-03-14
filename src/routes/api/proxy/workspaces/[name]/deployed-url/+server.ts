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

  // Last resort: parse deployed URL from goal result text
  // Claude always mentions the deployed URL in its goal result summary
  if (ip) {
    try {
      const goalsRes = await fetch(`http://${ip}:4200/goals`, {
        signal: AbortSignal.timeout(2000)
      });
      if (goalsRes.ok) {
        const goals = await goalsRes.json() as Array<{ status: string; result?: string }>;
        for (const g of [...goals].reverse()) {
          if (g.result) {
            const match = g.result.match(/https?:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i);
            if (match && !match[0].includes('localhost') && !match[0].includes('10.42.')) {
              return new Response(JSON.stringify({ url: match[0] }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  return new Response(JSON.stringify({ url: null }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
