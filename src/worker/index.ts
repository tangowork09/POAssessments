/**
 * Worker entrypoint. One deploy serves the API and both frontend shells.
 *
 * Route separation is enforced here, in the only place that maps URLs to HTML:
 *
 *   /admin, /admin/*        → admin.html   (the console shell, and only it)
 *   /t/:token, /r/:token,
 *   /c/:token, /           → index.html   (the candidate shell, and only it)
 *
 * The two shells are separate Vite entry points with no shared layout, so an
 * admin affordance cannot appear on a candidate page by accident.
 */

import { Hono } from 'hono';
import type { Env, PipelineMessage } from './env.js';
import { adminRoutes } from './routes/admin.js';
import { candidateRoutes } from './routes/candidate.js';
import { LOGO_PATH, logoResponse } from './lib/brand-asset.js';
import { cohortRoutes } from './routes/cohorts.js';
import { collabRunRoutes } from './routes/collab-runs.js';
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

// Mounted before the catch-all admin router so its own session gate runs.
app.route('/api/admin/cohorts', cohortRoutes);
// Diagnostic runs are cohorts underneath, and share nothing else — see routes/collab-runs.ts.
app.route('/api/admin/collab-runs', collabRunRoutes);
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
/**
 * A build asset's filename contains a hash of its contents, so its bytes can
 * never change. The assets binding still answers `max-age=0, must-revalidate`,
 * which costs every returning visitor a round trip per file before the page can
 * paint. Anything hashed is marked immutable; anything else (favicon, a logo in
 * /public) keeps a short cache and a revalidation.
 */
const HASHED = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp)$/;

function cacheAsset(pathname: string, res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(
    'cache-control',
    HASHED.test(pathname)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600, must-revalidate',
  );
  return new Response(res.body, { status: res.status, headers });
}

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
const RESERVED_PATHS = new Set(['admin', 't', 'r', 'c', 'api']);

async function resolveShortLink(env: Env, pathname: string): Promise<string | null> {
  const parts = pathname.slice(1).split('/').filter(Boolean);
  // Every real route in this app starts with one of these; skip the database
  // round trip on the common case instead of querying for a match that cannot
  // exist.
  if (parts.length === 0 || RESERVED_PATHS.has(parts[0]!)) return null;

  // Two segments is a cohort under the instrument that owns it —
  // `/sociometry/acme-leadership-2026`. The instrument segment is not
  // decoration: it is what keeps a client's group name out of the root
  // namespace, where it would compete with the instrument aliases and where a
  // reader could not tell from the link what kind of thing it opens.
  if (parts.length === 2) return await resolveCohortSlug(env, parts[0]!, parts[1]!);
  if (parts.length > 2) return null;

  const slug = parts[0]!;
  // `cohort_id IS NULL` is load-bearing, not tidiness. A cohort instrument has
  // one generic link *per cohort*, so without it this query matches every run
  // of that instrument and returns whichever row the database hands back first
  // — a short link that drops the reader into an arbitrary group. A cohort's
  // link is shared deliberately, by the facilitator, and has no short alias.
  const instrument = await env.DB.prepare(
    `SELECT l.token_plain AS token FROM links l
       JOIN assessments a ON a.id = l.assessment_id
      WHERE a.short_slug = ?1 AND a.status = 'live' AND a.slug_active = 1
        AND l.kind = 'generic' AND l.cohort_id IS NULL
        AND l.active = 1 AND l.token_plain IS NOT NULL`,
  )
    .bind(slug)
    .first<{ token: string }>();
  return instrument?.token ?? null;
}

/**
 * A cohort instrument has one open link per cohort, so the alias belongs to the
 * cohort rather than to the instrument: `/sociometry/acme-leadership-2026`. A
 * bare `/sociometry` deliberately resolves to nothing — the instrument lookup
 * above requires `links.cohort_id IS NULL`, and every link a cohort instrument
 * has belongs to a cohort, so there is no "the" generic link to hand back.
 *
 * A closed or draft cohort, or one whose alias has been switched off, resolves
 * to nothing as well, and falls through to the app's link-not-found page: an
 * alias that opened an exercise only to refuse the reader would be worse.
 */
async function resolveCohortSlug(
  env: Env,
  instrumentSlug: string,
  cohortSlug: string,
): Promise<string | null> {
  const cohort = await env.DB.prepare(
    `SELECT l.token_plain AS token FROM links l
       JOIN cohorts co ON co.id = l.cohort_id
       JOIN assessments a ON a.id = co.assessment_id
      WHERE a.short_slug = ?1 AND a.status = 'live' AND a.slug_active = 1
        AND co.short_slug = ?2 AND co.status = 'open' AND co.slug_active = 1
        AND l.kind = 'generic' AND l.active = 1 AND l.token_plain IS NOT NULL
        -- The alias belongs to the group and follows it from wave to wave: it
        -- always opens the round that is currently taking responses, so a
        -- facilitator can share one address and start a new round behind it.
        AND l.round_no = (SELECT rd.no FROM cohort_rounds rd
                           WHERE rd.cohort_id = co.id
                           ORDER BY (rd.closed_at IS NULL) DESC, rd.no DESC LIMIT 1)`,
  )
    .bind(instrumentSlug, cohortSlug)
    .first<{ token: string }>();
  return cohort?.token ?? null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Seeding is idempotent and short-circuits after the first call per isolate.
    ctx.waitUntil(bootstrap(env));

    const url = new URL(req.url);

    // Public, cacheable, and deliberately outside the Hono app: it answers
    // before auth, before rate limits, and before anything touches the request
    // body, because it is a static image every page in the product loads.
    if (url.pathname === LOGO_PATH) return logoResponse(env, req);

    if (url.pathname.startsWith('/api/')) {
      return app.fetch(req, env, ctx);
    }

    // Real files (hashed JS/CSS, favicon, images) come from the assets binding.
    if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
      const asset = await env.ASSETS.fetch(req);
      if (asset.status !== 404) return cacheAsset(url.pathname, asset);
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
