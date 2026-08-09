/**
 * The seams between the two instruments: the registry, the per-assessment
 * rating bounds the API enforces, and the tagged report payload.
 *
 * These are the places where "the platform serves two instruments" could go
 * wrong quietly — a 0–6 answer accepted for a 0–4 inventory, or an ego
 * response rendered through the influencing-style layout.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENTS,
  ASSESSMENT_ID,
  configFor,
  kindForAssessment,
  scaleFor,
} from '../src/shared/assessments.js';
import { EGO_MAX_STATE_SCORE, EGO_QUESTION_COUNT } from '../src/shared/ego-scoring.js';
import { EGO_STATES } from '../src/shared/ego.js';
import { MAX_ANSWER, MAX_STYLE_SCORE, QUESTION_COUNT } from '../src/shared/scoring.js';
import { answerBatchSchemaFor } from '../src/worker/lib/validation.js';
import { buildReport, reportFromScores, UnknownAssessmentError } from '../src/worker/lib/report.js';
import { BRAND_ACCENT, BRAND_COMPANY_NAME, BRAND_LOGO_DATA_URL } from '../src/shared/brand.js';
import type { Branding, CandidateDetails } from '../src/shared/types.js';

const branding: Branding = {
  companyName: BRAND_COMPANY_NAME,
  accentColor: BRAND_ACCENT,
  logoDataUrl: BRAND_LOGO_DATA_URL,
  supportEmail: '',
};

const candidate: CandidateDetails = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  organisation: 'Northwind',
  ageBand: '35–44',
  experienceBand: '6–10 years',
  gender: 'Female',
};

const answersFor = (count: number, mod: number): Record<number, number> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, (i * 3) % mod]));

describe('the assessment registry', () => {
  it('resolves both live instruments and nothing else', () => {
    expect(kindForAssessment(ASSESSMENT_ID.isi)).toBe('isi');
    expect(kindForAssessment(ASSESSMENT_ID.ego)).toBe('ego');
    expect(kindForAssessment('asm_motivation_need')).toBeNull();
    expect(configFor('asm_motivation_need')).toBeNull();
  });

  it('agrees with the scoring engines about counts and bounds', () => {
    expect(ASSESSMENTS.isi.questionCount).toBe(QUESTION_COUNT);
    expect(ASSESSMENTS.isi.scale.max).toBe(MAX_ANSWER);
    expect(ASSESSMENTS.ego.questionCount).toBe(EGO_QUESTION_COUNT);
    expect(ASSESSMENTS.ego.scale.max).toBe(6);
  });

  it('offers one label per point on every scale', () => {
    for (const config of Object.values(ASSESSMENTS)) {
      const points = config.scale.max - config.scale.min + 1;
      expect(config.scale.labels, config.kind).toHaveLength(points);
      expect(config.scale.shortLabels, config.kind).toHaveLength(points);
    }
  });

  it('falls back to the influencing-style scale for an unknown instrument', () => {
    expect(scaleFor('asm_nonexistent')).toEqual(ASSESSMENTS.isi.scale);
  });

  it('reproduces the Ego States instructions verbatim', () => {
    const intro = ASSESSMENTS.ego.intro;
    expect(intro.title).toBe('Ego States Scale');
    expect(intro.lede).toBe(
      'For each statement choose a number from zero to six that describes how true or untrue it is for you in your experience of yourself.',
    );
    expect(intro.instructions[0]).toBe(
      "For example, the number 0 means ‘never true’ and the number 6 means ‘always true’.",
    );
    expect(intro.emphasis).toBe(
      'In responding to each statement, read it first and once you have understood it, respond intuitively rather than rationally.',
    );
    expect(intro.instructions).toHaveLength(4);
  });

  it('titles the influencing-style begin screen the way the client does', () => {
    expect(ASSESSMENTS.isi.intro.title).toBe('Influencing Styles Questionnaire');
    expect([...ASSESSMENTS.isi.intro.instructions]).toEqual([
      '0 = I never do it',
      '1 = I rarely do this',
      '2 = I sometimes do this',
      '3 = I often do this',
      '4 = I always do this',
    ]);
    expect(ASSESSMENTS.isi.intro.cta).toBe('Begin Test');
  });
});

describe('per-assessment answer bounds', () => {
  const parse = (min: number, max: number, value: number) =>
    answerBatchSchemaFor(min, max).safeParse({ answers: [{ no: 1, value }] }).success;

  it('accepts 4 and rejects 5 on the influencing-style scale', () => {
    const { min, max } = ASSESSMENTS.isi.scale;
    expect(parse(min, max, 0)).toBe(true);
    expect(parse(min, max, 4)).toBe(true);
    expect(parse(min, max, 5)).toBe(false);
    expect(parse(min, max, -1)).toBe(false);
  });

  it('accepts 5 and 6 but rejects 7 on the ego-states scale', () => {
    const { min, max } = ASSESSMENTS.ego.scale;
    expect(parse(min, max, 5)).toBe(true);
    expect(parse(min, max, 6)).toBe(true);
    expect(parse(min, max, 7)).toBe(false);
  });

  it('rejects a non-integer rating on either scale', () => {
    expect(parse(0, 4, 2.5)).toBe(false);
    expect(parse(0, 6, 2.5)).toBe(false);
  });

  it('still rejects an empty batch and an out-of-range statement number', () => {
    const schema = answerBatchSchemaFor(0, 6);
    expect(schema.safeParse({ answers: [] }).success).toBe(false);
    expect(schema.safeParse({ answers: [{ no: 0, value: 1 }] }).success).toBe(false);
  });
});

describe('buildReport', () => {
  const base = {
    reportToken: 'r'.repeat(43),
    candidate,
    completedAt: '2026-08-09 10:30:00',
    branding,
  };

  it('builds an influencing-style payload from a 0–4 response', () => {
    const report = buildReport({
      ...base,
      assessmentId: ASSESSMENT_ID.isi,
      assessmentName: 'Influencing Style Inventory',
      answers: answersFor(QUESTION_COUNT, MAX_ANSWER + 1),
    });

    expect(report.kind).toBe('isi');
    if (report.kind !== 'isi') throw new Error('unreachable');
    expect(report.scores.styles).toHaveLength(10);
    expect(report.narratives).toHaveLength(3);
    expect(report.development.name).toBeTruthy();
    expect(report.methods.push).toContain('The Push Method');
    expect(report.methods.pull).toContain('stake in the eventual outcomes');
    for (const s of report.scores.styles) {
      expect(s.score).toBeLessThanOrEqual(MAX_STYLE_SCORE);
    }
  });

  it('builds an ego-states payload from a 0–6 response', () => {
    const report = buildReport({
      ...base,
      assessmentId: ASSESSMENT_ID.ego,
      assessmentName: 'Ego States Scale',
      answers: answersFor(EGO_QUESTION_COUNT, 7),
    });

    expect(report.kind).toBe('ego');
    if (report.kind !== 'ego') throw new Error('unreachable');
    expect(report.states).toHaveLength(EGO_STATES.length);
    expect(report.states.map((s) => s.abbr)).toEqual(EGO_STATES.map((s) => s.abbr));
    expect(report.highest.score).toBeGreaterThanOrEqual(report.lowest.score);
    expect(report.labelsAreDraft).toBe(true);
    expect(report.draftNote).toMatch(/draft/i);
    for (const s of report.states) {
      expect(s.score).toBeLessThanOrEqual(EGO_MAX_STATE_SCORE);
      expect(s.description.length).toBeGreaterThan(80);
    }
  });

  it('refuses an instrument with no scoring engine rather than guessing', () => {
    expect(() =>
      buildReport({
        ...base,
        assessmentId: 'asm_motivation_need',
        assessmentName: 'Motivation Need Assessment',
        answers: answersFor(10, 5),
      }),
    ).toThrow(UnknownAssessmentError);
  });
});

describe('reportFromScores', () => {
  it('round-trips a persisted score object through JSON', () => {
    const built = buildReport({
      reportToken: 'r'.repeat(43),
      assessmentId: ASSESSMENT_ID.ego,
      assessmentName: 'Ego States Scale',
      candidate,
      completedAt: '2026-08-09 10:30:00',
      branding,
      answers: answersFor(EGO_QUESTION_COUNT, 7),
    });
    if (built.kind !== 'ego') throw new Error('unreachable');

    const rebuilt = reportFromScores({
      reportToken: built.reportToken,
      assessmentId: ASSESSMENT_ID.ego,
      assessmentName: built.assessmentName,
      candidate,
      completedAt: built.completedAt,
      branding,
      scores: JSON.parse(JSON.stringify(built.ego)),
    });

    expect(rebuilt).toEqual(built);
  });

  it('reads a pre-tagging influencing-style row from the assessment id', () => {
    const built = buildReport({
      reportToken: 'r'.repeat(43),
      assessmentId: ASSESSMENT_ID.isi,
      assessmentName: 'Influencing Style Inventory',
      candidate,
      completedAt: '2026-08-09 10:30:00',
      branding,
      answers: answersFor(QUESTION_COUNT, MAX_ANSWER + 1),
    });
    if (built.kind !== 'isi') throw new Error('unreachable');

    // A row written before the payload carried a tag.
    const { kind: _dropped, ...untagged } = built.scores;
    const rebuilt = reportFromScores({
      reportToken: built.reportToken,
      assessmentId: ASSESSMENT_ID.isi,
      assessmentName: built.assessmentName,
      candidate,
      completedAt: built.completedAt,
      branding,
      scores: untagged as typeof built.scores,
    });

    expect(rebuilt.kind).toBe('isi');
    expect(rebuilt.summary).toBe(built.summary);
  });
});

describe('house branding', () => {
  it('ships a PO Motivation logo as an embeddable PNG data URI', () => {
    expect(BRAND_COMPANY_NAME).toBe('PO Motivation');
    expect(BRAND_LOGO_DATA_URL.startsWith('data:image/png;base64,')).toBe(true);
    expect(BRAND_LOGO_DATA_URL.length).toBeGreaterThan(10_000);
    expect(BRAND_ACCENT).toMatch(/^#[0-9A-F]{6}$/);
  });
});
