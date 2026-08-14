/**
 * Rebuilding a stored report.
 *
 * A report is persisted as its scores and nothing else presentational: the
 * candidate, the instrument and the completion date are joined back from the
 * rows that already hold them, and the branding is read live. Everything that
 * renders a report — the HTML page, the downloaded PDF, the PDF attached to a
 * report email — goes through here, so the three cannot disagree.
 *
 * The alternative, serving the copy of the PDF taken at completion, made every
 * report immutable in the wrong way: a logo upload or a fix to the layout
 * reached candidates who finished afterwards and no one else.
 */

import type { Env } from '../env.js';
import { getBranding } from './settings.js';
import { reportFromScores, type StoredScores } from './report.js';
import { decodeImageDataUrl } from '../pdf/image.js';
import { renderReportPdf } from '../pdf/report.js';
import type { Branding, ReportPayload } from '../../shared/types.js';

export interface ReportRow {
  report_id: string;
  scores_json: string;
  completed_at: string | null;
  assessment_id: string;
  assessment_name: string;
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  age_band: string;
  experience_band: string;
  gender: string;
}

/** Every column `toPayload` needs. Callers append their own WHERE clause. */
export const REPORT_SELECT = `
  SELECT rp.id AS report_id, rp.scores_json,
         r.completed_at, a.id AS assessment_id, a.name AS assessment_name,
         c.first_name, c.last_name, c.email, c.organisation,
         c.age_band, c.experience_band, c.gender
    FROM reports rp
    JOIN responses r  ON r.id = rp.response_id
    JOIN assessments a ON a.id = r.assessment_id
    JOIN candidates c  ON c.id = r.candidate_id
`;

/**
 * The reference printed on the document, derived from the report's own id.
 *
 * Not from the report token: that token is a credential, it is recoverable
 * through only one of the two candidate-facing doors, and printing it put a
 * live secret's first ten characters on a page that leaves the platform. The
 * id is stable, carries nothing, and gives every route the same code for the
 * same report.
 */
export function reportRef(reportId: string): string {
  return reportId.replace(/^rpt_/, '');
}

export function toPayload(row: ReportRow, reportToken: string, branding: Branding): ReportPayload {
  const scores = JSON.parse(row.scores_json) as StoredScores;
  return reportFromScores({
    reportToken,
    assessmentId: row.assessment_id,
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

/**
 * Renders the report as it stands now. The logo is whatever `brandingFrom`
 * resolves — a tenant upload or the house mark — and decodes to null for a
 * format a PDF cannot carry, which falls back to the vector lockup.
 */
export async function renderStoredReportPdf(row: ReportRow, branding: Branding): Promise<Uint8Array> {
  const payload = toPayload(row, reportRef(row.report_id), branding);
  return renderReportPdf(payload, await decodeImageDataUrl(branding.logoDataUrl));
}

/** Loads one report by its response id and renders it. */
export async function renderReportForResponse(env: Env, responseId: string): Promise<Uint8Array | null> {
  const row = await env.DB.prepare(`${REPORT_SELECT} WHERE rp.response_id = ?1`)
    .bind(responseId)
    .first<ReportRow>();
  if (!row) return null;
  return renderStoredReportPdf(row, await getBranding(env));
}
