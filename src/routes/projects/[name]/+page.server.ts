import type { PageServerLoad } from './$types';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

export const load: PageServerLoad = async ({ params }) => {
  const { name } = params;

  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`);
    const workspace = res.ok ? await res.json() : null;
    return { name, workspace };
  } catch {
    return { name, workspace: null };
  }
};
