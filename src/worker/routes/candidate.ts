/**
 * Candidate API. Access is the link token alone — there is no candidate login,
 * and nothing here is reachable from, or links to, the admin console.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { dispatch } from '../pipeline.js';
import { newId } from '../lib/ids.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import { getBranding } from '../lib/settings.js';
import { generateToken, hashToken, looksLikeToken } from '../lib/tokens.js';
import { answerBatchSchemaFor, candidateDetailsSchema, fieldErrors } from '../lib/validation.js';
import { ASSESSMENTS, kindForAssessment } from '../../shared/assessments.js';
import type { CandidateSession, Question, ScaleInfo } from '../../shared/types.js';

export const candidateRoutes = new Hono<{ Bindings: Env }>();

interface LinkRow {
  link_id: string;
  kind: 'personal' | 'generic';
  active: number;
  assessment_id: string;
  candidate_id: string | null;
  slug: string;
  name: string;
  description: string;
  status: 'live' | 'planned' | 'retired';
  question_count: number;
  per_page: number;
  min_answer: number;
  max_answer: number;
}

/**
 * The rating scale for a link's assessment. The registry is authoritative for
 * the anchors (the words the candidate reads); the D1 columns are the bounds
 * the API enforces, so a scale change is a migration and the two are asserted
 * to agree here rather than drifting silently.
 */
function scaleForLink(link: LinkRow): ScaleInfo {
  const config = configForLink(link);
  if (config) {
    return {
      min: config.scale.min,
      max: config.scale.max,
      labels: config.scale.labels,
      shortLabels: config.scale.shortLabels,
    };
  }
  // An instrument seeded without a registry entry still gets a usable control.
  const labels = Array.from({ length: link.max_answer - link.min_answer + 1 }, (_, i) =>
    String(link.min_answer + i),
  );
  return { min: link.min_answer, max: link.max_answer, labels, shortLabels: labels };
}

function configForLink(link: LinkRow) {
  const kind = kindForAssessment(link.assessment_id);
  return kind ? ASSESSMENTS[kind] : null;
}

/**
 * Resolves an opaque token to its link row. Links never expire; the only
 * negative outcome besides "unknown" is an administrator having deactivated it.
 */
async function resolveLink(env: Env, token: string): Promise<LinkRow | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  return env.DB.prepare(
    `SELECT l.id AS link_id, l.kind, l.active, l.assessment_id, l.candidate_id,
            a.slug, a.name, a.description, a.status, a.question_count, a.per_page,
            a.min_answer, a.max_answer
       FROM links l
       JOIN assessments a ON a.id = l.assessment_id
      WHERE l.token_hash = ?1`,
  )
    .bind(hash)
    .first<LinkRow>();
}

async function loadQuestions(env: Env, assessmentId: string): Promise<Question[]> {
  const { results } = await env.DB.prepare(
    'SELECT no, text FROM questions WHERE assessment_id = ?1 ORDER BY no',
  )
    .bind(assessmentId)
    .all<Question>();
  return results ?? [];
}

async function loadResponseState(
  env: Env,
  responseId: string,
): Promise<CandidateSession['response']> {
  const resp = await env.DB.prepare(
    `SELECT r.id, r.status, r.answered_count, r.resume_page, r.started_at, r.completed_at,
            c.first_name, c.last_name, c.email, c.organisation, c.age_band, c.experience_band, c.gender
       FROM responses r JOIN candidates c ON c.id = r.candidate_id
      WHERE r.id = ?1`,
  )
    .bind(responseId)
    .first<{
      id: string;
      status: 'invited' | 'in_progress' | 'completed';
      answered_count: number;
      resume_page: number;
      started_at: string | null;
      completed_at: string | null;
      first_name: string;
      last_name: string;
      email: string;
      organisation: string;
      age_band: string;
      experience_band: string;
      gender: string;
    }>();
  if (!resp) return null;

  const { results } = await env.DB.prepare('SELECT no, value FROM answers WHERE response_id = ?1')
    .bind(responseId)
    .all<{ no: number; value: number }>();
  const answers: Record<number, number> = {};
  for (const a of results ?? []) answers[a.no] = a.value;

  const hasDetails = Boolean(resp.first_name && resp.last_name && resp.organisation && resp.age_band);

  return {
    responseId: resp.id,
    status: resp.status,
    details: hasDetails
      ? {
          firstName: resp.first_name,
          lastName: resp.last_name,
          email: resp.email,
          organisation: resp.organisation,
          ageBand: resp.age_band,
          experienceBand: resp.experience_band,
          gender: resp.gender,
        }
      : null,
    answers,
    answeredCount: Object.keys(answers).length,
    resumePage: resp.resume_page,
    startedAt: resp.started_at,
    completedAt: resp.completed_at,
  };
}

async function hasReportFor(env: Env, responseId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM reports WHERE response_id = ?1')
    .bind(responseId)
    .first<{ id: string }>();
  return row !== null;
}

// --------------------------------------------------------------- session load

candidateRoutes.get('/session/:token', async (c) => {
  const token = c.req.param('token');

  const rl = await rateLimit(c.env, `sess:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const link = await resolveLink(c.env, token);
  if (!link) return c.json({ error: 'This link was not recognised.' }, 404);
  if (!link.active) {
    return c.json({ error: 'This link has been deactivated by the administrator.' }, 403);
  }
  if (link.status !== 'live') {
    return c.json({ error: 'This assessment is not currently open.' }, 403);
  }

  await c.env.DB.prepare(`UPDATE links SET last_seen_at = datetime('now') WHERE id = ?1`)
    .bind(link.link_id)
    .run();

  const [questions, branding] = await Promise.all([
    loadQuestions(c.env, link.assessment_id),
    getBranding(c.env),
  ]);

  let response: CandidateSession['response'] = null;
  let hasReport = false;

  if (link.candidate_id) {
    const row = await c.env.DB.prepare(
      'SELECT id FROM responses WHERE assessment_id = ?1 AND candidate_id = ?2',
    )
      .bind(link.assessment_id, link.candidate_id)
      .first<{ id: string }>();
    if (row) {
      response = await loadResponseState(c.env, row.id);
      hasReport = await hasReportFor(c.env, row.id);
    }
  }

  const config = configForLink(link);

  const session: CandidateSession = {
    linkKind: link.kind,
    assessment: {
      id: link.assessment_id,
      slug: link.slug,
      name: link.name,
      description: link.description,
      status: link.status,
      questionCount: link.question_count,
      kind: kindForAssessment(link.assessment_id),
    },
    questions,
    branding,
    perPage: link.per_page,
    scale: scaleForLink(link),
    intro: (config ?? ASSESSMENTS.isi).intro,
    response,
    reportAvailable: hasReport,
  };

  return c.json(session);
});

// --------------------------------------------------------------------- start

/**
 * Records the candidate's details and returns the response id used for the
 * rest of the session. On a generic link this is where the candidate becomes a
 * candidate, and where they receive their own personal continuation token.
 */
candidateRoutes.post('/start/:token', async (c) => {
  const token = c.req.param('token');

  const rl = await rateLimit(c.env, `start:${clientKey(c.req.raw)}`, 20, 300);
  if (!rl.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);

  const link = await resolveLink(c.env, token);
  if (!link || !link.active || link.status !== 'live') {
    return c.json({ error: 'This link is not available.' }, 404);
  }

  const parsed = candidateDetailsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const d = parsed.data;

  // A personal link is bound to a candidate; the email on it is authoritative
  // and cannot be reassigned from the form.
  let candidateId = link.candidate_id;

  if (!candidateId) {
    const existing = await c.env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
      .bind(d.email)
      .first<{ id: string }>();
    candidateId = existing?.id ?? newId('cand');
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO candidates (id, email, first_name, last_name, organisation, age_band, experience_band, gender)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          candidateId,
          d.email,
          d.firstName,
          d.lastName,
          d.organisation,
          d.ageBand,
          d.experienceBand,
          d.gender,
        )
        .run();
    }
  }

  await c.env.DB.prepare(
    `UPDATE candidates
        SET first_name = ?2, last_name = ?3, organisation = ?4,
            age_band = ?5, experience_band = ?6, gender = ?7
      WHERE id = ?1`,
  )
    .bind(candidateId, d.firstName, d.lastName, d.organisation, d.ageBand, d.experienceBand, d.gender)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO responses (id, assessment_id, candidate_id, link_id, status, started_at)
     VALUES (?1, ?2, ?3, ?4, 'in_progress', datetime('now'))
     ON CONFLICT (assessment_id, candidate_id) DO UPDATE
        SET status     = CASE WHEN responses.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
            started_at = COALESCE(responses.started_at, datetime('now'))`,
  )
    .bind(newId('resp'), link.assessment_id, candidateId, link.link_id)
    .run();

  const responseRow = await c.env.DB.prepare(
    'SELECT id FROM responses WHERE assessment_id = ?1 AND candidate_id = ?2',
  )
    .bind(link.assessment_id, candidateId)
    .first<{ id: string }>();

  // On a generic link, hand back a personal token so this candidate can leave
  // and return to their own in-progress session.
  let personalToken: string | null = null;
  if (link.kind === 'generic') {
    personalToken = generateToken();
    const hash = await hashToken(personalToken, c.env.LINK_TOKEN_SECRET);
    const existingLink = await c.env.DB.prepare(
      `SELECT id FROM links WHERE kind = 'personal' AND assessment_id = ?1 AND candidate_id = ?2`,
    )
      .bind(link.assessment_id, candidateId)
      .first<{ id: string }>();

    if (existingLink) {
      await c.env.DB.prepare('UPDATE links SET token_hash = ?2, active = 1 WHERE id = ?1')
        .bind(existingLink.id, hash)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, active)
         VALUES (?1, ?2, 'personal', ?3, ?4, 1)`,
      )
        .bind(newId('link'), hash, link.assessment_id, candidateId)
        .run();
    }
  }

  return c.json({
    responseId: responseRow!.id,
    personalToken,
    state: await loadResponseState(c.env, responseRow!.id),
  });
});

// ------------------------------------------------------------------- answers

/**
 * Autosave. Accepts one answer or a flushed offline batch; both are upserts, so
 * replaying a queue after reconnect is safe and order-independent.
 */
candidateRoutes.post('/answers/:token', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || !link.active) return c.json({ error: 'This link is not available.' }, 404);

  const rl = await rateLimit(c.env, `ans:${clientKey(c.req.raw)}`, 600, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  // Bounds come from the instrument this link resolves to, so a 0–4 inventory
  // rejects a 5 and a 0–6 inventory accepts one.
  const scale = scaleForLink(link);
  const parsed = answerBatchSchemaFor(scale.min, scale.max).safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      {
        error: `Each rating must be a whole number from ${scale.min} to ${scale.max}.`,
        details: fieldErrors(parsed.error),
      },
      400,
    );
  }

  const responseId = c.req.query('response');
  if (!responseId) return c.json({ error: 'Missing response id' }, 400);

  const resp = await c.env.DB.prepare(
    'SELECT id, status, candidate_id FROM responses WHERE id = ?1 AND assessment_id = ?2',
  )
    .bind(responseId, link.assessment_id)
    .first<{ id: string; status: string; candidate_id: string }>();
  if (!resp) return c.json({ error: 'Unknown response' }, 404);

  // A personal link may only write to its own candidate's response.
  if (link.candidate_id && link.candidate_id !== resp.candidate_id) {
    return c.json({ error: 'This link does not match that response.' }, 403);
  }
  if (resp.status === 'completed') {
    return c.json({ error: 'This assessment has already been submitted.', completed: true }, 409);
  }

  const valid = parsed.data.answers.filter((a) => a.no >= 1 && a.no <= link.question_count);
  if (valid.length === 0) return c.json({ error: 'No valid answers in payload' }, 400);

  const statements = valid.map((a) =>
    c.env.DB.prepare(
      `INSERT INTO answers (response_id, no, value, updated_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT (response_id, no) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(responseId, a.no, a.value),
  );
  statements.push(
    c.env.DB.prepare(
      `UPDATE responses
          SET answered_count = (SELECT COUNT(*) FROM answers WHERE response_id = ?1),
              resume_page = COALESCE(?2, resume_page),
              status = CASE WHEN status = 'invited' THEN 'in_progress' ELSE status END,
              started_at = COALESCE(started_at, datetime('now'))
        WHERE id = ?1`,
    ).bind(responseId, parsed.data.resumePage ?? null),
  );
  await c.env.DB.batch(statements);

  const count = await c.env.DB.prepare('SELECT answered_count FROM responses WHERE id = ?1')
    .bind(responseId)
    .first<{ answered_count: number }>();

  return c.json({ saved: valid.length, answeredCount: count?.answered_count ?? 0 });
});

// -------------------------------------------------------------------- submit

const submitSchema = z.object({ responseId: z.string().min(1) });

candidateRoutes.post('/submit/:token', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || !link.active) return c.json({ error: 'This link is not available.' }, 404);

  const rl = await rateLimit(c.env, `submit:${clientKey(c.req.raw)}`, 30, 300);
  if (!rl.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);

  const parsed = submitSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Missing response id' }, 400);

  const resp = await c.env.DB.prepare(
    'SELECT id, status, candidate_id, answered_count FROM responses WHERE id = ?1 AND assessment_id = ?2',
  )
    .bind(parsed.data.responseId, link.assessment_id)
    .first<{ id: string; status: string; candidate_id: string; answered_count: number }>();
  if (!resp) return c.json({ error: 'Unknown response' }, 404);
  if (link.candidate_id && link.candidate_id !== resp.candidate_id) {
    return c.json({ error: 'This link does not match that response.' }, 403);
  }

  if (resp.status === 'completed') {
    return c.json({ completed: true, alreadyCompleted: true });
  }

  const missing = await c.env.DB.prepare(
    `SELECT q.no FROM questions q
      WHERE q.assessment_id = ?1
        AND q.no NOT IN (SELECT no FROM answers WHERE response_id = ?2)
      ORDER BY q.no`,
  )
    .bind(link.assessment_id, resp.id)
    .all<{ no: number }>();

  const missingNos = (missing.results ?? []).map((r) => r.no);
  if (missingNos.length > 0) {
    return c.json({ error: 'Some statements are still unanswered.', missing: missingNos }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE responses SET status = 'completed', completed_at = datetime('now') WHERE id = ?1`,
  )
    .bind(resp.id)
    .run();

  // Minted here so the completion screen can offer a working report URL at
  // once; only its keyed hash is ever written to the database.
  const reportToken = generateToken();
  await dispatch(
    c.env,
    { type: 'score_and_deliver', responseId: resp.id, reportToken },
    c.executionCtx,
  );

  return c.json({ completed: true, reportToken });
});
