import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import { isCollabLink, validateFacets, waveName } from '../src/worker/routes/collab-candidate.js';
import { ASSESSMENT_ID } from '../src/shared/assessments.js';
import type { CollabFacet } from '../src/shared/types.js';

const department: CollabFacet = {
  key: 'department',
  label: 'Department',
  options: ['Operations', 'Quality & QA', 'R&D'],
  required: true,
};
const level: CollabFacet = {
  key: 'level',
  label: 'Level',
  options: ['Head of function', 'Senior manager'],
  required: false,
};

describe('what a respondent is asked', () => {
  it('accepts a value from the list it offered', () => {
    const result = validateFacets([department], { department: 'Operations' });
    expect(result).toEqual({ values: { department: 'Operations' } });
  });

  it('refuses a value that was never offered', () => {
    // The closed list is the whole reason two spellings of one department
    // cannot exist. A client crafting its own request is exactly how a third
    // spelling would get in, so the check is here and not only in the form.
    const result = validateFacets([department], { department: 'Ops' });
    expect(result).toEqual({ error: 'That is not one of the department options.', field: 'department' });
  });

  it('will not let a required cut be skipped', () => {
    expect(validateFacets([department], {})).toEqual({
      error: 'Please choose your department.',
      field: 'department',
    });
    expect(validateFacets([department], { department: '   ' })).toHaveProperty('field', 'department');
  });

  it('leaves a declined optional cut absent rather than storing "Not given"', () => {
    // An unanswered cut and a suppressed one must never pool into a phantom
    // segment that the console then reports a mean for.
    const result = validateFacets([department, level], { department: 'R&D' });
    expect(result).toEqual({ values: { department: 'R&D' } });
    expect(Object.keys((result as { values: Record<string, string> }).values)).not.toContain('level');
  });

  it('trims what arrives, so a stray space is not an unknown department', () => {
    expect(validateFacets([department], { department: '  Operations  ' })).toEqual({
      values: { department: 'Operations' },
    });
  });

  it('ignores keys the run does not collect', () => {
    const result = validateFacets([department], { department: 'R&D', salary: '90000' });
    expect(result).toEqual({ values: { department: 'R&D' } });
  });

  it('survives a body that is not an object', () => {
    expect(validateFacets([level], null)).toEqual({ values: {} });
    expect(validateFacets([level], 'Operations')).toEqual({ values: {} });
    expect(validateFacets([level], ['Operations'])).toEqual({ values: {} });
  });

  it('asks nothing when a run collects no cuts', () => {
    expect(validateFacets([], { department: 'Operations' })).toEqual({ values: {} });
  });
});

describe('naming a wave', () => {
  it('uses the facilitator’s label when there is one', () => {
    expect(waveName(2, 'September 2026')).toBe('September 2026');
    expect(waveName(2, '  September 2026  ')).toBe('September 2026');
  });

  it('falls back to the number', () => {
    expect(waveName(3, '')).toBe('Wave 3');
    expect(waveName(1, '   ')).toBe('Wave 1');
  });
});

describe('routing a link', () => {
  it('recognises the diagnostic and nothing else', () => {
    expect(isCollabLink({ assessment_id: ASSESSMENT_ID.collab })).toBe(true);
    expect(isCollabLink({ assessment_id: ASSESSMENT_ID.socio })).toBe(false);
    expect(isCollabLink({ assessment_id: ASSESSMENT_ID.isi })).toBe(false);
    expect(isCollabLink({ assessment_id: ASSESSMENT_ID.ego })).toBe(false);
  });
});

describe('the instrument the respondent sees', () => {
  it('is 24 statements, so a sheet is finished or it is not submitted', () => {
    expect(COLLAB_ITEM_COUNT).toBe(24);
  });
});
