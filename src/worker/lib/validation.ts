/** Request schemas. Every public body is parsed through one of these. */

import { z } from 'zod';
import { MAX_ANSWER, MIN_ANSWER } from '../../shared/scoring.js';

const trimmed = (max: number) => z.string().trim().max(max);

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
  ageBand: trimmed(40).min(1, 'Age range is required'),
  experienceBand: trimmed(40).min(1, 'Experience is required'),
  gender: trimmed(40).min(1, 'This field is required'),
});

export const answerSchema = z.object({
  no: z.number().int().min(1).max(200),
  value: z.number().int().min(MIN_ANSWER).max(MAX_ANSWER),
});

export const answerBatchSchema = z.object({
  answers: z.array(answerSchema).min(1).max(200),
  resumePage: z.number().int().min(0).max(100).optional(),
});

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
