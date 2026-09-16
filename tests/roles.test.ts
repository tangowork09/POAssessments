import { describe, expect, it } from 'vitest';
import { canAccess, isFullAdmin, landingPath, roleLabel, type AdminArea } from '../src/shared/roles.js';
import { toRole } from '../src/worker/lib/auth.js';
import type { AdminRole } from '../src/shared/types.js';

const ROLES: AdminRole[] = ['superadmin', 'admin', 'cohort_admin'];

/** Every area a cohort administrator must not reach. */
const OFF_LIMITS: AdminArea[] = [
  'dashboard',
  'assessments',
  'candidates',
  'invites',
  'links',
  'settings',
  'activity',
  'branding',
];

describe('toRole', () => {
  it('keeps each role it knows', () => {
    for (const role of ROLES) expect(toRole(role)).toBe(role);
  });

  // A tampered or truncated claim must fall to the least privileged role that
  // still signs in, never silently to a stronger one.
  it('falls back to a plain admin for anything else', () => {
    for (const value of ['', 'owner', 'COHORT_ADMIN', null, undefined, 0, {}]) {
      expect(toRole(value)).toBe('admin');
    }
  });
});

describe('cohort_admin', () => {
  it('reaches cohorts', () => {
    expect(canAccess('cohort_admin', 'cohorts')).toBe(true);
  });

  it('reaches nothing else', () => {
    for (const area of OFF_LIMITS) expect(canAccess('cohort_admin', area)).toBe(false);
  });

  it('is not a full admin, so the worker guard refuses it', () => {
    expect(isFullAdmin('cohort_admin')).toBe(false);
    expect(isFullAdmin('admin')).toBe(true);
    expect(isFullAdmin('superadmin')).toBe(true);
  });

  // It has no dashboard, so '/admin' would be a panel it cannot read.
  it('opens the console on the cohorts list', () => {
    expect(landingPath('cohort_admin')).toBe('/admin/cohorts');
    expect(landingPath('admin')).toBe('/admin');
    expect(landingPath('superadmin')).toBe('/admin');
  });
});

describe('the existing roles are unchanged', () => {
  it('leaves an ordinary admin everything but the owner panels', () => {
    for (const area of ['dashboard', 'assessments', 'cohorts', 'candidates', 'invites', 'links', 'settings'] as AdminArea[]) {
      expect(canAccess('admin', area)).toBe(true);
    }
    expect(canAccess('admin', 'activity')).toBe(false);
    expect(canAccess('admin', 'branding')).toBe(false);
  });

  it('leaves a superadmin everything', () => {
    const areas: AdminArea[] = [...OFF_LIMITS, 'cohorts'];
    for (const area of areas) expect(canAccess('superadmin', area)).toBe(true);
  });
});

describe('roleLabel', () => {
  it('names every role', () => {
    expect(roleLabel('superadmin')).toBe('Super admin');
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('cohort_admin')).toBe('Cohort admin');
  });
});
