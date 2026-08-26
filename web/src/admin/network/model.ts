/**
 * The sociogram's reading of the raw ratings: which ties are warm, cool or
 * neutral, and which people the group has made central, peripheral or hard
 * work. Pure functions so the semantics are testable and the card just draws
 * what they return.
 *
 * The instrument is a 1–5 positive scale plus one deficit item, not a
 * choose/reject nomination, so polarity is derived rather than given:
 *
 *   positive  — the rater asserts the statement (mean ≥ the tie threshold).
 *               This is the tie every report already counts.
 *   negative  — the rater is cool (mean ≤ the cool line, default 2.0) OR the
 *               deficit item is loud (asks markedly more support than they get).
 *   neutral   — rated, but between the two: an acquaintance, not a bond.
 *
 * A blank is never an edge — "no basis to judge" is the absence of a rating,
 * not a neutral one.
 */

import type { CohortNetworkEdge } from '../../../../src/shared/types.js';

export type Polarity = 'positive' | 'negative' | 'neutral';
export type Role = 'star' | 'rejected' | 'isolate' | 'member';

/** Below this mean a rating reads as a cool tie rather than a mere neutral one. */
export const COOL_LINE = 2.0;
/** At/above this on the deficit item, "I want more support" is itself a cool signal. */
export const GAP_LINE = 4;

/** The lens's mean for this edge: the overall asset mean, or one block's. */
export function edgeMean(e: CohortNetworkEdge, lens: string): number | null {
  if (lens === 'overall') return e.n > 0 ? e.mean : null;
  const b = e.blocks[lens];
  return b ? b.mean : null;
}

export function edgePolarity(e: CohortNetworkEdge, lens: string, tieThreshold: number): Polarity | null {
  const mean = edgeMean(e, lens);
  const gapCool = lens === 'overall' && e.gap !== null && e.gap.mean >= GAP_LINE;
  if (mean === null) return gapCool ? 'negative' : null;
  if (mean >= tieThreshold) return 'positive';
  if (mean <= COOL_LINE || gapCool) return 'negative';
  return 'neutral';
}

export interface DegreeCounts {
  posIn: number;
  negIn: number;
  neuIn: number;
  posOut: number;
  negOut: number;
}

/** Per-member directed degree, split by polarity, under one lens + threshold. */
export function degrees(
  memberNos: number[],
  edges: CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
): Map<number, DegreeCounts> {
  const d = new Map<number, DegreeCounts>();
  for (const no of memberNos) d.set(no, { posIn: 0, negIn: 0, neuIn: 0, posOut: 0, negOut: 0 });
  for (const e of edges) {
    const p = edgePolarity(e, lens, tieThreshold);
    if (!p) continue;
    const to = d.get(e.to);
    const from = d.get(e.from);
    if (to) {
      if (p === 'positive') to.posIn += 1;
      else if (p === 'negative') to.negIn += 1;
      else to.neuIn += 1;
    }
    if (from) {
      if (p === 'positive') from.posOut += 1;
      else if (p === 'negative') from.negOut += 1;
    }
  }
  return d;
}

/**
 * The role each person has been given by the group.
 *
 *   isolate  — nobody has a warm or cool bond with them, in or out. The one
 *              finding you must not hide, so it is never filtered away.
 *   rejected — the group is net-cool toward them (more cool ties received than
 *              warm), and there is real coolness to speak of.
 *   star     — a sociometric centre: warm ties received in the top band of the
 *              group and clear of a floor, so a small group cannot mint a star
 *              on one nomination.
 *   member   — everyone else.
 */
export function roles(degreeMap: Map<number, DegreeCounts>): Map<number, Role> {
  const entries = [...degreeMap.entries()];
  // A star is genuinely rare — the top ~12% of the group by positive
  // in-degree, and only among those clearly above the pack. Rank-based rather
  // than a value threshold, so a cluster of people all on the same middling
  // in-degree does not all become stars (the earlier bug where the badge
  // showed on half the map).
  const withPos = entries.filter(([, d]) => d.posIn > 0).sort((a, b) => b[1].posIn - a[1].posIn);
  const starCount = Math.max(1, Math.round(withPos.length * 0.12));
  const starLine = Math.max(3, withPos[Math.min(starCount, withPos.length) - 1]?.[1].posIn ?? 3);
  const stars = new Set<number>();
  for (const [no, d] of withPos) {
    if (stars.size >= starCount) break;
    if (d.posIn >= starLine) stars.add(no);
  }

  const out = new Map<number, Role>();
  for (const [no, d] of entries) {
    const anyTie = d.posIn + d.negIn + d.neuIn + d.posOut + d.negOut;
    if (anyTie === 0) out.set(no, 'isolate');
    else if (d.negIn > d.posIn && d.negIn >= 2) out.set(no, 'rejected');
    else if (stars.has(no)) out.set(no, 'star');
    else out.set(no, 'member');
  }
  return out;
}

export const POLARITY_STYLE: Record<Polarity, { color: string; dashed: boolean; label: string }> = {
  positive: { color: '#0E7C5A', dashed: false, label: 'Positive tie' },
  negative: { color: '#C0362C', dashed: true, label: 'Negative tie' },
  neutral: { color: '#8D97A6', dashed: true, label: 'Neutral tie' },
};

export const ROLE_STYLE: Record<Role, { fill: string; label: string }> = {
  star: { fill: '#E08A1E', label: 'Star (sociometric centre)' },
  rejected: { fill: '#C0362C', label: 'Rejected (net-cool)' },
  isolate: { fill: 'transparent', label: 'Isolate' },
  member: { fill: '#2a78d6', label: 'Member' },
};
