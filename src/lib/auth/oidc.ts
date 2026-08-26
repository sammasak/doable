// src/lib/auth/oidc.ts
import * as oauth from 'oauth4webapi';
import { env } from '$env/dynamic/private';

export function getOidcClient(): oauth.Client {
	return { client_id: env.AUTHENTIK_CLIENT_ID! };
}

export async function getAuthorizationServer(): Promise<oauth.AuthorizationServer> {
	const issuer = new URL(env.AUTHENTIK_ISSUER_URL!);
	const discoveryResponse = await oauth.discoveryRequest(issuer);
	return oauth.processDiscoveryResponse(issuer, discoveryResponse);
}

export function getRedirectUri(): string {
	return `${env.APP_BASE_URL}/auth/callback`;
}
