/**
 * The logo, as a file rather than as forty-five kilobytes of JSON.
 *
 * Branding is stored as a data URL because that is what the upload produces and
 * what the PDF writer consumes. Sending it inside every API response was the
 * expensive part: the candidate's session payload was 49KB, of which 45KB was
 * the same base64 string every single time — on every load, every resume, and
 * (since the session watch) every minute a tab stays open.
 *
 * So client-facing payloads carry a URL instead. The bytes are served once from
 * `/api/branding/logo`, cached for a year, and versioned by a hash of the data
 * URL itself, so uploading a new logo changes the URL and every browser picks it
 * up without anything being purged. Server-side rendering still reads the data
 * URL directly; nothing about the PDF path changes.
 */

import type { Env } from '../env.js';
import type { Branding } from '../../shared/types.js';
import { getBranding } from './settings.js';

/** FNV-1a, 32-bit. Short, stable, and not a security boundary. */
export function logoVersion(dataUrl: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < dataUrl.length; i += 1) {
    h ^= dataUrl.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const LOGO_PATH = '/api/branding/logo';

/**
 * The branding a browser should receive: same shape, with the logo as a URL.
 *
 * `logoDataUrl` keeps its name deliberately. Every surface that renders it does
 * `<img src={branding.logoDataUrl}>`, and a URL is what an `img` wanted all
 * along — renaming the field would touch six components to say the same thing.
 */
export function brandingForClient(branding: Branding): Branding {
  if (!branding.logoDataUrl.startsWith('data:')) return branding;
  return { ...branding, logoDataUrl: `${LOGO_PATH}?v=${logoVersion(branding.logoDataUrl)}` };
}

const TYPE = /^data:([^;,]+)[;,]/;

/**
 * Serves the stored logo.
 *
 * Immutable for a year: the URL carries the content's own hash, so a cached
 * copy can never be the wrong one. A request without the version still works —
 * it is simply revalidated rather than trusted forever.
 */
export async function logoResponse(env: Env, req: Request): Promise<Response> {
  const branding = await getBranding(env);
  const dataUrl = branding.logoDataUrl;
  const version = logoVersion(dataUrl);
  const etag = `"${version}"`;

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Response('No logo', { status: 404 });

  const meta = dataUrl.slice(0, comma);
  const type = TYPE.exec(dataUrl)?.[1] ?? 'image/png';
  const body = dataUrl.slice(comma + 1);

  let bytes: BodyInit;
  if (meta.includes(';base64')) {
    const binary = atob(body);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    bytes = out;
  } else {
    bytes = decodeURIComponent(body);
  }

  const versioned = new URL(req.url).searchParams.get('v') === version;
  return new Response(bytes, {
    headers: {
      'content-type': type,
      etag,
      'cache-control': versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300, must-revalidate',
    },
  });
}
