/**
 * Rebuilding a stored cohort report.
 *
 * Same principle as `report-render.ts`: the row holds scores and nothing
 * presentational, the cohort and instrument are joined back, and branding is
 * read live -- so a logo change or a layout fix reaches every report already
 * issued rather than only the ones generated afterwards.
 */

import type { Env } from '../env.js';
import { getBranding } from './settings.js';
import { groupPayload, memberPayload, type CohortRow, type MemberScores } from './cohort.js';
import { decodeImageDataUrl } from '../pdf/image.js';
import { renderCohortReportPdf } from '../pdf/socio-report.js';
import type { SocioGroupResult } from '../../shared/socio-scoring.js';
import type { Branding, CohortReportPayload } from '../../shared/types.js';

export interface CohortReportRow {
  report_id: string;
  scope: 'group' | 'member';
  member_id: string | null;
  member_name: string | null;
  scores_json: string;
  suppressed: number;
  created_at: string;
  round_no: number;
  round_label: string | null;
  cohort_id: string;
  cohort_name: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  min_raters: number;
  tie_threshold: number;
  min_rated_targets: number;
  cohort_created_at: string;
  closed_at: string | null;
  assessment_id: string;
  assessment_name: string;
}

/** Every column `toCohortPayload` needs. Callers append their own WHERE clause. */
export const COHORT_REPORT_SELECT = `
  SELECT cr.id AS report_id, cr.scope, cr.member_id, cr.scores_json, cr.suppressed, cr.created_at,
         cr.round_no, rd.label AS round_label,
         m.name AS member_name,
         co.id AS cohort_id, co.name AS cohort_name, co.organisation, co.status,
         co.min_raters, co.tie_threshold, co.min_rated_targets,
         co.created_at AS cohort_created_at, co.closed_at,
         a.id AS assessment_id, a.name AS assessment_name
    FROM cohort_reports cr
    JOIN cohorts co     ON co.id = cr.cohort_id
    JOIN assessments a  ON a.id = co.assessment_id
    LEFT JOIN cohort_rounds rd ON rd.cohort_id = cr.cohort_id AND rd.no = cr.round_no
    LEFT JOIN cohort_members m ON m.id = cr.member_id
`;

/** The reference printed on the document, derived from the report's own id. */
export function cohortReportRef(reportId: string): string {
  return reportId.replace(/^crpt_/, '');
}

function cohortOf(row: CohortReportRow): CohortRow {
  return {
    id: row.cohort_id,
    assessment_id: row.assessment_id,
    name: row.cohort_name,
    organisation: row.organisation,
    status: row.status,
    min_raters: row.min_raters,
    // Not selected by the report query and not read by rendering: how someone
    // proved who they were on the way in, and whether the completion screen
    // promises a report, have no bearing on what the report says.
    share_reports: 0,
    otp_required: 0,
    link_only_identity: 0,
    tie_threshold: row.tie_threshold,
    min_rated_targets: row.min_rated_targets,
    created_at: row.cohort_created_at,
    closed_at: row.closed_at,
  };
}

export function toCohortPayload(
  row: CohortReportRow,
  reportToken: string,
  branding: Branding,
): CohortReportPayload {
  const base = {
    reportToken,
    cohort: cohortOf(row),
    round: { no: row.round_no, label: row.round_label ?? '' },
    assessmentName: row.assessment_name,
    generatedAt: row.created_at,
    branding,
  };

  if (row.scope === 'group') {
    return groupPayload({ ...base, group: JSON.parse(row.scores_json) as SocioGroupResult });
  }
  return memberPayload({ ...base, scores: JSON.parse(row.scores_json) as MemberScores });
}

export async function renderStoredCohortPdf(
  row: CohortReportRow,
  branding: Branding,
): Promise<Uint8Array> {
  const payload = toCohortPayload(row, cohortReportRef(row.report_id), branding);
  return renderCohortReportPdf(payload, await decodeImageDataUrl(branding.logoDataUrl));
}

/** Loads one cohort report by id and renders it, for the admin console. */
export async function renderCohortReportById(env: Env, reportId: string): Promise<Uint8Array | null> {
  const row = await env.DB.prepare(`${COHORT_REPORT_SELECT} WHERE cr.id = ?1`)
    .bind(reportId)
    .first<CohortReportRow>();
  if (!row) return null;
  return renderStoredCohortPdf(row, await getBranding(env));
}

/** A filename that says what the document is without naming a token. */
export function cohortPdfName(row: CohortReportRow): string {
  // The round is in the filename only when there has been more than one, so a
  // cohort run once keeps the name its reports already had.
  const round = row.round_no > 1 ? `-${(row.round_label || `round-${row.round_no}`)}` : '';
  const stem =
    row.scope === 'group'
      ? `${row.cohort_name}${round}-group-report`
      : `${row.member_name ?? 'member'}${round}-peer-report`;
  return stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
