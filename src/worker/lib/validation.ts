/** Request schemas. Every public body is parsed through one of these. */

import { z } from 'zod';
import { AGE_MAX, AGE_MIN, EXPERIENCE_MAX, EXPERIENCE_MIN, TENURE_BANDS } from '../../shared/types.js';

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * Age and experience are collected as exact years now, not as a band picked
 * from a list, so the server checks the number rather than accepting any short
 * string. The value stays TEXT on the way to D1: the column already holds band
 * labels from before the change and nothing downstream does arithmetic on it.
 */
const years = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    // The length cap lives in the pattern rather than in a separate `.max()` so
    // a legacy band label ("35-44") fails with "must be a number" instead of
    // zod's own character-count wording.
    .regex(/^\d{1,3}$/, `${label} must be a number`)
    .refine((v) => Number(v) >= min && Number(v) <= max, `${label} must be between ${min} and ${max}`);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  // Deliberately narrower than RFC 5322: it must have a dot-bearing domain and
  // no spaces, which is what actually matters for deliverability here.
  .regex(/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/, 'Enter a valid email address');

export const candidateDetailsSchema = z.object({
  firstName: trimmed(80).min(1, 'First name is required'),
  lastName: trimmed(80).min(1, 'Last name is required'),
  email: emailSchema,
  organisation: trimmed(120).min(1, 'Organisation is required'),
  ageBand: years(AGE_MIN, AGE_MAX, 'Age'),
  experienceBand: years(EXPERIENCE_MIN, EXPERIENCE_MAX, 'Experience'),
  gender: trimmed(40).min(1, 'This field is required'),
});

/**
 * Answer bounds are per-assessment — the Influencing Style Inventory is rated
 * 0–4 and the Ego States Scale 0–6 — so the schema is built from the rating
 * scale the link resolves to rather than from a single global constant. A
 * value outside the instrument's own range is rejected at the edge, not
 * clamped, because a 5 arriving for a 0–4 instrument means the client and the
 * server disagree about the scale and silently absorbing it would hide that.
 *
 * `maxNo` is the highest answer number the instrument can produce. A statement
 * inventory tops out at its statement count; a cohort instrument addresses a
 * matrix cell, so its ceiling is roster size × items and is passed in from the
 * cohort rather than assumed.
 */
export function answerBatchSchemaFor(min: number, max: number, maxNo = 200) {
  return z.object({
    answers: z
      .array(
        z.object({
          no: z.number().int().min(1).max(maxNo),
          value: z
            .number()
            .int()
            .min(min, `Rating must be at least ${min}`)
            .max(max, `Rating must be at most ${max}`),
        }),
      )
      .min(1)
      .max(200),
    // A cohort instrument pages by roster member, so the ceiling is the
    // largest roster the platform accepts rather than a statement-count page.
    resumePage: z.number().int().min(0).max(500).optional(),
  });
}

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const singleInviteSchema = z.object({
  assessmentId: z.string().min(1),
  firstName: trimmed(80).default(''),
  lastName: trimmed(80).default(''),
  email: emailSchema,
  organisation: trimmed(120).default(''),
  send: z.boolean().default(true),
});

export const autoSendSchema = z.object({
  autoSend: z.boolean(),
});

export const bulkRowSchema = z.object({
  firstName: trimmed(80).default(''),
  lastName: trimmed(80).default(''),
  email: z.string().trim().max(254),
  organisation: trimmed(120).default(''),
});

export const bulkPreviewSchema = z.object({
  csv: z.string().max(2_000_000),
});

export const bulkConfirmSchema = z.object({
  assessmentId: z.string().min(1),
  rows: z.array(bulkRowSchema).min(1).max(5000),
});

export const brandingSchema = z.object({
  companyName: trimmed(120).min(1),
  accentColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour such as #1A4FD6'),
  supportEmail: z.union([emailSchema, z.literal('')]).default(''),
  // ~1.4 MB of base64 ≈ 1 MB of image; D1 rows must stay well under limits.
  logoDataUrl: z
    .string()
    .max(1_400_000)
    .refine((v) => v === '' || /^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(v), {
      message: 'Logo must be a PNG, JPEG, SVG or WebP data URL',
    })
    .default(''),
});

export const mailSettingsSchema = z.object({
  dailySendCap: z.number().int().min(1).max(10_000),
  attachPdf: z.boolean(),
});

export const linkToggleSchema = z.object({ active: z.boolean() });

// ------------------------------------------------------------------ cohorts

/**
 * A cohort respondent identifies themselves from the roster instead of filling
 * in a details form. Name and function are the cohort's own facts, fixed by the
 * facilitator, so the only thing asked for is an email -- and that is asked for
 * because it is how their own peer-feedback report reaches them, not for
 * demographics. Age, experience and gender are not collected: they are
 * irrelevant to a network score and this is a named group.
 */
/**
 * Identity for a cohort respondent is the email the facilitator put on the
 * roster — nothing else. There is no name picker: a list of who is in the
 * group is the facilitator's information, and handing it to whoever opens the
 * link would leak the roster to anyone the link reaches.
 */
export const cohortIdentitySchema = z.object({
  email: emailSchema,
  /** Required only when the cohort has OTP switched on. Six digits, mailed. */
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email').optional(),
});

/** Asking for a code: the email alone. */
export const cohortOtpRequestSchema = z.object({
  email: emailSchema,
});

/**
 * A cohort's memorable alias, used as a bare path (`/acme-leadership-2026`).
 *
 * Deliberately narrow: it shares a namespace with the app's own routes and with
 * the instrument aliases, so it is lower-case, hyphen-separated and long enough
 * that a two-letter collision with a future route is unlikely.
 */
export const cohortSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lower-case letters, numbers and hyphens only');

/**
 * The editable settings of a cohort, without defaults.
 *
 * The defaults live on the create schema alone, and the update schema is built
 * from these bare fields rather than from `cohortCreateSchema.partial()`.
 * `.partial()` makes a key optional but does not strip its `.default()`, so a
 * partial update that omitted `organisation` would still parse as `''` — and
 * the handler's COALESCE, seeing a value rather than null, would overwrite the
 * stored one. A PATCH that only flipped the status silently blanked the
 * organisation and reset the rater floor and tie threshold to their defaults.
 */
const cohortFields = {
  name: trimmed(160).min(1, 'Give the cohort a name'),
  shortSlug: z.union([cohortSlugSchema, z.literal('')]),
  // The alias can be switched off without being given up: the slug stays
  // reserved to this cohort and the token link keeps working, the alias 404s.
  slugActive: z.boolean(),
  organisation: trimmed(160),
  minRaters: z.number().int().min(1).max(50),
  tieThreshold: z.number().int().min(1).max(5),
  minRatedTargets: z.number().int().min(0).max(200),
  /** Whether participants are promised their own report. See migration 0015. */
  shareReports: z.boolean(),
  /** Whether a one-time code must verify the roster email. See migration 0017. */
  otpRequired: z.boolean(),
  /**
   * Whether the shared generic link has stopped accepting identity claims, so
   * only a per-member personal link gets in. See migration 0019. Deliberately
   * a separate field from `otpRequired` rather than one three-valued mode: an
   * update that turns this on says nothing about the code requirement, so the
   * stored one survives and comes back when the facilitator switches away.
   */
  linkOnlyIdentity: z.boolean(),
};

export const cohortCreateSchema = z.object({
  name: cohortFields.name,
  organisation: cohortFields.organisation.default(''),
  minRaters: cohortFields.minRaters.default(3),
  tieThreshold: cohortFields.tieThreshold.default(4),
  minRatedTargets: cohortFields.minRatedTargets.default(1),
});

export const cohortUpdateSchema = z
  .object({ ...cohortFields, status: z.enum(['draft', 'open', 'closed']) })
  .partial();

/**
 * The two optional attributes a member may carry: how long they have been here,
 * and who they formally report to. See migration 0018.
 *
 * `.optional()` and no `.default()`, unlike `func` and `email` above. Those two
 * have a natural empty value — a blank string is a function nobody filled in —
 * where these have three states that must stay apart: absent (a PATCH that says
 * nothing about this field, leave it alone), null (explicitly not recorded,
 * clear it) and a value. Defaulting either one would turn every partial edit of
 * a name into a silent wipe of the attributes.
 */
const memberAttributeFields = {
  tenureBand: z.enum(TENURE_BANDS).nullable().optional(),
  // A roster position, so the same 1..200 range positions are capped at
  // everywhere else. Whether the position actually exists on *this* cohort —
  // and whether it is the member's own — is checked by `reportsToError`, which
  // needs the roster and cannot be expressed here.
  reportsTo: z.number().int().min(1).max(200).nullable().optional(),
};

/**
 * The one rule about `reportsTo` a schema cannot state.
 *
 * A member schema validates one member in isolation: it sees neither which
 * roster position that member holds nor which positions exist on the cohort, so
 * "nobody reports to themselves" and "the manager is on this roster" have to be
 * asked once the handler has both. Kept here beside the field it guards rather
 * than inline in the route, so the two places that write a member cannot drift.
 *
 * Returns the message to refuse with, or null when the value is acceptable —
 * including when it is absent or null, which is always acceptable.
 */
export function reportsToError(
  reportsTo: number | null | undefined,
  ownNo: number | null,
  rosterNos: ReadonlySet<number>,
): string | null {
  if (reportsTo === undefined || reportsTo === null) return null;
  if (ownNo !== null && reportsTo === ownNo) {
    return 'Someone cannot report to themselves. Leave it blank if there is nobody above them here.';
  }
  if (!rosterNos.has(reportsTo)) {
    return `Position ${reportsTo} is not on this roster, so nobody can report to it.`;
  }
  return null;
}

export const rosterRowSchema = z.object({
  name: trimmed(120).min(1, 'Every roster row needs a name'),
  func: trimmed(120).default(''),
  email: z.union([emailSchema, z.literal('')]).default(''),
  ...memberAttributeFields,
});

/**
 * The roster is replaced wholesale rather than diffed. Positions are the
 * addresses the stored ratings use, so the handler -- not this schema -- is
 * where existing positions are preserved; see the roster route.
 */
export const rosterSetSchema = z.object({
  members: z.array(rosterRowSchema).min(1).max(200),
});

/**
 * The whole assignment map, replaced wholesale like the roster: who rates whom
 * when the cohort is too big for everyone-rates-everyone. An empty list clears
 * the map and returns the cohort to the full matrix.
 */
export const assignmentsSetSchema = z.object({
  assignments: z
    .array(
      z.object({
        raterMemberId: z.string().min(1),
        targetMemberIds: z.array(z.string().min(1)).max(200),
      }),
    )
    .max(200),
});

/** Whole rows to blank out, addressed by roster position. */
export const clearRowSchema = z.object({
  memberNos: z.array(z.number().int().min(1).max(200)).min(1).max(200),
  resumePage: z.number().int().min(0).max(500).optional(),
});

/** One roster member, added or edited on their own. */
export const rosterMemberSchema = z.object({
  name: trimmed(120).min(1, 'Name is required'),
  func: trimmed(120).default(''),
  email: z.union([emailSchema, z.literal('')]).default(''),
  ...memberAttributeFields,
});

/**
 * A roster workbook, uploaded rather than pasted. Base64 because the Worker
 * reads the bytes itself: the same three columns as the paste box, so a client
 * can hand over the spreadsheet the facilitator already has instead of
 * retyping it.
 */
export const rosterUploadSchema = z.object({
  // ~6 MB of base64 is about 4.5 MB of workbook, far more than a roster needs.
  fileBase64: z.string().min(1).max(6_000_000),
  filename: trimmed(200).default(''),
});

/**
 * One workbook in, one working cohort out. Name and organisation typed in the
 * console win over anything found in the file; the file wins over its own
 * filename.
 */
export const cohortImportSchema = z.object({
  fileBase64: z.string().min(1).max(6_000_000),
  filename: trimmed(200).default(''),
  name: z.union([trimmed(160), z.literal('')]).default(''),
  organisation: z.union([trimmed(160), z.literal('')]).default(''),
});

/**
 * What the console hands over for an insight PDF. Display strings only: the
 * server draws them, it does not re-derive them.
 */
export const insightExportSchema = z.object({
  round: trimmed(80).default(''),
  tabTitle: trimmed(120).default(''),
  question: trimmed(200).default(''),
  finding: trimmed(600).default(''),
  /** A PNG data URL of the picture. Capped: a map at 2x is well under this. */
  imageDataUrl: z.string().max(12_000_000).optional(),
  columns: z
    .array(z.object({ head: trimmed(60), right: z.boolean().optional(), weight: z.number().min(0.2).max(8).optional() }))
    .max(16)
    .default([]),
  rows: z.array(z.array(trimmed(200)).max(16)).max(2000).default([]),
  panels: z
    .array(
      z.object({
        title: trimmed(80),
        rows: z.array(z.tuple([trimmed(120), trimmed(80)])).max(40),
      }),
    )
    .max(8)
    .default([]),
});

/** Roster paste: one member per line, `Name, Function, email`. */
export const rosterPasteSchema = z.object({
  text: z.string().max(200_000),
});

export type CandidateDetailsInput = z.infer<typeof candidateDetailsSchema>;
export type BulkRow = z.infer<typeof bulkRowSchema>;

/** Flattens a ZodError into the { field: message } shape the forms expect. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
