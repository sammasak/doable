import type { RequestHandler } from '@sveltejs/kit';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const POST: RequestHandler = async ({ params }) => {
  const res = await fetch(`${API}/api/v1/workspaces/${params.name}/heartbeat`, { method: 'POST' });
  return new Response(null, { status: res.status });
};
