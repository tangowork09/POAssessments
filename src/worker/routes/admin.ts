/**
 * Admin API. Everything here sits behind the session cookie; nothing in it is
 * referenced by the candidate shell, and no candidate-facing route links here.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import ExcelJS from 'exceljs';
import type { Env } from '../env.js';
import { baseUrl } from '../env.js';
import { clearSession, issueSession, readSession, verifyPassword } from '../lib/auth.js';
import type { AdminHono } from '../lib/auth.js';
import { newId } from '../lib/ids.js';
import { sendMail } from '../lib/mailer.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import {
  attachPdf,
  brandingFrom,
  dailySendCap,
  getSettings,
  setSetting,
} from '../lib/settings.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import {
  brandingSchema,
  bulkConfirmSchema,
  bulkPreviewSchema,
  emailSchema,
  fieldErrors,
  linkToggleSchema,
  loginSchema,
  mailSettingsSchema,
  singleInviteSchema,
} from '../lib/validation.js';
import { consumeSendAllowance, dispatch, ensureCandidateAndLink, sendsToday } from '../pipeline.js';
import { inviteEmail } from '../email/templates.js';
import { MAX_STYLE_SCORE } from '../../shared/scoring.js';
import { STYLES } from '../../shared/styles.js';

export const adminRoutes = new Hono<AdminHono>();

// ------------------------------------------------------------------- session

adminRoutes.post('/login', async (c) => {
  const rl = await rateLimit(c.env, `login:${clientKey(c.req.raw)}`, 10, 300);
  if (!rl.allowed) return c.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);

  const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Enter your email address and password.' }, 400);

  const user = await c.env.DB.prepare('SELECT id, email, name, password_hash FROM admin_users WHERE email = ?1')
    .bind(parsed.data.email)
    .first<{ id: string; email: string; name: string; password_hash: string }>();

  // Same message and comparable work for unknown users and wrong passwords.
  const ok = user ? await verifyPassword(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) return c.json({ error: 'Those details were not recognised.' }, 401);

  await c.env.DB.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?1`)
    .bind(user.id)
    .run();

  await issueSession(c, { sub: user.id, email: user.email, name: user.name });
  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

adminRoutes.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

adminRoutes.get('/me', async (c) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  return c.json({ user: { id: claims.sub, email: claims.email, name: claims.name } });
});

const requireAdmin: MiddlewareHandler<AdminHono> = async (c, next) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  c.set('admin', claims);
  await next();
};

adminRoutes.use('/dashboard', requireAdmin);
adminRoutes.use('/assessments/*', requireAdmin);
adminRoutes.use('/assessments', requireAdmin);
adminRoutes.use('/candidates/*', requireAdmin);
adminRoutes.use('/candidates', requireAdmin);
adminRoutes.use('/invites/*', requireAdmin);
adminRoutes.use('/links/*', requireAdmin);
adminRoutes.use('/links', requireAdmin);
adminRoutes.use('/branding', requireAdmin);
adminRoutes.use('/settings/*', requireAdmin);
adminRoutes.use('/export/*', requireAdmin);
adminRoutes.use('/outbox', requireAdmin);

// ----------------------------------------------------------------- dashboard

adminRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;

  const [totals, trend, assessments, recent, cohort, settings] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM candidates)                                   AS candidates,
           (SELECT COUNT(*) FROM responses)                                    AS invited,
           (SELECT COUNT(*) FROM responses WHERE status = 'in_progress')       AS in_progress,
           (SELECT COUNT(*) FROM responses WHERE status = 'completed')         AS completed,
           (SELECT COUNT(*) FROM responses WHERE status <> 'invited')          AS started`,
      )
      .first<{
        candidates: number;
        invited: number;
        in_progress: number;
        completed: number;
        started: number;
      }>(),
    // Twelve ISO weeks of completions, oldest first.
    db
      .prepare(
        `SELECT strftime('%Y-%W', completed_at) AS week, COUNT(*) AS n
           FROM responses
          WHERE status = 'completed' AND completed_at >= date('now', '-84 days')
          GROUP BY week ORDER BY week`,
      )
      .all<{ week: string; n: number }>(),
    db
      .prepare(
        `SELECT a.id, a.slug, a.name, a.description, a.status, a.question_count,
                (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id) AS invited,
                (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status <> 'invited') AS started,
                (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status = 'completed') AS completed
           FROM assessments a ORDER BY a.status DESC, a.name`,
      )
      .all(),
    db
      .prepare(
        `SELECT r.id, r.status, r.answered_count, r.completed_at, r.invited_at,
                c.first_name, c.last_name, c.email, c.organisation, a.name AS assessment_name
           FROM responses r
           JOIN candidates c ON c.id = r.candidate_id
           JOIN assessments a ON a.id = r.assessment_id
          ORDER BY COALESCE(r.completed_at, r.started_at, r.invited_at) DESC
          LIMIT 8`,
      )
      .all(),
    db.prepare('SELECT scores_json FROM reports').all<{ scores_json: string }>(),
    getSettings(c.env),
  ]);

  return c.json({
    totals: totals ?? { candidates: 0, invited: 0, in_progress: 0, completed: 0, started: 0 },
    completionRate:
      totals && totals.started > 0 ? Math.round((totals.completed / totals.started) * 1000) / 10 : null,
    trend: fillWeeks(trend.results ?? []),
    assessments: assessments.results ?? [],
    recent: recent.results ?? [],
    cohort: cohortAverages(cohort.results ?? []),
    sendsToday: await sendsToday(c.env),
    dailySendCap: dailySendCap(settings),
  });
});

/** Pads the trend to a full twelve weeks so the chart never shrinks. */
function fillWeeks(rows: { week: string; n: number }[]): { week: string; label: string; n: number }[] {
  const byWeek = new Map(rows.map((r) => [r.week, r.n]));
  const out: { week: string; label: string; n: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86_400_000);
    const key = `${d.getUTCFullYear()}-${String(isoWeekNumber(d)).padStart(2, '0')}`;
    out.push({
      week: key,
      label: `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`,
      n: byWeek.get(key) ?? 0,
    });
  }
  return out;
}

/** Matches SQLite's strftime('%W') — weeks start on Monday, week 00 possible. */
function isoWeekNumber(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const firstDay = new Date(start).getUTCDay();
  const daysSinceJan1 = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86_400_000);
  const offset = (firstDay + 6) % 7; // days from Monday
  return Math.floor((daysSinceJan1 + offset) / 7);
}

function cohortAverages(rows: { scores_json: string }[]): {
  key: string;
  name: string;
  side: string;
  average: number;
  n: number;
}[] {
  const totals = new Map<string, number>();
  let n = 0;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.scores_json) as { styles: { key: string; score: number }[] };
      for (const s of parsed.styles) totals.set(s.key, (totals.get(s.key) ?? 0) + s.score);
      n++;
    } catch {
      // A malformed historical row must not take the dashboard down.
    }
  }
  return STYLES.map((s) => ({
    key: s.key,
    name: s.name,
    side: s.side,
    average: n === 0 ? 0 : Math.round(((totals.get(s.key) ?? 0) / n) * 10) / 10,
    n,
  }));
}

// --------------------------------------------------------------- assessments

adminRoutes.get('/assessments', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.slug, a.name, a.description, a.status, a.question_count,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id) AS invited,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status <> 'invited') AS started,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status = 'completed') AS completed
       FROM assessments a ORDER BY a.status DESC, a.name`,
  ).all();
  return c.json({ assessments: results ?? [], maxStyleScore: MAX_STYLE_SCORE });
});

// ---------------------------------------------------------------- candidates

adminRoutes.get('/candidates', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const status = c.req.query('status') ?? '';
  const assessmentId = c.req.query('assessment') ?? '';

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    binds.push(`%${q}%`);
    where.push(
      `(lower(c.first_name || ' ' || c.last_name) LIKE ?${binds.length} OR lower(c.email) LIKE ?${binds.length} OR lower(c.organisation) LIKE ?${binds.length})`,
    );
  }
  if (status) {
    binds.push(status);
    where.push(`r.status = ?${binds.length}`);
  }
  if (assessmentId) {
    binds.push(assessmentId);
    where.push(`r.assessment_id = ?${binds.length}`);
  }

  const sql = `
    SELECT r.id AS response_id, r.status, r.answered_count, r.invited_at, r.started_at, r.completed_at,
           c.id AS candidate_id, c.first_name, c.last_name, c.email, c.organisation,
           a.id AS assessment_id, a.name AS assessment_name, a.question_count,
           rp.scores_json,
           l.id AS link_id, l.active AS link_active
      FROM responses r
      JOIN candidates c ON c.id = r.candidate_id
      JOIN assessments a ON a.id = r.assessment_id
      LEFT JOIN reports rp ON rp.response_id = r.id
      LEFT JOIN links l ON l.kind = 'personal' AND l.assessment_id = r.assessment_id AND l.candidate_id = r.candidate_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(r.completed_at, r.started_at, r.invited_at) DESC
     LIMIT 1000`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return c.json({ candidates: (results ?? []).map(decorate) });
});

function decorate(row: Record<string, unknown>): Record<string, unknown> {
  const scoresJson = row.scores_json as string | null;
  let push: number | null = null;
  let pull: number | null = null;
  if (scoresJson) {
    try {
      const parsed = JSON.parse(scoresJson) as { push: number; pull: number };
      push = parsed.push;
      pull = parsed.pull;
    } catch {
      /* ignore malformed historical rows */
    }
  }
  const { scores_json: _drop, ...rest } = row;
  return { ...rest, push, pull, hasReport: scoresJson !== null };
}

/**
 * Mints a fresh personal link for a candidate. Existing tokens are stored only
 * as hashes, so "copy personal link" necessarily issues a new one and retires
 * the previous value.
 */
adminRoutes.post('/candidates/:responseId/link', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT assessment_id, candidate_id FROM responses WHERE id = ?1',
  )
    .bind(c.req.param('responseId'))
    .first<{ assessment_id: string; candidate_id: string }>();
  if (!row) return c.json({ error: 'Unknown candidate' }, 404);

  const token = generateToken();
  const hash = await hashToken(token, c.env.LINK_TOKEN_SECRET);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM links WHERE kind = 'personal' AND assessment_id = ?1 AND candidate_id = ?2`,
  )
    .bind(row.assessment_id, row.candidate_id)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare('UPDATE links SET token_hash = ?2, active = 1 WHERE id = ?1')
      .bind(existing.id, hash)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, active)
       VALUES (?1, ?2, 'personal', ?3, ?4, 1)`,
    )
      .bind(newId('link'), hash, row.assessment_id, row.candidate_id)
      .run();
  }

  return c.json({ url: `${baseUrl(c.env, c.req.raw)}/t/${token}`, rotated: Boolean(existing) });
});

adminRoutes.post('/candidates/:responseId/resend', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT r.assessment_id, r.candidate_id, a.name AS assessment_name, a.question_count,
            c.email, c.first_name, c.last_name, c.organisation
       FROM responses r
       JOIN assessments a ON a.id = r.assessment_id
       JOIN candidates c ON c.id = r.candidate_id
      WHERE r.id = ?1`,
  )
    .bind(c.req.param('responseId'))
    .first<{
      assessment_id: string;
      candidate_id: string;
      assessment_name: string;
      question_count: number;
      email: string;
      first_name: string;
      last_name: string;
      organisation: string;
    }>();
  if (!row) return c.json({ error: 'Unknown candidate' }, 404);

  const settings = await getSettings(c.env);
  const cap = dailySendCap(settings);
  if (!(await consumeSendAllowance(c.env, cap))) {
    return c.json({ status: 'failed', error: `Daily send cap of ${cap} reached.` }, 429);
  }

  const { token } = await ensureCandidateAndLink(c.env, {
    assessmentId: row.assessment_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    organisation: row.organisation,
  });

  const branding = brandingFrom(settings);
  const mail = inviteEmail({
    branding,
    firstName: row.first_name,
    assessmentName: row.assessment_name,
    link: `${baseUrl(c.env, c.req.raw)}/t/${token}`,
    questionCount: row.question_count,
  });
  const result = await sendMail(c.env, {
    to: row.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'invite',
  });

  return c.json({ status: result.status, error: result.error ?? null });
});

/** Per-link enable/disable — the only way a link ever stops working. */
adminRoutes.post('/links/:linkId/active', async (c) => {
  const parsed = linkToggleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid payload' }, 400);

  const res = await c.env.DB.prepare('UPDATE links SET active = ?2 WHERE id = ?1')
    .bind(c.req.param('linkId'), parsed.data.active ? 1 : 0)
    .run();
  if (!res.meta.changes) return c.json({ error: 'Unknown link' }, 404);
  return c.json({ active: parsed.data.active });
});

// -------------------------------------------------------------- generic links

adminRoutes.get('/links', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id AS assessment_id, a.name, a.slug, a.status, a.question_count,
            l.id AS link_id, l.active, l.created_at, l.last_seen_at
       FROM assessments a
       LEFT JOIN links l ON l.assessment_id = a.id AND l.kind = 'generic'
      ORDER BY a.status DESC, a.name`,
  ).all();
  const settings = await getSettings(c.env);
  return c.json({ links: results ?? [], activeTheme: settings['theme.active'] });
});

/**
 * Issues (or reissues) the always-active generic link for one assessment. Every
 * assessment has exactly one, enforced by a partial unique index.
 */
adminRoutes.post('/links/generic/:assessmentId', async (c) => {
  const assessmentId = c.req.param('assessmentId');
  const assessment = await c.env.DB.prepare('SELECT id FROM assessments WHERE id = ?1')
    .bind(assessmentId)
    .first<{ id: string }>();
  if (!assessment) return c.json({ error: 'Unknown assessment' }, 404);

  const token = generateToken();
  const hash = await hashToken(token, c.env.LINK_TOKEN_SECRET);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM links WHERE kind = 'generic' AND assessment_id = ?1`,
  )
    .bind(assessmentId)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare('UPDATE links SET token_hash = ?2, active = 1 WHERE id = ?1')
      .bind(existing.id, hash)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, active)
       VALUES (?1, ?2, 'generic', ?3, NULL, 1)`,
    )
      .bind(newId('link'), hash, assessmentId)
      .run();
  }

  return c.json({ url: `${baseUrl(c.env, c.req.raw)}/t/${token}`, rotated: Boolean(existing) });
});

// ------------------------------------------------------------------- invites

adminRoutes.post('/invites/single', async (c) => {
  const parsed = singleInviteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  const assessment = await c.env.DB.prepare(
    'SELECT id, name, question_count, status FROM assessments WHERE id = ?1',
  )
    .bind(d.assessmentId)
    .first<{ id: string; name: string; question_count: number; status: string }>();
  if (!assessment) return c.json({ error: 'Unknown assessment' }, 404);

  const { token } = await ensureCandidateAndLink(c.env, {
    assessmentId: d.assessmentId,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    organisation: d.organisation,
  });
  const url = `${baseUrl(c.env, c.req.raw)}/t/${token}`;

  if (!d.send) return c.json({ url, sent: false });

  const settings = await getSettings(c.env);
  const cap = dailySendCap(settings);
  // Consumes the slot as well as checking it, so single and bulk sends draw on
  // the same ledger rather than the cap only counting batches.
  if (!(await consumeSendAllowance(c.env, cap))) {
    return c.json({ url, sent: false, error: `Daily send cap of ${cap} reached.` }, 429);
  }

  const branding = brandingFrom(settings);
  const mail = inviteEmail({
    branding,
    firstName: d.firstName,
    assessmentName: assessment.name,
    link: url,
    questionCount: assessment.question_count,
  });
  const result = await sendMail(c.env, {
    to: d.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'invite',
  });

  return c.json({ url, sent: result.status !== 'failed', status: result.status, error: result.error ?? null });
});

/**
 * Validates a pasted or uploaded CSV without writing anything. Bad addresses
 * are flagged in place and duplicates are collapsed, so the administrator sees
 * exactly what confirming would do.
 */
adminRoutes.post('/invites/bulk/preview', async (c) => {
  const parsed = bulkPreviewSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Could not read that file.' }, 400);

  const rows = parseCsv(parsed.data.csv);
  if (rows.length === 0) return c.json({ error: 'That file has no data rows.' }, 400);

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = {
    email: findColumn(header, ['email', 'e-mail', 'email address']),
    first: findColumn(header, ['first name', 'firstname', 'first', 'given name']),
    last: findColumn(header, ['last name', 'lastname', 'last', 'surname', 'family name']),
    org: findColumn(header, ['organisation', 'organization', 'org', 'company']),
  };
  if (idx.email < 0) {
    return c.json({ error: 'No "email" column found. Expected a header row with an email column.' }, 400);
  }

  const seen = new Set<string>();
  const existing = new Set(
    ((await c.env.DB.prepare('SELECT email FROM candidates').all<{ email: string }>()).results ?? []).map(
      (r) => r.email,
    ),
  );

  const items = rows.slice(1).map((cells, i) => {
    const email = (cells[idx.email] ?? '').trim().toLowerCase();
    const parsedEmail = emailSchema.safeParse(email);
    const duplicate = parsedEmail.success && seen.has(email);
    if (parsedEmail.success) seen.add(email);
    return {
      row: i + 2,
      firstName: idx.first >= 0 ? (cells[idx.first] ?? '').trim() : '',
      lastName: idx.last >= 0 ? (cells[idx.last] ?? '').trim() : '',
      email,
      organisation: idx.org >= 0 ? (cells[idx.org] ?? '').trim() : '',
      valid: parsedEmail.success && !duplicate,
      issue: !email
        ? 'Missing email address'
        : !parsedEmail.success
          ? 'Not a valid email address'
          : duplicate
            ? 'Duplicate of an earlier row'
            : null,
      known: parsedEmail.success && existing.has(email),
    };
  });

  const settings = await getSettings(c.env);
  return c.json({
    items,
    validCount: items.filter((i) => i.valid).length,
    invalidCount: items.filter((i) => !i.valid).length,
    dailySendCap: dailySendCap(settings),
    sendsToday: await sendsToday(c.env),
  });
});

adminRoutes.post('/invites/bulk/confirm', async (c) => {
  const parsed = bulkConfirmSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid batch payload' }, 400);

  const valid = parsed.data.rows.filter((r) => emailSchema.safeParse(r.email).success);
  if (valid.length === 0) return c.json({ error: 'No valid rows to send.' }, 400);

  const batchId = newId('batch');
  await c.env.DB.prepare(
    `INSERT INTO invite_batches (id, assessment_id, total, status) VALUES (?1, ?2, ?3, 'running')`,
  )
    .bind(batchId, parsed.data.assessmentId, valid.length)
    .run();

  const items = valid.map((r) => ({ id: newId('bi'), ...r, email: r.email.trim().toLowerCase() }));
  // D1 caps a batch; 50 statements at a time keeps well inside it.
  for (let i = 0; i < items.length; i += 50) {
    await c.env.DB.batch(
      items.slice(i, i + 50).map((r) =>
        c.env.DB.prepare(
          `INSERT INTO invite_batch_items (id, batch_id, email, first_name, last_name, organisation, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')`,
        ).bind(r.id, batchId, r.email, r.firstName, r.lastName, r.organisation),
      ),
    );
  }

  // Throttled: one queue message per recipient, each of which re-checks the
  // daily cap when it runs.
  for (const item of items) {
    await dispatch(c.env, { type: 'send_invite', batchItemId: item.id }, c.executionCtx);
  }

  return c.json({ batchId, queued: items.length });
});

adminRoutes.get('/invites/bulk/:batchId', async (c) => {
  const batchId = c.req.param('batchId');
  const batch = await c.env.DB.prepare('SELECT * FROM invite_batches WHERE id = ?1')
    .bind(batchId)
    .first();
  if (!batch) return c.json({ error: 'Unknown batch' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, email, first_name, last_name, status, error
       FROM invite_batch_items WHERE batch_id = ?1 ORDER BY status, email`,
  )
    .bind(batchId)
    .all();

  return c.json({ batch, items: results ?? [] });
});

/** Requeues just the failures of a batch. */
adminRoutes.post('/invites/bulk/:batchId/retry', async (c) => {
  const batchId = c.req.param('batchId');
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM invite_batch_items WHERE batch_id = ?1 AND status = 'failed'`,
  )
    .bind(batchId)
    .all<{ id: string }>();

  const ids = (results ?? []).map((r) => r.id);
  if (ids.length === 0) return c.json({ retried: 0 });

  await c.env.DB.batch([
    ...ids.map((id) =>
      c.env.DB.prepare(`UPDATE invite_batch_items SET status = 'pending', error = NULL WHERE id = ?1`).bind(id),
    ),
    c.env.DB
      .prepare(`UPDATE invite_batches SET failed = MAX(failed - ?2, 0), status = 'running', finished_at = NULL WHERE id = ?1`)
      .bind(batchId, ids.length),
  ]);

  for (const id of ids) {
    await dispatch(c.env, { type: 'send_invite', batchItemId: id }, c.executionCtx);
  }
  return c.json({ retried: ids.length });
});

adminRoutes.get('/invites/batches', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.*, a.name AS assessment_name FROM invite_batches b
       JOIN assessments a ON a.id = b.assessment_id
      ORDER BY b.created_at DESC LIMIT 20`,
  ).all();
  return c.json({ batches: results ?? [] });
});

// ------------------------------------------------------------------ branding

adminRoutes.get('/branding', async (c) => {
  const settings = await getSettings(c.env);
  return c.json({
    branding: brandingFrom(settings),
    mail: { dailySendCap: dailySendCap(settings), attachPdf: attachPdf(settings) },
    activeTheme: settings['theme.active'],
  });
});

adminRoutes.put('/branding', async (c) => {
  const parsed = brandingSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;
  await Promise.all([
    setSetting(c.env, 'branding.company_name', d.companyName),
    setSetting(c.env, 'branding.accent_color', d.accentColor.toUpperCase()),
    setSetting(c.env, 'branding.support_email', d.supportEmail),
    setSetting(c.env, 'branding.logo_data_url', d.logoDataUrl),
  ]);
  return c.json({ branding: brandingFrom(await getSettings(c.env)) });
});

adminRoutes.put('/settings/mail', async (c) => {
  const parsed = mailSettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid mail settings' }, 400);
  await Promise.all([
    setSetting(c.env, 'mail.daily_send_cap', String(parsed.data.dailySendCap)),
    setSetting(c.env, 'mail.attach_pdf', parsed.data.attachPdf ? 'true' : 'false'),
  ]);
  return c.json({ ok: true });
});

adminRoutes.get('/outbox', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, to_email, subject, kind, status, error, created_at, sent_at
       FROM mail_outbox ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return c.json({ messages: results ?? [] });
});

// ------------------------------------------------------------------- exports

interface ExportRow {
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  age_band: string;
  experience_band: string;
  gender: string;
  assessment_name: string;
  status: string;
  answered_count: number;
  invited_at: string;
  completed_at: string | null;
  scores_json: string | null;
}

async function exportRows(env: Env): Promise<ExportRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.first_name, c.last_name, c.email, c.organisation, c.age_band, c.experience_band, c.gender,
            a.name AS assessment_name, r.status, r.answered_count, r.invited_at, r.completed_at,
            rp.scores_json
       FROM responses r
       JOIN candidates c ON c.id = r.candidate_id
       JOIN assessments a ON a.id = r.assessment_id
       LEFT JOIN reports rp ON rp.response_id = r.id
      ORDER BY COALESCE(r.completed_at, r.invited_at) DESC`,
  ).all<ExportRow>();
  return results ?? [];
}

const EXPORT_HEADERS = [
  'First name',
  'Last name',
  'Email',
  'Organisation',
  'Age',
  'Experience',
  'Gender',
  'Assessment',
  'Status',
  'Answered',
  'Invited',
  'Completed',
  'Push /100',
  'Pull /100',
  ...STYLES.map((s) => `${s.name} /${MAX_STYLE_SCORE}`),
];

function exportCells(row: ExportRow): (string | number | null)[] {
  let push: number | null = null;
  let pull: number | null = null;
  const styleScores = new Map<string, number>();
  if (row.scores_json) {
    try {
      const parsed = JSON.parse(row.scores_json) as {
        push: number;
        pull: number;
        styles: { key: string; score: number }[];
      };
      push = parsed.push;
      pull = parsed.pull;
      for (const s of parsed.styles) styleScores.set(s.key, s.score);
    } catch {
      /* leave the score columns empty for a malformed row */
    }
  }
  return [
    row.first_name,
    row.last_name,
    row.email,
    row.organisation,
    row.age_band,
    row.experience_band,
    row.gender,
    row.assessment_name,
    row.status,
    row.answered_count,
    row.invited_at,
    row.completed_at,
    push,
    pull,
    ...STYLES.map((s) => styleScores.get(s.key) ?? null),
  ];
}

adminRoutes.get('/export/csv', async (c) => {
  const rows = await exportRows(c.env);
  const csv = [EXPORT_HEADERS, ...rows.map(exportCells)]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n');
  return new Response('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="candidates-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

adminRoutes.get('/export/xlsx', async (c) => {
  const rows = await exportRows(c.env);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Assessment Platform';
  wb.created = new Date();
  const ws = wb.addWorksheet('Candidates', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.addRow(EXPORT_HEADERS);
  ws.getRow(1).font = { bold: true, color: { argb: 'FF0C1421' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F8' } };
  for (const row of rows) ws.addRow(exportCells(row));

  ws.columns.forEach((col, i) => {
    const header = EXPORT_HEADERS[i] ?? '';
    col.width = Math.max(12, Math.min(28, header.length + 4));
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_HEADERS.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="candidates-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});

// -------------------------------------------------------------------- helpers

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Guard against spreadsheet formula injection from candidate-supplied text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function findColumn(header: string[], candidates: string[]): number {
  for (const name of candidates) {
    const i = header.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

/** RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/^﻿/, '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

export const _testing = { parseCsv, csvCell, fillWeeks, cohortAverages };
