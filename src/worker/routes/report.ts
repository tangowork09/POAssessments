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
import { reportFromScores } from '../lib/report.js';
import type { ScoreResult } from '../../shared/scoring.js';
import type { ReportPayload } from '../../shared/types.js';

export const reportRoutes = new Hono<{ Bindings: Env }>();

interface ReportRow {
  report_id: string;
  scores_json: string;
  pdf_bytes: number;
  completed_at: string | null;
  assessment_name: string;
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  age_band: string;
  experience_band: string;
  gender: string;
}

const SELECT_REPORT = `
  SELECT rp.id AS report_id, rp.scores_json, rp.pdf_bytes,
         r.completed_at, a.name AS assessment_name,
         c.first_name, c.last_name, c.email, c.organisation,
         c.age_band, c.experience_band, c.gender
    FROM reports rp
    JOIN responses r  ON r.id = rp.response_id
    JOIN assessments a ON a.id = r.assessment_id
    JOIN candidates c  ON c.id = r.candidate_id
`;

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

function toPayload(row: ReportRow, reportToken: string, branding: Awaited<ReturnType<typeof getBranding>>): ReportPayload {
  const scores = JSON.parse(row.scores_json) as ScoreResult;
  return reportFromScores({
    reportToken,
    assessmentName: row.assessment_name,
    candidate: {
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      organisation: row.organisation,
      ageBand: row.age_band,
      experienceBand: row.experience_band,
      gender: row.gender,
    },
    completedAt: row.completed_at ?? '',
    branding,
    scores,
  });
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

async function pdfResponse(c: Context<{ Bindings: Env }>, row: ReportRow | null): Promise<Response> {
  if (!row) return c.json({ error: 'Report not found.' }, 404);
  // D1 returns a BLOB as a plain array of byte values, not an ArrayBuffer —
  // handing that straight to Response() yields an empty body.
  const rec = await c.env.DB.prepare('SELECT pdf FROM reports WHERE id = ?1')
    .bind(row.report_id)
    .first<{ pdf: number[] | ArrayBuffer | null }>();
  if (!rec?.pdf) return c.json({ error: 'The PDF for this report is not available.' }, 404);

  const bytes = Array.isArray(rec.pdf) ? new Uint8Array(rec.pdf) : new Uint8Array(rec.pdf);
  if (bytes.byteLength === 0) {
    return c.json({ error: 'The PDF for this report is not available.' }, 404);
  }

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
