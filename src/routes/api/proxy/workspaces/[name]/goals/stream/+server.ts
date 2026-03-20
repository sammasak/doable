import type { RequestHandler } from '@sveltejs/kit';
import { getMeter } from '$lib/server/otel';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

const meter = getMeter();
const sseConnects = meter.createCounter('doable_sse_goal_stream_connects_total', {
  description: 'Number of SSE goal-stream connections opened from the doable server',
});

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

export const GET: RequestHandler = async ({ params, url }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  const ip = url.searchParams.get('ip') || await resolveIP(params.name);
  if (!ip) {
    return new Response('Worker not ready', { status: 503 });
  }

  try {
    // Resolve the latest goal ID — the stream endpoint requires /goals/{id}/stream
    const goalsRes = await fetch(`http://${ip}:4200/goals`);
    if (!goalsRes.ok) {
      return new Response('Worker not ready', { status: 503 });
    }
    const goals = await goalsRes.json() as Array<{ id: string }>;
    if (!goals.length) {
      return new Response('No goals yet', { status: 404 });
    }
    const latestId = goals[goals.length - 1].id;

    const upstream = await fetch(`http://${ip}:4200/goals/${latestId}/stream`, {
      headers: { Accept: 'text/event-stream' }
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('Stream unavailable', { status: 502 });
    }

    sseConnects.add(1);

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive'
      }
    });
  } catch {
    return new Response('Stream unavailable', { status: 502 });
  }
};
