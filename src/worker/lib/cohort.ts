/**
 * Cohorts: loading a roster, scoring a run, and building the two report shapes.
 *
 * A cohort is one run of a cohort instrument on one intact group at one point
 * in time. Everything here is scoped to a single cohort id, deliberately, so
 * two runs of the same instrument can never pool into one network.
 *
 * Scoring is done across the whole cohort rather than per response, which is
 * why none of this hangs off the `score_and_deliver` path the self-rating
 * instruments use: there is nothing to score at the moment one person finishes.
 */

import type { Env } from '../env.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';
import { newId } from './ids.js';
import { generateToken, hashToken } from './tokens.js';
import {
  SOCIO_BLOCKS,
  SOCIO_ITEMS,
  cellNo,
  SOCIO_ITEM_COUNT,
} from '../../shared/socio.js';
import {
  memberResultFor,
  scoreSocioCohort,
  socioGroupSummary,
  socioMemberSummary,
  type SocioGroupResult,
  type SocioMember,
  type SocioMemberResult,
  type SocioResponseInput,
} from '../../shared/socio-scoring.js';
import { socioInsights } from '../../shared/socio-insights.js';
import type {
  Branding,
  CohortRosterMember,
  SocioBlockInfo,
  SocioGroupReportPayload,
  SocioItemInfo,
  SocioMemberReportPayload,
} from '../../shared/types.js';

export class CohortError extends Error {}

/**
 * How long a personal link lasts by default: a fortnight, which is what the
 * instrument's own instructions tell participants. Zero means never expires.
 */
export const DEFAULT_LINK_TTL_DAYS = 14;

export interface CohortRow {
  id: string;
  assessment_id: string;
  name: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  min_raters: number;
  tie_threshold: number;
  min_rated_targets: number;
  /** Days a personal link lasts. 0 = never expires. See migration 0020. */
  link_ttl_days: number;
  /**
   * Whether participants are told a personal report is coming. Off by default:
   * whether anyone in this group ever receives their own profile is the
   * facilitator's decision, and the completion screen must not promise it on
   * their behalf. See migration 0015.
   */
  share_reports: number;
  /** Whether a one-time code must verify the roster email. See migration 0017. */
  otp_required: number;
  /**
   * Whether the shared generic link still accepts an identity claim. 1 means it
   * does not, and only a per-member personal link gets in — `otp_required` is
   * then ignored, not cleared. See migration 0019.
   */
  link_only_identity: number;
  created_at: string;
  closed_at: string | null;
}

/**
 * One wave of rating on the same group.
 *
 * The cohort holds what is true about the group — its roster and the positions
 * ratings are stored against, the rater floor, the tie threshold, the alias.
 * The round holds what is true about one asking: the link people answer
 * through, their responses, and the reports built from them. Splitting it this
 * way is what lets September and October be compared — position 7 is the same
 * person in both — without either month's numbers leaking into the other's.
 */
export interface RoundRow {
  id: string;
  cohort_id: string;
  no: number;
  label: string;
  opened_at: string;
  closed_at: string | null;
}

export interface MemberRow {
  id: string;
  cohort_id: string;
  no: number;
  name: string;
  function: string;
  email: string;
  active: number;
  /** Optional attributes, NULL on every roster built before migration 0018. */
  tenure_band: string | null;
  reports_to: number | null;
}

/**
 * The confidentiality promise, restated in every report.
 *
 * The workbook says results are reported "only as overall patterns for the
 * group". This deployment also gives each leader their own aggregated profile,
 * which is a real change to what was promised on the tin -- so the promise is
 * restated here in the terms that are actually true, and the participant
 * instructions in the registry say the same thing. The two must not drift.
 */
export function confidentialityNote(minRaters: number): string {
  return (
    'Individual responses are seen only by the facilitators running this exercise and are never shown ' +
    'to other participants. Nothing is reported as who said what about whom. Where a leader receives ' +
    `their own profile, it shows averages across the colleagues who rated them and never a single ` +
    `response; below ${minRaters} raters no profile is produced at all, because an average of one or ` +
    'two responses in a named group is a quotation with a decimal point on it.'
  );
}

export const SOCIO_BLOCK_INFO: SocioBlockInfo[] = SOCIO_BLOCKS.map((b) => ({
  key: b.key,
  name: b.name,
  gloss: b.gloss,
  short: b.short,
  color: b.color,
  items: [...b.items],
}));

export const SOCIO_ITEM_INFO: SocioItemInfo[] = SOCIO_ITEMS.map((i) => ({
  no: i.no,
  short: i.short,
  text: i.text,
  blockKey: i.blockKey,
  polarity: i.polarity,
}));

// ------------------------------------------------------------------ loading

/**
 * One sociometry cohort.
 *
 * Scoped to this instrument on purpose. A Collaboration Diagnostic run is also
 * a row in `cohorts` — that reuse is what gives it rounds, links and an audit
 * trail for free — but it has no roster positions, no rater floor and no tie
 * threshold, and every caller of this function reads at least one of those.
 * Without the filter a diagnostic run opened here renders as a cohort whose
 * numbers are all meaningless: a list that counts its responses and a detail
 * page that counts the ones attributed to a rater, which is none of them.
 *
 * So it is refused at the door instead, and all twenty-odd cohort routes
 * answer "not found" rather than half-answering about the wrong instrument.
 */
export async function loadCohort(env: Env, cohortId: string): Promise<CohortRow | null> {
  return env.DB.prepare(
    `SELECT id, assessment_id, name, organisation, status, min_raters, tie_threshold, link_ttl_days,
            min_rated_targets, share_reports, otp_required, link_only_identity,
            created_at, closed_at
       FROM cohorts WHERE id = ?1 AND assessment_id = ?2`,
  )
    .bind(cohortId, ASSESSMENT_ID.socio)
    .first<CohortRow>();
}

/**
 * The targets a rater is allowed to see, or null for the whole roster.
 *
 * Null and "every id" are different answers on purpose. Null means the cohort
 * runs unrestricted for this rater — including the rater who simply has no
 * assignment rows in a cohort that has them for others. A sheet that maps half
 * the group must not lock the other half out of the exercise: over-shown is
 * recoverable, locked out is a support call.
 */
export async function allowedTargetsFor(
  env: Env,
  cohortId: string,
  raterMemberId: string,
): Promise<string[] | null> {
  const { results } = await env.DB.prepare(
    `SELECT a.target_member_id FROM cohort_assignments a
      JOIN cohort_members m ON m.id = a.target_member_id AND m.active = 1
     WHERE a.cohort_id = ?1 AND a.rater_member_id = ?2`,
  )
    .bind(cohortId, raterMemberId)
    .all<{ target_member_id: string }>();
  const ids = (results ?? []).map((r) => r.target_member_id);
  return ids.length > 0 ? ids : null;
}

/** What the facilitator calls a round, with a fallback nobody has to invent. */
export function roundName(round: { no: number; label: string }): string {
  return round.label.trim() || `Round ${round.no}`;
}

export async function loadRounds(env: Env, cohortId: string): Promise<RoundRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, cohort_id, no, label, opened_at, closed_at
       FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no`,
  )
    .bind(cohortId)
    .all<RoundRow>();
  return results ?? [];
}

/**
 * The round a link issued today belongs to, and the one a respondent arriving
 * today is answering: the open one, or — if the cohort has been closed — the
 * last one there was. Never null for a cohort created through the console; the
 * caller still handles null, because a cohort whose rounds were deleted out
 * from under it is a broken cohort, not a crash.
 */
export async function currentRound(env: Env, cohortId: string): Promise<RoundRow | null> {
  return env.DB.prepare(
    `SELECT id, cohort_id, no, label, opened_at, closed_at
       FROM cohort_rounds WHERE cohort_id = ?1
      ORDER BY (closed_at IS NULL) DESC, no DESC LIMIT 1`,
  )
    .bind(cohortId)
    .first<RoundRow>();
}

export async function roundByNo(env: Env, cohortId: string, no: number): Promise<RoundRow | null> {
  return env.DB.prepare(
    `SELECT id, cohort_id, no, label, opened_at, closed_at
       FROM cohort_rounds WHERE cohort_id = ?1 AND no = ?2`,
  )
    .bind(cohortId, no)
    .first<RoundRow>();
}

export async function loadRoster(env: Env, cohortId: string): Promise<MemberRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, cohort_id, no, name, function, email, active, tenure_band, reports_to
       FROM cohort_members WHERE cohort_id = ?1 AND active = 1 ORDER BY no`,
  )
    .bind(cohortId)
    .all<MemberRow>();
  return results ?? [];
}

/**
 * The roster as the candidate shell sees it, plus who has already submitted —
 * *in this round*. Someone who answered September has an empty slot again in
 * October, which is the whole point of a round; without the round in this
 * predicate the second wave would open with every name greyed out.
 */
export async function rosterForSession(
  env: Env,
  cohortId: string,
  roundNo: number,
): Promise<CohortRosterMember[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.no, m.name, m.function,
            EXISTS (SELECT 1 FROM responses r
                     WHERE r.cohort_id = m.cohort_id
                       AND r.rater_member_id = m.id
                       AND r.round_no = ?2
                       AND r.status = 'completed') AS responded
       FROM cohort_members m
      WHERE m.cohort_id = ?1 AND m.active = 1
      ORDER BY m.no`,
  )
    .bind(cohortId, roundNo)
    .all<{ id: string; no: number; name: string; function: string; responded: number }>();

  return (results ?? []).map((m) => ({
    memberId: m.id,
    no: m.no,
    name: m.name,
    func: m.function,
    responded: m.responded === 1,
  }));
}

/**
 * Every completed response in the cohort, keyed by the roster position it came
 * from. A response whose rater is no longer on the roster is dropped: the
 * roster is the authority on who is in the group, and attributing ratings to a
 * position that has been vacated would put them in someone else's mouth.
 */
export async function loadCohortResponses(
  env: Env,
  cohortId: string,
  roundNo: number,
): Promise<SocioResponseInput[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id AS response_id, m.no AS rater_no
       FROM responses r
       JOIN cohort_members m ON m.id = r.rater_member_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed' AND m.active = 1
      ORDER BY m.no`,
  )
    .bind(cohortId, roundNo)
    .all<{ response_id: string; rater_no: number }>();

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

  const byResponse = new Map<string, Record<number, number>>();
  for (const a of answers.results ?? []) {
    let bag = byResponse.get(a.response_id);
    if (!bag) {
      bag = {};
      byResponse.set(a.response_id, bag);
    }
    bag[a.no] = a.value;
  }

  return rows.map((r) => ({ raterNo: r.rater_no, answers: byResponse.get(r.response_id) ?? {} }));
}

// ------------------------------------------------------------------ scoring

export async function scoreCohort(
  env: Env,
  cohort: CohortRow,
  roundNo: number,
): Promise<SocioGroupResult> {
  const roster = await loadRoster(env, cohort.id);
  if (roster.length === 0) throw new CohortError('This cohort has no roster members.');

  const members: SocioMember[] = roster.map((m) => ({
    no: m.no,
    id: m.id,
    name: m.name,
    func: m.function,
  }));

  const responses = await loadCohortResponses(env, cohort.id, roundNo);
  const group = scoreSocioCohort(members, responses, {
    minRaters: cohort.min_raters,
    tieThreshold: cohort.tie_threshold,
  });

  // Attached here rather than inside `scoreSocioCohort`, which the live
  // network route calls on a 15-second poll and which the trend replays per
  // round — neither wants this work, and the dashboard computes its own
  // findings from the payload it already has.
  return {
    ...group,
    insights: socioInsights(members, responses, { tieThreshold: cohort.tie_threshold }),
  };
}

// ------------------------------------------------------------------ payloads

interface PayloadBase {
  reportToken: string;
  cohort: CohortRow;
  round: { no: number; label: string };
  assessmentName: string;
  generatedAt: string;
  branding: Branding;
}

export function groupPayload(input: PayloadBase & { group: SocioGroupResult }): SocioGroupReportPayload {
  return {
    kind: 'socio_group',
    reportToken: input.reportToken,
    cohortId: input.cohort.id,
    cohortName: input.cohort.name,
    organisation: input.cohort.organisation,
    assessmentId: input.cohort.assessment_id,
    assessmentName: input.assessmentName,
    roundNo: input.round.no,
    roundName: roundName(input.round),
    generatedAt: input.generatedAt,
    branding: input.branding,
    summary: socioGroupSummary(input.group, input.cohort.name),
    confidentiality: confidentialityNote(input.group.minRaters),
    group: input.group,
    blocks: SOCIO_BLOCK_INFO,
    items: SOCIO_ITEM_INFO,
  };
}

/**
 * The self-contained scores a member report is rendered from.
 *
 * Stored on the member's own `cohort_reports` row rather than pointing back at
 * the group blob, so one member's report can be re-rendered, re-sent or revoked
 * without loading -- or being invalidated by -- the whole cohort's numbers.
 */
export interface MemberScores {
  kind: 'socio_member';
  member: SocioMemberResult;
  context: SocioMemberReportPayload['context'];
  groupContext: SocioMemberReportPayload['groupContext'];
  summary: string;
}

export function memberScores(group: SocioGroupResult, member: SocioMemberResult): MemberScores {
  // The cohort figure for a block is the mean of the other members' block
  // means, so a member is compared with the group's typical profile rather than
  // with a grand mean that mixes blocks together -- and never against a number
  // their own ratings helped produce.
  const context = SOCIO_BLOCKS.map((b) => {
    const memberBlock = member.blocks.find((x) => x.blockKey === b.key)!;
    const others = group.members
      .filter((m) => m.memberNo !== member.memberNo)
      .map((m) => m.blocks.find((x) => x.blockKey === b.key)!.mean)
      .filter((v): v is number => v !== null);
    const cohortMean = others.length > 0 ? round2(others.reduce((t, v) => t + v, 0) / others.length) : null;
    return {
      blockKey: b.key,
      name: b.name,
      short: b.short,
      color: b.color,
      memberMean: memberBlock.mean,
      cohortMean,
      delta: memberBlock.mean !== null && cohortMean !== null ? round2(memberBlock.mean - cohortMean) : null,
    };
  });

  return {
    kind: 'socio_member',
    member,
    context,
    groupContext: {
      rosterSize: group.rosterSize,
      respondents: group.respondents,
      minRaters: group.minRaters,
      tieThreshold: group.tieThreshold,
      cohortMean: group.cohortMean,
    },
    summary: socioMemberSummary(member, group),
  };
}

export function memberPayload(input: PayloadBase & { scores: MemberScores }): SocioMemberReportPayload {
  return {
    kind: 'socio_member',
    reportToken: input.reportToken,
    cohortId: input.cohort.id,
    cohortName: input.cohort.name,
    organisation: input.cohort.organisation,
    assessmentId: input.cohort.assessment_id,
    assessmentName: input.assessmentName,
    roundNo: input.round.no,
    roundName: roundName(input.round),
    generatedAt: input.generatedAt,
    branding: input.branding,
    summary: input.scores.summary,
    confidentiality: confidentialityNote(input.scores.groupContext.minRaters),
    member: input.scores.member,
    context: input.scores.context,
    groupContext: input.scores.groupContext,
    items: SOCIO_ITEM_INFO,
    suppressed: input.scores.member.suppressed,
  };
}

// --------------------------------------------------------------- generation

export interface GeneratedReports {
  group: { reportId: string; token: string };
  members: { reportId: string; memberId: string; memberNo: number; name: string; suppressed: boolean }[];
  suppressed: number;
}

/**
 * Scores the cohort and writes one group report plus one report per roster
 * member.
 *
 * Re-runnable, and deliberately so: responses keep arriving after the first
 * generation, and a facilitator will regenerate. Existing rows are updated in
 * place so the token already shared with a leader keeps working -- minting a
 * fresh token on every regeneration would silently break every link already
 * sent. A member under the rater floor still gets a row, marked suppressed, so
 * the console can show that they were skipped and why rather than leaving a
 * gap that reads like a bug.
 */
export async function generateCohortReports(
  env: Env,
  cohort: CohortRow,
  round: RoundRow,
): Promise<GeneratedReports> {
  // A floor on the group report, not only on the member ones.
  //
  // Without it the console would hand back a "ready" group report for a cohort
  // nobody had answered yet — a network of no ties, a density of zero and a
  // function matrix of blanks, presented as findings about a real leadership
  // team. Worse than useless at one or two responses: with a single respondent
  // every figure in the "group" report is that one person's opinion with their
  // name taken off, which is exactly the exposure `min_raters` exists to
  // prevent for individuals.
  //
  // The same threshold is used for both, so a facilitator has one number to
  // reason about rather than two.
  const respondents = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM responses r
       JOIN cohort_members m ON m.id = r.rater_member_id
      WHERE r.cohort_id = ?1 AND r.round_no = ?2 AND r.status = 'completed' AND m.active = 1`,
  )
    .bind(cohort.id, round.no)
    .first<{ n: number }>();
  const answered = respondents?.n ?? 0;
  if (answered < cohort.min_raters) {
    const where = roundName(round);
    throw new CohortError(
      answered === 0
        ? `Nobody has completed ${where} yet. Reports need at least ${cohort.min_raters} responses — share the link first.`
        : `Only ${answered} of the group ${answered === 1 ? 'has' : 'have'} responded to ${where}. Reports need at least ${cohort.min_raters}, so that no figure in them can be traced back to one person.`,
    );
  }

  const group = await scoreCohort(env, cohort, round.no);
  const scoresJson = JSON.stringify(group);

  const groupToken = generateToken();
  const groupHash = await hashToken(groupToken, env.LINK_TOKEN_SECRET);
  const groupId = newId('crpt');

  await env.DB.prepare(
    `INSERT INTO cohort_reports (id, cohort_id, round_no, scope, member_id, token_hash, token_plain, scores_json, suppressed)
     VALUES (?1, ?2, ?6, 'group', NULL, ?3, ?4, ?5, 0)
     ON CONFLICT (cohort_id, scope, COALESCE(member_id, ''), round_no) DO UPDATE
        SET scores_json = excluded.scores_json,
            created_at  = datetime('now')`,
  )
    .bind(groupId, cohort.id, groupHash, groupToken, scoresJson, round.no)
    .run();

  const groupRow = await env.DB.prepare(
    `SELECT id, token_plain FROM cohort_reports
      WHERE cohort_id = ?1 AND scope = 'group' AND round_no = ?2`,
  )
    .bind(cohort.id, round.no)
    .first<{ id: string; token_plain: string | null }>();

  const members: GeneratedReports['members'] = [];
  const statements = [];

  for (const m of group.members) {
    const token = generateToken();
    const hash = await hashToken(token, env.LINK_TOKEN_SECRET);
    const scores = memberScores(group, memberResultFor(group, m.memberNo)!);
    statements.push(
      env.DB.prepare(
        `INSERT INTO cohort_reports (id, cohort_id, round_no, scope, member_id, token_hash, token_plain, scores_json, suppressed)
         VALUES (?1, ?2, ?7, 'member', ?3, ?4, NULL, ?5, ?6)
         ON CONFLICT (cohort_id, scope, COALESCE(member_id, ''), round_no) DO UPDATE
            SET scores_json = excluded.scores_json,
                suppressed  = excluded.suppressed,
                created_at  = datetime('now')`,
      ).bind(
        newId('crpt'),
        cohort.id,
        m.memberId,
        hash,
        JSON.stringify(scores),
        scores.member.suppressed ? 1 : 0,
        round.no,
      ),
    );
    members.push({
      reportId: '',
      memberId: m.memberId,
      memberNo: m.memberNo,
      name: m.name,
      suppressed: scores.member.suppressed,
    });
  }

  if (statements.length > 0) await env.DB.batch(statements);

  return {
    group: { reportId: groupRow?.id ?? groupId, token: groupRow?.token_plain ?? groupToken },
    members,
    suppressed: members.filter((m) => m.suppressed).length,
  };
}

// ------------------------------------------------------------------ helpers

/**
 * How many cells a full roster produces, used to bound the answer schema. The
 * matrix is `rosterSize` rows of twelve, and the last cell of the last row is
 * the largest number the client can legitimately send.
 */
export function maxCellNo(rosterSize: number): number {
  return cellNo(Math.max(1, rosterSize), SOCIO_ITEM_COUNT);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
