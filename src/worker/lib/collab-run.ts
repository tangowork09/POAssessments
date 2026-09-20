/**
 * Collaboration Diagnostic runs: loading a wave's responses and scoring it.
 *
 * A run is a cohort whose instrument is the diagnostic, and a wave is one of
 * that cohort's rounds — see migration 0022 for why neither concept is rebuilt.
 * What is different from sociometry, and what this module exists to hold:
 *
 *   * There is no roster requirement. A run answered entirely through one
 *     shared link, with nobody named anywhere, is a complete run.
 *   * A response belongs to the run, not to a rater position. Nothing here
 *     joins to `cohort_members`, and nothing here reads a candidate's name or
 *     address — not because the console hides them, but because the group
 *     figures never need them.
 *   * Segments come off the response (`response_facets`), so they survive
 *     anonymity. A department that travels on the candidate row would vanish
 *     the moment the response is detached from a person.
 *
 * Scoring is across the whole wave, so none of this hangs off the
 * `score_and_deliver` path a self-rating uses: one leader finishing scores
 * nothing.
 */

import type { Env } from '../env.js';
import { COLLAB_ITEM_COUNT } from '../../shared/collab.js';
import {
  scoreCollabGroup,
  segmentCollab,
  type CollabGroupResult,
  type CollabSegment,
} from '../../shared/collab-scoring.js';

export class CollabRunError extends Error {}

/** One respondent's answers, with the cuts they can be grouped by. */
export interface CollabRunResponse {
  responseId: string;
  /** Statement number to raw 1..5 answer, exactly as given. */
  answers: Record<number, number>;
  /** Facet key to chosen value. Absent keys were not asked or were declined. */
  facets: Record<string, string>;
  anonymous: boolean;
}

export interface CollabRunTurnout {
  /** People who were given a way in: personal links issued, or roster size. */
  invited: number;
  started: number;
  completed: number;
}

/**
 * Every completed response in one wave.
 *
 * Incomplete responses are left out here rather than filtered later: a
 * half-finished sheet is not a quiet zero, and the engine counts what it had to
 * set aside so the console can report it.
 */
export async function loadRunResponses(
  env: Env,
  cohortId: string,
  roundNo: number,
): Promise<CollabRunResponse[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, anonymous
       FROM responses
      WHERE cohort_id = ?1 AND round_no = ?2 AND status = 'completed'
      ORDER BY completed_at`,
  )
    .bind(cohortId, roundNo)
    .all<{ id: string; anonymous: number }>();

  const rows = results ?? [];
  if (rows.length === 0) return [];

  const answers = await env.DB.prepare(
    `SELECT a.response_id, a.no, a.value
       FROM answers a
       JOIN responses r ON r.id = a.response_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed'`,
  )
    .bind(cohortId, roundNo)
    .all<{ response_id: string; no: number; value: number }>();

  const facets = await env.DB.prepare(
    `SELECT f.response_id, f.key, f.value
       FROM response_facets f
       JOIN responses r ON r.id = f.response_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed'`,
  )
    .bind(cohortId, roundNo)
    .all<{ response_id: string; key: string; value: string }>();

  const answersByResponse = new Map<string, Record<number, number>>();
  for (const a of answers.results ?? []) {
    let bag = answersByResponse.get(a.response_id);
    if (!bag) answersByResponse.set(a.response_id, (bag = {}));
    bag[a.no] = a.value;
  }

  const facetsByResponse = new Map<string, Record<string, string>>();
  for (const f of facets.results ?? []) {
    let bag = facetsByResponse.get(f.response_id);
    if (!bag) facetsByResponse.set(f.response_id, (bag = {}));
    bag[f.key] = f.value;
  }

  return rows.map((row) => ({
    responseId: row.id,
    answers: answersByResponse.get(row.id) ?? {},
    facets: facetsByResponse.get(row.id) ?? {},
    anonymous: row.anonymous === 1,
  }));
}

/**
 * How many people were asked, started and finished.
 *
 * `invited` counts the ways in that were handed to a named person, falling back
 * to the roster when a run is being chased by list rather than by link. A run
 * on one shared link has no honest denominator, and reports 0 rather than
 * inventing one — the console shows a count answered instead of a rate.
 */
export async function runTurnout(env: Env, cohortId: string, roundNo: number): Promise<CollabRunTurnout> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM links
         WHERE cohort_id = ?1 AND round_no = ?2 AND kind = 'personal' AND active = 1) AS personal_links,
       (SELECT COUNT(*) FROM cohort_members WHERE cohort_id = ?1 AND active = 1) AS roster,
       (SELECT COUNT(*) FROM responses
         WHERE cohort_id = ?1 AND round_no = ?2 AND status IN ('in_progress','completed')) AS started,
       (SELECT COUNT(*) FROM responses
         WHERE cohort_id = ?1 AND round_no = ?2 AND status = 'completed') AS completed`,
  )
    .bind(cohortId, roundNo)
    .first<{ personal_links: number; roster: number; started: number; completed: number }>();

  if (!row) return { invited: 0, started: 0, completed: 0 };
  return {
    invited: row.personal_links > 0 ? row.personal_links : row.roster,
    started: row.started,
    completed: row.completed,
  };
}

export interface CollabRunScores {
  group: CollabGroupResult;
  /** One entry per facet collected, each with its segments in offered order. */
  cuts: CollabRunCut[];
  turnout: CollabRunTurnout;
}

export interface CollabRunCut {
  key: string;
  label: string;
  segments: CollabSegment[];
}

/**
 * Scores a wave: the group figures, then the same figures cut by each facet.
 *
 * Cuts are built from the facet's declared options rather than from the values
 * that happen to appear, so a department where nobody answered is reported as
 * having nobody rather than silently disappearing from the table. That absence
 * is a fact a facilitator needs on the day.
 */
export async function scoreRun(
  env: Env,
  cohort: { id: string; min_segment: number },
  roundNo: number,
): Promise<CollabRunScores> {
  const responses = await loadRunResponses(env, cohort.id, roundNo);
  if (responses.length === 0) {
    throw new CollabRunError('No completed responses in this wave yet.');
  }

  const group = scoreCollabGroup(responses.map((r) => r.answers));

  const { results } = await env.DB.prepare(
    `SELECT key, label, options FROM cohort_facets WHERE cohort_id = ?1 ORDER BY sort_order, key`,
  )
    .bind(cohort.id)
    .all<{ key: string; label: string; options: string }>();

  const cuts: CollabRunCut[] = [];
  for (const facet of results ?? []) {
    const options = parseOptions(facet.options);
    const seen = new Set(options);
    // A value recorded before an option was renamed still has respondents
    // behind it, so it is reported rather than dropped for being off-list.
    for (const r of responses) {
      const v = r.facets[facet.key];
      if (v !== undefined && !seen.has(v)) {
        options.push(v);
        seen.add(v);
      }
    }
    cuts.push({
      key: facet.key,
      label: facet.label,
      segments: segmentCollab(
        options.map((option) => ({
          name: option,
          responses: responses.filter((r) => r.facets[facet.key] === option).map((r) => r.answers),
        })),
        cohort.min_segment,
      ),
    });
  }

  return { group, cuts, turnout: await runTurnout(env, cohort.id, roundNo) };
}

/**
 * Whether a response holds all 24 answers.
 *
 * Used at submission, where the check has to be cheap and local. The engine
 * enforces the same rule when scoring; this is the door, not the lock.
 */
export function isCompleteRun(answers: Readonly<Record<number, number>>): boolean {
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) {
    if (answers[no] === undefined) return false;
  }
  return true;
}

/**
 * The placeholder a run's anonymous responses are attributed to.
 *
 * One per cohort and round, addressed at a domain that cannot receive mail, so
 * a detached response points at a row that identifies a wave rather than a
 * person. `.invalid` is reserved by RFC 2606 precisely so it can never be a
 * real address.
 */
export function anonymousCandidateEmail(cohortId: string, roundNo: number): string {
  return `anonymous+${cohortId}-r${roundNo}@respondent.invalid`;
}

function parseOptions(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CollabRunError('A segment list is stored in a form this run cannot read.');
  }
  if (!Array.isArray(parsed)) throw new CollabRunError('A segment list is not a list.');
  return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}
