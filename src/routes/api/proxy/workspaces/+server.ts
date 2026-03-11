import type { RequestHandler } from '@sveltejs/kit';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const GET: RequestHandler = async () => {
  try {
    const res = await fetch(`${API}/api/v1/workspaces`);
    const body = await res.json();
    const data = Array.isArray(body) ? body : (body.workspaces ?? []);
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspaces list fetch failed:', err);
    return new Response(JSON.stringify([]), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const res = await fetch(`${API}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspace create failed:', err);
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
