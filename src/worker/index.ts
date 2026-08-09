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
