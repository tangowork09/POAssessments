/**
 * The respondent's side of a Collaboration Diagnostic run.
 *
 * A leader opening a run's link is doing something simpler than either of the
 * other instruments: 24 statements, one scale, no roster to identify against
 * and no colleagues to rate. What is not simple is what the platform is allowed
 * to know about them while they do it, and that is what this module holds.
 *
 * Two modes, decided per run before anyone is invited:
 *
 *   * **Named.** The respondent gives an email, exactly as a self-rating does,
 *     and the facilitator can see who has finished and chase who has not.
 *   * **Anonymous.** No email is asked and none is kept. The response is
 *     attributed to a placeholder that identifies the wave rather than a
 *     person, so there is nothing to join back to. Resuming works through the
 *     link, not through an identity.
 *
 * In both modes the respondent is asked for their department, or whatever cuts
 * the run collects. That is not a demographic: it is the only thing that makes
 * "Quality see this and Commercial do not" sayable, and it is stored on the
 * response rather than on a person so it survives anonymity.
 *
 * What is never asked: name, age band, experience band, gender. The diagnostic
 * reports on an organisation. None of those change a section mean, and asking
 * for them in a run promised as anonymous would be a lie told in a form field.
 */

import type { Context } from 'hono';
import type { Env } from '../env.js';
import { newId } from './../lib/ids.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';
import { COLLAB_ITEM_COUNT } from '../../shared/collab.js';
import { anonymousCandidateEmail } from '../lib/collab-run.js';
import type { CollabFacet, CollabRunForCandidate } from '../../shared/types.js';

/** The subset of the link row this module needs. */
export interface CollabLink {
  link_id: string;
  assessment_id: string;
  kind: 'personal' | 'generic';
  candidate_id: string | null;
  cohort_id: string | null;
  round_no: number;
}

export function isCollabLink(link: { assessment_id: string }): boolean {
  return link.assessment_id === ASSESSMENT_ID.collab;
}

interface RunRow {
  id: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  anonymous: number;
  open_question: string;
}

/**
 * Loads the run behind a link, refusing one that is not taking answers.
 *
 * A draft run has not been announced to anybody, and a closed one has been
 * scored — a response arriving after the facilitator has read the results
 * either changes a number they have already quoted, or is silently discarded.
 * Neither is acceptable, so the door is shut here with a reason a respondent
 * can act on.
 */
export async function runForLink(
  env: Env,
  link: CollabLink,
): Promise<{ run: RunRow; waveNo: number; waveLabel: string } | { error: string; code: 403 | 404 }> {
  if (!link.cohort_id) return { error: 'This link is not attached to a run.', code: 404 };

  const run = await env.DB.prepare(
    `SELECT id, organisation, status, anonymous, open_question
       FROM cohorts WHERE id = ?1 AND assessment_id = ?2`,
  )
    .bind(link.cohort_id, ASSESSMENT_ID.collab)
    .first<RunRow>();
  if (!run) return { error: 'This run no longer exists.', code: 404 };
  if (run.status === 'draft') {
    return { error: 'This diagnostic has not opened yet. Your facilitator will let you know when it does.', code: 403 };
  }
  if (run.status === 'closed') {
    return { error: 'This diagnostic has closed and is no longer accepting responses.', code: 403 };
  }

  const wave = await env.DB.prepare(
    'SELECT no, label, closed_at FROM cohort_rounds WHERE cohort_id = ?1 AND no = ?2',
  )
    .bind(run.id, link.round_no)
    .first<{ no: number; label: string; closed_at: string | null }>();
  if (!wave) return { error: 'This run no longer exists.', code: 404 };
  if (wave.closed_at) {
    return {
      error: `${waveName(wave.no, wave.label)} has finished and is no longer accepting responses. If you were sent a newer link, use that one.`,
      code: 403,
    };
  }

  return { run, waveNo: wave.no, waveLabel: wave.label };
}

export function waveName(no: number, label: string): string {
  return label.trim() !== '' ? label.trim() : `Wave ${no}`;
}

/** The cuts a run collects, as the respondent will be asked them. */
export async function loadFacets(env: Env, cohortId: string): Promise<CollabFacet[]> {
  const { results } = await env.DB.prepare(
    `SELECT key, label, options, required FROM cohort_facets
      WHERE cohort_id = ?1 ORDER BY sort_order, key`,
  )
    .bind(cohortId)
    .all<{ key: string; label: string; options: string; required: number }>();

  return (results ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    options: parseOptions(row.options),
    required: row.required === 1,
  }));
}

/** What this respondent has already chosen, for a resumed session. */
export async function loadChosenFacets(env: Env, responseId: string): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM response_facets WHERE response_id = ?1',
  )
    .bind(responseId)
    .all<{ key: string; value: string }>();
  const chosen: Record<string, string> = {};
  for (const row of results ?? []) chosen[row.key] = row.value;
  return chosen;
}

/** What this respondent has already typed in the open question. */
export async function loadOpenAnswer(env: Env, responseId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT text FROM collab_open_answers WHERE response_id = ?1')
    .bind(responseId)
    .first<{ text: string }>();
  return row?.text ?? '';
}

/**
 * Saves the open answer, or clears it.
 *
 * Kept out of `answers`, which holds a 1..5 per statement number and is what
 * every mean is taken over. A sentence is not a rating and must never be
 * reachable by code that averages.
 */
export async function saveOpenAnswer(
  env: Env,
  responseId: string,
  cohortId: string,
  roundNo: number,
  text: string,
): Promise<void> {
  const trimmed = text.trim().slice(0, 2000);
  if (trimmed === '') {
    await env.DB.prepare('DELETE FROM collab_open_answers WHERE response_id = ?1').bind(responseId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO collab_open_answers (response_id, cohort_id, round_no, text)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(response_id) DO UPDATE SET text = excluded.text, created_at = datetime('now')`,
  )
    .bind(responseId, cohortId, roundNo, trimmed)
    .run();
}

/** The run block a candidate session carries, or an error the shell can draw. */
export async function collabSessionFor(
  env: Env,
  link: CollabLink,
  responseId: string | null,
): Promise<CollabRunForCandidate | { error: string; code: 403 | 404 }> {
  const resolved = await runForLink(env, link);
  if ('error' in resolved) return resolved;

  return {
    cohortId: resolved.run.id,
    organisation: resolved.run.organisation,
    waveNo: resolved.waveNo,
    waveName: waveName(resolved.waveNo, resolved.waveLabel),
    anonymous: resolved.run.anonymous === 1,
    /**
     * One optional free-text question, after the statements. Never scored:
     * the instrument has 24 statements and this is not a 25th.
     */
    openQuestion: resolved.run.open_question,
    openAnswer: responseId ? await loadOpenAnswer(env, responseId) : '',
    facets: await loadFacets(env, resolved.run.id),
    chosen: {
      // Anything the facilitator already recorded about this person is not
      // asked again: they wrote "Operations" on the roster, so the respondent
      // is not invited to type a third spelling of it.
      ...(await rosterFacets(env, resolved.run.id, link)),
      ...(responseId ? await loadChosenFacets(env, responseId) : {}),
    },
  };
}

/**
 * What the run's roster already knows about the person holding this link.
 *
 * Only for a personal link in a named run: a shared link has no idea who is
 * on the other end, which is exactly what it is for.
 */
export async function rosterFacets(
  env: Env,
  cohortId: string,
  link: CollabLink,
): Promise<Record<string, string>> {
  if (link.kind !== 'personal' || !link.candidate_id) return {};

  const row = await env.DB.prepare(
    `SELECT m.function FROM cohort_members m
       JOIN candidates cd ON cd.email = m.email
      WHERE m.cohort_id = ?1 AND cd.id = ?2 AND m.active = 1 AND m.function <> ''`,
  )
    .bind(cohortId, link.candidate_id)
    .first<{ function: string }>();

  return row?.function ? { department: row.function } : {};
}

export interface StartCollabBody {
  email?: unknown;
  facets?: unknown;
}

export interface StartCollabResult {
  responseId: string;
  /** A token that resumes this session, on a run answered through a shared link. */
  personalToken: string | null;
}

/**
 * Begins, or resumes, one respondent's sheet.
 *
 * The response is found by the link rather than by the person, which is what
 * lets an anonymous run resume at all: every anonymous response in a wave
 * shares one placeholder candidate, so "this candidate's response" is not a
 * question with one answer, while "this link's response" always is.
 */
export async function startCollabResponse(
  c: Context<{ Bindings: Env }>,
  link: CollabLink,
): Promise<Response> {
  const resolved = await runForLink(c.env, link);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.code);
  const { run, waveNo } = resolved;
  const anonymous = run.anonymous === 1;

  const body = (await c.req.json().catch(() => ({}))) as StartCollabBody;

  const facets = await loadFacets(c.env, run.id);
  const known = await rosterFacets(c.env, run.id, link);
  // The roster's answer wins over anything the client sends for the same
  // question: the facilitator's spelling is the one the results are cut by.
  const chosen = validateFacets(facets, { ...(asRecord(body.facets) ?? {}), ...known });
  if ('error' in chosen) return c.json({ error: chosen.error, field: chosen.field }, 400);

  let candidateId: string;
  if (anonymous) {
    candidateId = await placeholderCandidate(c.env, run.id, waveNo);
  } else {
    const resolvedCandidate = await namedCandidate(c.env, link, body.email);
    if ('error' in resolvedCandidate) return c.json({ error: resolvedCandidate.error }, 400);
    candidateId = resolvedCandidate.id;
  }

  // A link that already has a response continues it. On a shared link in an
  // anonymous run there is no such row for a new visitor, so they get a fresh
  // one and a token of their own to come back with.
  const existing = await c.env.DB.prepare(
    `SELECT id, status FROM responses
      WHERE link_id = ?1 AND cohort_id = ?2 AND round_no = ?3
      ORDER BY invited_at DESC LIMIT 1`,
  )
    .bind(link.link_id, run.id, waveNo)
    .first<{ id: string; status: string }>();

  let responseId: string;
  let personalToken: string | null = null;

  if (existing && link.kind === 'personal') {
    responseId = existing.id;
    if (existing.status === 'invited') {
      await c.env.DB.prepare(
        `UPDATE responses SET status = 'in_progress', started_at = COALESCE(started_at, datetime('now'))
          WHERE id = ?1`,
      )
        .bind(responseId)
        .run();
    }
  } else {
    responseId = newId('resp');
    // A shared link is one row that many people open, so each respondent is
    // given their own personal link and their response is bound to it. Without
    // that, the second person to start would resume the first one's sheet.
    let linkId = link.link_id;
    if (link.kind === 'generic') {
      personalToken = generateToken();
      linkId = newId('link');
      // self_issued: this link was minted for the person in front of us so
      // they can come back to their own sheet. It is not an invitation, and
      // turnout must not count it as one.
      await c.env.DB.prepare(
        `INSERT INTO links (id, token_hash, kind, assessment_id, candidate_id, cohort_id, round_no, active, self_issued)
         VALUES (?1, ?2, 'personal', ?3, ?4, ?5, ?6, 1, 1)`,
      )
        .bind(
          linkId,
          await hashToken(personalToken, c.env.LINK_TOKEN_SECRET),
          ASSESSMENT_ID.collab,
          candidateId,
          run.id,
          waveNo,
        )
        .run();
    }

    await c.env.DB.prepare(
      `INSERT INTO responses (id, assessment_id, candidate_id, link_id, cohort_id, round_no, anonymous, status, started_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'in_progress', datetime('now'))`,
    )
      .bind(responseId, ASSESSMENT_ID.collab, candidateId, linkId, run.id, waveNo, anonymous ? 1 : 0)
      .run();
  }

  if (Object.keys(chosen.values).length > 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM response_facets WHERE response_id = ?1').bind(responseId),
      ...Object.entries(chosen.values).map(([key, value]) =>
        c.env.DB.prepare('INSERT INTO response_facets (response_id, key, value) VALUES (?1, ?2, ?3)').bind(
          responseId,
          key,
          value,
        ),
      ),
    ]);
  }

  return c.json({ responseId, personalToken } satisfies StartCollabResult);
}

/**
 * What can be wrong with a sheet at submit time: a gap.
 *
 * Unlike sociometry, where a blank colleague is the instrument's own
 * instruction, every statement here is about the respondent's own organisation
 * and there is nothing they have no basis to judge. A section mean over 3 of 4
 * statements is a different quantity wearing the same name, so the sheet is
 * finished or it is not submitted. Returns the missing numbers, so the shell
 * can take the respondent back to them.
 */
export async function checkCollabSubmission(env: Env, responseId: string): Promise<number[]> {
  const { results } = await env.DB.prepare('SELECT no FROM answers WHERE response_id = ?1')
    .bind(responseId)
    .all<{ no: number }>();
  const answered = new Set((results ?? []).map((r) => r.no));
  const missing: number[] = [];
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) {
    if (!answered.has(no)) missing.push(no);
  }
  return missing;
}

/**
 * The row anonymous responses in one wave are attributed to.
 *
 * Created on first use and shared by everyone in that wave, which is precisely
 * what makes it useless for identifying anybody. It is addressed at `.invalid`,
 * reserved by RFC 2606 so it can never receive mail, and carries no name.
 */
async function placeholderCandidate(env: Env, cohortId: string, waveNo: number): Promise<string> {
  const email = anonymousCandidateEmail(cohortId, waveNo);
  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = newId('cand');
  await env.DB.prepare(
    `INSERT INTO candidates (id, email, first_name, last_name, organisation)
     VALUES (?1, ?2, '', '', '')
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(id, email)
    .run();

  const row = await env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? id;
}

/**
 * The candidate behind a named run's response.
 *
 * A personal link already knows who it went to and that binding wins: an email
 * typed into a form cannot reassign someone else's link.
 */
async function namedCandidate(
  env: Env,
  link: CollabLink,
  email: unknown,
): Promise<{ id: string } | { error: string }> {
  if (link.candidate_id) return { id: link.candidate_id };

  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(address) || address.length > 200) {
    return { error: 'Please enter the email address your invitation was sent to.' };
  }

  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE email = ?1')
    .bind(address)
    .first<{ id: string }>();
  if (existing) return { id: existing.id };

  const id = newId('cand');
  await env.DB.prepare(
    `INSERT INTO candidates (id, email, first_name, last_name, organisation) VALUES (?1, ?2, '', '', '')`,
  )
    .bind(id, address)
    .run();
  return { id };
}

/**
 * Checks the respondent's choices against the list they were offered.
 *
 * A value that is not on the list is refused rather than stored: the whole
 * point of a closed list is that two spellings of one department cannot exist,
 * and a client crafting their own request is exactly how a third spelling gets
 * in. A facet marked optional may be left out entirely; it is then absent
 * rather than stored as "Not given", so an unanswered cut and a suppressed one
 * never pool into a phantom segment.
 */
export function validateFacets(
  facets: readonly CollabFacet[],
  given: unknown,
): { values: Record<string, string> } | { error: string; field: string } {
  const input =
    given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : {};
  const values: Record<string, string> = {};

  for (const facet of facets) {
    const raw = input[facet.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      if (facet.required) return { error: `Please choose your ${facet.label.toLowerCase()}.`, field: facet.key };
      continue;
    }
    if (!facet.options.includes(value)) {
      return { error: `That is not one of the ${facet.label.toLowerCase()} options.`, field: facet.key };
    }
    values[facet.key] = value;
  }

  return { values };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOptions(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
