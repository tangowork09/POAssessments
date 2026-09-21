/**
 * How an organisation has moved between waves.
 *
 * Two questions a facilitator asks after the second wave, and neither is
 * answered by putting two reports side by side:
 *
 *   - is this place working together better than it was?
 *   - did the same proportion of people actually take part?
 *
 * The second is the honest caveat on the first. A section mean that rose while
 * half the leadership stopped answering has not risen; it has changed who was
 * asked. So participation is reported beside every movement rather than in a
 * footnote, and a wave that lost respondents says so.
 *
 * Everything is computed from stored responses rather than from stored
 * reports, so a wave whose report was never generated still appears, and a
 * regenerated report can never disagree with the trend.
 */

import type { Env } from '../env.js';
import { scoreCollabGroup } from '../../shared/collab-scoring.js';
import { loadRunResponses, runTurnout } from './collab-run.js';

export interface CollabTrendWave {
  no: number;
  label: string;
  openedAt: string;
  closedAt: string | null;
  /** Complete responses scored. Null when the wave has none yet. */
  n: number;
  invited: number;
  total: number | null;
  perItem: number | null;
  bandName: string | null;
  /** Section key to converted mean. Empty when the wave has no responses. */
  sections: Record<string, number>;
  /** Statement number to converted mean. */
  items: Record<number, number>;
}

export interface CollabTrendMove {
  key: string;
  short: string;
  from: number;
  to: number;
  delta: number;
}

export interface CollabTrend {
  waves: CollabTrendWave[];
  /** Movement from the previous scored wave to the latest, if both exist. */
  latest: {
    fromWave: number;
    toWave: number;
    totalDelta: number;
    perItemDelta: number;
    /** Participation, which qualifies every figure above it. */
    fromN: number;
    toN: number;
    sections: CollabTrendMove[];
    /** The three statements that moved most in each direction. */
    improved: { no: number; from: number; to: number; delta: number }[];
    worsened: { no: number; from: number; to: number; delta: number }[];
  } | null;
}

export async function collabTrend(
  env: Env,
  cohortId: string,
  sectionNames: ReadonlyMap<string, string>,
): Promise<CollabTrend> {
  const { results } = await env.DB.prepare(
    'SELECT no, label, opened_at, closed_at FROM cohort_rounds WHERE cohort_id = ?1 ORDER BY no',
  )
    .bind(cohortId)
    .all<{ no: number; label: string; opened_at: string; closed_at: string | null }>();

  const waves: CollabTrendWave[] = [];
  for (const row of results ?? []) {
    const responses = await loadRunResponses(env, cohortId, row.no);
    const turnout = await runTurnout(env, cohortId, row.no);
    const complete = responses.map((r) => r.answers);

    if (complete.length === 0) {
      waves.push({
        no: row.no,
        label: row.label.trim() || `Wave ${row.no}`,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        n: 0,
        invited: turnout.invited,
        total: null,
        perItem: null,
        bandName: null,
        sections: {},
        items: {},
      });
      continue;
    }

    let group;
    try {
      group = scoreCollabGroup(complete);
    } catch {
      // Every sheet in the wave was incomplete. Reported as a wave with no
      // scored responses rather than dropped, because "nobody finished" is
      // itself something the facilitator needs to see.
      waves.push({
        no: row.no,
        label: row.label.trim() || `Wave ${row.no}`,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        n: 0,
        invited: turnout.invited,
        total: null,
        perItem: null,
        bandName: null,
        sections: {},
        items: {},
      });
      continue;
    }

    waves.push({
      no: row.no,
      label: row.label.trim() || `Wave ${row.no}`,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      n: group.n,
      invited: turnout.invited,
      total: group.total,
      perItem: group.perItem,
      bandName: group.band.name,
      sections: Object.fromEntries(group.sections.map((s) => [s.key, s.mean])),
      items: Object.fromEntries(group.items.map((i) => [i.no, i.mean])),
    });
  }

  const scored = waves.filter((w) => w.total !== null);
  if (scored.length < 2) return { waves, latest: null };

  const to = scored[scored.length - 1]!;
  const from = scored[scored.length - 2]!;

  const sections: CollabTrendMove[] = Object.keys(to.sections)
    .filter((key) => from.sections[key] !== undefined)
    .map((key) => ({
      key,
      short: sectionNames.get(key) ?? key,
      from: from.sections[key]!,
      to: to.sections[key]!,
      delta: round2(to.sections[key]! - from.sections[key]!),
    }))
    .sort((a, b) => b.delta - a.delta);

  const moves = Object.keys(to.items)
    .map(Number)
    .filter((no) => from.items[no] !== undefined)
    .map((no) => ({
      no,
      from: from.items[no]!,
      to: to.items[no]!,
      delta: round2(to.items[no]! - from.items[no]!),
    }))
    .sort((a, b) => b.delta - a.delta);

  return {
    waves,
    latest: {
      fromWave: from.no,
      toWave: to.no,
      totalDelta: to.total! - from.total!,
      perItemDelta: round2(to.perItem! - from.perItem!),
      fromN: from.n,
      toN: to.n,
      sections,
      improved: moves.filter((m) => m.delta > 0).slice(0, 3),
      worsened: moves.filter((m) => m.delta < 0).slice(-3).reverse(),
    },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
