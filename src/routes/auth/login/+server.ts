// src/routes/auth/login/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';
import { encryptSession } from '$lib/auth/session';
import { getOidcClient, getAuthorizationServer, getRedirectUri } from '$lib/auth/oidc';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const as = await getAuthorizationServer();
	const client = getOidcClient();

	const codeVerifier = oauth.generateRandomCodeVerifier();
	const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
	const state = oauth.generateRandomState();

	// Store next URL (where to redirect after login)
	const next = url.searchParams.get('next') ?? '/';

	// Save PKCE + state in a short-lived encrypted cookie
	const pkcePayload = { codeVerifier, state, next };
	const pkceToken = await encryptSession({
		userId: JSON.stringify(pkcePayload),
		email: '',
		expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
	});

	cookies.set('doable_pkce', pkceToken, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/auth/callback',
		maxAge: 600
	});

	const authUrl = new URL(as.authorization_endpoint!);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', client.client_id);
	authUrl.searchParams.set('redirect_uri', getRedirectUri());
	authUrl.searchParams.set('scope', 'openid email profile');
	authUrl.searchParams.set('state', state);
	authUrl.searchParams.set('code_challenge', codeChallenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');

	return Response.redirect(authUrl.toString(), 302);
};
