/**
 * Admin API. Everything here sits behind the session cookie; nothing in it is
 * referenced by the candidate shell, and no candidate-facing route links here.
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Env } from '../env.js';
import { baseUrl } from '../env.js';
import { clearSession, issueSession, readSession, toRole, verifyPassword } from '../lib/auth.js';
import type { AdminHono } from '../lib/auth.js';
import { auditAll, recordBefore } from '../lib/audit.js';
import { roundName } from '../lib/cohort.js';
import { newId } from '../lib/ids.js';
import { sendMail } from '../lib/mailer.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import { renderReportForResponse } from '../lib/report-render.js';
import {
  attachPdf,
  brandingFrom,
  dailySendCap,
  getSettings,
  setSetting,
} from '../lib/settings.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import {
  autoSendSchema,
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
import {
  consumeSendAllowance,
  deliverReportEmail,
  dispatch,
  ensureCandidateAndLink,
  sendsToday,
} from '../pipeline.js';
import { inviteEmail } from '../email/templates.js';
import { isCohortAssessment, kindForAssessment, type AssessmentKind } from '../../shared/assessments.js';
import { EGO_STATES } from '../../shared/ego.js';
import { EGO_MAX_STATE_SCORE, type EgoResult } from '../../shared/ego-scoring.js';
import { MAX_SIDE_SCORE, MAX_STYLE_SCORE, type ScoreResult } from '../../shared/scoring.js';
import { STYLES } from '../../shared/styles.js';

export const adminRoutes = new Hono<AdminHono>();

// ------------------------------------------------------------------- session

adminRoutes.post('/login', async (c) => {
  const rl = await rateLimit(c.env, `login:${clientKey(c.req.raw)}`, 10, 300);
  if (!rl.allowed) return c.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429);

  const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Enter your email address and password.' }, 400);

  const user = await c.env.DB
    .prepare('SELECT id, email, name, role, password_hash FROM admin_users WHERE email = ?1')
    .bind(parsed.data.email)
    .first<{ id: string; email: string; name: string; role: string; password_hash: string }>();

  // Same message and comparable work for unknown users and wrong passwords.
  const ok = user ? await verifyPassword(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) return c.json({ error: 'Those details were not recognised.' }, 401);

  await c.env.DB.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?1`)
    .bind(user.id)
    .run();

  const role = toRole(user.role);
  await issueSession(c, { sub: user.id, email: user.email, name: user.name, role });
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role } });
});

adminRoutes.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

adminRoutes.get('/me', async (c) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  return c.json({
    user: { id: claims.sub, email: claims.email, name: claims.name, role: claims.role },
  });
});

const requireAdmin: MiddlewareHandler<AdminHono> = async (c, next) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  c.set('admin', claims);
  await next();
};

/**
 * Branding reaches the candidate UI, the PDF and every outbound email at once,
 * so it belongs to the account that owns the deployment rather than to a
 * client administrator. The nav item is hidden in the console as well, but this
 * is the check that actually enforces it.
 */
const requireSuperadmin: MiddlewareHandler<AdminHono> = async (c, next) => {
  const claims = await readSession(c);
  if (!claims) return c.json({ error: 'Not signed in' }, 401);
  if (claims.role !== 'superadmin') {
    return c.json({ error: 'Branding is managed by the platform owner.' }, 403);
  }
  c.set('admin', claims);
  await next();
};

// Every mutating admin request is logged, whether or not its handler describes
// itself. Above the auth guards, so a refused request is logged too — "someone
// tried" is exactly what you want to see after something breaks.
adminRoutes.use('*', auditAll);

adminRoutes.use('/dashboard', requireAdmin);
adminRoutes.use('/assessments/*', requireAdmin);
adminRoutes.use('/assessments', requireAdmin);
adminRoutes.use('/candidates/*', requireAdmin);
adminRoutes.use('/candidates', requireAdmin);
adminRoutes.use('/invites/*', requireAdmin);
adminRoutes.use('/links/*', requireAdmin);
adminRoutes.use('/links', requireAdmin);
adminRoutes.use('/branding', requireSuperadmin);
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
    db
      .prepare(
        `SELECT rp.scores_json, r.assessment_id
           FROM reports rp JOIN responses r ON r.id = rp.response_id`,
      )
      .all<{ scores_json: string; assessment_id: string }>(),
    getSettings(c.env),
  ]);

  const reports = cohort.results ?? [];

  return c.json({
    totals: totals ?? { candidates: 0, invited: 0, in_progress: 0, completed: 0, started: 0 },
    completionRate:
      totals && totals.started > 0 ? Math.round((totals.completed / totals.started) * 1000) / 10 : null,
    trend: fillWeeks(trend.results ?? []),
    assessments: assessments.results ?? [],
    recent: recent.results ?? [],
    // Two cohorts, because the two instruments are not on a common scale and
    // averaging them together would produce a number that means nothing.
    cohort: cohortAverages(reports),
    egoCohort: egoCohortAverages(reports),
    maxStyleScore: MAX_STYLE_SCORE,
    maxSideScore: MAX_SIDE_SCORE,
    maxEgoStateScore: EGO_MAX_STATE_SCORE,
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

interface CohortRow {
  scores_json: string;
  assessment_id: string;
}

/** Mean style score across every completed Influencing Style report. */
function cohortAverages(rows: CohortRow[]): {
  key: string;
  name: string;
  side: string;
  average: number;
  n: number;
}[] {
  const totals = new Map<string, number>();
  let n = 0;
  for (const row of rows) {
    if (kindForAssessment(row.assessment_id) !== 'isi') continue;
    const parsed = parseScores(row.scores_json) as ScoreResult | null;
    // A malformed historical row must not take the dashboard down.
    if (!parsed?.styles) continue;
    for (const s of parsed.styles) totals.set(s.key, (totals.get(s.key) ?? 0) + s.score);
    n++;
  }
  return STYLES.map((s) => ({
    key: s.key,
    name: s.name,
    side: s.side,
    average: n === 0 ? 0 : Math.round(((totals.get(s.key) ?? 0) / n) * 10) / 10,
    n,
  }));
}

/** Mean ego-gram across every completed Ego States report. */
function egoCohortAverages(rows: CohortRow[]): {
  key: string;
  name: string;
  abbr: string;
  color: string;
  average: number;
  percent: number;
  n: number;
}[] {
  const totals = new Map<string, number>();
  let n = 0;
  for (const row of rows) {
    if (kindForAssessment(row.assessment_id) !== 'ego') continue;
    const parsed = parseScores(row.scores_json) as EgoResult | null;
    if (!parsed?.states) continue;
    for (const s of parsed.states) totals.set(s.key, (totals.get(s.key) ?? 0) + s.score);
    n++;
  }
  return EGO_STATES.map((s) => {
    const average = n === 0 ? 0 : Math.round(((totals.get(s.key) ?? 0) / n) * 10) / 10;
    return {
      key: s.key,
      name: s.name,
      abbr: s.abbr,
      color: s.color,
      average,
      percent: Math.round((average / EGO_MAX_STATE_SCORE) * 1000) / 10,
      n,
    };
  });
}

// --------------------------------------------------------------- assessments

adminRoutes.get('/assessments', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.slug, a.name, a.description, a.status, a.question_count, a.auto_send_report,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id) AS invited,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status <> 'invited') AS started,
            (SELECT COUNT(*) FROM responses r WHERE r.assessment_id = a.id AND r.status = 'completed') AS completed,
            (SELECT COUNT(*) FROM reports rep
               JOIN responses r2 ON r2.id = rep.response_id
              WHERE r2.assessment_id = a.id AND rep.sent_at IS NULL) AS unsent_reports
       FROM assessments a ORDER BY a.status DESC, a.name`,
  ).all();
  return c.json({ assessments: results ?? [], maxStyleScore: MAX_STYLE_SCORE });
});

/**
 * Sends a stored report to its candidate by hand — the counterpart to turning
 * auto-send off.
 *
 * A fresh report token is minted here rather than recovering the original,
 * which is not recoverable by design: only its keyed hash is stored. That is
 * safe precisely because the token's one use is the emailed /r/ URL, so an
 * unsent report's token has never left the server. The candidate's own
 * on-screen link is their /t/ link token and is unaffected.
 */
adminRoutes.post('/candidates/:responseId/send-report', async (c) => {
  const responseId = c.req.param('responseId');
  const row = await c.env.DB.prepare(
    `SELECT rep.id AS report_id, rep.sent_at,
            a.name AS assessment_name,
            c.email, c.first_name
       FROM reports rep
       JOIN responses r ON r.id = rep.response_id
       JOIN assessments a ON a.id = r.assessment_id
       JOIN candidates c ON c.id = r.candidate_id
      WHERE rep.response_id = ?1`,
  )
    .bind(responseId)
    .first<{
      report_id: string;
      sent_at: string | null;
      assessment_name: string;
      email: string;
      first_name: string;
    }>();

  if (!row) return c.json({ error: 'No report exists for this candidate yet.' }, 404);

  // Rendered now, not read from the copy stored at completion: a hand-sent
  // report must carry the same artwork as the one the candidate downloads.
  const pdf = await renderReportForResponse(c.env, responseId);
  if (!pdf) return c.json({ error: 'No report exists for this candidate yet.' }, 404);

  const settings = await getSettings(c.env);
  const cap = dailySendCap(settings);
  if (!(await consumeSendAllowance(c.env, cap))) {
    return c.json({ error: `Daily send cap of ${cap} reached.` }, 429);
  }

  const token = generateToken();
  await c.env.DB.prepare('UPDATE reports SET token_hash = ?2 WHERE id = ?1')
    .bind(row.report_id, await hashToken(token, c.env.LINK_TOKEN_SECRET))
    .run();

  const result = await deliverReportEmail(c.env, {
    reportId: row.report_id,
    reportToken: token,
    assessmentName: row.assessment_name,
    firstName: row.first_name,
    email: row.email,
    pdf,
    settings,
    branding: brandingFrom(settings),
  });

  return c.json({
    status: result.status,
    error: result.error ?? null,
    resent: row.sent_at !== null,
  });
});

/**
 * Turns automatic report delivery on or off for one assessment. Off means a
 * completed assessment is still scored and its report still stored — only the
 * email waits for an administrator.
 */
adminRoutes.post('/assessments/:id/auto-send', async (c) => {
  const parsed = autoSendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Expected { autoSend: boolean }' }, 400);

  const res = await c.env.DB.prepare('UPDATE assessments SET auto_send_report = ?2 WHERE id = ?1')
    .bind(c.req.param('id'), parsed.data.autoSend ? 1 : 0)
    .run();
  if (!res.meta.changes) return c.json({ error: 'Unknown assessment' }, 404);

  return c.json({ autoSend: parsed.data.autoSend });
});

// ---------------------------------------------------------------- candidates

/**
 * The filter vocabulary for the candidates grid. Organisations are whatever
 * candidates have actually typed, so the list is derived rather than curated —
 * a fixed list would go stale the first time someone joins from a new company.
 */
adminRoutes.get('/candidates/filters', async (c) => {
  const [assessments, organisations] = await Promise.all([
    c.env.DB.prepare(
      `SELECT DISTINCT a.id, a.name
         FROM assessments a JOIN responses r ON r.assessment_id = a.id
        ORDER BY a.name`,
    ).all<{ id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT organisation FROM candidates
        WHERE TRIM(organisation) <> '' ORDER BY lower(organisation)`,
    ).all<{ organisation: string }>(),
  ]);

  return c.json({
    assessments: assessments.results ?? [],
    organisations: (organisations.results ?? []).map((r) => r.organisation),
    statuses: ['invited', 'in_progress', 'completed'],
  });
});

/** YYYY-MM-DD or nothing — anything else is dropped rather than half-applied. */
function dateParam(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

adminRoutes.get('/candidates', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const status = c.req.query('status') ?? '';
  const assessmentId = c.req.query('assessment') ?? '';
  const organisation = (c.req.query('organisation') ?? '').trim();
  const from = dateParam(c.req.query('from'));
  const to = dateParam(c.req.query('to'));

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
  if (organisation) {
    binds.push(organisation);
    where.push(`c.organisation = ?${binds.length}`);
  }
  // The date filter reads the row's own most meaningful date — when it
  // finished if it did, otherwise when it was issued — which is the same value
  // the grid sorts and displays by.
  const ACTIVITY_DATE = `date(COALESCE(r.completed_at, r.started_at, r.invited_at))`;
  if (from) {
    binds.push(from);
    where.push(`${ACTIVITY_DATE} >= ?${binds.length}`);
  }
  if (to) {
    binds.push(to);
    where.push(`${ACTIVITY_DATE} <= ?${binds.length}`);
  }

  const sql = `
    SELECT r.id AS response_id, r.status, r.answered_count, r.invited_at, r.started_at, r.completed_at,
           c.id AS candidate_id, c.first_name, c.last_name, c.email, c.organisation,
           a.id AS assessment_id, a.name AS assessment_name, a.question_count,
           rp.scores_json, rp.sent_at AS report_sent_at,
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

/** Parses a stored score object, tolerating a malformed historical row. */
export function parseScores(scoresJson: string | null): ScoreResult | EgoResult | null {
  if (!scoresJson) return null;
  try {
    return JSON.parse(scoresJson) as ScoreResult | EgoResult;
  } catch {
    return null;
  }
}

/**
 * A one-line result for the grid. The two instruments report different things —
 * a Push/Pull balance and an ego-gram peak — so the column carries a sentence
 * rather than a number that would mean something different in each row.
 */
export function resultLabelFor(
  kind: AssessmentKind | null,
  scores: ScoreResult | EgoResult | null,
): string | null {
  if (!scores) return null;
  if (kind === 'ego' || (scores as EgoResult).kind === 'ego') {
    const ego = scores as EgoResult;
    const top = ego.ranked?.[0] ?? ego.states?.[0];
    return top ? `Top: ${top.name} (${top.percent}%)` : null;
  }
  const isi = scores as ScoreResult;
  if (typeof isi.push !== 'number') return null;
  return `Push ${isi.push} · Pull ${isi.pull} of ${MAX_SIDE_SCORE}`;
}

function decorate(row: Record<string, unknown>): Record<string, unknown> {
  const scoresJson = (row.scores_json as string | null) ?? null;
  const kind = kindForAssessment(String(row.assessment_id ?? ''));
  const scores = parseScores(scoresJson);
  const { scores_json: _drop, ...rest } = row;
  return {
    ...rest,
    assessmentKind: kind,
    resultLabel: resultLabelFor(kind, scores),
    hasReport: scoresJson !== null,
    // Distinguishes "no report yet" from "report ready but never emailed" —
    // the second is the one the console offers a send button for.
    reportSent: scoresJson !== null && row.report_sent_at !== null,
  };
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

interface ResendRow {
  assessment_id: string;
  candidate_id: string;
  assessment_name: string;
  question_count: number;
  email: string;
  first_name: string;
  last_name: string;
  organisation: string;
}

const RESEND_SELECT = `
  SELECT r.assessment_id, r.candidate_id, a.name AS assessment_name, a.question_count,
         c.email, c.first_name, c.last_name, c.organisation
    FROM responses r
    JOIN assessments a ON a.id = r.assessment_id
    JOIN candidates c ON c.id = r.candidate_id
   WHERE r.id = ?1`;

/**
 * Reissues one candidate's invitation. Shared by the per-row action and the
 * bulk action so the two cannot diverge — in particular so the bulk path draws
 * on the same daily send ledger rather than bypassing it.
 */
async function resendOne(
  c: Context<AdminHono>,
  responseId: string,
  settings: Record<string, string>,
  origin: string,
): Promise<{ status: string; error: string | null }> {
  const row = await c.env.DB.prepare(RESEND_SELECT).bind(responseId).first<ResendRow>();
  if (!row) return { status: 'failed', error: 'Unknown candidate' };

  const cap = dailySendCap(settings);
  if (!(await consumeSendAllowance(c.env, cap))) {
    return { status: 'failed', error: `Daily send cap of ${cap} reached.` };
  }

  const { token } = await ensureCandidateAndLink(c.env, {
    assessmentId: row.assessment_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    organisation: row.organisation,
  });

  const mail = inviteEmail({
    branding: brandingFrom(settings),
    logoUrl: `${origin}/api/logo`,
    firstName: row.first_name,
    assessmentName: row.assessment_name,
    link: `${origin}/t/${token}`,
    questionCount: row.question_count,
  });
  const result = await sendMail(c.env, {
    to: row.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    kind: 'invite',
  });

  return { status: result.status, error: result.error ?? null };
}

adminRoutes.post('/candidates/:responseId/resend', async (c) => {
  const settings = await getSettings(c.env);
  const out = await resendOne(c, c.req.param('responseId'), settings, baseUrl(c.env, c.req.raw));
  if (out.error === 'Unknown candidate') return c.json({ error: out.error }, 404);
  if (out.status === 'failed' && out.error?.startsWith('Daily send cap')) {
    return c.json(out, 429);
  }
  return c.json(out);
});

// ------------------------------------------------------------- bulk actions

const bulkIdsSchema = z.object({
  responseIds: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * Resends a selection one at a time rather than in parallel: each send has to
 * consume a slot from the daily ledger, and a fan-out would race the cap.
 * Every recipient's outcome is reported individually, so a partial failure is
 * visible instead of being flattened into "something went wrong".
 */
adminRoutes.post('/candidates/bulk/resend', async (c) => {
  const parsed = bulkIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Select at least one candidate.' }, 400);

  const settings = await getSettings(c.env);
  const origin = baseUrl(c.env, c.req.raw);
  const results: { responseId: string; status: string; error: string | null }[] = [];

  for (const responseId of parsed.data.responseIds) {
    const out = await resendOne(c, responseId, settings, origin);
    results.push({ responseId, ...out });
  }

  return c.json({
    sent: results.filter((r) => r.status !== 'failed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
});

const bulkLinkSchema = bulkIdsSchema.extend({ active: z.boolean() });

/** Enables or disables the personal links behind a selection, in one batch. */
adminRoutes.post('/candidates/bulk/links', async (c) => {
  const parsed = bulkLinkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Select at least one candidate.' }, 400);

  const placeholders = parsed.data.responseIds.map((_, i) => `?${i + 2}`).join(',');
  const res = await c.env.DB.prepare(
    `UPDATE links SET active = ?1
      WHERE kind = 'personal'
        AND (assessment_id, candidate_id) IN (
              SELECT assessment_id, candidate_id FROM responses WHERE id IN (${placeholders}))`,
  )
    .bind(parsed.data.active ? 1 : 0, ...parsed.data.responseIds)
    .run();

  return c.json({ changed: res.meta.changes ?? 0, active: parsed.data.active });
});

/** Per-link enable/disable — the only way a link ever stops working. */
adminRoutes.post('/links/:linkId/active', async (c) => {
  const parsed = linkToggleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid payload' }, 400);

  const before = await c.env.DB.prepare(
    'SELECT id, kind, assessment_id, cohort_id, round_no, token_plain, active FROM links WHERE id = ?1',
  )
    .bind(c.req.param('linkId'))
    .first<Record<string, unknown>>();
  if (before) {
    recordBefore(c, {
      action: parsed.data.active ? 'links.activate' : 'links.deactivate',
      entity: 'link',
      entityId: c.req.param('linkId'),
      summary: `${parsed.data.active ? 'Re-activated' : 'Deactivated'} a ${String(before.kind)} link.`,
      before,
      after: { active: parsed.data.active },
    });
  }

  const res = await c.env.DB.prepare('UPDATE links SET active = ?2 WHERE id = ?1')
    .bind(c.req.param('linkId'), parsed.data.active ? 1 : 0)
    .run();
  if (!res.meta.changes) return c.json({ error: 'Unknown link' }, 404);
  return c.json({ active: parsed.data.active });
});

// -------------------------------------------------------------- generic links

adminRoutes.get('/links', async (c) => {
  // `l.cohort_id IS NULL` is the whole fix for a page that had started showing
  // "Collaboration Sociometry" five times: a cohort instrument has one generic
  // link *per cohort per round*, and joining them all onto the assessment
  // multiplied the instrument's row once per group. An instrument-level link is
  // the one that belongs to no group.
  const { results } = await c.env.DB.prepare(
    `SELECT a.id AS assessment_id, a.name, a.slug, a.status, a.question_count,
            l.id AS link_id, l.active, l.created_at, l.last_seen_at
       FROM assessments a
       LEFT JOIN links l
              ON l.assessment_id = a.id AND l.kind = 'generic' AND l.cohort_id IS NULL
      ORDER BY a.status DESC, a.name`,
  ).all();

  // The group links, listed under the instrument they belong to rather than
  // beside it. A facilitator looking for "the sociometry link" is looking for
  // one of these, and the page should say which group and which round it opens.
  const cohortLinks = await c.env.DB.prepare(
    `SELECT l.id AS link_id, l.assessment_id, l.active, l.created_at, l.last_seen_at,
            l.token_plain, l.round_no,
            co.id AS cohort_id, co.name AS cohort_name, co.organisation, co.status AS cohort_status,
            rd.label AS round_label, rd.closed_at AS round_closed_at,
            (SELECT COUNT(*) FROM responses r
              WHERE r.cohort_id = co.id AND r.round_no = l.round_no
                AND r.status = 'completed') AS respondents
       FROM links l
       JOIN cohorts co ON co.id = l.cohort_id
       LEFT JOIN cohort_rounds rd ON rd.cohort_id = co.id AND rd.no = l.round_no
      WHERE l.kind = 'generic'
      ORDER BY co.created_at DESC, l.round_no DESC`,
  ).all<{
    link_id: string;
    assessment_id: string;
    active: number;
    created_at: string;
    last_seen_at: string | null;
    token_plain: string | null;
    round_no: number;
    cohort_id: string;
    cohort_name: string;
    organisation: string;
    cohort_status: string;
    round_label: string | null;
    round_closed_at: string | null;
    respondents: number;
  }>();

  const settings = await getSettings(c.env);
  return c.json({
    links: results ?? [],
    cohortLinks: (cohortLinks.results ?? []).map((r) => ({
      linkId: r.link_id,
      assessmentId: r.assessment_id,
      cohortId: r.cohort_id,
      cohortName: r.cohort_name,
      organisation: r.organisation,
      cohortStatus: r.cohort_status,
      roundNo: r.round_no,
      roundName: roundName({ no: r.round_no, label: r.round_label ?? '' }),
      roundClosed: r.round_closed_at !== null,
      active: r.active === 1,
      token: r.token_plain,
      respondents: r.respondents,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
    })),
    activeTheme: settings['theme.active'],
  });
});

/**
 * The current open link, read back for a copy shortcut. Reads the stored
 * plaintext rather than minting — copying a link must never rotate the copies
 * already distributed.
 */
adminRoutes.get('/links/generic/:assessmentId', async (c) => {
  const assessmentId = c.req.param('assessmentId');
  if (isCohortAssessment(assessmentId)) {
    return c.json(
      { error: 'This instrument is run per group — its links live on each cohort.' },
      400,
    );
  }
  const row = await c.env.DB.prepare(
    `SELECT l.token_plain, l.active AS link_active, a.short_slug, a.slug_active, a.status
       FROM assessments a
       LEFT JOIN links l
              ON l.assessment_id = a.id AND l.kind = 'generic' AND l.cohort_id IS NULL
      WHERE a.id = ?1`,
  )
    .bind(assessmentId)
    .first<{
      token_plain: string | null;
      link_active: number | null;
      short_slug: string | null;
      slug_active: number;
      status: string;
    }>();
  if (!row || row.link_active === null) {
    return c.json({ error: 'No open link yet — issue one from the Assessment Link panel.' }, 404);
  }
  if (!row.token_plain || row.link_active !== 1) {
    return c.json(
      { error: 'This link cannot be shown again — re-issue it from the Assessment Link panel.' },
      404,
    );
  }
  // The short alias when it currently resolves (same conditions the router
  // checks), otherwise the tokenised URL — hand out the address that works.
  const short = Boolean(row.short_slug && row.slug_active === 1 && row.status === 'live');
  const base = baseUrl(c.env, c.req.raw);
  return c.json({
    url: short ? `${base}/${row.short_slug}` : `${base}/t/${row.token_plain}`,
    short,
  });
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

  // A cohort instrument's open link belongs to a cohort, not to the instrument:
  // one issued here would carry no cohort, resolve fine, and then tell whoever
  // opened it that it is not attached to a group.
  if (isCohortAssessment(assessmentId)) {
    return c.json(
      {
        error:
          'This instrument is run per group. Create a cohort and issue its link from the Cohorts panel — a link without a group has nobody to rate.',
      },
      400,
    );
  }

  const token = generateToken();
  const hash = await hashToken(token, c.env.LINK_TOKEN_SECRET);
  const existing = await c.env.DB.prepare(
    `SELECT id, token_plain FROM links
      WHERE kind = 'generic' AND assessment_id = ?1 AND cohort_id IS NULL`,
  )
    .bind(assessmentId)
    .first<{ id: string; token_plain: string | null }>();

  // The link this replaces. Rotating is the whole point of the button, and the
  // log is where the previous token survives being replaced.
  recordBefore(c, {
    action: existing ? 'links.generic.reissue' : 'links.generic.issue',
    entity: 'assessment',
    entityId: assessmentId,
    summary: existing
      ? `Re-issued the open link for ${assessmentId}. Every copy of the previous link stopped working.`
      : `Issued the open link for ${assessmentId}.`,
    before: existing ? { linkId: existing.id, token: existing.token_plain } : null,
    after: { token },
  });

  if (existing) {
    await c.env.DB.prepare('UPDATE links SET token_hash = ?2, token_plain = ?3, active = 1 WHERE id = ?1')
      .bind(existing.id, hash, token)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO links (id, token_hash, token_plain, kind, assessment_id, candidate_id, active)
       VALUES (?1, ?2, ?3, 'generic', ?4, NULL, 1)`,
    )
      .bind(newId('link'), hash, token, assessmentId)
      .run();
  }

  return c.json({ url: `${baseUrl(c.env, c.req.raw)}/t/${token}`, rotated: Boolean(existing) });
});

// ------------------------------------------------------------------ activity

/**
 * The log, newest first.
 *
 * Superadmin only. It carries previous link tokens, which are credentials for
 * as long as they are un-rotated, and it names who did what — neither belongs
 * in front of every administrator.
 */
adminRoutes.get('/activity', requireSuperadmin, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 500);
  const action = c.req.query('action') ?? '';
  const entityId = c.req.query('entityId') ?? '';

  const { results } = await c.env.DB.prepare(
    `SELECT id, at, admin_email, action, entity, entity_id, summary,
            before_json, after_json, method, path, status
       FROM admin_audit
      WHERE (?2 = '' OR action LIKE ?2 || '%')
        AND (?3 = '' OR entity_id = ?3)
      ORDER BY at DESC, rowid DESC
      LIMIT ?1`,
  )
    .bind(limit, action, entityId)
    .all<{
      id: string;
      at: string;
      admin_email: string | null;
      action: string;
      entity: string | null;
      entity_id: string | null;
      summary: string;
      before_json: string | null;
      after_json: string | null;
      method: string | null;
      path: string | null;
      status: number | null;
    }>();

  return c.json({
    entries: (results ?? []).map((r) => ({
      id: r.id,
      at: r.at,
      admin: r.admin_email,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      summary: r.summary,
      before: r.before_json,
      after: r.after_json,
      method: r.method,
      path: r.path,
      status: r.status,
    })),
  });
});

/**
 * Puts a rotated link back.
 *
 * The one recovery the log can actually perform. A token is only ever stored as
 * a hash, so a link cannot be "undeleted" from the links table — but the plain
 * token of the link that was replaced is in the log, and re-hashing it makes
 * the old link work again. Used when a rotation went out to the wrong list, or
 * when someone rotated the link people were already halfway through answering.
 *
 * The current token is logged in turn, so this is reversible too.
 */
adminRoutes.post('/activity/:entryId/restore-link', requireSuperadmin, async (c) => {
  const entry = await c.env.DB.prepare(
    'SELECT id, action, entity_id, before_json FROM admin_audit WHERE id = ?1',
  )
    .bind(c.req.param('entryId'))
    .first<{ id: string; action: string; entity_id: string | null; before_json: string | null }>();
  if (!entry) return c.json({ error: 'No such log entry.' }, 404);

  interface PreviousLink {
    linkId?: string;
    token?: string | null;
  }
  let before: PreviousLink | null = null;
  try {
    before = entry.before_json ? (JSON.parse(entry.before_json) as PreviousLink) : null;
  } catch {
    before = null;
  }
  if (!before?.linkId || !before.token) {
    return c.json({ error: 'That entry has no previous link to restore.' }, 400);
  }

  const current = await c.env.DB.prepare(
    'SELECT id, token_plain FROM links WHERE id = ?1',
  )
    .bind(before.linkId)
    .first<{ id: string; token_plain: string | null }>();
  if (!current) return c.json({ error: 'That link no longer exists.' }, 404);

  const hash = await hashToken(before.token, c.env.LINK_TOKEN_SECRET);
  await c.env.DB.prepare(
    'UPDATE links SET token_hash = ?2, token_plain = ?3, active = 1 WHERE id = ?1',
  )
    .bind(before.linkId, hash, before.token)
    .run();

  recordBefore(c, {
    action: 'links.restore',
    entity: 'link',
    entityId: before.linkId,
    summary: 'Restored a previously rotated link from the activity log.',
    before: { linkId: before.linkId, token: current.token_plain },
    after: { linkId: before.linkId, token: before.token, fromEntry: entry.id },
  });

  return c.json({ url: `${baseUrl(c.env, c.req.raw)}/t/${before.token}` });
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
    logoUrl: `${baseUrl(c.env, c.req.raw)}/api/logo`,
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
  response_id: string;
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  age_band: string;
  experience_band: string;
  gender: string;
  assessment_id: string;
  assessment_name: string;
  status: string;
  answered_count: number;
  invited_at: string;
  completed_at: string | null;
  scores_json: string | null;
}

const EXPORT_SELECT = `
  SELECT r.id AS response_id,
         c.first_name, c.last_name, c.email, c.organisation, c.age_band, c.experience_band, c.gender,
         a.id AS assessment_id, a.name AS assessment_name,
         r.status, r.answered_count, r.invited_at, r.completed_at,
         rp.scores_json
    FROM responses r
    JOIN candidates c ON c.id = r.candidate_id
    JOIN assessments a ON a.id = r.assessment_id
    LEFT JOIN reports rp ON rp.response_id = r.id`;

const EXPORT_ORDER = ' ORDER BY COALESCE(r.completed_at, r.invited_at) DESC';

async function exportRows(env: Env, responseIds?: string[]): Promise<ExportRow[]> {
  if (responseIds && responseIds.length > 0) {
    const placeholders = responseIds.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await env.DB
      .prepare(`${EXPORT_SELECT} WHERE r.id IN (${placeholders})${EXPORT_ORDER}`)
      .bind(...responseIds)
      .all<ExportRow>();
    return results ?? [];
  }
  const { results } = await env.DB.prepare(`${EXPORT_SELECT}${EXPORT_ORDER}`).all<ExportRow>();
  return results ?? [];
}

/**
 * One sheet covers both instruments, so the score columns are the union of the
 * two: a row only ever fills the block belonging to its own assessment and
 * leaves the other blank. That keeps a single export usable in a pivot table
 * without forcing the reader to reconcile two files.
 */
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
  'Result',
  `Push /${MAX_SIDE_SCORE}`,
  `Pull /${MAX_SIDE_SCORE}`,
  ...STYLES.map((s) => `${s.name} /${MAX_STYLE_SCORE}`),
  ...EGO_STATES.map((s) => `${s.abbr} /${EGO_MAX_STATE_SCORE}`),
];

function exportCells(row: ExportRow): (string | number | null)[] {
  const kind = kindForAssessment(row.assessment_id);
  const scores = parseScores(row.scores_json);

  let push: number | null = null;
  let pull: number | null = null;
  const styleScores = new Map<string, number>();
  const egoScores = new Map<string, number>();

  if (scores && (scores as EgoResult).kind === 'ego') {
    for (const s of (scores as EgoResult).states ?? []) egoScores.set(s.key, s.score);
  } else if (scores) {
    const isi = scores as ScoreResult;
    push = isi.push ?? null;
    pull = isi.pull ?? null;
    for (const s of isi.styles ?? []) styleScores.set(s.key, s.score);
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
    resultLabelFor(kind, scores),
    push,
    pull,
    ...STYLES.map((s) => styleScores.get(s.key) ?? null),
    ...EGO_STATES.map((s) => egoScores.get(s.key) ?? null),
  ];
}

function csvBody(rows: ExportRow[]): string {
  return [EXPORT_HEADERS, ...rows.map(exportCells)]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n');
}

function csvResponse(rows: ExportRow[], name: string): Response {
  // A leading BOM so Excel opens the UTF-8 as UTF-8 rather than as Latin-1.
  return new Response('\ufeff' + csvBody(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

adminRoutes.get('/export/csv', async (c) => csvResponse(await exportRows(c.env), 'candidates'));

/**
 * The selected-rows export. It is a POST because the selection is a list of
 * ids that would not survive a URL, and it answers with a file rather than
 * JSON so the browser can save it directly.
 */
adminRoutes.post('/export/csv/selected', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = bulkIdsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Select at least one candidate.' }, 400);
  return csvResponse(await exportRows(c.env, parsed.data.responseIds), 'candidates-selected');
});

adminRoutes.get('/export/xlsx', async (c) => {
  const rows = await exportRows(c.env);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PO Assessments';
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
