/**
 * Report delivery.
 *
 * Two doors, both candidate-facing and neither linked to the admin console:
 *   /api/report/:reportToken       — the tokenised link sent by email
 *   /api/report/by-link/:linkToken — the candidate's own personal invite link
 *
 * Both return the identical payload, so the HTML report page and the PDF are
 * always rendering the same numbers.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import { getBranding } from '../lib/settings.js';
import { hashToken, looksLikeToken } from '../lib/tokens.js';
import {
  REPORT_SELECT as SELECT_REPORT,
  renderStoredReportPdf,
  toPayload,
  type ReportRow,
} from '../lib/report-render.js';

export const reportRoutes = new Hono<{ Bindings: Env }>();

async function byReportToken(env: Env, token: string): Promise<ReportRow | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  return env.DB.prepare(`${SELECT_REPORT} WHERE rp.token_hash = ?1`).bind(hash).first<ReportRow>();
}

/** Resolves through an active personal link to that candidate's own report. */
async function byLinkToken(env: Env, token: string): Promise<ReportRow | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  return env.DB
    .prepare(
      `${SELECT_REPORT}
        JOIN links l ON l.assessment_id = r.assessment_id AND l.candidate_id = r.candidate_id
       WHERE l.token_hash = ?1 AND l.kind = 'personal' AND l.active = 1`,
    )
    .bind(hash)
    .first<ReportRow>();
}

reportRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `rpt:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byReportToken(c.env, token);
  if (!row) return c.json({ error: 'This report link was not recognised.' }, 404);

  return c.json(toPayload(row, token, await getBranding(c.env)));
});

reportRoutes.get('/by-link/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `rptl:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byLinkToken(c.env, token);
  if (!row) return c.json({ error: 'No report is available for this link yet.' }, 404);

  // The report token is not recoverable from its hash; the candidate reading
  // through their own link does not need it, so it is reported as empty.
  return c.json(toPayload(row, '', await getBranding(c.env)));
});

/**
 * Renders the PDF on request rather than serving the copy taken at completion.
 *
 * The stored copy is a snapshot of the branding, the logo and the layout as
 * they stood the moment the candidate finished, and nothing ever refreshes it —
 * so a logo upload or a fix to the report reached new candidates only, and
 * every report already issued kept the old artwork for good. Rendering here
 * costs a few tens of milliseconds per download and removes that whole class of
 * staleness: there is one renderer, and every report goes through it.
 */
async function pdfResponse(c: Context<{ Bindings: Env }>, row: ReportRow | null): Promise<Response> {
  if (!row) return c.json({ error: 'Report not found.' }, 404);

  const bytes = await renderStoredReportPdf(row, await getBranding(c.env));

  const name = `${row.first_name}-${row.last_name}-report`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}

reportRoutes.get('/:token/pdf', async (c) => pdfResponse(c, await byReportToken(c.env, c.req.param('token'))));

reportRoutes.get('/by-link/:token/pdf', async (c) =>
  pdfResponse(c, await byLinkToken(c.env, c.req.param('token'))),
);
