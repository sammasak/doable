# Doable Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Authentik OIDC authentication to doable (SvelteKit) and per-user workspace isolation in workstation-api.

**Architecture:** doable BFF proxy already exists at `/api/proxy/workspaces/`. Add session management via `jose` + `oauth4webapi`, protect all routes via `hooks.server.ts`, inject `X-User-ID` + `Authorization: Bearer` headers into every proxy call. workstation-api: read `X-User-ID`, store as annotation `doable.sammasak.dev/owner-id` on each WorkspaceClaim, filter/guard by it.

**Tech Stack:** oauth4webapi, jose, SvelteKit 5 server hooks, Rust/Axum header extraction, Kubernetes annotations, SOPS/age encryption

---

## Prerequisites — read before starting

- **Repos to clone:**
  ```bash
  cd /var/lib/claude-worker/projects
  gh repo clone sammasak/doable
  gh repo clone sammasak/workstation-api
  gh repo clone sammasak/homelab-gitops
  ```
- **Authentik API token** (retrieve from cluster):
  ```bash
  export AUTHENTIK_API_TOKEN=$(kubectl get secret authentik-secret -n authentik \
    -o jsonpath='{.data.api_token}' | base64 -d)
  echo $AUTHENTIK_API_TOKEN   # should be non-empty
  ```
- **WORKSTATION_API_KEY** — generate a new one (workstation-api currently has no key set):
  ```bash
  export WORKSTATION_API_KEY=$(openssl rand -hex 32)
  echo $WORKSTATION_API_KEY   # save this for later steps
  ```
- **SESSION_SECRET** — 32-byte key for jose cookie encryption:
  ```bash
  export SESSION_SECRET=$(openssl rand -hex 32)
  echo $SESSION_SECRET
  ```
- Node.js and npm are globally installed. Run SvelteKit build commands directly.
- Rust builds go inside `buildah build --isolation=chroot` via the Dockerfile (multi-stage). No need for `nix develop` for building — the Dockerfile handles musl/alpine setup.
- SOPS encrypts using public keys from `.sops.yaml`. No private key required to encrypt.

---

## Task 1: Create Authentik OIDC application

**Step 1: Create the OAuth2/OIDC provider**

```bash
PROVIDER_RESPONSE=$(curl -sf -X POST \
  -H "Authorization: Bearer $AUTHENTIK_API_TOKEN" \
  -H "Content-Type: application/json" \
  https://auth.sammasak.dev/api/v3/providers/oauth2/ \
  -d '{
    "name": "doable",
    "authorization_flow": "default-provider-authorization-explicit-consent",
    "client_type": "confidential",
    "redirect_uris": "https://doable.sammasak.dev/auth/callback",
    "sub_mode": "hashed_user_id",
    "include_claims_in_id_token": true,
    "property_mappings": []
  }')
echo $PROVIDER_RESPONSE | jq .
```

If this fails with a 400 about `authorization_flow`, list available flows first:
```bash
curl -sf -H "Authorization: Bearer $AUTHENTIK_API_TOKEN" \
  "https://auth.sammasak.dev/api/v3/flows/instances/?designation=authorization" | jq '.results[].slug'
```
Use the first slug returned in place of `default-provider-authorization-explicit-consent`.

**Step 2: Extract provider ID, client_id, client_secret**

```bash
export PROVIDER_ID=$(echo $PROVIDER_RESPONSE | jq -r '.pk')
export OIDC_CLIENT_ID=$(echo $PROVIDER_RESPONSE | jq -r '.client_id')
export OIDC_CLIENT_SECRET=$(echo $PROVIDER_RESPONSE | jq -r '.client_secret')
export OIDC_ISSUER_URL="https://auth.sammasak.dev/application/o/doable/"
echo "Provider ID: $PROVIDER_ID"
echo "Client ID: $OIDC_CLIENT_ID"
echo "Issuer: $OIDC_ISSUER_URL"
```

**Step 3: Create the application and bind provider**

```bash
curl -sf -X POST \
  -H "Authorization: Bearer $AUTHENTIK_API_TOKEN" \
  -H "Content-Type: application/json" \
  https://auth.sammasak.dev/api/v3/core/applications/ \
  -d "{
    \"name\": \"doable\",
    \"slug\": \"doable\",
    \"provider\": $PROVIDER_ID,
    \"meta_launch_url\": \"https://doable.sammasak.dev\"
  }" | jq .
```

Expected: `201 Created` with application object containing `slug: "doable"`.

**Step 4: Verify OIDC discovery endpoint responds**

```bash
curl -sf "https://auth.sammasak.dev/application/o/doable/.well-known/openid-configuration" | jq '{issuer, authorization_endpoint, token_endpoint}'
```

Expected: JSON with issuer `https://auth.sammasak.dev/application/o/doable/`.

**Step 5: Commit checkpoint**

```bash
git -C /var/lib/claude-worker/projects/homelab-gitops config user.email "claude-worker@sammasak.dev"
git -C /var/lib/claude-worker/projects/homelab-gitops config user.name "claude-worker-agent"
```

---

## Task 2: Create SOPS secret and update homelab-gitops

**Files:**
- Create: `apps/doable/secrets/doable-authentik-oidc.secret.yaml`
- Modify: `apps/doable/deployment.yaml`
- Modify: `apps/doable/kustomization.yaml`
- Modify: `apps/workstations/api-server/deployment.yaml`

**Step 1: Create the plaintext secret file (will be encrypted in place)**

```bash
cd /var/lib/claude-worker/projects/homelab-gitops
mkdir -p apps/doable/secrets
cat > apps/doable/secrets/doable-authentik-oidc.secret.yaml << EOF
apiVersion: v1
kind: Secret
metadata:
    name: doable-authentik-oidc
    namespace: doable
stringData:
    AUTHENTIK_CLIENT_ID: "${OIDC_CLIENT_ID}"
    AUTHENTIK_CLIENT_SECRET: "${OIDC_CLIENT_SECRET}"
    AUTHENTIK_ISSUER_URL: "${OIDC_ISSUER_URL}"
    SESSION_SECRET: "${SESSION_SECRET}"
    WORKSTATION_API_KEY: "${WORKSTATION_API_KEY}"
EOF
```

**Step 2: Encrypt with SOPS**

```bash
sops -e --in-place apps/doable/secrets/doable-authentik-oidc.secret.yaml
```

Verify it's encrypted (values should start with `ENC[`):
```bash
grep "ENC\[" apps/doable/secrets/doable-authentik-oidc.secret.yaml | head -3
```

**Step 3: Add secret to doable kustomization**

Edit `apps/doable/kustomization.yaml` to add the secrets directory:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - deployment.yaml
  - ingress.yaml
  - secrets/doable-authentik-oidc.secret.yaml
```

**Step 4: Update doable deployment to mount the secret**

Edit `apps/doable/deployment.yaml`. Add `envFrom` to mount all secret keys as env vars.
Replace the `env:` block in the container spec with:

```yaml
        envFrom:
        - secretRef:
            name: doable-authentik-oidc
        env:
        - name: WORKSTATION_API_URL
          value: "http://workstation-api.workstations.svc.cluster.local:8080"
        - name: ORIGIN
          value: "https://doable.sammasak.dev"
        - name: PUBLIC_BASE_URL
          value: "https://doable.sammasak.dev"
        - name: PORT
          value: "3000"
        - name: HOST
          value: "0.0.0.0"
        - name: NODE_ENV
          value: "production"
```

**Step 5: Add WORKSTATION_API_KEY to workstation-api deployment**

Edit `apps/workstations/api-server/deployment.yaml`. Add to the `env:` list:

```yaml
            - name: WORKSTATION_API_KEY
              valueFrom:
                secretKeyRef:
                  name: doable-authentik-oidc
                  key: WORKSTATION_API_KEY
```

Wait — the workstation-api is in namespace `workstations`, but the secret is in `doable`. They can't share across namespaces directly. Instead, create a separate secret for workstation-api:

```bash
cat > apps/workstations/secrets/workstation-api-key.secret.yaml << EOF
apiVersion: v1
kind: Secret
metadata:
    name: workstation-api-key
    namespace: workstations
stringData:
    WORKSTATION_API_KEY: "${WORKSTATION_API_KEY}"
EOF
sops -e --in-place apps/workstations/secrets/workstation-api-key.secret.yaml
```

Add to `apps/workstations/kustomization.yaml` resources:
```yaml
  - secrets/workstation-api-key.secret.yaml
```

Add to `apps/workstations/api-server/deployment.yaml` env:
```yaml
            - name: WORKSTATION_API_KEY
              valueFrom:
                secretKeyRef:
                  name: workstation-api-key
                  key: WORKSTATION_API_KEY
```

**Step 6: Commit homelab-gitops changes**

```bash
cd /var/lib/claude-worker/projects/homelab-gitops
git add apps/doable/ apps/workstations/
git commit -m "feat: add auth secrets for doable and workstation-api key"
```

---

## Task 3: Install npm dependencies in doable

**Step 1: Install oauth4webapi and jose**

```bash
cd /var/lib/claude-worker/projects/doable
npm install oauth4webapi jose
```

Expected: packages added to `package.json` dependencies.

**Step 2: Verify build still compiles**

```bash
npm run check
```

Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(auth): add oauth4webapi and jose dependencies"
```

---

## Task 4: Add app.d.ts Locals interface

**Files:**
- Create: `src/app.d.ts`

**Step 1: Create the file**

```typescript
// src/app.d.ts
declare global {
	namespace App {
		interface Locals {
			userId: string | null;
			email: string | null;
		}
	}
}

export {};
```

**Step 2: Verify type check**

```bash
npm run check
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/app.d.ts
git commit -m "feat(auth): add Locals interface (userId, email)"
```

---

## Task 5: Create session utilities

**Files:**
- Create: `src/lib/auth/session.ts`

**Step 1: Write the file**

```typescript
// src/lib/auth/session.ts
import { EncryptJWT, jwtDecrypt } from 'jose';
import { env } from '$env/dynamic/private';

export interface Session {
	userId: string;
	email: string;
	expiresAt: number;
}

function getKey(): Uint8Array {
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('SESSION_SECRET env var must be at least 32 characters');
	}
	return new TextEncoder().encode(secret.slice(0, 32));
}

export async function encryptSession(session: Session): Promise<string> {
	return new EncryptJWT(session as unknown as Record<string, unknown>)
		.setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
		.setIssuedAt()
		.setExpirationTime('7d')
		.encrypt(getKey());
}

export async function decryptSession(token: string): Promise<Session> {
	const { payload } = await jwtDecrypt(token, getKey());
	return payload as unknown as Session;
}
```

**Step 2: Type check**

```bash
npm run check
```

**Step 3: Commit**

```bash
git add src/lib/auth/session.ts
git commit -m "feat(auth): add session encrypt/decrypt helpers (jose JWE)"
```

---

## Task 6: Create OIDC utilities

**Files:**
- Create: `src/lib/auth/oidc.ts`

**Step 1: Write the file**

```typescript
// src/lib/auth/oidc.ts
import * as oauth from 'oauth4webapi';
import { env } from '$env/dynamic/private';

export function getOidcClient(): oauth.Client {
	return { client_id: env.AUTHENTIK_CLIENT_ID };
}

export async function getAuthorizationServer(): Promise<oauth.AuthorizationServer> {
	const issuer = new URL(env.AUTHENTIK_ISSUER_URL);
	const discoveryResponse = await oauth.discoveryRequest(issuer);
	return oauth.processDiscoveryResponse(issuer, discoveryResponse);
}

export function getRedirectUri(): string {
	return `${env.PUBLIC_BASE_URL}/auth/callback`;
}
```

**Step 2: Type check**

```bash
npm run check
```

**Step 3: Commit**

```bash
git add src/lib/auth/oidc.ts
git commit -m "feat(auth): add OIDC client/server discovery helpers"
```

---

## Task 7: Add login route

**Files:**
- Create: `src/routes/auth/login/+server.ts`

**Step 1: Write the file**

```typescript
// src/routes/auth/login/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';
import { encryptSession } from '$lib/auth/session';
import { getOidcClient, getAuthorizationServer, getRedirectUri } from '$lib/auth/oidc';
import { env } from '$env/dynamic/private';

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
```

**Step 2: Type check**

```bash
npm run check
```

**Step 3: Commit**

```bash
git add src/routes/auth/login/+server.ts
git commit -m "feat(auth): add OIDC login route (PKCE redirect)"
```

---

## Task 8: Add callback route

**Files:**
- Create: `src/routes/auth/callback/+server.ts`

**Step 1: Write the file**

```typescript
// src/routes/auth/callback/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';
import { encryptSession, decryptSession } from '$lib/auth/session';
import { getOidcClient, getAuthorizationServer, getRedirectUri } from '$lib/auth/oidc';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ url, cookies }) => {
	// Retrieve and validate PKCE cookie
	const pkceToken = cookies.get('doable_pkce');
	if (!pkceToken) {
		return Response.redirect('/', 302);
	}

	let pkcePayload: { codeVerifier: string; state: string; next: string };
	try {
		const pkceSession = await decryptSession(pkceToken);
		pkcePayload = JSON.parse(pkceSession.userId);
	} catch {
		cookies.delete('doable_pkce', { path: '/auth/callback' });
		return Response.redirect('/auth/login', 302);
	}
	cookies.delete('doable_pkce', { path: '/auth/callback' });

	const as = await getAuthorizationServer();
	const client = getOidcClient();

	// Validate state and extract code
	const params = oauth.validateAuthResponse(as, client, url.searchParams, pkcePayload.state);
	if (oauth.isOAuth2Error(params)) {
		console.error('[auth] OAuth2 error:', params);
		return Response.redirect('/auth/login', 302);
	}

	// Exchange code for tokens
	const tokenResponse = await oauth.authorizationCodeGrantRequest(
		as,
		client,
		{ client_secret: env.AUTHENTIK_CLIENT_SECRET },
		params,
		getRedirectUri(),
		pkcePayload.codeVerifier
	);

	const result = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse);
	if (oauth.isOAuth2Error(result)) {
		console.error('[auth] Token exchange error:', result);
		return Response.redirect('/auth/login', 302);
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
	return Response.redirect(`${env.PUBLIC_BASE_URL}${safePath}`, 302);
};
```

**Step 2: Type check**

```bash
npm run check
```

**Step 3: Commit**

```bash
git add src/routes/auth/callback/+server.ts
git commit -m "feat(auth): add OIDC callback route (code exchange, session cookie)"
```

---

## Task 9: Add logout route

**Files:**
- Create: `src/routes/auth/logout/+server.ts`

**Step 1: Write the file**

```typescript
// src/routes/auth/logout/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete('doable_session', { path: '/' });
	// Redirect to Authentik end-session endpoint to clear SSO session
	const endSessionUrl = new URL(`${env.AUTHENTIK_ISSUER_URL}end-session/`);
	endSessionUrl.searchParams.set('post_logout_redirect_uri', env.PUBLIC_BASE_URL);
	return Response.redirect(endSessionUrl.toString(), 302);
};
```

**Step 2: Type check**

```bash
npm run check
```

**Step 3: Commit**

```bash
git add src/routes/auth/logout/+server.ts
git commit -m "feat(auth): add logout route (clear session + Authentik end-session)"
```

---

## Task 10: Update hooks.server.ts — session validation

**Files:**
- Modify: `src/hooks.server.ts`

Current file only does OTEL metrics. Add session validation before the existing logic.

**Step 1: Read the current file**

```bash
cat /var/lib/claude-worker/projects/doable/src/hooks.server.ts
```

**Step 2: Replace with the new version**

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { getMeter } from '$lib/server/otel';
import { decryptSession } from '$lib/auth/session';

// Initialize meter (and OTEL provider) at module load time
const meter = getMeter();

const requestDuration = meter.createHistogram('doable_http_server_duration_seconds', {
  description: 'Duration of incoming HTTP requests to the doable SvelteKit server',
  unit: 's',
});

// Paths that do NOT require a valid session
const PUBLIC_PATHS = ['/auth/login', '/auth/callback'];

export const handle: Handle = async ({ event, resolve }) => {
  const start = performance.now();
  let status = 'error';

  // --- Session validation ---
  event.locals.userId = null;
  event.locals.email = null;

  const sessionCookie = event.cookies.get('doable_session');
  if (sessionCookie) {
    try {
      const session = await decryptSession(sessionCookie);
      if (session.expiresAt > Date.now()) {
        event.locals.userId = session.userId;
        event.locals.email = session.email;
      }
    } catch {
      // Invalid/expired — clear it
      event.cookies.delete('doable_session', { path: '/' });
    }
  }

  const isPublicPath = PUBLIC_PATHS.some(p => event.url.pathname.startsWith(p));

  if (!event.locals.userId && !isPublicPath) {
    const next = encodeURIComponent(event.url.pathname + event.url.search);
    return Response.redirect(`${event.url.origin}/auth/login?next=${next}`, 302);
  }
  // --- End session validation ---

  try {
    const response = await resolve(event);
    status = String(response.status);
    return response;
  } finally {
    requestDuration.record((performance.now() - start) / 1000, {
      method: event.request.method,
      route: event.route.id ?? 'unknown',
      status,
    });
  }
};
```

**Step 3: Type check**

```bash
npm run check
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(auth): protect all routes via session cookie in hooks.server.ts"
```

---

## Task 11: Inject auth headers into all proxy routes

The existing proxy routes at `src/routes/api/proxy/workspaces/` call workstation-api without auth. Each file needs `Authorization: Bearer <key>` and `X-User-ID: <userId>` injected.

**Files to modify:**
- `src/routes/api/proxy/workspaces/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/events/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/goals/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/goals/stream/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/heartbeat/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/preview-status/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/deployed-url/+server.ts`

Also fix the page server that calls workstation-api directly:
- `src/routes/projects/[name]/+page.server.ts`

**Step 1: Read and understand current proxy pattern**

```bash
cat src/routes/api/proxy/workspaces/+server.ts
```

**Step 2: Update `src/routes/api/proxy/workspaces/+server.ts`**

Add auth headers to every `fetch` call. Pattern:

```typescript
import type { RequestHandler } from '@sveltejs/kit';
import { getMeter } from '$lib/server/otel';
import { env } from '$env/dynamic/private';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

const meter = getMeter();
const wsCreateDuration = meter.createHistogram('doable_workspace_create_duration_seconds', {
  description: 'Latency of workstation-api workspace creation calls from doable server',
  unit: 's',
});
const wsCreateTotal = meter.createCounter('doable_workspace_create_total', {
  description: 'Total workspace creation requests',
});

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const res = await fetch(`${API}/api/v1/workspaces`, {
      headers: authHeaders(locals.userId),
    });
    const body = await res.json();
    const data = Array.isArray(body) ? body : (body.workspaces ?? []);
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspaces list fetch failed:', err);
    return new Response(JSON.stringify([]), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const t0 = performance.now();
  let result = 'error';
  try {
    const body = await request.json();
    const res = await fetch(`${API}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(locals.userId) },
      body: JSON.stringify(body)
    });
    result = res.ok ? 'success' : 'error';
    wsCreateTotal.add(1, { result });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[proxy] workspace create failed:', err);
    wsCreateTotal.add(1, { result: 'error' });
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    wsCreateDuration.record((performance.now() - t0) / 1000);
  }
};
```

**Step 3: Update `src/routes/api/proxy/workspaces/[name]/+server.ts`**

```typescript
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';

function authHeaders(userId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.WORKSTATION_API_KEY}`,
  };
  if (userId) headers['X-User-ID'] = userId;
  return headers;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}`, {
      headers: authHeaders(locals.userId),
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(`[proxy] workspace fetch failed for ${params.name}:`, err);
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  try {
    const res = await fetch(`${API}/api/v1/workspaces/${params.name}`, {
      method: 'DELETE',
      headers: authHeaders(locals.userId),
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    console.error(`[proxy] workspace delete failed for ${params.name}:`, err);
    return new Response(JSON.stringify({ error: 'workspace API unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

**Step 4: Apply the same authHeaders pattern to all remaining proxy routes**

For each remaining proxy file, read the current content and add:
1. `import { env } from '$env/dynamic/private';`
2. The `authHeaders(userId: string | null)` helper function (same as above)
3. Pass `locals.userId` to each `fetch` call via `headers: authHeaders(locals.userId)`

Do this for:
- `src/routes/api/proxy/workspaces/[name]/events/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/goals/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/goals/stream/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/heartbeat/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/preview-status/+server.ts`
- `src/routes/api/proxy/workspaces/[name]/deployed-url/+server.ts`

Note: the preview route (`preview/[...path]/+server.ts`) proxies to the VM directly (not workstation-api) — skip that one.

**Step 5: Fix `src/routes/projects/[name]/+page.server.ts`**

This calls workstation-api directly without auth. Add a user check:

```typescript
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
```

**Step 6: Type check**

```bash
npm run check
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src/routes/
git commit -m "feat(auth): inject Authorization + X-User-ID into all proxy routes"
```

---

## Task 12: Add logout button to UI

The landing page (`+page.svelte`) and workspace view need a logout link so users can sign out.

**Step 1: Read the current layout**

```bash
cat src/routes/+layout.svelte
```

**Step 2: Add logout form to `+layout.svelte`**

Add a logout form using SvelteKit enhance. Find a sensible location (e.g. top-right corner). Use a `<form method="post" action="/auth/logout">` with a submit button.

The exact UI placement depends on the current layout. Read the file first and add it in a way that fits the existing design — a small "Sign out" link in the top-right is sufficient. Example:

```svelte
<form method="post" action="/auth/logout" style="position:fixed;top:1rem;right:1rem;z-index:100">
  <button type="submit" style="font-size:0.75rem;opacity:0.6;cursor:pointer;background:none;border:none;color:inherit">
    Sign out
  </button>
</form>
```

**Step 3: Type check and commit**

```bash
npm run check
git add src/routes/+layout.svelte
git commit -m "feat(auth): add logout button to layout"
```

---

## Task 13: workstation-api — add owner annotation support

**Files:**
- Modify: `src/handlers.rs`

**Step 1: Read the relevant sections**

```bash
sed -n '1,50p' src/handlers.rs    # imports and constants
sed -n '559,580p' src/handlers.rs # list_workspaces signature
sed -n '594,610p' src/handlers.rs # get_workspace signature
grep -n "pub async fn" src/handlers.rs  # all handler locations
```

**Step 2: Add OWNER_ID_ANNOTATION constant**

After the existing `DISPLAY_NAME_ANNOTATION` constant (line ~29), add:

```rust
/// Annotation key for the user who owns this `WorkspaceClaim`.
const OWNER_ID_ANNOTATION: &str = "doable.sammasak.dev/owner-id";
```

**Step 3: Add extract_user_id helper**

After the `validate_idle_halt_after_minutes` function, add:

```rust
/// Extract the `X-User-ID` header value, if present.
fn extract_user_id(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Check whether the calling user owns the given workspace.
/// Returns `Ok(())` if `user_id` is `None` (ops call), or if annotation matches.
/// Returns `Err(ApiError::Forbidden)` if annotation is set to a different user.
fn check_ownership(wsc: &WorkspaceClaim, user_id: &Option<String>) -> Result<(), ApiError> {
    let Some(uid) = user_id else {
        return Ok(()); // no user context = ops/internal call, allow all
    };
    let owner = wsc
        .metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get(OWNER_ID_ANNOTATION))
        .map(|s| s.as_str());
    match owner {
        Some(o) if o == uid => Ok(()),
        Some(_) => Err(ApiError::Forbidden),
        None => Err(ApiError::Forbidden), // owned by nobody = deny user access
    }
}
```

**Step 4: Add Forbidden variant to ApiError**

Read `src/error.rs` and add `Forbidden` variant:

```rust
// In src/error.rs, add to ApiError enum:
Forbidden,

// In the IntoResponse impl for ApiError:
ApiError::Forbidden => (
    StatusCode::FORBIDDEN,
    Json(json!({"error": "forbidden", "message": "you do not own this workspace"})),
)
    .into_response(),
```

Also add `utoipa::ToSchema` impl if the file uses utoipa — check existing pattern and follow it.

**Step 5: Modify list_workspaces to accept headers and filter by user**

Change signature to accept `HeaderMap` and filter:

```rust
pub async fn list_workspaces(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<WorkspaceListResponse>, ApiError> {
    let user_id = extract_user_id(&headers);
    let api: Api<WorkspaceClaim> = Api::namespaced(state.client.clone(), &state.namespace);
    let claims = api
        .list(&ListParams::default())
        .await
        .map_err(|e| kube_err("list", e))?;

    let mut responses: Vec<WorkspaceResponse> = claims
        .items
        .iter()
        .filter(|w| !w.spec.pool)
        .filter(|w| {
            if let Some(ref uid) = user_id {
                w.metadata
                    .annotations
                    .as_ref()
                    .and_then(|a| a.get(OWNER_ID_ANNOTATION))
                    .map(|owner| owner == uid)
                    .unwrap_or(false)
            } else {
                true // no X-User-ID = ops call, show all
            }
        })
        .map(claim_to_response)
        .collect();

    enrich_all_with_vmi(&state.client, &state.namespace, &mut responses).await;
    Ok(Json(WorkspaceListResponse {
        workspaces: responses,
    }))
}
```

**Step 6: Modify get_workspace to check ownership**

Add `HeaderMap` parameter and `check_ownership` call after the pool guard:

```rust
pub async fn get_workspace(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    validate_k8s_name(&name)?;
    let user_id = extract_user_id(&headers);
    let api: Api<WorkspaceClaim> = Api::namespaced(state.client.clone(), &state.namespace);
    let wsc = api.get(&name).await.map_err(|e| kube_err(&name, e))?;

    if wsc.spec.pool {
        return Err(ApiError::NotFound(format!("workspace '{name}' not found")));
    }

    check_ownership(&wsc, &user_id)?;

    let mut resp = claim_to_response(&wsc);
    if let Some(details) = get_vmi_details(&state.client, &state.namespace, &name).await {
        enrich_response_with_vmi(&mut resp, &details);
    }
    Ok(Json(resp))
}
```

**Step 7: Modify create_workspace to store owner annotation**

Find `create_workspace` (around line 1134). After the workspace CRD is created, patch the owner annotation alongside the display-name annotation. Look for the section around line 1429 where `display-name` is patched, and add owner:

```rust
// Add this constant near the display-name patch block:
// After creating the workspace, patch owner annotation
if let Some(ref uid) = extract_user_id(&headers) {
    let owner_patch = json!({
        "metadata": {
            "annotations": {
                OWNER_ID_ANNOTATION: uid
            }
        }
    });
    if let Err(e) = api
        .patch(&name, &PatchParams::default(), &Patch::Merge(&owner_patch))
        .await
    {
        warn!(workspace = %name, error = %e, "failed to patch owner annotation (non-fatal)");
    }
}
```

Also add `headers: axum::http::HeaderMap` to the `create_workspace` function signature. Read the full function first to find the right insertion point.

**Step 8: Modify mutation handlers (delete, patch, start, stop, restart, heartbeat)**

For each of: `delete_workspace`, `patch_workspace`, `start_workspace`, `stop_workspace`, `restart_workspace`, `heartbeat_workspace`:

1. Add `headers: axum::http::HeaderMap` to the function signature
2. At the start, extract `user_id` and call `check_ownership` after fetching the workspace

Follow the same pattern as `get_workspace` above. Read each function first before modifying.

**Step 9: Update router in lib.rs if needed**

Axum auto-extracts `HeaderMap` from handlers — no router changes needed. Verify by checking that the existing handler signatures already use `State`, `Path`, etc. and that axum's extractor system handles `HeaderMap` addition correctly.

**Step 10: Build inside Docker to verify**

```bash
cd /var/lib/claude-worker/projects/workstation-api
buildah build --isolation=chroot -t workstation-api-test .
```

Expected: build completes without errors. This may take 5–10 minutes (Rust musl compile).

If build fails due to compile errors, fix them before proceeding. Read error messages carefully — they will point to the exact line.

**Step 11: Run existing tests**

```bash
# If there's a nix develop shell, run tests inside it
# Otherwise tests run inside the Dockerfile build
grep -r "cargo test" Justfile 2>/dev/null || echo "no test target in Justfile"
```

**Step 12: Commit**

```bash
git add src/
git commit -m "feat(auth): add owner annotation on workspace create, filter/guard by X-User-ID"
```

---

## Task 14: Build and push both images

**Step 1: Build and push workstation-api**

```bash
cd /var/lib/claude-worker/projects/workstation-api
buildah build --isolation=chroot -t workstation-api:latest .
buildah push --authfile /var/lib/claude-worker/.config/containers/auth.json \
  workstation-api:latest docker://registry.sammasak.dev/workstations/workstation-api:latest
```

**Step 2: Build and push doable**

```bash
cd /var/lib/claude-worker/projects/doable
npm run build
buildah build --isolation=chroot -t doable-ui:latest .
buildah push --authfile /var/lib/claude-worker/.config/containers/auth.json \
  doable-ui:latest docker://registry.sammasak.dev/lab/doable-ui:latest
```

Check the Dockerfile exists in the doable repo:
```bash
cat Dockerfile
```
If no Dockerfile exists, create one following the existing pattern from the container image (adapter-node SvelteKit):
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["node", "build"]
```

---

## Task 15: Push homelab-gitops and reconcile

**Step 1: Pull latest before pushing**

```bash
cd /var/lib/claude-worker/projects/homelab-gitops
git pull --rebase origin main
```

**Step 2: Push**

```bash
git push origin main
```

**Step 3: Reconcile Flux**

```bash
flux reconcile kustomization flux-system --with-source
# Wait for doable and workstations kustomizations
flux reconcile kustomization apps --with-source
```

**Step 4: Restart deployments to pick up new images and secrets**

```bash
kubectl rollout restart deployment/doable -n doable
kubectl rollout restart deployment/workstation-api -n workstations
kubectl rollout status deployment/doable -n doable --timeout=120s
kubectl rollout status deployment/workstation-api -n workstations --timeout=120s
```

**Step 5: Verify pods are running**

```bash
kubectl get pods -n doable
kubectl get pods -n workstations -l app=workstation-api
```

---

## Task 16: End-to-end verification

**Step 1: Test that unauthenticated access redirects to Authentik**

```bash
curl -sI https://doable.sammasak.dev | head -5
```

Expected: `302` redirect to `https://auth.sammasak.dev/...` (not 200).

**Step 2: Test Authentik OIDC discovery**

```bash
curl -sf "https://auth.sammasak.dev/application/o/doable/.well-known/openid-configuration" | jq '{issuer, authorization_endpoint}'
```

Expected: valid OIDC configuration JSON.

**Step 3: Test workstation-api rejects requests without API key**

```bash
curl -sf https://workstations-api.sammasak.dev/api/v1/workspaces
```

Expected: `401 Unauthorized` (now that WORKSTATION_API_KEY is set).

**Step 4: Test workstation-api accepts requests with API key**

```bash
WS_KEY=$(kubectl get secret workstation-api-key -n workstations -o jsonpath='{.data.WORKSTATION_API_KEY}' | base64 -d)
curl -sf -H "Authorization: Bearer $WS_KEY" https://workstations-api.sammasak.dev/api/v1/workspaces | jq .
```

Expected: 200 with workspace list (may be empty).

**Step 5: Use verify-deployment sub-agent**

```
Use the verify-deployment agent to check that doable in namespace doable is healthy and https://doable.sammasak.dev returns HTTP 302 (redirect to auth).
```

---

## Task 17: Push source code to GitHub

```bash
cd /var/lib/claude-worker/projects/doable
git push origin main

cd /var/lib/claude-worker/projects/workstation-api
git push origin main
```

Verify pushes succeeded:
```bash
gh repo view sammasak/doable --json pushedAt
gh repo view sammasak/workstation-api --json pushedAt
```

---

## Notes on oauth4webapi API compatibility

The `oauth4webapi` API may differ slightly depending on the installed version. If type errors appear:

1. Check the installed version: `cat node_modules/oauth4webapi/package.json | jq .version`
2. Check the API: `cat node_modules/oauth4webapi/dist/index.d.ts | head -100`
3. The key patterns to look for: `discoveryRequest`, `processDiscoveryResponse`, `generateRandomCodeVerifier`, `calculatePKCECodeChallenge`, `generateRandomState`, `validateAuthResponse`, `authorizationCodeGrantRequest`, `processAuthorizationCodeResponse`, `getValidatedIdTokenClaims`
4. Adapt the call sites in `src/routes/auth/login/+server.ts` and `src/routes/auth/callback/+server.ts` to match the actual installed API

If `processAuthorizationCodeResponse` requires different arguments in your version, consult the package's README or source:
```bash
cat node_modules/oauth4webapi/README.md | head -200
```
