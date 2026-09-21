/**
 * Report delivery.
 *
 * Two doors, both candidate-facing and neither linked to the admin console:
 *   /api/report/:reportToken       — the tokenised link sent by email
 *   /api/report/by-link/:linkToken — the candidate's own personal invite link
 *
 * Both return the identical payload, so the HTML report page and the PDF are
 * always rendering the same numbers.
 *
 * A cohort instrument has a third door, /api/report/cohort/:token. Its reports
 * are not facts about one response — there is a group report and one report per
 * rated member — so they carry their own payload union and their own renderer,
 * and they are matched before the per-response routes so that `cohort` is never
 * mistaken for a report token.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import { getBranding } from '../lib/settings.js';
import { decodeImageDataUrl } from '../pdf/image.js';
import { renderCollabSheetPdf, type CollabSheetPayload } from '../pdf/collab-onepager.js';
import { brandingForClient } from '../lib/brand-asset.js';
import { hashToken, looksLikeToken } from '../lib/tokens.js';
import {
  REPORT_SELECT as SELECT_REPORT,
  renderStoredReportPdf,
  toPayload,
  type ReportRow,
} from '../lib/report-render.js';
import {
  COHORT_REPORT_SELECT,
  cohortPdfName,
  renderStoredCohortPdf,
  toCohortPayload,
  type CohortReportRow,
} from '../lib/cohort-report-render.js';

export const reportRoutes = new Hono<{ Bindings: Env }>();

/**
 * A Collaboration Diagnostic participant's own sheet.
 *
 * Its own door, deliberately. The two self-rating instruments and sociometry
 * resolve a token to a stored `scores_json` and render it through shared
 * machinery that knows those payload shapes; a diagnostic sheet is neither a
 * score nor a cohort report, and threading a fourth shape through that code
 * would put a new instrument in the path of the instruments already serving
 * clients. This route stores its own bytes and serves them.
 */
reportRoutes.get('/collab-sheet/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `sheet:${clientKey(c.req.raw)}`, 60, 300);
  if (!rl.allowed) return c.text('Too many requests. Try again shortly.', 429);
  if (!looksLikeToken(token)) return c.text('This link was not recognised.', 404);

  const hash = await hashToken(token, c.env.LINK_TOKEN_SECRET);
  const row = await c.env.DB.prepare(
    `SELECT s.sheet_json, co.organisation, co.name
       FROM collab_participant_sheets s
       JOIN cohorts co ON co.id = s.cohort_id
      WHERE s.token_hash = ?1`,
  )
    .bind(hash)
    .first<{ sheet_json: string; organisation: string; name: string }>();

  if (!row) return c.text('This link was not recognised.', 404);

  let figures: Omit<CollabSheetPayload, 'branding'>;
  try {
    figures = JSON.parse(row.sheet_json) as Omit<CollabSheetPayload, 'branding'>;
  } catch {
    return c.text('This sheet could not be read.', 500);
  }

  // Rendered on request from the stored figures, the way every other report
  // here works: branding is current, and a layout fix reaches sheets already
  // sent.
  const branding = await getBranding(c.env);
  const pdf = renderCollabSheetPdf(
    { ...figures, branding },
    await decodeImageDataUrl(branding.logoDataUrl),
  );

  await c.env.DB.prepare(
    `UPDATE collab_participant_sheets SET sent_at = COALESCE(sent_at, datetime('now')) WHERE token_hash = ?1`,
  )
    .bind(hash)
    .run();

  const slug = (row.organisation || row.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${slug || 'your'}-answers.pdf"`,
    },
  });
});

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

// ------------------------------------------------------------ cohort reports
//
// Declared before '/:token' so the literal segment wins the match.

async function byCohortToken(env: Env, token: string): Promise<CohortReportRow | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  return env.DB.prepare(`${COHORT_REPORT_SELECT} WHERE cr.token_hash = ?1`)
    .bind(hash)
    .first<CohortReportRow>();
}

reportRoutes.get('/cohort/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `crpt:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byCohortToken(c.env, token);
  if (!row) return c.json({ error: 'This report link was not recognised.' }, 404);

  return c.json(toCohortPayload(row, token, brandingForClient(await getBranding(c.env))));
});

reportRoutes.get('/cohort/:token/pdf', async (c) => {
  const rl = await rateLimit(c.env, `crptpdf:${clientKey(c.req.raw)}`, 60, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byCohortToken(c.env, c.req.param('token'));
  if (!row) return c.json({ error: 'Report not found.' }, 404);

  const bytes = await renderStoredCohortPdf(row, await getBranding(c.env));
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${cohortPdfName(row)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
});

// ----------------------------------------------------- per-response reports

reportRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `rpt:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byReportToken(c.env, token);
  if (!row) return c.json({ error: 'This report link was not recognised.' }, 404);

  return c.json(toPayload(row, token, brandingForClient(await getBranding(c.env))));
});

reportRoutes.get('/by-link/:token', async (c) => {
  const token = c.req.param('token');
  const rl = await rateLimit(c.env, `rptl:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const row = await byLinkToken(c.env, token);
  if (!row) return c.json({ error: 'No report is available for this link yet.' }, 404);

  // The report token is not recoverable from its hash; the candidate reading
  // through their own link does not need it, so it is reported as empty.
  return c.json(toPayload(row, '', brandingForClient(await getBranding(c.env))));
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
