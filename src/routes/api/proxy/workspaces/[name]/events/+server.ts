import type { RequestHandler } from '@sveltejs/kit';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const GET: RequestHandler = async ({ params }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}/events`);
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
