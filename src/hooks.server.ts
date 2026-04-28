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
