/**
 * Candidate API. Access is the link token alone — there is no candidate login,
 * and nothing here is reachable from, or links to, the admin console.
 */

import { Hono } from 'hono';
import type { CollabRunForCandidate } from '../../shared/types.js';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { dispatch } from '../pipeline.js';
import { newId } from '../lib/ids.js';
import { clientKey, rateLimit } from '../lib/ratelimit.js';
import { getBranding } from '../lib/settings.js';
import { sendMail } from '../lib/mailer.js';
import { otpEmail } from '../email/templates.js';
import { baseUrl } from '../env.js';
import { brandingForClient } from '../lib/brand-asset.js';
import { generateToken, hashToken, looksLikeToken } from '../lib/tokens.js';
import {
  answerBatchSchemaFor,
  candidateDetailsSchema,
  clearRowSchema,
  cohortIdentitySchema,
  cohortOtpRequestSchema,
  fieldErrors,
} from '../lib/validation.js';
import { ASSESSMENTS, isCohortKind, kindForAssessment } from '../../shared/assessments.js';
import {
  checkCollabSubmission,
  collabSessionFor,
  isCollabLink,
  saveOpenAnswer,
  startCollabResponse,
} from './collab-candidate.js';
import {
  allowedTargetsFor,
  loadCohort,
  loadRoster,
  maxCellNo,
  roundByNo,
  roundName,
  rosterForSession,
  type CohortRow,
  type RoundRow,
} from '../lib/cohort.js';
import { SOCIO_ITEM_COUNT, decodeCell } from '../../shared/socio.js';
import { LINK_ONLY_REFUSAL } from '../../shared/cohort-identity.js';
import type { CandidateCohort, CandidateSession, Question, ScaleInfo } from '../../shared/types.js';

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
  /** Set only for a cohort instrument's link. */
  cohort_id: string | null;
  /** When the link stops working, or null when it does not. */
  expires_at: string | null;
  /** Which wave of rating this link belongs to. 1 for everything else. */
  round_no: number;
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

/** Past its date. Compared in UTC, which is how the column is written. */
function linkExpired(link: { expires_at: string | null }): boolean {
  if (!link.expires_at) return false;
  const at = Date.parse(`${link.expires_at.replace(' ', 'T')}Z`);
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * What to tell somebody whose link will not open, or null when it will.
 *
 * Said in terms of what they can do next: a link that has run out is a thing
 * to ask for again, and the facilitator can re-send one in a click.
 */
export function linkRefusal(link: { active: number; expires_at: string | null }): string | null {
  if (!link.active) return 'This link has been deactivated by the administrator.';
  if (linkExpired(link)) {
    return 'This link has expired. Ask the person running the exercise to send you a new one — it takes them a moment.';
  }
  return null;
}

function configForLink(link: LinkRow) {
  const kind = kindForAssessment(link.assessment_id);
  return kind ? ASSESSMENTS[kind] : null;
}

/**
 * Resolves an opaque token to its link row.
 *
 * A link can now be past its date as well as switched off, and the two are
 * kept apart: "this closed on the 4th" is something a participant can act on
 * by asking for another, where "deactivated" is a decision somebody made about
 * them. Expiry is read here rather than filtered in SQL so the caller can say
 * which of the two happened.
 */
async function resolveLink(env: Env, token: string): Promise<LinkRow | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
  return env.DB.prepare(
    `SELECT l.id AS link_id, l.kind, l.active, l.assessment_id, l.candidate_id, l.cohort_id,
            l.round_no, l.expires_at,
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
            r.rater_member_id,
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
      rater_member_id: string | null;
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
    raterMemberId: resp.rater_member_id,
    startedAt: resp.started_at,
    completedAt: resp.completed_at,
  };
}

/**
 * Resolves the cohort a link belongs to, refusing one that is not open.
 *
 * 'draft' means the facilitator is still building the roster, and a roster that
 * changes under a respondent changes what their saved ratings point at, so a
 * draft cohort is never answerable. 'closed' means scoring has begun.
 */
async function cohortForLink(
  env: Env,
  link: LinkRow,
): Promise<{ cohort: CohortRow; round: RoundRow } | { error: string; code: 403 | 404 }> {
  if (!link.cohort_id) {
    return { error: 'This link is not attached to a group.', code: 404 };
  }
  const cohort = await loadCohort(env, link.cohort_id);
  if (!cohort) return { error: 'This group no longer exists.', code: 404 };
  if (cohort.status === 'draft') {
    return { error: 'This exercise has not opened yet. Your facilitator will let you know when it does.', code: 403 };
  }
  if (cohort.status === 'closed') {
    return { error: 'This exercise has closed and is no longer accepting responses.', code: 403 };
  }

  // A link belongs to the wave it was issued for, and only that wave. The
  // previous round's link is not revoked when a new one starts — the people
  // holding it did nothing wrong, and its responses and reports are still
  // theirs — so it says which round it was for rather than failing as though it
  // were forged.
  const round = await roundByNo(env, cohort.id, link.round_no);
  if (!round) return { error: 'This group no longer exists.', code: 404 };
  if (round.closed_at) {
    return {
      error: `${roundName(round)} has finished and is no longer accepting responses. If you were sent a newer link, use that one.`,
      code: 403,
    };
  }
  return { cohort, round };
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
  const refusal = linkRefusal(link);
  if (refusal) return c.json({ error: refusal }, 403);
  if (link.status !== 'live') {
    return c.json({ error: 'This assessment is not currently open.' }, 403);
  }

  await c.env.DB.prepare(`UPDATE links SET last_seen_at = datetime('now') WHERE id = ?1`)
    .bind(link.link_id)
    .run();

  const [questions, branding] = await Promise.all([
    loadQuestions(c.env, link.assessment_id),
    getBranding(c.env).then(brandingForClient),
  ]);

  const kind = kindForAssessment(link.assessment_id);

  // A cohort instrument is unanswerable without its group: the roster is what
  // the respondent rates, and the answer encoding addresses roster positions.
  let cohort: CandidateCohort | null = null;
  if (isCohortKind(kind)) {
    const resolved = await cohortForLink(c.env, link);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);
    // The roster stays empty until this respondent has identified themselves:
    // who is in the group is the facilitator's information, and a link that
    // reaches the wrong inbox must not hand over sixty names. The count alone
    // is released, so the welcome screen can still say how much work this is.
    const rosterCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?1 AND active = 1',
    )
      .bind(resolved.cohort.id)
      .first<{ n: number }>();
    cohort = {
      cohortId: resolved.cohort.id,
      name: resolved.cohort.name,
      organisation: resolved.cohort.organisation,
      roundNo: resolved.round.no,
      roundName: roundName(resolved.round),
      minRatedTargets: resolved.cohort.min_rated_targets,
      shareReports: resolved.cohort.share_reports === 1,
      otpRequired: resolved.cohort.otp_required === 1,
      // Told to the client so the shell can draw the dead end instead of an
      // email form it would only be refused for submitting. The refusal itself
      // is not the client's to make: the identity, code-request and
      // code-verify handlers all check the same flag against the same link,
      // whatever a client chooses to render.
      linkOnly: resolved.cohort.link_only_identity === 1,
      rosterSize: rosterCount?.n ?? 0,
      roster: [],
      selfMemberId: null,
      allowedTargetIds: null,
    };
  }

  let response: CandidateSession['response'] = null;
  let hasReport = false;

  if (link.candidate_id) {
    const row = await c.env.DB.prepare(
      `SELECT id FROM responses
        WHERE assessment_id = ?1 AND candidate_id = ?2
          AND COALESCE(cohort_id, '') = COALESCE(?3, '')`,
    )
      .bind(link.assessment_id, link.candidate_id, link.cohort_id)
      .first<{ id: string }>();
    if (row) {
      response = await loadResponseState(c.env, row.id);
      hasReport = await hasReportFor(c.env, row.id);
    }
  }

  if (cohort && response?.raterMemberId) {
    cohort.selfMemberId = response.raterMemberId;
    cohort.allowedTargetIds = await allowedTargetsFor(c.env, cohort.cohortId, response.raterMemberId);
    // Identified: release the roster — but an assigned rater receives only
    // their own row and their targets. The rest of the group stays unnamed.
    const full = await rosterForSession(c.env, cohort.cohortId, cohort.roundNo);
    const allowed = cohort.allowedTargetIds ? new Set(cohort.allowedTargetIds) : null;
    cohort.roster = full.filter(
      (m) => m.memberId === response.raterMemberId || !allowed || allowed.has(m.memberId),
    );
  }

  /*
   * A diagnostic run carries no roster — there is nobody to rate — but it does
   * carry the cuts it collects and whether answers are stored anonymously.
   * Both are decided by the facilitator before anyone is invited, and both
   * have to reach the respondent before they answer: the department question
   * is asked up front, and a promise of anonymity is worthless if the person
   * making it is never told.
   */
  let run: CollabRunForCandidate | null = null;
  if (isCollabLink(link)) {
    const resolved = await collabSessionFor(c.env, link, response?.responseId ?? null);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);
    run = resolved;
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
    cohort,
    run,
    scale: scaleForLink(link),
    intro: (config ?? ASSESSMENTS.isi).intro,
    response,
    reportAvailable: hasReport,
  };

  return c.json(session);
});

/**
 * The cheap half of the session, for a tab that is only checking it is still
 * allowed to be open.
 *
 * The page re-checks once a minute. Re-fetching the whole session for that
 * meant questions, intro copy and the roster every time — now a few hundred
 * bytes, and the same verdicts: 403 when the exercise has closed or the round
 * has moved on, 404 when the link no longer resolves.
 */
candidateRoutes.get('/session/:token/state', async (c) => {
  const rl = await rateLimit(c.env, `state:${clientKey(c.req.raw)}`, 240, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link) return c.json({ error: 'This link was not recognised.' }, 404);
  const refusal = linkRefusal(link);
  if (refusal) return c.json({ error: refusal }, 403);
  if (link.status !== 'live') {
    return c.json({ error: 'This assessment is not currently open.' }, 403);
  }

  if (!isCohortKind(kindForAssessment(link.assessment_id))) return c.json({ ok: true });

  const resolved = await cohortForLink(c.env, link);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);

  return c.json({
    ok: true,
    roundNo: resolved.round.no,
    // Who has answered changes while the roster list is on screen, and that
    // list is the one thing a waiting tab wants refreshed.
    responded: (await rosterForSession(c.env, resolved.cohort.id, resolved.round.no))
      .filter((m) => m.responded)
      .map((m) => m.memberId),
  });
});

// --------------------------------------------------------------------- start

/**
 * Records the candidate's details and returns the response id used for the
 * rest of the session. On a generic link this is where the candidate becomes a
 * candidate, and where they receive their own personal continuation token.
 */
candidateRoutes.post('/start/:token', async (c) => {
  const token = c.req.param('token');

  /*
   * Two limits, because there are two things happening on this route and only
   * one of them is an attack.
   *
   * A cohort or a diagnostic run is fifty colleagues in one company, and a
   * company reaches the internet through one address. Twenty starts per five
   * minutes keyed on that address is not a rate limit on abuse, it is a rate
   * limit on a leadership team being in the same meeting — which is exactly
   * how a facilitator runs this: everyone opens the link at once. The
   * generous ceiling here is a volume guard, not a credential check.
   *
   * What is worth limiting hard is a token that does not resolve. Guessing a
   * 32-byte token is the only reason to send a stream of unrecognised ones, so
   * that is where the strict bucket sits.
   */
  const volume = await rateLimit(c.env, `start:${clientKey(c.req.raw)}`, 200, 300);
  if (!volume.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);

  const link = await resolveLink(c.env, token);
  if (!link || linkRefusal(link) || link.status !== 'live') {
    const guessing = await rateLimit(c.env, `startbad:${clientKey(c.req.raw)}`, 20, 300);
    if (!guessing.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);
    return c.json({ error: 'This link is not available.' }, 404);
  }

  // A cohort respondent identifies themselves from the roster rather than
  // filling in a details form: their name and function are the cohort's own
  // facts, and demographics are irrelevant to a network score.
  if (isCohortKind(kindForAssessment(link.assessment_id))) {
    return startCohortResponse(c, link);
  }

  // A diagnostic respondent is not described, only placed: the cuts the run
  // collects, and an email only when the run is a named one. Name, age band,
  // experience band and gender are not asked, because none of them moves a
  // section mean and asking for them in a run promised as anonymous would be a
  // lie told in a form field.
  if (isCollabLink(link)) {
    return startCollabResponse(c, link);
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
     -- The conflict target must name the unique index exactly, and that index
     -- gained round_no when cohorts learned to run in rounds. A self-rating
     -- has no round, so it lands on the default of 1 and collides with itself
     -- the way it always did.
     ON CONFLICT (assessment_id, candidate_id, COALESCE(cohort_id, ''), round_no) DO UPDATE
        SET status     = CASE WHEN responses.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
            started_at = COALESCE(responses.started_at, datetime('now'))`,
  )
    .bind(newId('resp'), link.assessment_id, candidateId, link.link_id)
    .run();

  const responseRow = await c.env.DB.prepare(
    `SELECT id FROM responses
      WHERE assessment_id = ?1 AND candidate_id = ?2 AND cohort_id IS NULL`,
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

/**
 * Identity, for a cohort instrument.
 *
 * The respondent chooses their own name from the roster and gives an email.
 * That email is not a demographic: it is how their own peer-feedback report
 * reaches them later, and it is the only thing asked for that the facilitator
 * has not already supplied.
 */
async function startCohortResponse(c: Context<{ Bindings: Env }>, link: LinkRow): Promise<Response> {
  const resolved = await cohortForLink(c.env, link);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);
  const cohort = resolved.cohort;
  const round = resolved.round;

  // The strongest form of the same argument the OTP flag makes. With personal
  // links as the only door, a typed email is not a claim this cohort accepts
  // from anybody: the shared link reaches every inbox in the group and every
  // colleague's address is common knowledge, so the claim proves nothing. A
  // personal link is untouched — it was bound to one person before it was
  // sent, and the person holding it has nothing to type. Refused here rather
  // than trusted from the client, which is where the hole was.
  if (cohort.link_only_identity === 1 && link.kind === 'generic') {
    return c.json({ error: LINK_ONLY_REFUSAL, linkOnly: true }, 403);
  }

  const parsed = cohortIdentitySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }
  const { email, otp } = parsed.data;

  // Two-way binding, when the cohort demands it: the roster claims this email,
  // and the mailed code proves the inbox is actually held by whoever typed it.
  if (cohort.otp_required === 1) {
    if (!otp) {
      return c.json(
        { error: 'This exercise needs the 6-digit code from your email.', details: { otp: 'Code required' }, otpRequired: true },
        400,
      );
    }
    const otpProblem = await verifyOtp(c.env, cohort.id, round.no, email.trim().toLowerCase(), otp);
    if (otpProblem) {
      return c.json({ error: otpProblem, details: { otp: otpProblem }, otpRequired: true }, 400);
    }
  }

  // The email the facilitator put on the roster is the credential. No list of
  // names is ever offered to choose from, so nothing about who is in the
  // group leaves the server for an unidentified visitor.
  const { results: matches } = await c.env.DB.prepare(
    `SELECT id, no, name, function FROM cohort_members
      WHERE cohort_id = ?1 AND active = 1 AND email = ?2 AND email != ''`,
  )
    .bind(cohort.id, email.trim().toLowerCase())
    .all<{ id: string; no: number; name: string; function: string }>();

  if (!matches || matches.length === 0) {
    return c.json(
      {
        error:
          'You are not enrolled for this exercise. If you believe you should be, contact the cohort admin and ask them to add your work email.',
        details: { email: 'Not enrolled — contact the cohort admin' },
      },
      400,
    );
  }
  if (matches.length > 1) {
    return c.json(
      {
        error:
          'More than one person on this list shares that email, so it cannot say who you are. Ask your facilitator to fix the list.',
        details: { email: 'Shared by more than one person' },
      },
      400,
    );
  }
  const member = matches[0]!;

  let candidateId = link.candidate_id;
  if (!candidateId) {
    const existing = await c.env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
      .bind(email)
      .first<{ id: string }>();
    candidateId = existing?.id ?? newId('cand');
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO candidates (id, email, first_name, last_name, organisation)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
        .bind(candidateId, email, ...splitName(member.name), cohort.organisation)
        .run();
    }
  }

  // One roster position speaks once. Someone arriving at a name another person
  // has already claimed is told plainly rather than being allowed to submit a
  // second matrix that would be scored as that person's view.
  const claimed = await c.env.DB.prepare(
    `SELECT candidate_id, status FROM responses
      WHERE cohort_id = ?1 AND rater_member_id = ?2 AND round_no = ?3`,
  )
    .bind(cohort.id, member.id, round.no)
    .first<{ candidate_id: string; status: string }>();
  if (claimed && claimed.candidate_id !== candidateId) {
    return c.json(
      {
        error: `Someone has already started this exercise as ${member.name}. If that is not you, use your own work email; if it is, use the link you were sent originally.`,
        details: { email: 'Already claimed' },
      },
      409,
    );
  }
  // A completed matrix is closed. Re-entering the same email must not reopen
  // it — that is what would let a shared link read back, or overwrite, a
  // colleague's finished ratings at cell granularity. The answer is "you are
  // done", and no stored answers are returned.
  if (claimed && claimed.status === 'completed') {
    return c.json({ completed: true, alreadyCompleted: true });
  }

  // The roster name is authoritative, so it overwrites whatever the candidate
  // row was carrying: in a named group, "who this is" is the cohort's fact.
  const [firstName, lastName] = splitName(member.name);
  await c.env.DB.prepare(
    `UPDATE candidates SET first_name = ?2, last_name = ?3, organisation = ?4 WHERE id = ?1`,
  )
    .bind(candidateId, firstName, lastName, cohort.organisation)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO responses (id, assessment_id, candidate_id, link_id, cohort_id, round_no, rater_member_id, status, started_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?7, ?6, 'in_progress', datetime('now'))
     ON CONFLICT (assessment_id, candidate_id, COALESCE(cohort_id, ''), round_no) DO UPDATE
        SET status          = CASE WHEN responses.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
            rater_member_id = excluded.rater_member_id,
            started_at      = COALESCE(responses.started_at, datetime('now'))`,
  )
    .bind(newId('resp'), link.assessment_id, candidateId, link.link_id, cohort.id, member.id, round.no)
    .run();

  const responseRow = await c.env.DB.prepare(
    `SELECT id FROM responses
      WHERE assessment_id = ?1 AND candidate_id = ?2 AND cohort_id = ?3 AND round_no = ?4`,
  )
    .bind(link.assessment_id, candidateId, cohort.id, round.no)
    .first<{ id: string }>();

  // Changing identity mid-exercise would leave behind ratings the respondent
  // had given of the person they have now declared themselves to be. Those are
  // self-ratings, which the instrument forbids, so they are cleared rather than
  // carried and silently dropped at scoring time.
  await c.env.DB.prepare(
    `DELETE FROM answers
      WHERE response_id = ?1 AND no > ?2 AND no <= ?3`,
  )
    .bind(responseRow!.id, (member.no - 1) * SOCIO_ITEM_COUNT, member.no * SOCIO_ITEM_COUNT)
    .run();

  let personalToken: string | null = null;
  if (link.kind === 'generic') {
    personalToken = generateToken();
    const hash = await hashToken(personalToken, c.env.LINK_TOKEN_SECRET);
    const existingLink = await c.env.DB.prepare(
      `SELECT id FROM links
        WHERE kind = 'personal' AND assessment_id = ?1 AND candidate_id = ?2
          AND cohort_id = ?3 AND round_no = ?4`,
    )
      .bind(link.assessment_id, candidateId, cohort.id, round.no)
      .first<{ id: string }>();

    if (existingLink) {
      // A personal continuation link already exists for this person and round.
      // Rotating its token here would silently break the link already in the
      // real owner's hands — the lever an impersonator would pull. Leave it
      // untouched; this claim hands out no new link and the owner keeps theirs.
      personalToken = null;
    } else {
      await c.env.DB.prepare(
        `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, cohort_id, round_no, active)
         VALUES (?1, ?2, 'personal', ?3, ?4, ?5, ?6, 1)`,
      )
        .bind(newId('link'), hash, link.assessment_id, candidateId, cohort.id, round.no)
        .run();
    }
  }

  // The roster is released only now, to the person it was withheld from until
  // they proved themselves with a listed email — and an assigned rater gets
  // only themselves and their targets, never the rest of the group.
  const allowedTargetIds = await allowedTargetsFor(c.env, cohort.id, member.id);
  const fullRoster = await rosterForSession(c.env, cohort.id, round.no);
  const allowedSet = allowedTargetIds ? new Set(allowedTargetIds) : null;
  const roster = fullRoster.filter(
    (m) => m.memberId === member.id || !allowedSet || allowedSet.has(m.memberId),
  );

  return c.json({
    responseId: responseRow!.id,
    personalToken,
    selfMemberId: member.id,
    roster,
    allowedTargetIds,
    state: await loadResponseState(c.env, responseRow!.id),
  });
}

/** "Priya Raman" -> ["Priya", "Raman"]; a single-word name keeps a blank last. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return [parts[0] ?? name, parts.slice(1).join(' ')];
}

/**
 * Roster facts an answer batch is checked against: which positions exist, the
 * highest legitimate cell number, and which position the writer occupies.
 * null for the self-rating instruments, which have no roster.
 */
async function cohortBoundsFor(
  env: Env,
  link: LinkRow,
  responseId: string,
): Promise<{ maxNo: number; positions: Set<number>; selfNo: number | null } | null> {
  if (!isCohortKind(kindForAssessment(link.assessment_id)) || !link.cohort_id) return null;

  const { results } = await env.DB.prepare(
    `SELECT no FROM cohort_members WHERE cohort_id = ?1 AND active = 1 ORDER BY no`,
  )
    .bind(link.cohort_id)
    .all<{ no: number }>();

  const positions = new Set((results ?? []).map((r) => r.no));
  const highest = positions.size > 0 ? Math.max(...positions) : 1;

  // Taken from the response being written to rather than from the link: on a
  // generic link the link itself carries no candidate.
  const self = await env.DB.prepare(
    `SELECT m.no FROM responses r
       JOIN cohort_members m ON m.id = r.rater_member_id
      WHERE r.id = ?1 AND r.cohort_id = ?2`,
  )
    .bind(responseId, link.cohort_id)
    .first<{ no: number }>();

  return { maxNo: maxCellNo(highest), positions, selfNo: self?.no ?? null };
}

// ------------------------------------------------------------------- answers

/**
 * Autosave. Accepts one answer or a flushed offline batch; both are upserts, so
 * replaying a queue after reconnect is safe and order-independent.
 */
candidateRoutes.post('/answers/:token', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || linkRefusal(link)) return c.json({ error: 'This link is not available.' }, 404);

  const rl = await rateLimit(c.env, `ans:${clientKey(c.req.raw)}`, 600, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  // Bounds come from the instrument this link resolves to, so a 0–4 inventory
  // rejects a 5 and a 0–6 inventory accepts one. For a cohort instrument the
  // *number* is a matrix cell rather than a statement, so its ceiling comes
  // from the roster: roster size × twelve items.
  const responseId = c.req.query('response');
  if (!responseId) return c.json({ error: 'Missing response id' }, 400);

  const scale = scaleForLink(link);
  const cohortInfo = await cohortBoundsFor(c.env, link, responseId);
  const parsed = answerBatchSchemaFor(scale.min, scale.max, cohortInfo?.maxNo ?? 200).safeParse(
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

  const valid = cohortInfo
    ? parsed.data.answers.filter((a) => {
        if (a.no < 1 || a.no > cohortInfo.maxNo) return false;
        const { memberNo } = decodeCell(a.no);
        // Positions vacated from the roster, and the respondent's own row, are
        // dropped at the edge rather than stored and discarded at scoring time.
        if (!cohortInfo.positions.has(memberNo)) return false;
        return memberNo !== cohortInfo.selfNo;
      })
    : parsed.data.answers.filter((a) => a.no >= 1 && a.no <= link.question_count);
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

/**
 * Clears a colleague's whole row.
 *
 * "We don't really work together" is a real answer, and a respondent who rated
 * someone and then thought better of it needs a way to say it. Blanking cells
 * client-side would not do: the stored ratings are what the cohort is scored
 * from, so the removal has to reach the database. Only whole rows are clearable
 * — a request to clear part of one would leave exactly the ambiguous half-row
 * that submit refuses.
 */
candidateRoutes.post('/answers/:token/clear', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || linkRefusal(link)) return c.json({ error: 'This link is not available.' }, 404);
  if (!isCohortKind(kindForAssessment(link.assessment_id))) {
    return c.json({ error: 'This assessment has no rows to clear.' }, 400);
  }

  const rl = await rateLimit(c.env, `clr:${clientKey(c.req.raw)}`, 120, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const responseId = c.req.query('response');
  if (!responseId) return c.json({ error: 'Missing response id' }, 400);

  const parsed = clearRowSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Nothing to clear.' }, 400);

  const resp = await c.env.DB.prepare(
    'SELECT id, status, candidate_id FROM responses WHERE id = ?1 AND assessment_id = ?2',
  )
    .bind(responseId, link.assessment_id)
    .first<{ id: string; status: string; candidate_id: string }>();
  if (!resp) return c.json({ error: 'Unknown response' }, 404);
  if (link.candidate_id && link.candidate_id !== resp.candidate_id) {
    return c.json({ error: 'This link does not match that response.' }, 403);
  }
  if (resp.status === 'completed') {
    return c.json({ error: 'This assessment has already been submitted.', completed: true }, 409);
  }

  const statements = parsed.data.memberNos.map((memberNo) =>
    c.env.DB.prepare('DELETE FROM answers WHERE response_id = ?1 AND no > ?2 AND no <= ?3').bind(
      responseId,
      (memberNo - 1) * SOCIO_ITEM_COUNT,
      memberNo * SOCIO_ITEM_COUNT,
    ),
  );
  statements.push(
    c.env.DB.prepare(
      `UPDATE responses
          SET answered_count = (SELECT COUNT(*) FROM answers WHERE response_id = ?1),
              resume_page = COALESCE(?2, resume_page)
        WHERE id = ?1`,
    ).bind(responseId, parsed.data.resumePage ?? null),
  );
  await c.env.DB.batch(statements);

  const count = await c.env.DB.prepare('SELECT answered_count FROM responses WHERE id = ?1')
    .bind(responseId)
    .first<{ answered_count: number }>();

  return c.json({ cleared: parsed.data.memberNos.length, answeredCount: count?.answered_count ?? 0 });
});

// ----------------------------------------------------------------------- otp

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

/**
 * Mails a six-digit code to an enrolled address, for a cohort that requires
 * one. The code is stored hashed, lives ten minutes, and is replaced by any
 * newer request — so only the latest mail works, and a database row never
 * contains anything typeable.
 */
candidateRoutes.post('/otp/:token', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || linkRefusal(link) || link.status !== 'live') {
    return c.json({ error: 'This link is not available.' }, 404);
  }
  if (!isCohortKind(kindForAssessment(link.assessment_id))) {
    return c.json({ error: 'This assessment does not use codes.' }, 400);
  }

  const rl = await rateLimit(c.env, `otp:${clientKey(c.req.raw)}`, 10, 300);
  if (!rl.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);

  const parsed = cohortOtpRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Please check the highlighted fields.', details: fieldErrors(parsed.error) }, 400);
  }

  const resolved = await cohortForLink(c.env, link);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);
  const { cohort, round } = resolved;
  // Defence in depth. The console does not offer codes for a link-only cohort
  // and the shell does not draw the form, but this door mails something to an
  // address someone typed, and the identity step it feeds is already shut —
  // so it shuts on the same terms rather than trusting that nobody knocks.
  if (cohort.link_only_identity === 1 && link.kind === 'generic') {
    return c.json({ error: LINK_ONLY_REFUSAL, linkOnly: true }, 403);
  }
  if (cohort.otp_required !== 1) return c.json({ error: 'This exercise does not use codes.' }, 400);

  const email = parsed.data.email.trim().toLowerCase();
  const { results: members } = await c.env.DB.prepare(
    `SELECT id, name FROM cohort_members
      WHERE cohort_id = ?1 AND active = 1 AND email = ?2 AND email != ''`,
  )
    .bind(cohort.id, email)
    .all<{ id: string; name: string }>();

  if (!members || members.length !== 1) {
    // The same wording the identity step uses, so the two doors agree.
    return c.json(
      {
        error:
          members && members.length > 1
            ? 'More than one person on this list shares that email. Ask your facilitator to fix the list.'
            : 'You are not enrolled for this exercise. If you believe you should be, contact the cohort admin and ask them to add your work email.',
        details: { email: 'Not enrolled — contact the cohort admin' },
      },
      400,
    );
  }

  // Six digits from the platform CSPRNG — never Math.random for a credential.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(buf[0]! % 1_000_000).padStart(6, '0');

  await c.env.DB.prepare(
    `INSERT INTO cohort_otps (id, cohort_id, round_no, email, code_hash, expires_at, attempts)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+${OTP_MINUTES} minutes'), 0)
     ON CONFLICT (cohort_id, round_no, email) DO UPDATE
        SET code_hash = excluded.code_hash,
            expires_at = excluded.expires_at,
            attempts = 0,
            created_at = datetime('now')`,
  )
    .bind(newId('otp'), cohort.id, round.no, email, await hashToken(code, c.env.LINK_TOKEN_SECRET))
    .run();

  const branding = brandingForClient(await getBranding(c.env));
  const mail = otpEmail({
    branding,
    logoUrl: `${baseUrl(c.env, c.req.raw)}/api/logo`,
    code,
    cohortName: cohort.name,
    minutes: OTP_MINUTES,
  });
  await sendMail(c.env, { to: email, subject: mail.subject, html: mail.html, text: mail.text, kind: 'cohort_otp' });

  return c.json({ sent: true, minutes: OTP_MINUTES });
});

/**
 * Checks a submitted code against the stored hash. Consumes the row on
 * success; counts and caps failures so six digits cannot be walked.
 */
async function verifyOtp(
  env: Env,
  cohortId: string,
  roundNo: number,
  email: string,
  otp: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at <= datetime('now') AS expired
       FROM cohort_otps WHERE cohort_id = ?1 AND round_no = ?2 AND email = ?3`,
  )
    .bind(cohortId, roundNo, email)
    .first<{ id: string; code_hash: string; attempts: number; expired: number }>();

  if (!row || row.expired === 1) return 'That code has expired. Request a fresh one.';
  if (row.attempts >= OTP_MAX_ATTEMPTS) return 'Too many wrong tries. Request a fresh code.';

  const ok = row.code_hash === (await hashToken(otp, env.LINK_TOKEN_SECRET));
  if (!ok) {
    await env.DB.prepare('UPDATE cohort_otps SET attempts = attempts + 1 WHERE id = ?1')
      .bind(row.id)
      .run();
    return 'That code is not right. Check the newest email, or request a fresh code.';
  }
  await env.DB.prepare('DELETE FROM cohort_otps WHERE id = ?1').bind(row.id).run();
  return null;
}

// -------------------------------------------------------------------- submit

const submitSchema = z.object({
  responseId: z.string().min(1),
  /**
   * The diagnostic's optional free-text answer. Accepted here rather than on
   * the autosave route because it is not a rating: it is submitted once, with
   * the sheet, and never averaged.
   */
  openAnswer: z.string().max(2000).optional(),
});

candidateRoutes.post('/submit/:token', async (c) => {
  const link = await resolveLink(c.env, c.req.param('token'));
  if (!link || linkRefusal(link)) return c.json({ error: 'This link is not available.' }, 404);

  // Thirty per five minutes keyed on one office address is fewer than the
  // number of leaders in a single run finishing together. A submission has
  // already presented a token that resolved, so this is a volume guard too.
  const rl = await rateLimit(c.env, `submit:${clientKey(c.req.raw)}`, 200, 300);
  if (!rl.allowed) return c.json({ error: 'Too many attempts. Try again shortly.' }, 429);

  const parsed = submitSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Missing response id' }, 400);

  const resp = await c.env.DB.prepare(
    'SELECT id, status, candidate_id, answered_count, rater_member_id FROM responses WHERE id = ?1 AND assessment_id = ?2',
  )
    .bind(parsed.data.responseId, link.assessment_id)
    .first<{ id: string; status: string; candidate_id: string; answered_count: number; rater_member_id: string | null }>();
  if (!resp) return c.json({ error: 'Unknown response' }, 404);
  if (link.candidate_id && link.candidate_id !== resp.candidate_id) {
    return c.json({ error: 'This link does not match that response.' }, 403);
  }

  if (resp.status === 'completed') {
    return c.json({ completed: true, alreadyCompleted: true });
  }

  // A cohort instrument has no notion of "every statement answered": leaving a
  // colleague blank is the workbook's own instruction and is real information.
  // What is checked instead is that the rows the respondent *did* start are
  // whole, and that they rated at least the cohort's floor of colleagues.
  if (isCohortKind(kindForAssessment(link.assessment_id))) {
    const problem = await checkCohortSubmission(c.env, link, resp.id, resp.rater_member_id);
    if (problem) return c.json(problem.body, problem.status);

    await c.env.DB.prepare(
      `UPDATE responses SET status = 'completed', completed_at = datetime('now') WHERE id = ?1`,
    )
      .bind(resp.id)
      .run();

    // No report token, and nothing dispatched. A cohort is scored across every
    // response at once, when the facilitator generates the reports -- there is
    // nothing to score at the moment one person finishes.
    return c.json({ completed: true, reportToken: null, cohort: true });
  }

  /*
   * A diagnostic sheet is finished or it is not submitted. Every statement is
   * about the respondent's own organisation, so unlike a peer matrix there is
   * nothing here they have no basis to judge, and a section mean over three of
   * four statements is a different quantity wearing the same name.
   *
   * Nothing is dispatched on completion and no report token is minted. A run
   * is scored across every response at once, when the facilitator reads the
   * results; one leader finishing scores nothing. The respondent is promised
   * nothing in return, and the completion screen says so.
   */
  if (isCollabLink(link)) {
    const missingNos = await checkCollabSubmission(c.env, resp.id);
    if (missingNos.length > 0) {
      return c.json({ error: 'Some statements are still unanswered.', missing: missingNos }, 400);
    }

    // The open question is optional and is stored apart from the ratings: a
    // sentence is not a 25th statement and must never reach a mean.
    const body = parsed.data as { responseId: string; openAnswer?: unknown };
    if (typeof body.openAnswer === 'string' && link.cohort_id) {
      await saveOpenAnswer(c.env, resp.id, link.cohort_id, link.round_no, body.openAnswer);
    }
    await c.env.DB.prepare(
      `UPDATE responses SET status = 'completed', completed_at = datetime('now') WHERE id = ?1`,
    )
      .bind(resp.id)
      .run();
    return c.json({ completed: true, reportToken: null, run: true });
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

/**
 * What can be wrong with a matrix at submit time.
 *
 * Two rules, and the distinction between them is the whole design:
 *
 *  1. A colleague may be left entirely unrated. That is the workbook's own
 *     instruction — "if you have no real basis to judge someone, leave those
 *     cells blank" — and a blank row is real information, not a gap.
 *  2. A colleague who *is* rated must be rated on all twelve statements.
 *
 * A part-rated row is neither of the two things a reader can act on. It is not
 * "no basis to judge", because the respondent plainly had a basis for the seven
 * they answered; and it is not a rating, because the block means the average of
 * its statements and a block missing half its statements is a different
 * quantity wearing the same name. Two people rated on different subsets are
 * then ranked against each other in the group report as though the numbers were
 * comparable. They are not.
 *
 * So the choice is pushed back to where it can still be made honestly: finish
 * this person, or say you have no basis and leave them blank.
 *
 * Under that, a floor against an empty submission. Returns null when the
 * submission is acceptable.
 */
async function checkCohortSubmission(
  env: Env,
  link: LinkRow,
  responseId: string,
  raterMemberId: string | null,
): Promise<{ body: Record<string, unknown>; status: 400 } | null> {
  const cohort = link.cohort_id ? await loadCohort(env, link.cohort_id) : null;
  if (!cohort) return { body: { error: 'This group no longer exists.' }, status: 400 };

  // A tab left open across the end of a wave would otherwise post its matrix
  // into a round that has been scored and reported. The page checks the session
  // once a minute for exactly this, but the server is the one that decides.
  const round = await roundByNo(env, cohort.id, link.round_no);
  if (!round || round.closed_at) {
    return {
      body: {
        error: round
          ? `${roundName(round)} has finished and is no longer accepting responses. Nothing you entered has been lost — ask your facilitator for the current link.`
          : 'This group no longer exists.',
      },
      status: 400,
    };
  }

  const { results } = await env.DB.prepare('SELECT no FROM answers WHERE response_id = ?1')
    .bind(responseId)
    .all<{ no: number }>();

  const perTarget = new Map<number, number>();
  for (const a of results ?? []) {
    const { memberNo } = decodeCell(a.no);
    perTarget.set(memberNo, (perTarget.get(memberNo) ?? 0) + 1);
  }

  // Named, not numbered. "Rows 3, 7 and 12 are incomplete" is a sentence about
  // the storage layout; the respondent is looking at a list of people.
  const roster = await loadRoster(env, cohort.id);
  const nameByNo = new Map(roster.map((m) => [m.no, m.name] as const));

  const partial = [...perTarget.entries()]
    .filter(([, n]) => n > 0 && n < SOCIO_ITEM_COUNT)
    .map(([no]) => no)
    .sort((a, b) => a - b);

  if (partial.length > 0) {
    const names = partial.map((no) => nameByNo.get(no) ?? `Colleague ${no}`);
    return {
      body: {
        error:
          partial.length === 1
            ? `You have answered some but not all of the statements about ${names[0]}. Please finish them, or clear them with "no basis to judge" if you would rather not rate this person.`
            : `You have answered some but not all of the statements about ${names.length} colleagues: ${names.join(', ')}. Please finish each of them, or clear them with "no basis to judge" if you would rather not rate that person.`,
        partialTargets: partial,
        partialNames: names,
      },
      status: 400,
    };
  }

  // An assigned rater lives in a smaller world: someone mapped to three
  // colleagues cannot be held to a floor of five. The floor never rises above
  // what they were actually shown.
  const allowed = raterMemberId ? await allowedTargetsFor(env, cohort.id, raterMemberId) : null;
  const floor = allowed ? Math.min(cohort.min_rated_targets, allowed.length) : cohort.min_rated_targets;

  const rated = perTarget.size;
  if (rated < floor) {
    return {
      body: {
        error: `Please rate at least ${floor} ${
          floor === 1 ? 'colleague' : 'colleagues'
        } before submitting. You have rated ${rated}.`,
        ratedTargets: rated,
        minRatedTargets: floor,
      },
      status: 400,
    };
  }

  return null;
}
