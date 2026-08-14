/**
 * Worker entrypoint. One deploy serves the API and both frontend shells.
 *
 * Route separation is enforced here, in the only place that maps URLs to HTML:
 *
 *   /admin, /admin/*        → admin.html   (the console shell, and only it)
 *   /t/:token, /r/:token, / → index.html   (the candidate shell, and only it)
 *
 * The two shells are separate Vite entry points with no shared layout, so an
 * admin affordance cannot appear on a candidate page by accident.
 */

import { Hono } from 'hono';
import type { Env, PipelineMessage } from './env.js';
import { adminRoutes } from './routes/admin.js';
import { candidateRoutes } from './routes/candidate.js';
import { reportRoutes } from './routes/report.js';
import { handleMessage } from './pipeline.js';
import { bootstrap } from './bootstrap.js';
import { pruneRateLimits } from './lib/ratelimit.js';
import { getBranding } from './lib/settings.js';

const app = new Hono<{ Bindings: Env }>();

// ------------------------------------------------------------------- security

app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('x-frame-options', 'DENY');
  h.set('permissions-policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
});

// API responses are per-session and must never be cached by an intermediary.
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('cache-control')) {
    c.res.headers.set('cache-control', 'private, no-store');
  }
});

app.route('/api/admin', adminRoutes);
app.route('/api/candidate', candidateRoutes);
app.route('/api/report', reportRoutes);

app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV }));

/**
 * The branding logo as a fetchable image, not a data URI. Gmail (and several
 * other clients) silently strip or refuse to render `data:` image sources in
 * HTML mail — the logo would render fine in a browser and fail only in a
 * candidate's inbox, which is exactly the shape of bug that is easy to ship
 * unnoticed. Every email links here instead of embedding the bytes; the
 * candidate header and the PDF are unaffected — the header is a normal
 * browser `<img>` (data URIs work there) and the PDF embeds the decoded bytes
 * directly as an image XObject.
 */
app.get('/api/logo', async (c) => {
  const branding = await getBranding(c.env);
  const match = /^data:([^;,]+)(?:;base64)?,(.+)$/.exec(branding.logoDataUrl);
  if (!match) return c.text('No logo set', 404);
  const [, mime, data] = match;
  const bytes = Uint8Array.from(atob(data!), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mime!,
      // Short enough that a branding change (upload or reset) is live within
      // minutes, long enough that an email client's own fetch isn't hammering
      // this on every open.
      'cache-control': 'public, max-age=300',
    },
  });
});

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }
  return serveShell(c.env, c.req.raw);
});

app.onError((err, c) => {
  console.error('[worker] unhandled', err);
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  }
  return c.text('Something went wrong.', 500);
});

// -------------------------------------------------------------- shell serving

const ADMIN_PREFIX = '/admin';

/**
 * Picks the shell for a document request. Static asset requests (anything with
 * a file extension) pass straight through to the assets binding.
 */
async function serveShell(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const isAdmin = path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`);
  const shell = isAdmin ? '/admin.html' : '/index.html';

  const res = await env.ASSETS.fetch(new Request(new URL(shell, url.origin), { headers: req.headers }));
  if (!res.ok) return res;

  const headers = new Headers(res.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  // The console must never be indexed, and neither must a tokenised link.
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('cache-control', 'no-cache');
  return new Response(res.body, { status: res.status, headers });
}

/**
 * `poassessments.com/influencing` rather than a 60-character token — short
 * enough to read aloud or paste into WhatsApp. Resolves fresh from
 * `links.token_plain` on every request rather than a token baked in at deploy
 * time, so reissuing the generic link in the admin console (a rotation)
 * doesn't quietly break every copy of the short link already shared.
 */
const RESERVED_PATHS = new Set(['admin', 't', 'r', 'api']);

async function resolveShortLink(env: Env, pathname: string): Promise<string | null> {
  const slug = pathname.slice(1);
  // Every real route in this app is one of these; skip the database round
  // trip on the common case instead of querying for a match that can't exist.
  if (!slug || slug.includes('/') || RESERVED_PATHS.has(slug.split('/')[0]!)) return null;
  const row = await env.DB.prepare(
    `SELECT l.token_plain AS token FROM links l
       JOIN assessments a ON a.id = l.assessment_id
      WHERE a.short_slug = ?1 AND a.status = 'live'
        AND l.kind = 'generic' AND l.active = 1 AND l.token_plain IS NOT NULL`,
  )
    .bind(slug)
    .first<{ token: string }>();
  return row?.token ?? null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Seeding is idempotent and short-circuits after the first call per isolate.
    ctx.waitUntil(bootstrap(env));

    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(req, env, ctx);
    }

    // Real files (hashed JS/CSS, favicon, images) come from the assets binding.
    if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
      const asset = await env.ASSETS.fetch(req);
      if (asset.status !== 404) return asset;
    }

    const shortToken = await resolveShortLink(env, url.pathname);
    if (shortToken) return Response.redirect(new URL(`/t/${shortToken}`, url).toString(), 302);

    if (Math.random() < 0.01) ctx.waitUntil(pruneRateLimits(env));

    return serveShell(env, req);
  },

  async queue(batch: MessageBatch<PipelineMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleMessage(env, message.body);
        message.ack();
      } catch (err) {
        console.error('[queue] message failed, will retry', message.body, err);
        message.retry();
      }
    }
  },
};
