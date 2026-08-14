/**
 * Rebuilding a stored report.
 *
 * The PDF used to be rendered once, at completion, and stored — so a logo
 * upload or a fix to the layout reached candidates who finished afterwards and
 * nobody else, and every report already issued kept its old artwork for good.
 * Downloads now render through `renderStoredReportPdf`, and these hold that
 * open: the row alone is enough to rebuild the document, the branding is read
 * at render time rather than baked in, and the reference on the page is the
 * report's id rather than its token.
 */

import { describe, expect, it } from 'vitest';
import {
  REPORT_SELECT,
  renderStoredReportPdf,
  reportRef,
  toPayload,
  type ReportRow,
} from '../src/worker/lib/report-render.js';
import { buildReport } from '../src/worker/lib/report.js';
import { ASSESSMENT_ID } from '../src/shared/assessments.js';
import { QUESTION_COUNT } from '../src/shared/scoring.js';
import { BRAND_ACCENT, BRAND_COMPANY_NAME, BRAND_LOGO_DATA_URL } from '../src/shared/brand.js';
import type { Branding, IsiReportPayload } from '../src/shared/types.js';

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

const house: Branding = {
  companyName: BRAND_COMPANY_NAME,
  accentColor: BRAND_ACCENT,
  logoDataUrl: BRAND_LOGO_DATA_URL,
  supportEmail: '',
};

/** The scores a completed ISI response stores, produced the way the pipeline does. */
const storedScores = (() => {
  const answers: Record<number, number> = {};
  for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 3) % 5;
  const report = buildReport({
    reportToken: 'r'.repeat(43),
    assessmentId: ASSESSMENT_ID.isi,
    assessmentName: 'Influencing Style Inventory',
    candidate: {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      organisation: 'Meridian Group',
      ageBand: '35–44',
      experienceBand: '6–10',
      gender: 'Female',
    },
    completedAt: '2026-08-09 10:30:00',
    branding: house,
    answers,
  }) as IsiReportPayload;
  return report.scores;
})();

const row: ReportRow = {
  report_id: 'rpt_0123456789abcdef0123456789abcdef',
  scores_json: JSON.stringify(storedScores),
  completed_at: '2026-08-09 10:30:00',
  assessment_id: ASSESSMENT_ID.isi,
  assessment_name: 'Influencing Style Inventory',
  first_name: 'Priya',
  last_name: 'Sharma',
  email: 'priya@example.com',
  organisation: 'Meridian Group',
  age_band: '35–44',
  experience_band: '6–10',
  gender: 'Female',
};

describe('REPORT_SELECT', () => {
  it('reads every column toPayload needs', () => {
    for (const column of [
      'scores_json',
      'completed_at',
      'assessment_id',
      'assessment_name',
      'first_name',
      'last_name',
      'organisation',
      'age_band',
      'experience_band',
      'gender',
    ]) {
      expect(REPORT_SELECT).toContain(column);
    }
  });
});

describe('reportRef', () => {
  it('drops the id prefix, so the printed code is not an internal handle', () => {
    expect(reportRef('rpt_0123456789abcdef')).toBe('0123456789abcdef');
  });

  it('leaves an unprefixed id alone', () => {
    expect(reportRef('0123456789')).toBe('0123456789');
  });
});

describe('toPayload', () => {
  it('rebuilds the scored report from the stored row alone', () => {
    const payload = toPayload(row, reportRef(row.report_id), house) as IsiReportPayload;
    expect(payload.kind).toBe('isi');
    expect(payload.candidate.firstName).toBe('Priya');
    expect(payload.candidate.organisation).toBe('Meridian Group');
    expect(payload.completedAt).toBe('2026-08-09 10:30:00');
    expect(payload.scores.styles).toHaveLength(storedScores.styles.length);
    expect(payload.scores.push).toBe(storedScores.push);
    expect(payload.scores.pull).toBe(storedScores.pull);
  });

  it('takes the branding it is handed rather than anything stored on the report', () => {
    const tenant: Branding = { ...house, companyName: 'Meridian Group', accentColor: '#1A4FD6' };
    expect(toPayload(row, '', tenant).branding.companyName).toBe('Meridian Group');
    expect(toPayload(row, '', house).branding.companyName).toBe(BRAND_COMPANY_NAME);
  });
});

describe('renderStoredReportPdf', () => {
  it('renders a PDF carrying the candidate and the reference', async () => {
    const pdf = await renderStoredReportPdf(row, house);
    const s = latin1(pdf);
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    // The reference is drawn uppercased, one `Tj` per line.
    expect(s).toContain(reportRef(row.report_id).slice(0, 10).toUpperCase());
  });

  it('embeds the logo rather than drawing the vector fallback', async () => {
    const withLogo = await renderStoredReportPdf(row, house);
    const without = await renderStoredReportPdf(row, { ...house, logoDataUrl: '' });
    expect(latin1(withLogo)).toContain('/Subtype /Image');
    expect(latin1(withLogo)).toContain('/SMask');
    expect(latin1(without)).not.toContain('/Subtype /Image');
    expect(withLogo.byteLength).toBeGreaterThan(without.byteLength);
  });

  it('picks up a branding change without the stored row changing', async () => {
    const a = await renderStoredReportPdf(row, house);
    const b = await renderStoredReportPdf(row, { ...house, companyName: 'Meridian Group' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('is deterministic for one row and one branding', async () => {
    const a = await renderStoredReportPdf(row, house);
    const b = await renderStoredReportPdf(row, house);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
