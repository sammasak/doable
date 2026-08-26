import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const load: PageServerLoad = async ({ params, locals }) => {
  // Auth guard
  if (!locals.userId) {
    throw redirect(302, '/auth/login');
  }

  const { name } = params;
  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`, {
      headers: {
        'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
        'X-User-ID': locals.userId,
      },
    });
    const workspace = res.ok ? await res.json() : null;
    return { name, workspace };
  } catch {
    return { name, workspace: null };
  }
};
