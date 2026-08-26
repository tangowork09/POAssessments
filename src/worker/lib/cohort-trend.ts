/**
 * How a group has moved between rounds.
 *
 * Two questions a facilitator asks after the second wave, and neither is
 * answered by putting two reports side by side:
 *
 *   - is the group working together better than it was?
 *   - did people actually take part this time?
 *
 * The first is the block means and the network figures across rounds; the
 * second is response rate and coverage, which is the honest caveat on the
 * first — a block mean that rose while half the group stopped answering has not
 * risen.
 *
 * Everything is computed from stored responses rather than from stored reports,
 * so a round that was never generated still appears, and a regenerated report
 * can never disagree with the trend.
 */

import type { Env } from '../env.js';
import { loadRounds, roundName, scoreCohort, type CohortRow } from './cohort.js';
import { SOCIO_BLOCKS } from '../../shared/socio.js';
import type { SocioGroupResult, SocioMemberResult } from '../../shared/socio-scoring.js';
import type { CohortTrend, CohortTrendRound } from '../../shared/types.js';

/** A member's overall standing in one round: the mean of their block means. */
function overallMean(member: SocioMemberResult): number | null {
  const means = member.blocks.map((b) => b.mean).filter((v): v is number => v !== null);
  if (means.length === 0) return null;
  return round2(means.reduce((t, v) => t + v, 0) / means.length);
}

/** The group's figure for one block: the mean of the members who have one. */
function blockMean(group: SocioGroupResult, blockKey: string): number | null {
  const means = group.members
    .map((m) => m.blocks.find((b) => b.blockKey === blockKey)?.mean ?? null)
    .filter((v): v is number => v !== null);
  if (means.length === 0) return null;
  return round2(means.reduce((t, v) => t + v, 0) / means.length);
}

/**
 * Density, reciprocity and concentration are per-block in the engine. Across a
 * round they are aggregated over the four networks — ties over rated pairs, and
 * reciprocal pairs over mutual pairs — rather than averaged, so a block nobody
 * rated does not count as much as a block everybody did.
 */
function networkSummary(group: SocioGroupResult): {
  density: number | null;
  reciprocity: number | null;
  concentration: number | null;
} {
  let ties = 0;
  let ratedPairs = 0;
  let mutual = 0;
  let reciprocal = 0;
  const concentrations: number[] = [];

  for (const n of group.networks) {
    ties += n.ties;
    ratedPairs += n.ratedPairs;
    if (n.reciprocity !== null && n.mutualPairs > 0) {
      mutual += n.mutualPairs;
      reciprocal += n.reciprocity * n.mutualPairs;
    }
    if (n.concentration !== null) concentrations.push(n.concentration);
  }

  return {
    density: ratedPairs > 0 ? round2(ties / ratedPairs) : null,
    reciprocity: mutual > 0 ? round2(reciprocal / mutual) : null,
    concentration:
      concentrations.length > 0
        ? round2(concentrations.reduce((t, v) => t + v, 0) / concentrations.length)
        : null,
  };
}

export async function buildCohortTrend(env: Env, cohort: CohortRow): Promise<CohortTrend> {
  const rounds = await loadRounds(env, cohort.id);

  const reportRows = await env.DB.prepare(
    `SELECT round_no, COUNT(*) AS n FROM cohort_reports
      WHERE cohort_id = ?1 AND scope = 'group' GROUP BY round_no`,
  )
    .bind(cohort.id)
    .all<{ round_no: number; n: number }>();
  const generated = new Set((reportRows.results ?? []).map((r) => r.round_no));

  const scored: { round: (typeof rounds)[number]; group: SocioGroupResult }[] = [];
  for (const round of rounds) {
    scored.push({ round, group: await scoreCohort(env, cohort, round.no) });
  }

  const trendRounds: CohortTrendRound[] = scored.map(({ round, group }) => {
    const net = networkSummary(group);
    return {
      no: round.no,
      name: roundName(round),
      openedAt: round.opened_at,
      closedAt: round.closed_at,
      rosterSize: group.rosterSize,
      respondents: group.respondents,
      responseRate: group.responseRate,
      coverage: group.acquaintance ?? 0,
      density: net.density,
      reciprocity: net.reciprocity,
      concentration: net.concentration,
      cohortMean: group.cohortMean,
      isolates: group.isolates.length,
      blocks: SOCIO_BLOCKS.map((b) => ({
        blockKey: b.key,
        name: b.name,
        short: b.short,
        mean: blockMean(group, b.key),
      })),
      reportsReady: generated.has(round.no),
    };
  });

  // Movers are first-to-last, not round-to-round: a facilitator reading this
  // wants the arc, and a member whose figure bounced either side of the same
  // number has not moved.
  const first = scored[0]?.group;
  const last = scored.length > 1 ? scored[scored.length - 1]!.group : undefined;
  const movers: CohortTrend['movers'] = [];
  if (first && last) {
    for (const m of last.members) {
      const before = first.members.find((x) => x.memberNo === m.memberNo);
      const a = before ? overallMean(before) : null;
      const b = overallMean(m);
      movers.push({
        memberId: m.memberId,
        name: m.name,
        func: m.func,
        first: a,
        last: b,
        delta: a !== null && b !== null ? round2(b - a) : null,
      });
    }
    movers.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
  }

  return {
    cohortId: cohort.id,
    cohortName: cohort.name,
    organisation: cohort.organisation,
    minRaters: cohort.min_raters,
    rounds: trendRounds,
    movers,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
