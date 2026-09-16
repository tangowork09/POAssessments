/**
 * What each administrator role may reach.
 *
 * Three roles, and the difference between them is which areas of the console
 * they can open:
 *
 *   superadmin    the owner account seeded from ADMIN_EMAIL. Everything,
 *                 including Activity and Branding.
 *   admin         a client administrator. Everything except the owner-only
 *                 panels.
 *   cohort_admin  a facilitator. Cohorts and nothing else — no dashboard, no
 *                 candidate list, no invites, no assessment links. Seeded from
 *                 COHORT_ADMIN_EMAIL so the same account exists in every
 *                 environment.
 *
 * This module is the single answer to "may this role do that". The worker
 * guards and the console navigation both read it, so a role can never be
 * hidden in the UI while its routes stay open, or the reverse.
 */

import type { AdminRole } from './types.js';

/** Console areas that are gated by role. */
export type AdminArea =
  | 'dashboard'
  | 'assessments'
  | 'cohorts'
  | 'candidates'
  | 'invites'
  | 'links'
  | 'activity'
  | 'branding'
  | 'settings';

/**
 * Which roles may open each area. Absent from a list means the route answers
 * 403 and the nav item is not rendered.
 */
const ACCESS: Record<AdminArea, readonly AdminRole[]> = {
  dashboard: ['superadmin', 'admin'],
  assessments: ['superadmin', 'admin'],
  cohorts: ['superadmin', 'admin', 'cohort_admin'],
  candidates: ['superadmin', 'admin'],
  invites: ['superadmin', 'admin'],
  links: ['superadmin', 'admin'],
  settings: ['superadmin', 'admin'],
  // Names people and holds previously-issued tokens.
  activity: ['superadmin'],
  // Reaches the candidate UI, the PDF and every outbound email at once.
  branding: ['superadmin'],
};

export function canAccess(role: AdminRole, area: AdminArea): boolean {
  return ACCESS[area].includes(role);
}

/**
 * True for the roles that run the whole deployment. Everything outside the
 * cohort routes is theirs; `cohort_admin` is the only role this excludes.
 */
export function isFullAdmin(role: AdminRole): boolean {
  return role === 'superadmin' || role === 'admin';
}

/**
 * Where the console opens for a role. A cohort admin has no dashboard, so
 * sending them to `/admin` would land them on a panel they cannot read.
 */
export function landingPath(role: AdminRole): string {
  return canAccess(role, 'dashboard') ? '/admin' : '/admin/cohorts';
}

export function roleLabel(role: AdminRole): string {
  if (role === 'superadmin') return 'Super admin';
  if (role === 'cohort_admin') return 'Cohort admin';
  return 'Admin';
}
