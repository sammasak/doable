import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    user: locals.userId ? { id: locals.userId, email: locals.email } : null,
  };
};
