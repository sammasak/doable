// src/routes/auth/callback/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';
import { encryptSession, decryptSession } from '$lib/auth/session';
import { getOidcClient, getAuthorizationServer, getRedirectUri } from '$lib/auth/oidc';
import { env } from '$env/dynamic/private';

function redirect(location: string): Response {
	return new Response(null, { status: 302, headers: { location } });
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	// Retrieve and validate PKCE cookie
	const pkceToken = cookies.get('doable_pkce');
	if (!pkceToken) {
		return redirect('/');
	}

	let pkcePayload: { codeVerifier: string; state: string; next: string };
	try {
		const pkceSession = await decryptSession(pkceToken);
		pkcePayload = JSON.parse(pkceSession.userId);
	} catch {
		cookies.delete('doable_pkce', { path: '/auth/callback' });
		return redirect('/auth/login');
	}
	cookies.delete('doable_pkce', { path: '/auth/callback' });

	const as = await getAuthorizationServer();
	const client = getOidcClient();

	let result: oauth.TokenEndpointResponse;
	try {
		// Validate state and extract code
		const params = oauth.validateAuthResponse(as, client, url.searchParams, pkcePayload.state);

		// Exchange code for tokens
		const tokenResponse = await oauth.authorizationCodeGrantRequest(
			as,
			client,
			oauth.ClientSecretPost(env.AUTHENTIK_CLIENT_SECRET!),
			params,
			getRedirectUri(),
			pkcePayload.codeVerifier
		);

		result = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse);
	} catch (err) {
		console.error('[auth] OAuth2 error:', err);
		return redirect('/auth/login');
	}

	// Extract user identity from ID token claims
	const claims = oauth.getValidatedIdTokenClaims(result)!;
	const userId = String(claims.sub);
	const email = String(claims.email ?? '');

	// Create encrypted session cookie
	const sessionToken = await encryptSession({
		userId,
		email,
		expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
	});

	cookies.set('doable_session', sessionToken, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/',
		maxAge: 7 * 24 * 60 * 60
	});

	const next = pkcePayload.next ?? '/';
	const safePath = next.startsWith('/') ? next : '/';
	return redirect(`${env.PUBLIC_BASE_URL}${safePath}`);
};
