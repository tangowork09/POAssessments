import { describe, expect, it } from 'vitest';
import {
  collabFacetSchema,
  collabInviteSchema,
  collabPersonUpdateSchema,
  collabRunCreateSchema,
  collabRunUpdateSchema,
} from '../src/worker/lib/validation.js';

/**
 * The run's own rules, at the door.
 *
 * These are the checks a facilitator hits before anything is stored, and each
 * one exists because the alternative silently corrupts a reading rather than
 * failing loudly: a one-person "department average", two spellings of the same
 * department, a cut with nothing to cut by.
 */
describe('creating a run', () => {
  it('defaults to a floor of five and to named responses', () => {
    const parsed = collabRunCreateSchema.parse({ name: 'Acme Pharma' });
    expect(parsed.minSegment).toBe(5);
    expect(parsed.anonymous).toBe(false);
    expect(parsed.organisation).toBe('');
  });

  it('lets a facilitator report every group, however small', () => {
    // A floor of 1 is a legitimate choice, and the commonest one for a twenty
    // person leadership team: withholding a four-person Operations withholds
    // the finding. The consequence is stated to respondents, not prevented.
    expect(collabRunCreateSchema.parse({ name: 'Acme', minSegment: 1 }).minSegment).toBe(1);
    expect(collabRunCreateSchema.parse({ name: 'Acme' }).minSegment).toBe(5);
    expect(collabRunCreateSchema.safeParse({ name: 'Acme', minSegment: 0 }).success).toBe(false);
    expect(collabRunCreateSchema.safeParse({ name: 'Acme', minSegment: 51 }).success).toBe(false);
  });

  it('needs a name', () => {
    expect(collabRunCreateSchema.safeParse({}).success).toBe(false);
    expect(collabRunCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('updating a run', () => {
  it('accepts a single field on its own', () => {
    const parsed = collabRunUpdateSchema.parse({ status: 'open' });
    expect(parsed.status).toBe('open');
    expect(parsed.name).toBeUndefined(); // absent stays absent, never blanked
  });

  it('knows only the three states a run can be in', () => {
    expect(collabRunUpdateSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});

describe('declaring a cut', () => {
  const base = { key: 'department', label: 'Department', options: ['Operations', 'R&D'] };

  it('takes a lower-case key and at least two values', () => {
    const parsed = collabFacetSchema.parse(base);
    expect(parsed.key).toBe('department');
    expect(parsed.required).toBe(true);
    expect(collabFacetSchema.safeParse({ ...base, options: ['Operations'] }).success).toBe(false);
  });

  it('refuses two values that differ only by case', () => {
    // "Operations" and "operations" are one department to the organisation and
    // two segments to a GROUP BY, and nothing afterwards recovers who meant which.
    const result = collabFacetSchema.safeParse({ ...base, options: ['Operations', 'operations'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('differ only by case');
    }
  });

  it('refuses a key that would not survive a URL or a column header', () => {
    expect(collabFacetSchema.safeParse({ ...base, key: 'Department' }).success).toBe(false);
    expect(collabFacetSchema.safeParse({ ...base, key: 'dept name' }).success).toBe(false);
    expect(collabFacetSchema.safeParse({ ...base, key: '2nd_line' }).success).toBe(false);
    expect(collabFacetSchema.safeParse({ ...base, key: 'reporting_line' }).success).toBe(true);
  });

  it('trims what a facilitator types, so a stray space is not a second department', () => {
    const parsed = collabFacetSchema.parse({ ...base, options: ['  Operations  ', 'R&D'] });
    expect(parsed.options[0]).toBe('Operations');
  });
});

describe('adding people to a run', () => {
  it('takes an address on its own', () => {
    const parsed = collabInviteSchema.parse({ people: [{ email: 'Anita@Acme.test' }] });
    expect(parsed.people[0]).toEqual({ email: 'anita@acme.test', name: '', department: '' });
  });

  it('keeps one person when the same address arrives twice in different case', () => {
    const parsed = collabInviteSchema.parse({
      people: [
        { email: 'a@acme.test', name: 'First' },
        { email: 'A@ACME.TEST', name: 'Second' },
      ],
    });
    // Two invitations to one inbox is two half-finished sheets.
    expect(parsed.people).toHaveLength(1);
    expect(parsed.people[0]!.name).toBe('First');
  });

  it('refuses something that is not an address', () => {
    expect(collabInviteSchema.safeParse({ people: [{ email: 'anita' }] }).success).toBe(false);
    expect(collabInviteSchema.safeParse({ people: [] }).success).toBe(false);
  });
});

describe('editing somebody on the roster', () => {
  it('changes only what was sent', () => {
    expect(collabPersonUpdateSchema.parse({ department: 'R&D' })).toEqual({ department: 'R&D' });
    expect(collabPersonUpdateSchema.parse({}).name).toBeUndefined();
  });

  it('does not accept a new address: that is a different person', () => {
    const parsed = collabPersonUpdateSchema.parse({
      name: 'Sam',
      email: 'someone-else@acme.test',
    } as Record<string, unknown>);
    expect('email' in parsed).toBe(false);
  });
});
