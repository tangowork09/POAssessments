import { describe, expect, it } from 'vitest';
import {
  answerBatchSchemaFor,
  clearRowSchema,
  cohortCreateSchema,
  cohortIdentitySchema,
  cohortUpdateSchema,
  rosterSetSchema,
} from '../src/worker/lib/validation.js';
import { roundName } from '../src/worker/lib/cohort.js';
import { cohortPdfName } from '../src/worker/lib/cohort-report-render.js';

describe('cohortCreateSchema', () => {
  it('fills in the defaults a facilitator does not have to think about', () => {
    const parsed = cohortCreateSchema.parse({ name: 'Acme leadership' });
    expect(parsed).toEqual({
      name: 'Acme leadership',
      organisation: '',
      minRaters: 3,
      tieThreshold: 4,
      minRatedTargets: 1,
    });
  });

  it('keeps what was supplied', () => {
    const parsed = cohortCreateSchema.parse({
      name: '  Acme leadership  ',
      organisation: 'Acme Pharma',
      minRaters: 5,
      tieThreshold: 3,
      minRatedTargets: 2,
    });
    expect(parsed.name).toBe('Acme leadership');
    expect(parsed.organisation).toBe('Acme Pharma');
    expect(parsed.minRaters).toBe(5);
  });

  it('rejects a nameless cohort and an out-of-scale threshold', () => {
    expect(cohortCreateSchema.safeParse({}).success).toBe(false);
    expect(cohortCreateSchema.safeParse({ name: 'x', tieThreshold: 6 }).success).toBe(false);
  });
});

describe('cohortUpdateSchema', () => {
  /**
   * The bug this exists to prevent: built as `cohortCreateSchema.partial()`,
   * every field came back with its *default* rather than as `undefined`,
   * because `.partial()` makes a key optional without stripping `.default()`.
   * The handler's COALESCE then saw a value instead of null, so a PATCH that
   * only flipped the status silently blanked the organisation and reset the
   * rater floor and tie threshold. It is invisible until someone notices the
   * organisation missing off a report cover weeks later.
   */
  it('leaves an omitted field undefined rather than defaulting it', () => {
    const parsed = cohortUpdateSchema.parse({ status: 'open' });
    expect(parsed).toEqual({ status: 'open' });
    expect('organisation' in parsed).toBe(false);
    expect(parsed.minRaters).toBeUndefined();
    expect(parsed.tieThreshold).toBeUndefined();
    expect(parsed.minRatedTargets).toBeUndefined();
    expect(parsed.name).toBeUndefined();
  });

  it('still validates the fields that are supplied', () => {
    expect(cohortUpdateSchema.safeParse({ minRaters: 0 }).success).toBe(false);
    expect(cohortUpdateSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(cohortUpdateSchema.parse({ minRaters: 4 })).toEqual({ minRaters: 4 });
  });

  it('accepts an empty patch as a no-op rather than an error', () => {
    expect(cohortUpdateSchema.parse({})).toEqual({});
  });
});

describe('cohortIdentitySchema', () => {
  it('asks for the enrolled email and nothing else — no roster choice exists', () => {
    const parsed = cohortIdentitySchema.parse({ email: ' Priya@Acme.com ' });
    expect(parsed).toEqual({ email: 'priya@acme.com' });
  });

  it('refuses an identity with no email', () => {
    const res = cohortIdentitySchema.safeParse({ email: '' });
    expect(res.success).toBe(false);
  });

  it('ignores a memberId smuggled alongside the email — identity is the email alone', () => {
    const parsed = cohortIdentitySchema.parse({ memberId: 'cmem_1', email: 'a@b.com' });
    expect(parsed).toEqual({ email: 'a@b.com' });
  });
});

describe('rosterSetSchema', () => {
  it('defaults the optional columns so a name-only paste is valid', () => {
    const parsed = rosterSetSchema.parse({ members: [{ name: 'Priya Raman' }] });
    expect(parsed.members[0]).toEqual({ name: 'Priya Raman', func: '', email: '' });
  });

  it('rejects an empty roster and a nameless row', () => {
    expect(rosterSetSchema.safeParse({ members: [] }).success).toBe(false);
    expect(rosterSetSchema.safeParse({ members: [{ name: '' }] }).success).toBe(false);
  });
});

describe('answerBatchSchemaFor', () => {
  /**
   * A statement inventory tops out at its statement count; a cohort instrument
   * addresses a matrix cell, so its ceiling is roster size x twelve items. A
   * fixed cap of 200 would have silently rejected everyone past roster
   * position 16.
   */
  it('takes its ceiling from the instrument rather than a constant', () => {
    const isi = answerBatchSchemaFor(0, 4);
    expect(isi.safeParse({ answers: [{ no: 40, value: 4 }] }).success).toBe(true);
    expect(isi.safeParse({ answers: [{ no: 600, value: 4 }] }).success).toBe(false);

    const socio = answerBatchSchemaFor(1, 5, 600);
    expect(socio.safeParse({ answers: [{ no: 600, value: 5 }] }).success).toBe(true);
    expect(socio.safeParse({ answers: [{ no: 601, value: 5 }] }).success).toBe(false);
  });

  it('rejects a rating outside the instrument scale rather than clamping it', () => {
    const socio = answerBatchSchemaFor(1, 5, 600);
    expect(socio.safeParse({ answers: [{ no: 1, value: 0 }] }).success).toBe(false);
    expect(socio.safeParse({ answers: [{ no: 1, value: 6 }] }).success).toBe(false);
  });

  it('allows a resume page beyond the old hundred-page cap', () => {
    // A cohort pages by roster member, so the ceiling is the largest roster.
    const socio = answerBatchSchemaFor(1, 5, 600);
    expect(socio.safeParse({ answers: [{ no: 1, value: 3 }], resumePage: 180 }).success).toBe(true);
  });
});

describe('clearRowSchema', () => {
  it('clears whole rows, addressed by roster position', () => {
    expect(clearRowSchema.parse({ memberNos: [3, 7] })).toEqual({ memberNos: [3, 7] });
    expect(clearRowSchema.safeParse({ memberNos: [] }).success).toBe(false);
    expect(clearRowSchema.safeParse({ memberNos: [0] }).success).toBe(false);
  });
});

// ------------------------------------------------------------------- rounds

describe('naming a round', () => {
  it('uses the facilitator\'s label when there is one', () => {
    expect(roundName({ no: 2, label: 'October 2026' })).toBe('October 2026');
  });

  it('falls back to the number, so a round always has a name', () => {
    expect(roundName({ no: 3, label: '' })).toBe('Round 3');
    expect(roundName({ no: 1, label: '   ' })).toBe('Round 1');
  });
});

describe('naming a report file', () => {
  const base = {
    report_id: 'crpt_abc',
    scope: 'group' as const,
    member_id: null,
    member_name: null,
    scores_json: '{}',
    suppressed: 0,
    created_at: '2026-08-24 10:00:00',
    cohort_id: 'coh_1',
    cohort_name: 'Acme leadership',
    organisation: 'Acme',
    status: 'open' as const,
    min_raters: 3,
    tie_threshold: 4,
    min_rated_targets: 1,
    cohort_created_at: '2026-08-01 10:00:00',
    closed_at: null,
    assessment_id: 'asm_sociometry',
    assessment_name: 'Collaboration Sociometry',
  };

  it('leaves a single-round cohort\'s filenames as they were', () => {
    expect(cohortPdfName({ ...base, round_no: 1, round_label: '' })).toBe('acme-leadership-group-report');
  });

  it('names the round once a group has been asked more than once', () => {
    expect(cohortPdfName({ ...base, round_no: 2, round_label: 'October 2026' })).toBe(
      'acme-leadership-october-2026-group-report',
    );
    expect(cohortPdfName({ ...base, round_no: 3, round_label: '' })).toBe(
      'acme-leadership-round-3-group-report',
    );
  });

  it('keeps one member\'s reports from two rounds apart', () => {
    const member = { ...base, scope: 'member' as const, member_name: 'Priya Raman' };
    expect(cohortPdfName({ ...member, round_no: 1, round_label: '' })).toBe('priya-raman-peer-report');
    expect(cohortPdfName({ ...member, round_no: 2, round_label: 'Oct' })).toBe(
      'priya-raman-oct-peer-report',
    );
  });
});
