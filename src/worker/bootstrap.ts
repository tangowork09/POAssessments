/**
 * First-boot seeding.
 *
 * Creates the administrator from ADMIN_EMAIL / ADMIN_PASSWORD if no admin
 * exists — as a superadmin, since that account is the owner — reconciles the
 * shared cohort-only account from COHORT_ADMIN_EMAIL / COHORT_ADMIN_PASSWORD,
 * and issues the generic always-active link for every live assessment that
 * lacks one. All three are idempotent, and the whole thing short-circuits
 * after the first successful run in an isolate.
 */

import type { Env } from './env.js';
import { hashPassword, verifyPassword } from './lib/auth.js';
import { newId } from './lib/ids.js';
import { generateToken, hashToken } from './lib/tokens.js';
import { ASSESSMENT_ID, isCohortAssessment } from '../shared/assessments.js';

let done = false;

export async function bootstrap(env: Env): Promise<void> {
  if (done) return;
  try {
    await seedAdmin(env);
    await seedCohortAdmin(env);
    await seedGenericLinks(env);
    done = true;
  } catch (err) {
    // Most often the migrations have not been applied yet. Leave `done` false
    // so the next request tries again rather than wedging the isolate.
    console.error('[bootstrap] deferred:', err instanceof Error ? err.message : err);
  }
}

async function seedAdmin(env: Env): Promise<void> {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return;

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn('[bootstrap] no admin seeded — set ADMIN_EMAIL and ADMIN_PASSWORD');
    return;
  }

  const hash = await hashPassword(env.ADMIN_PASSWORD);
  // The seeded account is the owner: it is the only one that can reach
  // Branding. Client administrators are created as plain 'admin'.
  await env.DB.prepare(
    `INSERT INTO admin_users (id, email, name, password_hash, role)
     VALUES (?1, ?2, ?3, ?4, 'superadmin')
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(newId('admin'), env.ADMIN_EMAIL.trim().toLowerCase(), 'Administrator', hash)
    .run();

  console.log(`[bootstrap] seeded superadmin ${env.ADMIN_EMAIL}`);
}

/**
 * The shared facilitator account: one credential pair, the same in every
 * environment, that reaches Cohorts and nothing else.
 *
 * Reconciled rather than seeded. `seedAdmin` runs only into an empty table, so
 * it could never introduce a second account to a deployment that already has
 * one — and this account has to appear in deployments that are long past their
 * first boot. It is also the way the password stays changeable: the configured
 * value is authoritative, so rotating it is a config edit and a deploy rather
 * than a hand-written bcrypt hash in the database.
 *
 * The role is re-asserted on every boot too. That is deliberate: this account
 * is handed out widely, and a stray UPDATE raising it to 'admin' would be
 * silent otherwise.
 */
async function seedCohortAdmin(env: Env): Promise<void> {
  const email = env.COHORT_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.COHORT_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await env.DB
    .prepare('SELECT id, role, password_hash FROM admin_users WHERE email = ?1')
    .bind(email)
    .first<{ id: string; role: string; password_hash: string }>();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO admin_users (id, email, name, password_hash, role)
       VALUES (?1, ?2, 'Cohort administrator', ?3, 'cohort_admin')
       ON CONFLICT(email) DO NOTHING`,
    )
      .bind(newId('admin'), email, await hashPassword(password))
      .run();
    console.log(`[bootstrap] seeded cohort admin ${email}`);
    return;
  }

  // One bcrypt compare per isolate, and only when the account is configured.
  const current = await verifyPassword(password, existing.password_hash);
  if (current && existing.role === 'cohort_admin') return;

  await env.DB.prepare('UPDATE admin_users SET password_hash = ?2, role = ?3 WHERE id = ?1')
    .bind(existing.id, current ? existing.password_hash : await hashPassword(password), 'cohort_admin')
    .run();
  console.log(`[bootstrap] reconciled cohort admin ${email}`);
}

/**
 * Every self-rating assessment gets exactly one generic link. The plaintext
 * token is printed once, here, because only its hash is retained — the admin
 * console can always reissue one on demand.
 *
 * Cohort instruments are excluded. Their link belongs to a cohort rather than
 * to the instrument, and a link seeded here would carry no cohort_id — so it
 * would resolve, open, and then tell the respondent it is not attached to a
 * group. Those links are issued from the Cohorts panel instead.
 */
async function seedGenericLinks(env: Env): Promise<void> {
  const cohortIds = Object.values(ASSESSMENT_ID).filter((id) => isCohortAssessment(id));
  const exclusion = cohortIds.map((_, i) => `?${i + 1}`).join(', ');

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.name FROM assessments a
      WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.assessment_id = a.id AND l.kind = 'generic')
        ${cohortIds.length > 0 ? `AND a.id NOT IN (${exclusion})` : ''}`,
  )
    .bind(...cohortIds)
    .all<{ id: string; name: string }>();

  for (const assessment of results ?? []) {
    const token = generateToken();
    // token_plain is what lets the short-slug redirect (/influencing, etc.)
    // resolve to whichever generic token is current, including after a
    // rotation — a generic link has no per-candidate secrecy to protect, so
    // retaining it here is not the exception personal links make hashing for.
    await env.DB.prepare(
      `INSERT INTO links (id, token_hash, token_plain, kind, assessment_id, candidate_id, active)
       VALUES (?1, ?2, ?3, 'generic', ?4, NULL, 1)`,
    )
      .bind(newId('link'), await hashToken(token, env.LINK_TOKEN_SECRET), token, assessment.id)
      .run();
    console.log(`[bootstrap] generic link for "${assessment.name}": /t/${token}`);
  }
}
