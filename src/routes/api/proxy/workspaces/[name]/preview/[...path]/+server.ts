import type { RequestHandler } from '@sveltejs/kit';

const WORKSTATION_API = process.env.WORKSTATION_API_URL || 'https://workstations-api.sammasak.dev';
const PREVIEW_PORT = 8080;

async function resolveIP(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${WORKSTATION_API}/api/v1/workspaces/${name}`);
    if (!res.ok) return null;
    const ws = await res.json();
    return ws.ipAddress ?? null;
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ params, url }) => {
  if (!params.name) return new Response('Bad request', { status: 400 });
  const ip = await resolveIP(params.name);
  if (!ip) return new Response('VM not ready', { status: 503 });

  const path = params.path ? `/${params.path}` : '/';
  const query = url.search;
  const target = `http://${ip}:${PREVIEW_PORT}${path}${query}`;

  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(3000) });

    const contentType = res.headers.get('content-type') ?? '';
    const headers = new Headers();
    const forwardHeaders = ['content-type', 'cache-control', 'etag', 'last-modified'];
    for (const h of forwardHeaders) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }

    // For HTML responses, inject a <base> tag so relative links resolve correctly
    // through the proxy path (the trailing-slash redirect strips the slash, so without
    // a base tag, relative URLs like "shared.css" resolve one level too high).
    if (contentType.includes('text/html')) {
      const text = await res.text();
      const basePath = `/api/proxy/workspaces/${params.name}/preview/`;
      const withBase = text.replace(/<head([^>]*)>/i, `<head$1><base href="${basePath}">`);
      return new Response(withBase, { status: res.status, headers });
    }

    return new Response(res.body, { status: res.status, headers });
  } catch {
    return new Response('Preview not available', { status: 503 });
  }
};
