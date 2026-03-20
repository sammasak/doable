// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { getMeter } from '$lib/server/otel';

// Initialize meter (and OTEL provider) at module load time
const meter = getMeter();

const requestDuration = meter.createHistogram('doable_http_server_duration_seconds', {
  description: 'Duration of incoming HTTP requests to the doable SvelteKit server',
  unit: 's',
});

export const handle: Handle = async ({ event, resolve }) => {
  const start = performance.now();
  const response = await resolve(event);
  const duration = (performance.now() - start) / 1000;

  requestDuration.record(duration, {
    method: event.request.method,
    route: event.route.id ?? 'unknown',
    status: String(response.status),
  });

  return response;
};
