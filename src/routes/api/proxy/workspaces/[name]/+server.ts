import type { RequestHandler } from '@sveltejs/kit';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const GET: RequestHandler = async ({ params }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  const res = await fetch(`${API}/api/v1/workspaces/${params.name}`);
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const DELETE: RequestHandler = async ({ params }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  const res = await fetch(`${API}/api/v1/workspaces/${params.name}`, { method: 'DELETE' });
  return new Response(null, { status: res.status });
};
