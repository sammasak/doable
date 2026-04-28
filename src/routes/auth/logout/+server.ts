// src/routes/auth/logout/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete('doable_session', { path: '/' });
	// Redirect to Authentik end-session endpoint to clear SSO session
	const endSessionUrl = new URL(`${env.AUTHENTIK_ISSUER_URL}end-session/`);
	endSessionUrl.searchParams.set('post_logout_redirect_uri', env.PUBLIC_BASE_URL!);
	return new Response(null, { status: 302, headers: { location: endSessionUrl.toString() } });
};
