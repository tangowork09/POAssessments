/**
 * How a cohort decides who somebody is.
 *
 * Two stored flags — `otp_required` (0017) and `link_only_identity` (0019) —
 * but only three meaningful settings, and a facilitator reasons about the three
 * rather than the two. The mapping lives here, once, because the console offers
 * the choice and the Worker enforces it: if the two ever disagreed about what
 * "personal links only" means, the console would be showing a lock the server
 * was not holding.
 *
 * Pure functions and constants only, so the Worker, both frontends and Vitest
 * all read the same rules.
 */

/**
 * - `open`     — the enrolled work email alone opens the exercise.
 * - `otp`      — that email must also be proved: a mailed six-digit code comes
 *                back typed before the respondent is bound to a position.
 * - `link_only` — no identity is typed at all. Only a per-member personal link
 *                 gets in; the shared generic link stops accepting claims.
 */
export const COHORT_IDENTITY_MODES = ['open', 'otp', 'link_only'] as const;
export type CohortIdentityMode = (typeof COHORT_IDENTITY_MODES)[number];

export interface CohortIdentityFlags {
  otpRequired: boolean;
  linkOnlyIdentity: boolean;
}

/**
 * The mode a pair of stored flags actually means.
 *
 * `link_only` wins outright: with the typed-identity step gone there is nothing
 * left for a code to verify, so `otp_required` is not consulted — which is why
 * the flag can be left exactly as the facilitator last set it.
 */
export function cohortIdentityMode(flags: CohortIdentityFlags): CohortIdentityMode {
  if (flags.linkOnlyIdentity) return 'link_only';
  return flags.otpRequired ? 'otp' : 'open';
}

/**
 * The PATCH body that puts a cohort into `mode`.
 *
 * Note what `link_only` does *not* say: it omits `otpRequired` rather than
 * sending false. The update handler leaves an absent field alone, so the code
 * requirement a facilitator had set survives a spell on personal links and
 * comes back with them — switching to `otp` and back must not quietly become
 * switching to `open`.
 */
export function cohortIdentityPatch(
  mode: CohortIdentityMode,
): { linkOnlyIdentity: boolean; otpRequired?: boolean } {
  if (mode === 'link_only') return { linkOnlyIdentity: true };
  return { linkOnlyIdentity: false, otpRequired: mode === 'otp' };
}

/**
 * What a respondent is told when they bring the shared link to a cohort that
 * has stopped accepting them. One string, because the refusal is issued by the
 * Worker at three doors and drawn by the candidate shell at a fourth, and a
 * respondent who sees two different wordings for the same wall will assume one
 * of them is a bug.
 */
export const LINK_ONLY_REFUSAL =
  'This exercise uses personal invitation links. Open the link that was emailed to you — this shared link cannot start the exercise.';
