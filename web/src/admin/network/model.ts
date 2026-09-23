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

import { TENURE_BANDS } from '../../../../src/shared/types.js';
import type { CohortNetworkEdge, CohortRosterMember } from '../../../../src/shared/types.js';
import { betweenness } from '../../../../src/shared/socio-network.js';
import { concentrationOfRates, powerKindOf, powerKindReading } from '../../../../src/shared/socio-scoring.js';
import type { PowerKind } from '../../../../src/shared/socio-scoring.js';
import type {
  DirectedTie,
  SubgroupTieStats,
  UnreciprocatedTie,
} from '../../../../src/shared/socio-network.js';

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

/**
 * The validated eight-hue categorical order, shared by every categorical
 * channel on the card — function colour, and now cluster colour. Every node
 * carries its name as a direct label, which is the secondary encoding that
 * lets the fuller palette past the all-pairs colour-distance floor.
 */
export const CATEGORICAL_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#4a3aa7',
  '#008300',
  '#e34948',
];
/** The "not one of the named categories" fill. Muted on purpose. */
export const MUTED_GREY = '#8D97A6';

// -------------------------------------------------------- the positive graph

/**
 * The positive-tie graph, exactly as the map draws it: one directed tie per
 * edge whose polarity is 'positive' under this lens and this threshold.
 *
 * Every network analytic on the card — bridges, clusters, silos, the compare
 * panes — is fed from here rather than from its own idea of what a tie is, so
 * moving the threshold slider moves all of them together and none of them can
 * disagree with the picture on screen.
 */
export function positiveTies(
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
): DirectedTie[] {
  const out: DirectedTie[] = [];
  for (const e of edges) {
    if (edgePolarity(e, lens, tieThreshold) === 'positive') out.push({ from: e.from, to: e.to });
  }
  return out;
}

/**
 * Every ordered pair with its mean under one lens — the shape
 * `unreciprocatedTies` reads. A pair nobody rated under this lens carries a
 * null mean, which the engine treats as an absence rather than as a zero.
 */
export function lensPairs(
  edges: readonly CohortNetworkEdge[],
  lens: string,
): { from: number; to: number; mean: number | null }[] {
  return edges.map((e) => ({ from: e.from, to: e.to, mean: edgeMean(e, lens) }));
}

// ------------------------------------------------------------------ bridges

export interface BridgeEntry {
  no: number;
  /** Normalised betweenness, 0..1. */
  score: number;
  /** score / the top score, 0..1 — what the little bar fills to. */
  share: number;
}

/**
 * The people the group routes through, strongest first. Only scores above zero
 * qualify: a betweenness of 0 is not a weak bridge, it is not a bridge at all.
 */
export function topBridges(scores: ReadonlyMap<number, number>, limit = 5): BridgeEntry[] {
  const ranked = [...scores.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit);
  const max = ranked[0]?.[1] ?? 0;
  return ranked.map(([no, score]) => ({ no, score, share: max > 0 ? score / max : 0 }));
}

// ------------------------------------------------------------------ anchors

export interface AnchorEntry {
  no: number;
  /** Positive ties received under that anchor's lens. */
  count: number;
}

/** Top `limit` people by positive ties received under one lens. Zeroes never rank. */
export function topPositiveIn(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
  limit = 3,
): AnchorEntry[] {
  const d = degrees([...memberNos], [...edges], lens, tieThreshold);
  return [...d.entries()]
    .filter(([, c]) => c.posIn > 0)
    .sort((a, b) => b[1].posIn - a[1].posIn || a[0] - b[0])
    .slice(0, limit)
    .map(([no, c]) => ({ no, count: c.posIn }));
}

export interface Anchors {
  /** Most trusted: top positive in-degree under the trust lens. */
  trusted: AnchorEntry[];
  /** Most influential: top positive in-degree under the power-over lens. */
  influential: AnchorEntry[];
  /** The people who carry both, which is the finding worth bolding. */
  both: Set<number>;
}

/**
 * The two lists a client looks for first, and their overlap. Trust and formal
 * pull are separate questions; the interesting cases are the people who are on
 * one list and not the other, so both lists are always drawn side by side.
 */
export function anchors(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  limit = 3,
): Anchors {
  const trusted = topPositiveIn(memberNos, edges, 'trust', tieThreshold, limit);
  const influential = topPositiveIn(memberNos, edges, 'power_over', tieThreshold, limit);
  const inf = new Set(influential.map((a) => a.no));
  return { trusted, influential, both: new Set(trusted.filter((a) => inf.has(a.no)).map((a) => a.no)) };
}

// ----------------------------------------------------------------- clusters

export interface ClusterLegendEntry {
  /** Display number, 1-based — "Cluster 1". Absent for the singleton row. */
  label: string;
  size: number;
  fill: string;
  singleton: boolean;
}

/**
 * Turn raw community ids into something a legend can show: real clusters
 * (two or more people) get the categorical palette in size order, and everyone
 * the algorithm left on their own collapses into a single muted "Unclustered"
 * row rather than a wall of one-person colours.
 */
export function clusterView(communityOf: ReadonlyMap<number, number>): {
  entries: ClusterLegendEntry[];
  fillByNo: Map<number, string>;
} {
  const members = new Map<number, number[]>();
  for (const [no, id] of communityOf) {
    const list = members.get(id);
    if (list) list.push(no);
    else members.set(id, [no]);
  }
  const real = [...members.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const singletons = [...members.entries()].filter(([, list]) => list.length === 1);

  const fillByNo = new Map<number, string>();
  const entries: ClusterLegendEntry[] = [];
  real.forEach(([, list], i) => {
    const fill = i < CATEGORICAL_COLORS.length ? CATEGORICAL_COLORS[i]! : MUTED_GREY;
    for (const no of list) fillByNo.set(no, fill);
    entries.push({ label: `Cluster ${i + 1}`, size: list.length, fill, singleton: false });
  });
  if (singletons.length > 0) {
    for (const [, list] of singletons) fillByNo.set(list[0]!, MUTED_GREY);
    entries.push({ label: 'Unclustered', size: singletons.length, fill: MUTED_GREY, singleton: true });
  }
  return { entries, fillByNo };
}

// -------------------------------------------------------------------- silos

/**
 * True when the most inward-facing function keeps trust to itself at more than
 * about twice the rate it sends it outward — the line at which "we work
 * closely" has become "we work apart". Suppressed groups have no rates and are
 * never the ones that trip it.
 */
export function silosVerdict(stats: readonly SubgroupTieStats[], factor = 2): boolean {
  for (const s of stats) {
    if (s.withinRate === null || s.outRate === null) continue;
    if (s.withinRate > 0 && s.withinRate >= s.outRate * factor) return true;
  }
  return false;
}

/**
 * What a silo is measured against. The panel used to know only one answer —
 * the function column — but a group divides along whichever line the
 * facilitator is asking about, and the same cohesion maths reads all three:
 *
 *   function — the department, as before
 *   tenure   — the banded how-long-have-you-been-here
 *   team     — the formal reporting line, keyed by the manager's roster no
 */
export const SILOS_MODES = ['function', 'tenure', 'team'] as const;
export type SilosMode = (typeof SILOS_MODES)[number];

export const SILOS_MODE_LABEL: Record<SilosMode, string> = {
  function: 'Function',
  tenure: 'Tenure',
  team: 'Team',
};

/** The column heading the rows are named under, per mode. */
export const SILOS_MODE_COLUMN: Record<SilosMode, string> = {
  function: 'Function',
  tenure: 'Tenure',
  team: 'Team',
};

/** The panel's subtitle, per mode. */
export const SILOS_MODE_SUB: Record<SilosMode, string> = {
  function: 'trust inside vs across functions',
  tenure: 'trust inside vs across tenure bands',
  team: 'trust inside vs across teams',
};

/**
 * The roster as `subgroupCohesion` wants it, keyed by whichever line is being
 * asked about. A null group is an exclusion, not a bucket: `subgroupCohesion`
 * drops those people from the analysis entirely rather than inventing an
 * "Unassigned" subgroup, which is exactly the right reading for a tenure band
 * nobody recorded or a person with no manager on the roster.
 */
export function silosGroups(
  nodes: readonly CohortRosterMember[],
  mode: SilosMode,
): { no: number; group: string | null }[] {
  return nodes.map((n) => {
    if (mode === 'tenure') return { no: n.no, group: (n.tenureBand ?? '').trim() || null };
    if (mode === 'team') {
      const boss = n.reportsTo;
      return { no: n.no, group: boss === null || boss === undefined ? null : String(boss) };
    }
    return { no: n.no, group: n.func.trim() || null };
  });
}

/**
 * How a group key is written on a row. Function and tenure keys are already
 * the label; a team key is a roster position and has to be resolved back to
 * the manager's name — and a manager who has since left the roster still names
 * their team, because the team is a real thing whether or not the position is.
 */
export function silosLabel(
  nodes: readonly CohortRosterMember[],
  mode: SilosMode,
): (key: string) => string {
  if (mode !== 'team') return (key) => key;
  const nameOf = new Map(nodes.map((n) => [String(n.no), n.name]));
  return (key) => {
    const name = nameOf.get(key);
    return name ? `Team of ${name}` : `Team of position ${key} (left roster)`;
  };
}

/**
 * The modes this roster can actually answer. A selector option that could only
 * ever produce an empty table teaches the reader the panel is broken, so a
 * mode nobody has data for is never offered.
 */
export function silosModes(nodes: readonly CohortRosterMember[]): SilosMode[] {
  const out: SilosMode[] = ['function'];
  if (nodes.some((n) => (n.tenureBand ?? '').trim() !== '')) out.push('tenure');
  if (nodes.some((n) => n.reportsTo !== null && n.reportsTo !== undefined)) out.push('team');
  return out;
}

/**
 * Row order. Function and team rows read biggest-first, which is what
 * `subgroupCohesion` already returns; tenure rows read in band order, because
 * "<1y" next to "7y+" is the whole point of the cut and sorting it by headcount
 * would scramble the one axis the reader came for.
 */
export function orderSilos(
  stats: readonly SubgroupTieStats[],
  mode: SilosMode,
): SubgroupTieStats[] {
  if (mode !== 'tenure') return [...stats];
  const rank = (key: string): number => {
    const i = (TENURE_BANDS as readonly string[]).indexOf(key);
    return i < 0 ? TENURE_BANDS.length : i;
  };
  return [...stats].sort(
    (a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

// ------------------------------------------------ reliability vs openness

export interface LensDensity {
  /** Positive ties under this lens. */
  ties: number;
  /** Ordered pairs that carry a rating under this lens at all. */
  ratedPairs: number;
  /** ties / ratedPairs, 2dp. null when nothing was rated under this lens. */
  density: number | null;
}

/**
 * How dense one lens's positive ties are, over the pairs that lens was
 * actually rated on. The same positive definition as everywhere else, so this
 * number and the lines on the map are the same claim.
 *
 * Null rather than zero on an unrated lens: "nobody was asked" and "nobody
 * said yes" are opposite findings, and only one of them is about the group.
 */
export function lensDensity(
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
): LensDensity {
  let ties = 0;
  let ratedPairs = 0;
  for (const e of edges) {
    if (edgeMean(e, lens) === null) continue;
    ratedPairs += 1;
    if (edgePolarity(e, lens, tieThreshold) === 'positive') ties += 1;
  }
  return {
    ties,
    ratedPairs,
    density: ratedPairs === 0 ? null : Math.round((ties / ratedPairs) * 100) / 100,
  };
}

/** How far apart the two facets have to sit before the gap is worth naming. */
export const REL_OPEN_GAP = 0.15;

/**
 * The one sentence the two bars are for. A group can be entirely dependable
 * and still unsafe to be wrong in front of, and the intervention that fixes
 * one does nothing for the other — so the reading names which it is.
 *
 * Null when either side has no rated pairs: with one number missing there is
 * no comparison to make, and the bars alone are the honest output.
 */
export function relOpenVerdict(rel: number | null, open: number | null): string | null {
  if (rel === null || open === null) return null;
  if (rel >= open + REL_OPEN_GAP) {
    return "The group delivers for one another but is guarded — people don't yet feel safe being wrong. That points at psychological safety, not accountability.";
  }
  if (open >= rel + REL_OPEN_GAP) {
    return 'People feel safe with one another but delivery trust lags — the work is accountability and follow-through, not safety.';
  }
  return 'Reliability and openness travel together in this group.';
}

// ------------------------------------------------------- compare-view panes

export interface PaneEdge {
  key: string;
  from: number;
  to: number;
  mean: number;
  /** Both directions present in this pane — drawn as a separated pair of arcs. */
  mutual: boolean;
  bend: number;
}

/**
 * One compare pane's edges: the positive ties under that pane's own lens,
 * between people the filters left on screen. Both panes share one layout, so
 * this is the only thing that differs between them.
 */
export function buildPaneEdges(
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
  visible: ReadonlySet<number>,
): PaneEdge[] {
  const kept = edges.filter(
    (e) =>
      visible.has(e.from) &&
      visible.has(e.to) &&
      edgePolarity(e, lens, tieThreshold) === 'positive',
  );
  const present = new Set(kept.map((e) => `${e.from}>${e.to}`));
  return kept.map((e) => {
    const mutual = present.has(`${e.to}>${e.from}`);
    return {
      key: `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      mean: edgeMean(e, lens) ?? 0,
      mutual,
      bend: mutual ? (e.from < e.to ? 0.28 : -0.28) : 0.12,
    };
  });
}

/**
 * Which nodes in one pane may carry a name. A sixty-person constellation
 * labelled exhaustively is label soup in the dense middle, where the ties are —
 * exactly where the picture is worth reading. The people the pane is about are
 * the ones being chosen, so the top `limit` by that pane's OWN in-degree keep
 * their names and everyone else keeps their tooltip.
 *
 * Nobody with zero ties received is ever named: a pane with three ties in it
 * should show three names, not eight.
 */
export function topPaneLabels(paneEdges: readonly PaneEdge[], limit = 8): Set<number> {
  const inDeg = paneInDegree(paneEdges);
  return new Set(
    [...inDeg.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([no]) => no),
  );
}

/**
 * The same list, with every row that touches the focused person lifted to the
 * top. A stable partition, not a re-sort: the ranking the list was built with
 * still holds inside each half, so focusing someone rearranges the page as
 * little as it can while still answering "and what about them?".
 */
export function orderTiesByFocus<T extends { a: number; b: number }>(
  ties: readonly T[],
  focus: number | null,
): T[] {
  if (focus === null) return [...ties];
  const touching = ties.filter((t) => t.a === focus || t.b === focus);
  return touching.length === 0
    ? [...ties]
    : [...touching, ...ties.filter((t) => t.a !== focus && t.b !== focus)];
}

/** Ties received inside one pane — what sizes that pane's nodes. */
export function paneInDegree(paneEdges: readonly PaneEdge[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of paneEdges) m.set(e.to, (m.get(e.to) ?? 0) + 1);
  return m;
}

/** Everyone one step from `no` in this pane, either direction. */
export function paneNeighbours(paneEdges: readonly PaneEdge[], no: number): Set<number> {
  const out = new Set<number>();
  for (const e of paneEdges) {
    if (e.from === no) out.add(e.to);
    if (e.to === no) out.add(e.from);
  }
  return out;
}

/**
 * The union graph the compare view lays out on: a tie in either pane is a tie
 * for the purpose of seating people. One layout, two drawings — which is the
 * whole point of the view, since a person only reads as "trusted here but not
 * listened to there" if they are in the same seat on both sides.
 */
export function unionTies(
  edges: readonly CohortNetworkEdge[],
  lenses: readonly string[],
  tieThreshold: number,
): DirectedTie[] {
  const seen = new Set<string>();
  const out: DirectedTie[] = [];
  for (const lens of lenses) {
    for (const t of positiveTies(edges, lens, tieThreshold)) {
      const key = `${t.from}>${t.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

// ------------------------------------------------ trust vs power divergence

/**
 * One person's place on the trust x influence plane.
 *
 * COVERAGE NORMALISATION — the one judgement call in this file. Ties received
 * is a count, and a count only compares two people fairly when the same number
 * of colleagues had a basis to rate each of them. So when the caller can supply
 * per-member coverage (how many colleagues rated that person at all, which the
 * scored group result carries and the roster nodes do not), both axes are
 * divided by it and `normalised` is true: a person rated by four reads against
 * a person rated by twelve. With no coverage data the raw counts are plotted
 * unchanged and `normalised` is false — the picture still reads, and the card
 * says which of the two numbers it is showing rather than pretending they are
 * the same thing. Coverage of zero cannot be divided by and plots at the
 * origin, which is exactly where a person nobody rated belongs.
 */
export interface DivergencePoint {
  no: number;
  /** x — positive trust ties received, per rater when normalised. */
  trust: number;
  /**
   * y — TOTAL power received: enabling plus controlling, per rater when
   * normalised.
   *
   * The facilitator guide plots trust against total power and then reads the
   * enabling/controlling split as a second question. Plotting power-over alone
   * put a strong enabler with no gatekeeping in the low-power half, which is
   * the opposite of the guide's "Collaborative Anchor" — the very person the
   * instrument exists to find.
   */
  power: number;
  /** The raw counts, always. A tooltip should say people, not rates. */
  trustCount: number;
  powerCount: number;
  /** The halves of that total, for the "which kind of power" reading. */
  enablingCount: number;
  controllingCount: number;
  normalised: boolean;
}

export interface Medians {
  trust: number;
  power: number;
}

/**
 * The four readings of the plane. Named for what they mean to a facilitator
 * rather than for their compass direction:
 *
 *   watch      — influence without trust: a friction point and a succession risk
 *   underused  — trusted without influence: the stretch-role candidates
 *   anchor     — trusted and influential
 *   peripheral — low on both
 */
export type Quadrant = 'watch' | 'underused' | 'anchor' | 'peripheral';

/** Both axes for every member, at one threshold, under the two fixed lenses. */
export function divergencePoints(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  coverageOf?: ReadonlyMap<number, number>,
): DivergencePoint[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const t = degrees(nos, [...edges], 'trust', tieThreshold);
  // Total power is the guide's horizontal axis: enabling and controlling
  // added, with the split kept for the second reading.
  const enabling = degrees(nos, [...edges], 'power_to', tieThreshold);
  const controlling = degrees(nos, [...edges], 'power_over', tieThreshold);
  // Normalise only when the coverage actually says something: a map of zeroes
  // would put the whole cohort at the origin and call it a finding.
  const normalised = coverageOf !== undefined && nos.some((no) => (coverageOf.get(no) ?? 0) > 0);
  return nos.map((no) => {
    const trustCount = t.get(no)?.posIn ?? 0;
    const enablingCount = enabling.get(no)?.posIn ?? 0;
    const controllingCount = controlling.get(no)?.posIn ?? 0;
    const powerCount = enablingCount + controllingCount;
    const cov = coverageOf?.get(no) ?? 0;
    const scale = normalised ? (cov > 0 ? 1 / cov : 0) : 1;
    return {
      no,
      trust: trustCount * scale,
      power: powerCount * scale,
      trustCount,
      powerCount,
      enablingCount,
      controllingCount,
      normalised,
    };
  });
}

/** The middle value; the mean of the two middles on an even count. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The two guide lines the scatter is split on. */
export function divergenceMedians(points: readonly DivergencePoint[]): Medians {
  return {
    trust: medianOf(points.map((p) => p.trust)),
    power: medianOf(points.map((p) => p.power)),
  };
}

/**
 * Which quadrant a person sits in. Sitting exactly on a median counts as the
 * higher side of it — unless that median is zero, since nobody with no ties
 * at all is high on anything: the split is a reading aid, and pushing a person at the
 * middle of the group down into "peripheral" is a harder claim than a median
 * can carry.
 */
export function quadrantOf(p: DivergencePoint, m: Medians): Quadrant {
  // Zero is never the high side. Where most of a group has no power ties the
  // median is 0, and "on the median counts high" would then call everyone with
  // none "influential" — a Trusted Advisor drawn as a Collaborative Anchor.
  const trusted = p.trust > 0 && p.trust >= m.trust;
  const influential = p.power > 0 && p.power >= m.power;
  if (trusted && influential) return 'anchor';
  if (influential) return 'watch';
  if (trusted) return 'underused';
  return 'peripheral';
}

/** What to call each kind of power on screen. */
export const POWER_KIND_LABEL: Record<PowerKind, string> = {
  bottleneck: 'Control, not enablement',
  capable_expert: 'Enablement, not control',
  mixed: 'Both kinds, evenly',
};

/**
 * Which kind of power carries this person, from the two halves the chart
 * already counted. Null when they are over the line on neither.
 *
 * The guide asks for this specifically inside the Risk Zone, where it decides
 * the intervention — "high power-OVER = a coercive bottleneck (the priority for
 * redesign); high power-TO but low trust = a capable expert who needs
 * relational development — a different fix." It is computed for everyone
 * because the same split reads usefully on an Anchor too, and the rule is the
 * engine's so a dossier and a chart cannot disagree about it.
 */
export function riskKindOf(p: DivergencePoint): PowerKind | null {
  return powerKindOf(p.enablingCount, p.controllingCount);
}

/** The guide's prescription for a kind, for the panel beside the chart. */
export function riskKindFix(kind: PowerKind): string {
  return powerKindReading(kind).fix;
}

export interface DivergenceEntry {
  no: number;
  trust: number;
  power: number;
  trustCount: number;
  powerCount: number;
  /** How far into its own quadrant this point sits — always above zero. */
  gap: number;
}

/**
 * The two lists the quadrant chart exists to produce. Rank is distance into the
 * quadrant, which is the sum of the two margins from the medians — one number
 * that says "far above the group on influence AND far below it on trust", so a
 * person who is only just over one line never outranks one who is clear of both.
 */
export function watchLists(
  points: readonly DivergencePoint[],
  m: Medians,
  limit = 5,
): { watch: DivergenceEntry[]; underused: DivergenceEntry[] } {
  const watch: DivergenceEntry[] = [];
  const underused: DivergenceEntry[] = [];
  for (const p of points) {
    const q = quadrantOf(p, m);
    const gap = p.power - m.power + (m.trust - p.trust);
    const entry = {
      no: p.no,
      trust: p.trust,
      power: p.power,
      trustCount: p.trustCount,
      powerCount: p.powerCount,
      gap: Math.abs(gap),
    };
    if (q === 'watch' && gap > 0) watch.push(entry);
    else if (q === 'underused' && gap < 0) underused.push(entry);
  }
  const rank = (a: DivergenceEntry, b: DivergenceEntry) => b.gap - a.gap || a.no - b.no;
  return {
    watch: watch.sort(rank).slice(0, limit),
    underused: underused.sort(rank).slice(0, limit),
  };
}

/**
 * Everyone on the plane, most notable first — where notable means furthest from
 * the crossing of the two medians, measured in units of each axis's own spread.
 * The two axes can be counts of very different size, and an unscaled hypotenuse
 * would rank by whichever axis happened to run further.
 *
 * This is the order the chart labels people in: the middle of the group is the
 * part with nothing to say, so when two labels collide the outlier keeps its
 * name and the unremarkable dot gives its up.
 */
export function rankByDivergence(
  points: readonly DivergencePoint[],
  m: Medians,
): DivergencePoint[] {
  const spreadT = Math.max(1e-9, ...points.map((p) => Math.abs(p.trust - m.trust)));
  const spreadP = Math.max(1e-9, ...points.map((p) => Math.abs(p.power - m.power)));
  const dist = (p: DivergencePoint): number =>
    Math.hypot((p.trust - m.trust) / spreadT, (p.power - m.power) / spreadP);
  return [...points].sort((a, b) => dist(b) - dist(a) || a.no - b.no);
}

/**
 * Which dots may carry a name at all, before collision culling gets its say.
 * Sixty labels on one scatter is a grey smear even when none of them overlap.
 */
export function outerLabels(
  points: readonly DivergencePoint[],
  m: Medians,
  share = 0.6,
): Set<number> {
  if (points.length === 0) return new Set();
  const keep = Math.max(1, Math.ceil(points.length * Math.max(0, Math.min(1, share))));
  return new Set(rankByDivergence(points, m).slice(0, keep).map((p) => p.no));
}

// ------------------------------------------------------- label collision

/** An axis-aligned box in SVG user units. */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mean advance width of the UI sans at weight 600, as a fraction of font size.
 * Measured off the rendered stack rather than guessed: it only has to be close
 * enough that two labels which look like they touch are treated as touching.
 * Erring high is the safe direction — it culls one label too many rather than
 * printing one on top of another.
 */
export const GLYPH_RATIO = 0.58;

/**
 * The box a piece of SVG text will occupy, from its anchor point. `cy` is the
 * baseline, as SVG means it; the box climbs above it by the cap height and
 * drops a little below for descenders.
 */
export function textBox(
  text: string,
  cx: number,
  cy: number,
  size: number,
  anchor: 'start' | 'middle' | 'end' = 'middle',
  pad = { x: 5, y: 3 },
): LabelBox {
  const w = text.length * size * GLYPH_RATIO + pad.x * 2;
  const h = size * 1.18 + pad.y * 2;
  const x = anchor === 'middle' ? cx - w / 2 : anchor === 'end' ? cx - w : cx;
  return { x, y: cy - size * 0.82 - pad.y, w, h };
}

/** Do these two boxes touch, allowing `gap` units of breathing room? */
export function boxesOverlap(a: LabelBox, b: LabelBox, gap = 0): boolean {
  return (
    a.x - gap < b.x + b.w &&
    b.x - gap < a.x + a.w &&
    a.y - gap < b.y + b.h &&
    b.y - gap < a.y + a.h
  );
}

/**
 * Greedy label placement. Walk the candidates in the order given — most
 * notable first — and give each one the first of its offered positions that
 * clears every box already standing, including the fixed furniture (corner
 * labels, median captions) passed in as `reserved`. Returns the index of the
 * position each label got; a label absent from the map found no room and is
 * not drawn at all.
 *
 * Offering a candidate two or three positions (above the dot, then below) buys
 * back most of the names a single-position pass would cull, without ever moving
 * a name away from the mark it belongs to. That last part is the reason this is
 * greedy rather than a force-relaxed layout: nudging labels until they all fit
 * detaches them from their dots, which on a scatter of named colleagues is
 * worse than not printing them. Every dot carries a hover tooltip, so a culled
 * label costs nothing but ink.
 */
export function cullLabels(
  candidates: readonly { id: number; boxes: readonly (LabelBox | null)[] }[],
  reserved: readonly LabelBox[] = [],
  gap = 2,
): Map<number, number> {
  const placed: LabelBox[] = [...reserved];
  const out = new Map<number, number>();
  for (const c of candidates) {
    // A null seat is one the caller has already ruled out — off the end of the
    // plot, say. It holds its index rather than being filtered away, because
    // the index IS the answer: the caller draws the label at the seat this
    // returns, and a compacted array would hand back a seat it never checked.
    const i = c.boxes.findIndex(
      (box) => box !== null && !placed.some((b) => boxesOverlap(box, b, gap)),
    );
    if (i < 0) continue;
    placed.push(c.boxes[i]!);
    out.set(c.id, i);
  }
  return out;
}

// ------------------------------------------------ isolates and the periphery

export interface PeripheralEntry {
  no: number;
  /** Positive trust ties received. */
  trustIn: number;
  /** Positive power-over ties received. */
  powerIn: number;
  /** isolate — nobody at all; peripheral — in the bottom band under both lenses. */
  kind: 'isolate' | 'peripheral';
  /** Their tenure band is the newest one: the chip that explains the position. */
  newerHire: boolean;
}

export interface PeripheralReading {
  members: PeripheralEntry[];
  /** Rated by fewer colleagues than the cohort's floor — no call is made. */
  thinlyRated: { no: number; coverage: number }[];
}

/**
 * The people the group has placed at its edge, and the people it has not said
 * enough about to place at all.
 *
 * Under-covered members are pulled out first and never judged: three colleagues
 * not rating someone highly is not the same finding as the group not rating
 * them highly, and merging the two would put the quietest corner of the roster
 * on a list it did not earn. Of those who remain, an isolate has no positive
 * ties at all under either lens; a peripheral member is in the bottom band
 * (~15% by rank) under BOTH lenses, because low on one alone is the divergence
 * finding, not this one.
 */
export function peripheralMembers(
  nodes: readonly CohortRosterMember[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  opts: {
    coverageOf?: ReadonlyMap<number, number>;
    /** The cohort's suppression floor. Below it a member is too thinly rated. */
    minRaters?: number;
    /** The bottom share of the group that counts as peripheral. */
    bottomShare?: number;
  } = {},
): PeripheralReading {
  const bottomShare = opts.bottomShare ?? 0.15;
  const minRaters = opts.minRaters ?? 0;
  const thinlyRated: { no: number; coverage: number }[] = [];
  const eligible: CohortRosterMember[] = [];
  for (const n of nodes) {
    const cov = opts.coverageOf?.get(n.no);
    if (cov !== undefined && minRaters > 0 && cov < minRaters) thinlyRated.push({ no: n.no, coverage: cov });
    else eligible.push(n);
  }

  const nos = eligible.map((n) => n.no);
  const t = degrees(nos, [...edges], 'trust', tieThreshold);
  const p = degrees(nos, [...edges], 'power_over', tieThreshold);
  const trustIn = (no: number) => t.get(no)?.posIn ?? 0;
  const powerIn = (no: number) => p.get(no)?.posIn ?? 0;

  // The bottom band is a rank, not a value: "the lowest 15% of this group",
  // which is the only version of the question that survives a cohort where
  // everybody holds three ties.
  const bandLine = (values: number[]): number => {
    if (values.length === 0) return -1;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(s.length * bottomShare) - 1)]!;
  };
  const trustLine = bandLine(nos.map(trustIn));
  const powerLine = bandLine(nos.map(powerIn));

  const members: PeripheralEntry[] = [];
  for (const n of eligible) {
    const ti = trustIn(n.no);
    const pi = powerIn(n.no);
    const isolate = ti === 0 && pi === 0;
    if (!isolate && !(ti <= trustLine && pi <= powerLine)) continue;
    members.push({
      no: n.no,
      trustIn: ti,
      powerIn: pi,
      kind: isolate ? 'isolate' : 'peripheral',
      newerHire: (n.tenureBand ?? '').trim() === TENURE_BANDS[0],
    });
  }
  members.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'isolate' ? -1 : 1) ||
      a.trustIn + a.powerIn - (b.trustIn + b.powerIn) ||
      a.no - b.no,
  );
  return { members, thinlyRated: thinlyRated.sort((a, b) => a.coverage - b.coverage || a.no - b.no) };
}

// ------------------------------------------------- spread or concentrated

/**
 * How a concentration reads out loud. The thresholds are the client's, not
 * ours, and the words are deliberately plain: 0.5 and above is a group whose
 * standing sits with a handful of people, 0.25 and below is a group that
 * spreads it around.
 */
export function concentrationReading(concentration: number | null): string | null {
  if (concentration === null) return null;
  if (concentration >= 0.5) return 'held by a few hands';
  if (concentration <= 0.25) return 'broadly spread';
  return 'somewhere between';
}

/** One scored block's concentration out of the network payload, if it is there. */
export function blockConcentration(
  networks: readonly { blockKey: string; concentration: number | null }[] | undefined,
  blockKey: string,
): number | null {
  return networks?.find((n) => n.blockKey === blockKey)?.concentration ?? null;
}

// ------------------------------------------- who we trust vs who decides

/** "A", "A and B", "A, B and C" — a list a person would read aloud. */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/**
 * The sentence under the two panes: does the group's trust sit with the people
 * it lets decide? Full overlap and no overlap are the two findings a client
 * acts on, so both are stated flatly; in between, the useful thing is the names
 * that carry both, which is what the debrief starts from.
 *
 * Null when either list is empty — with one side blank there is no comparison,
 * and the panes alone are the honest output.
 */
export function trustPowerOverlapSentence(
  trustTop: readonly number[],
  powerTop: readonly number[],
  nameOf: (no: number) => string,
): string | null {
  if (trustTop.length === 0 || powerTop.length === 0) return null;
  const power = new Set(powerTop);
  const both = trustTop.filter((no) => power.has(no));
  if (both.length === trustTop.length && both.length === powerTop.length) {
    return 'The people the group trusts are the people driving decisions.';
  }
  if (both.length === 0) {
    return "The group's trust and its decision power sit with different people — start the debrief here.";
  }
  return `${joinNames(both.map(nameOf))} ${both.length === 1 ? 'is' : 'are'} on both lists; beyond ${
    both.length === 1 ? 'them' : 'those names'
  }, the group's trust and its decision power sit with different people.`;
}

// --------------------------------------------------- shared tie-drawing math

export interface TieGeometry {
  /** Source centre and radius. */
  sx: number;
  sy: number;
  sr: number;
  /** Target centre and radius. */
  tx: number;
  ty: number;
  tr: number;
  mutual: boolean;
  bend: number;
  /** Room left at the target rim for the arrowhead. */
  tipGap?: number;
}

/**
 * The wire between two circles: centre to centre, trimmed at each rim, curved
 * away from its sibling when the pair is mutual. Extracted so the force map
 * and the compare panes draw the identical arc — one of them is React Flow and
 * the other is plain SVG, and this is the only geometry they can share.
 */
export function tiePath(g: TieGeometry): string {
  const tipGap = g.tipGap ?? 5;
  const dx = g.tx - g.sx;
  const dy = g.ty - g.sy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // Perpendicular shift separates a mutual pair into two parallel arcs from
  // the rim itself, not just at the midpoint.
  const px = -uy;
  const py = ux;
  const off = g.mutual ? (g.bend > 0 ? 5 : -5) : 0;

  const startX = g.sx + ux * g.sr + px * off;
  const startY = g.sy + uy * g.sr + py * off;
  const endX = g.tx - ux * (g.tr + tipGap) + px * off;
  const endY = g.ty - uy * (g.tr + tipGap) + py * off;

  const bend = g.mutual ? g.bend : g.bend * 0.35;
  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;
  const cx = mx - (endY - startY) * bend;
  const cy = my + (endX - startX) * bend;
  return `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`;
}

/** How heavy a tie is drawn: stronger ratings, and focused ties, draw thicker. */
export function tieWidth(polarity: Polarity, mean: number, focused: boolean, pending = false): number {
  if (pending) return 1;
  const strength =
    polarity === 'positive' ? Math.max(0, (mean - 1) / 4) : polarity === 'negative' ? 0.55 : 0.35;
  return (focused ? 1.6 : 1) + strength * 1.9;
}

/** How present a tie is: dimmed almost away, focused nearly solid, else faint. */
export function tieOpacity(
  polarity: Polarity,
  opts: { dimmed: boolean; focused: boolean; pending?: boolean },
): number {
  if (opts.dimmed) return 0.04;
  if (opts.focused) return 0.9;
  if (opts.pending) return 0.4;
  return polarity === 'neutral' ? 0.16 : polarity === 'negative' ? 0.32 : 0.24;
}

// ------------------------------------------------------------ community hulls
//
// A cluster is a claim about a REGION of the map, not about a handful of
// same-coloured dots, and colour alone makes the reader do the grouping in
// their head. A soft hull behind the nodes hands them the group already made.
//
// Three rules keep a hull honest. It is drawn BEHIND the nodes, because the
// people are the data and the shape is the annotation. It is padded and
// rounded, so it reads as a territory rather than as a polygon someone
// measured. And a cluster of one or two never gets one at all: a two-node
// capsule looks like a rendering fault, and the legend already says they are
// there.

/** A point in SVG user units. Hulls, callouts and leader lines all speak this. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Andrew's monotone chain. Points in, the convex hull out, with duplicates and
 * collinear points dropped — a hull is the shape, not the sample. Winding is
 * counter-clockwise in maths orientation, which is clockwise on screen where y
 * grows downward; nothing here depends on which, because `expandHull` decides
 * "outward" against the centroid rather than against the winding.
 *
 * Hand-rolled rather than pulled in: it is thirty lines, it is exact, and one
 * more dependency to draw four polygons is not a trade worth making.
 */
export function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const uniq: Pt[] = [];
  for (const p of sorted) {
    const last = uniq[uniq.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;

  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Pt[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** The outward unit normal of edge a→b, resolved against the shape's centre. */
function edgeNormal(a: Pt, b: Pt, cx: number, cy: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a.x + b.x) / 2 - cx;
  const my = (a.y + b.y) / 2 - cy;
  if (nx * mx + ny * my < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/** How far a hull stands off the nodes it wraps, in the map's own units. */
export const HULL_PAD = 26;

/**
 * Push every vertex outward by `pad`, along the bisector of its two edge
 * normals with a mitre so a sharp corner still clears its node by the full
 * padding. The mitre is capped at 3x, because an almost-degenerate spike would
 * otherwise throw a spear across the map.
 *
 * One and two point hulls are the degenerate cases a real cohort can still
 * produce (three people in a line), and they are given a square and a capsule
 * rather than being dropped: a hull that vanishes on collinear data reads as a
 * bug in the clustering, not as geometry.
 */
export function expandHull(hull: readonly Pt[], pad: number): Pt[] {
  const n = hull.length;
  if (n === 0) return [];
  if (n === 1) {
    const p = hull[0]!;
    return [
      { x: p.x - pad, y: p.y - pad },
      { x: p.x + pad, y: p.y - pad },
      { x: p.x + pad, y: p.y + pad },
      { x: p.x - pad, y: p.y + pad },
    ];
  }
  if (n === 2) {
    const a = hull[0]!;
    const b = hull[1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    return [
      { x: a.x - ux * pad + nx * pad, y: a.y - uy * pad + ny * pad },
      { x: b.x + ux * pad + nx * pad, y: b.y + uy * pad + ny * pad },
      { x: b.x + ux * pad - nx * pad, y: b.y + uy * pad - ny * pad },
      { x: a.x - ux * pad - nx * pad, y: a.y - uy * pad - ny * pad },
    ];
  }

  const cx = hull.reduce((s, p) => s + p.x, 0) / n;
  const cy = hull.reduce((s, p) => s + p.y, 0) / n;
  return hull.map((cur, i) => {
    const prev = hull[(i - 1 + n) % n]!;
    const next = hull[(i + 1) % n]!;
    const n1 = edgeNormal(prev, cur, cx, cy);
    const n2 = edgeNormal(cur, next, cx, cy);
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) {
      // The two edges double back on each other. Push straight out instead.
      const dx = cur.x - cx;
      const dy = cur.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: cur.x + (dx / d) * pad, y: cur.y + (dy / d) * pad };
    }
    bx /= blen;
    by /= blen;
    const mitre = Math.min(3, 1 / Math.max(0.34, bx * n1.x + by * n1.y));
    return { x: cur.x + bx * pad * mitre, y: cur.y + by * pad * mitre };
  });
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * A closed path through the polygon with every corner rounded off — the
 * difference between a territory and a surveyor's plot. Each corner is cut back
 * by `radius` (never past a segment's midpoint) and bridged with a quadratic
 * through the original vertex.
 */
export function roundedHullPath(points: readonly Pt[], radius = 14): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) {
    const p = points[0]!;
    const r = Math.max(1, radius);
    return `M ${fmt(p.x - r)} ${fmt(p.y)} a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0 Z`;
  }
  if (n === 2) {
    const a = points[0]!;
    const b = points[1]!;
    return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  const along = (from: Pt, to: Pt, d: number): Pt => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(d, len / 2) / len;
    return { x: from.x + dx * t, y: from.y + dy * t };
  };
  const corners = points.map((cur, i) => ({
    in: along(cur, points[(i - 1 + n) % n]!, radius),
    at: cur,
    out: along(cur, points[(i + 1) % n]!, radius),
  }));
  const first = corners[0]!;
  let d = `M ${fmt(first.out.x)} ${fmt(first.out.y)}`;
  for (let i = 1; i < n; i++) {
    const c = corners[i]!;
    d += ` L ${fmt(c.in.x)} ${fmt(c.in.y)} Q ${fmt(c.at.x)} ${fmt(c.at.y)} ${fmt(c.out.x)} ${fmt(c.out.y)}`;
  }
  d += ` L ${fmt(first.in.x)} ${fmt(first.in.y)} Q ${fmt(first.at.x)} ${fmt(first.at.y)} ${fmt(first.out.x)} ${fmt(first.out.y)} Z`;
  return d;
}

export interface ClusterHull {
  /** The legend row this hull belongs to — "Cluster 1". */
  label: string;
  fill: string;
  /** Everyone the algorithm put in this cluster, roster order. */
  members: number[];
  /** The padded outline, ready for `roundedHullPath`. */
  points: Pt[];
}

/** Below this a cluster gets no hull: a two-node capsule reads as an error. */
export const HULL_MIN_MEMBERS = 3;

/** The widest node in a cluster — what the hull has to clear, not the centres. */
function widestIn(members: readonly number[], radiusOf: (no: number) => number): number {
  return members.reduce((m, no) => Math.max(m, radiusOf(no)), 0);
}

/**
 * One padded hull per real cluster, in the same order and the same colours
 * `clusterView` gives the legend — the hull and the legend swatch are the same
 * claim, so they are numbered and coloured by one rule, here as there.
 *
 * A cluster is skipped when it has fewer than `minMembers` people, or when
 * fewer than that many of them have a seat on the map.
 *
 * `pad` is clearance from the node CENTRES, unless the caller supplies
 * `radiusOf` — in which case it is clearance from the rim of the cluster's
 * widest node, which is the only version that actually looks right. Nodes on
 * this map run 14 to 32 units, so a hull padded from the centres tucks itself
 * under the very people it is meant to be enclosing.
 */
export function clusterHulls(
  communityOf: ReadonlyMap<number, number>,
  positions: ReadonlyMap<number, Pt>,
  opts: {
    pad?: number;
    minMembers?: number;
    radiusOf?: (no: number) => number;
    /** Name and colour a territory by its community id, instead of by size rank. */
    labelOf?: (id: number) => string;
    colorOf?: (id: number) => string;
  } = {},
): ClusterHull[] {
  const pad = opts.pad ?? HULL_PAD;
  const minMembers = opts.minMembers ?? HULL_MIN_MEMBERS;
  const members = new Map<number, number[]>();
  for (const [no, id] of communityOf) {
    const list = members.get(id);
    if (list) list.push(no);
    else members.set(id, [no]);
  }
  // The identical ordering clusterView uses, so "Cluster 2" is the same people
  // and the same hue in the legend, on the map and inside the hull.
  const real = [...members.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);

  const out: ClusterHull[] = [];
  real.forEach(([id, list], i) => {
    if (list.length < minMembers) return;
    const all = list
      .map((no) => positions.get(no))
      .filter((p): p is Pt => p !== undefined)
      .map((p) => ({ x: p.x, y: p.y }));
    if (all.length < minMembers) return;
    // The hull wraps the cluster's CORE, not its stragglers: on a map laid out
    // by ties, clusters interleave, and a convex hull that reaches out to one
    // far member of each swallows the whole picture. Members further from
    // the cluster's centre than 1.6× the median distance are still coloured
    // and listed as members — they just do not stretch the territory.
    const cx = all.reduce((t, p) => t + p.x, 0) / all.length;
    const cy = all.reduce((t, p) => t + p.y, 0) / all.length;
    const dists = all.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)] ?? 0;
    const core = all.filter((p) => Math.hypot(p.x - cx, p.y - cy) <= Math.max(40, median * 1.6));
    const seated = core.length >= Math.min(3, all.length) ? core : all;
    const clearance = pad + (opts.radiusOf ? widestIn(list, opts.radiusOf) : 0);
    out.push({
      label: opts.labelOf ? opts.labelOf(id) : `Cluster ${i + 1}`,
      fill: opts.colorOf ? opts.colorOf(id) : i < CATEGORICAL_COLORS.length ? CATEGORICAL_COLORS[i]! : MUTED_GREY,
      members: [...list].sort((a, b) => a - b),
      points: expandHull(convexHull(seated), clearance),
    });
  });
  return out;
}

// --------------------------------------------------------- the tie matrix
//
// The same one-way ties as the list, read as a grid. A list answers "which
// reaching-out is not returned?" one pair at a time; a matrix answers "is this
// group full of them, and are they all pointing the same way?" at a glance —
// a solid row is a person nobody returns, a solid column is a person everybody
// reaches for.
//
// The ordering is the whole difference between a matrix that helps and one
// that hurts. An adjacency matrix in arbitrary (roster) order scatters its
// blocks into confetti and is strictly worse than the list it replaced; sorted
// by community, and by ties received inside each community, the blocks gather
// on the diagonal and the structure is the picture. So the ordering is not a
// nicety here, it is the feature.

export type MatrixTieKind = 'not_returned' | 'no_basis' | 'mutual';

export interface MatrixCell {
  /** Row — the person who asserted the tie. */
  from: number;
  /** Column — the person it was asserted about. */
  to: number;
  mean: number;
  kind: MatrixTieKind;
}

export interface TieMatrix {
  /** Row and column order — one order, used for both axes. */
  order: number[];
  cells: MatrixCell[];
  /** Positive ties received from inside the matrix, per person. */
  inDegree: Map<number, number>;
  /** One-way ties each person is on either end of. */
  involvement: Map<number, number>;
  /** How many people qualified, before the cap. */
  total: number;
  capped: boolean;
  limit: number;
}

/** Past this many people the grid stops being readable, so it stops growing. */
export const MATRIX_CAP = 25;

/**
 * The adjacency matrix for one lens, over the people who have at least one
 * one-way tie under it.
 *
 * Only those people: a matrix of the whole cohort is mostly blank, and the
 * blankness is not the finding. `kind` is derived exactly as
 * `unreciprocatedTies` derives it, from the same pair means, so a red cell here
 * and a row in the list are the same claim and can never disagree.
 *
 * Over `limit` people the grid keeps the most-involved and says so. Truncating
 * silently would let a reader conclude the group has twenty-five people worth
 * looking at when it has forty.
 */
export function tieMatrix(
  pairs: readonly { from: number; to: number; mean: number | null }[],
  tieThreshold: number,
  communityOf: ReadonlyMap<number, number>,
  limit = MATRIX_CAP,
): TieMatrix {
  const meanOf = new Map<string, number>();
  for (const p of pairs) {
    if (p.mean === null || p.from === p.to) continue;
    meanOf.set(`${p.from}>${p.to}`, p.mean);
  }
  const kindOf = (from: number, to: number): MatrixTieKind => {
    const back = meanOf.get(`${to}>${from}`);
    if (back !== undefined && back >= tieThreshold) return 'mutual';
    return back === undefined ? 'no_basis' : 'not_returned';
  };

  // Involvement counts both ends: a person nobody returns and a person who
  // never returns anyone are both worth a row.
  const involvement = new Map<number, number>();
  const bump = (no: number) => involvement.set(no, (involvement.get(no) ?? 0) + 1);
  for (const p of pairs) {
    if (p.mean === null || p.from === p.to || p.mean < tieThreshold) continue;
    if (kindOf(p.from, p.to) === 'mutual') continue;
    bump(p.from);
    bump(p.to);
  }

  const involved = [...involvement.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const total = involved.length;
  const kept = involved.slice(0, Math.max(0, limit)).map(([no]) => no);

  const cells: MatrixCell[] = [];
  const inDegree = new Map<number, number>(kept.map((no) => [no, 0]));
  for (const from of kept) {
    for (const to of kept) {
      if (from === to) continue; // the diagonal is not a fact about anyone
      const mean = meanOf.get(`${from}>${to}`);
      if (mean === undefined || mean < tieThreshold) continue;
      cells.push({ from, to, mean, kind: kindOf(from, to) });
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const order = [...kept].sort(
    (a, b) =>
      (communityOf.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (communityOf.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0) ||
      a - b,
  );

  return { order, cells, inDegree, involvement, total, capped: total > kept.length, limit };
}

// ------------------------------------------------------- trust vs power rank
//
// The scatter on card 1.2 finds the people whose two COUNTS diverge. The two
// panes on card 3.2 are a different question with a different answer: where
// does a person STAND relative to everyone else, on each side? Someone can be
// third on trust and fourteenth on decisions with counts that barely differ,
// and it is the standing, not the count, that a facilitator argues about.
//
// So the rings are drawn from ranks, and they are drawn in BOTH panes — the
// whole claim is that the same seat reads differently on the two sides, and a
// ring on one side only would be a claim about one side.

export interface RankDivergence {
  no: number;
  /** 1-based competition rank on positive trust ties received. */
  trustRank: number;
  /** The same, under the power-over lens. */
  powerRank: number;
  trustCount: number;
  powerCount: number;
  /** How far the two standings disagree. */
  delta: number;
}

/** The colour the divergence rings wear, in both panes. */
export const RANK_RING_COLOR = '#4a3aa7';

/**
 * Competition ranking (1, 2, 2, 4) on a count, biggest first. Equal counts must
 * take equal rank: splitting them on roster number would invent a divergence
 * out of the order people were typed into a spreadsheet.
 */
export function rankByCount(counts: ReadonlyMap<number, number>): Map<number, number> {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const out = new Map<number, number>();
  let rank = 0;
  let seen = 0;
  let last: number | null = null;
  for (const [no, count] of sorted) {
    seen += 1;
    if (last === null || count !== last) {
      rank = seen;
      last = count;
    }
    out.set(no, rank);
  }
  return out;
}

/**
 * The `limit` people whose trust standing and decision standing differ most.
 *
 * A delta of zero is not a weak finding, it is the absence of one, so it never
 * ranks — which also means a cohort where nobody diverges returns nothing and
 * the panes draw no rings at all. Ties go to the person who stands higher on
 * one of the two lists (the one a room will recognise), then to roster order.
 */
export function rankDivergence(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  limit = 3,
): RankDivergence[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const t = degrees(nos, [...edges], 'trust', tieThreshold);
  const p = degrees(nos, [...edges], 'power_over', tieThreshold);
  const trustCounts = new Map(nos.map((no) => [no, t.get(no)?.posIn ?? 0]));
  const powerCounts = new Map(nos.map((no) => [no, p.get(no)?.posIn ?? 0]));
  const trustRanks = rankByCount(trustCounts);
  const powerRanks = rankByCount(powerCounts);

  return nos
    .map((no) => {
      const trustRank = trustRanks.get(no)!;
      const powerRank = powerRanks.get(no)!;
      return {
        no,
        trustRank,
        powerRank,
        trustCount: trustCounts.get(no)!,
        powerCount: powerCounts.get(no)!,
        delta: Math.abs(trustRank - powerRank),
      };
    })
    .filter((d) => d.delta > 0)
    .sort(
      (a, b) =>
        b.delta - a.delta ||
        Math.min(a.trustRank, a.powerRank) - Math.min(b.trustRank, b.powerRank) ||
        a.no - b.no,
    )
    .slice(0, Math.max(0, limit));
}

/** How a ring reads out loud, in a tooltip. */
export function rankDivergenceLabel(d: RankDivergence): string {
  return `Trusted #${d.trustRank} · drives decisions #${d.powerRank}`;
}

// -------------------------------------------------------- margin annotations
//
// The bridges map names only the focused person, because names printed into a
// dense constellation land on each other and on the ties. The three people the
// card is actually about deserve better than a tooltip, so their names go in
// the MARGIN — outside the node field entirely, where there is nothing to
// collide with — and a hairline leader connects each one to its node.
//
// Two rules make the leaders readable, and both are geometric rather than
// aesthetic. They stop at the halo rim, so a leader points at a node instead of
// stabbing through it. And within one margin the annotations are stacked in the
// same top-to-bottom order as their nodes, which is what guarantees no two
// leaders cross: same start edge, same vertical order at both ends.

export interface CalloutTarget {
  no: number;
  x: number;
  y: number;
  /** The node's drawn radius. The leader stops at its halo, never inside it. */
  r: number;
  text: string;
}

export interface Callout {
  no: number;
  /** Which margin it sits in — decided by which half of the field the node is in. */
  side: 'left' | 'right';
  /** The text's anchor point, out in the margin. */
  x: number;
  y: number;
  anchor: 'start' | 'end';
  text: string;
  /** The hairline: field edge to halo rim. */
  line: { x1: number; y1: number; x2: number; y2: number };
}

/** How far outside a node's radius its halo reaches. Matches the mini-map. */
export const HALO_PAD = 7;

/**
 * Push a run of wanted positions apart until no two sit closer than `gap`,
 * keeping the order they arrived in and staying inside [min, max].
 *
 * Order-preserving is the point, not a side effect: leaders drawn from one
 * vertical edge to targets in the same vertical order cannot cross one another.
 * When there is genuinely not enough room the stack overflows the bottom rather
 * than reordering itself — an honest failure the caller can see and size for.
 */
export function spreadSlots(
  wanted: readonly number[],
  gap: number,
  min: number,
  max: number,
): number[] {
  const n = wanted.length;
  if (n === 0) return [];
  const out = [...wanted];
  out[0] = Math.max(min, out[0]!);
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i]!, out[i - 1]! + gap);
  // Ran off the bottom: walk the whole stack back up, then re-separate.
  for (let i = n - 1; i >= 0; i--) out[i] = Math.min(out[i]!, max - (n - 1 - i) * gap);
  out[0] = Math.max(min, out[0]!);
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i]!, out[i - 1]! + gap);
  return out;
}

/** How close a callout's text may come to the edge of the drawn viewBox. */
export const CALLOUT_EDGE_INSET = 6;

/**
 * Where each annotation sits, and where its leader runs. `box` is the node
 * field, in its own units; annotations are placed OUTSIDE it, at negative x on
 * the left and past `box.w` on the right, so the caller only has to widen the
 * viewBox by the margin it wants to give them.
 *
 * The one thing a margin annotation may never do is run off the picture. Text
 * anchored at the left margin grows LEFTWARDS from its anchor, so a name and a
 * score wider than the margin it was given used to slide out through the edge
 * of the viewBox and lose its first characters — "Aarav Menon · 0.29" printed
 * as "arav Menon · 0.29". Passing `margin` (the same number the caller widens
 * its viewBox by) and `fontSize` lets each label be clamped against its own
 * estimated width: an annotation is pulled back towards the field until its
 * whole text box fits, and its leader starts from wherever it ended up, so the
 * hairline stays attached to the name it belongs to.
 *
 * Without `margin` nothing is clamped, which is the old behaviour exactly.
 */
export function placeCallouts(
  targets: readonly CalloutTarget[],
  box: { w: number; h: number },
  opts: {
    gap?: number;
    inset?: number;
    haloPad?: number;
    /** Room the viewBox gives each margin. Omitted, no clamping happens. */
    margin?: number;
    /** The size the text is drawn at, for the width estimate. */
    fontSize?: number;
  } = {},
): Callout[] {
  const gap = opts.gap ?? 34;
  const inset = opts.inset ?? 12;
  const haloPad = opts.haloPad ?? HALO_PAD;
  const margin = opts.margin;
  const fontSize = opts.fontSize ?? 26;
  const out: Callout[] = [];

  for (const side of ['left', 'right'] as const) {
    const mine = targets
      .filter((t) => (t.x < box.w / 2 ? 'left' : 'right') === side)
      .sort((a, b) => a.y - b.y || a.no - b.no);
    if (mine.length === 0) continue;
    const slots = spreadSlots(mine.map((t) => t.y), gap, gap / 2, box.h - gap / 2);
    mine.forEach((t, i) => {
      const y = slots[i]!;
      const anchor = side === 'left' ? ('end' as const) : ('start' as const);
      let textX = side === 'left' ? -inset : box.w + inset;
      if (margin !== undefined && Number.isFinite(margin)) {
        // The estimated box this text will occupy, and the two edges of the
        // drawn viewBox it has to stay between.
        const w = textBox(t.text, textX, y, fontSize, anchor).w;
        const leftEdge = -margin + CALLOUT_EDGE_INSET;
        const rightEdge = box.w + margin - CALLOUT_EDGE_INSET;
        textX =
          side === 'left'
            ? Math.max(textX, leftEdge + w)
            : Math.min(textX, rightEdge - w);
      }
      const startX = side === 'left' ? textX + 3 : textX - 3;
      const dx = t.x - startX;
      const dy = t.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const stop = t.r + haloPad;
      out.push({
        no: t.no,
        side,
        x: textX,
        y,
        anchor,
        text: t.text,
        line: {
          x1: startX,
          y1: y,
          x2: t.x - (dx / d) * stop,
          y2: t.y - (dy / d) * stop,
        },
      });
    });
  }
  return out;
}

// ========================================================================
// The workspace tables
//
// Each of the nine insights now carries a detail band under its graph: the
// same finding, spelled out per person, for the reader who wants the row
// rather than the picture. These are the derivations behind those bands.
//
// They obey the same rule as everything above them: one lens, one threshold,
// one definition of a tie, computed once and shared. A table that counted its
// own ties would be a second opinion, and the whole page is built on there
// being only one.
// ========================================================================

/** One row of the anchors band: both standings, and whether they carry both. */
export interface AnchorRow {
  no: number;
  trustIn: number;
  powerIn: number;
  /** On the top-`limit` list under BOTH lenses — the names printed in bold. */
  onBoth: boolean;
}

/**
 * Everyone, with the two numbers the anchors tab ranks on. The ranked lists in
 * the sidebar are the top five of this; the band is the rest of the group,
 * which is the half of the finding a top-five cannot show — how far behind the
 * sixth person is, and whether the tail is flat or falls off a cliff.
 */
export function anchorTable(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  limit = 5,
): AnchorRow[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const t = degrees(nos, [...edges], 'trust', tieThreshold);
  const p = degrees(nos, [...edges], 'power_over', tieThreshold);
  const both = anchors(nos, edges, tieThreshold, limit).both;
  return nos
    .map((no) => ({
      no,
      trustIn: t.get(no)?.posIn ?? 0,
      powerIn: p.get(no)?.posIn ?? 0,
      onBoth: both.has(no),
    }))
    .sort((a, b) => b.trustIn - a.trustIn || b.powerIn - a.powerIn || a.no - b.no);
}

/** One row of the divergence band: a point, with the corner it landed in. */
export interface QuadrantRow extends DivergencePoint {
  quadrant: Quadrant;
}

/**
 * Every plotted person with their quadrant named, most notable first — the
 * same order the chart offers its labels in, so the band reads top-down as the
 * chart reads outward-in and the two never disagree about who matters.
 */
export function divergenceTable(
  points: readonly DivergencePoint[],
  m: Medians,
): QuadrantRow[] {
  return rankByDivergence(points, m).map((p) => ({ ...p, quadrant: quadrantOf(p, m) }));
}

/** One person's share of everything received under a lens, and the running total. */
export interface ShareRow {
  no: number;
  count: number;
  /** count / every tie received under this lens, 0..1. */
  share: number;
  /** This row's share plus every row above it, 0..1. */
  cumulative: number;
}

export interface ConcentrationTable {
  rows: ShareRow[];
  /** Every positive tie received under this lens, across the group. */
  total: number;
  /**
   * How few people it takes to hold half the ties. Zero when nothing has been
   * received yet — "nobody holds half of nothing" is not a finding about
   * concentration, and printing 1 there would be one.
   */
  halfCount: number;
}

/**
 * The concentration meter, spelled out per person.
 *
 * A Gini-style number says "held by a few hands" but never says how few, and
 * "how few" is the sentence a client repeats afterwards. The cumulative column
 * answers it directly: read down until the running total passes 50%, and the
 * number of rows you crossed is the answer.
 */
export function concentrationTable(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
): ConcentrationTable {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const d = degrees(nos, [...edges], lens, tieThreshold);
  const counts = nos.map((no) => ({ no, count: d.get(no)?.posIn ?? 0 }));
  const total = counts.reduce((s, c) => s + c.count, 0);
  const ordered = counts.sort((a, b) => b.count - a.count || a.no - b.no);
  let running = 0;
  let halfCount = 0;
  const rows: ShareRow[] = ordered.map((c, i) => {
    running += c.count;
    // Strictly above half, and only counted while somebody has actually been
    // chosen: a run of zeroes must never be credited with holding anything.
    if (halfCount === 0 && total > 0 && c.count > 0 && running * 2 >= total) halfCount = i + 1;
    return {
      no: c.no,
      count: c.count,
      share: total > 0 ? c.count / total : 0,
      cumulative: total > 0 ? running / total : 0,
    };
  });
  return { rows, total, halfCount };
}

/** One row of the trust-vs-power band: where a person stands on each side. */
export interface RankRow {
  no: number;
  trustRank: number;
  powerRank: number;
  trustCount: number;
  powerCount: number;
  /** |trustRank - powerRank|. Zero means the two sides agree about them. */
  delta: number;
}

/**
 * The whole group by standing, widest disagreement first.
 *
 * `rankDivergence` answers "who are the three to ring"; this answers "and
 * everyone else?". People whose two standings agree are kept rather than
 * filtered — on this band a delta of zero is a reading, not an absence, and a
 * table that dropped them would overstate how divided the group is.
 */
export function rankTable(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
): RankRow[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const t = degrees(nos, [...edges], 'trust', tieThreshold);
  const p = degrees(nos, [...edges], 'power_over', tieThreshold);
  const trustCounts = new Map(nos.map((no) => [no, t.get(no)?.posIn ?? 0]));
  const powerCounts = new Map(nos.map((no) => [no, p.get(no)?.posIn ?? 0]));
  const trustRanks = rankByCount(trustCounts);
  const powerRanks = rankByCount(powerCounts);
  return nos
    .map((no) => {
      const trustRank = trustRanks.get(no)!;
      const powerRank = powerRanks.get(no)!;
      return {
        no,
        trustRank,
        powerRank,
        trustCount: trustCounts.get(no)!,
        powerCount: powerCounts.get(no)!,
        delta: Math.abs(trustRank - powerRank),
      };
    })
    .sort(
      (a, b) =>
        b.delta - a.delta ||
        Math.min(a.trustRank, a.powerRank) - Math.min(b.trustRank, b.powerRank) ||
        a.no - b.no,
    );
}

/** One person under the two facets of trust, and the distance between them. */
export interface FacetRow {
  no: number;
  /** Positive ties received on "delivers as promised". */
  reliabilityIn: number;
  /** Positive ties received on "safe to be open". */
  opennessIn: number;
  /** reliabilityIn - opennessIn. Signed: the direction IS the intervention. */
  gap: number;
}

/**
 * The two facets, per person, widest gap first.
 *
 * The bars above say which way the GROUP leans; this says who the group leans
 * that way about. A signed gap rather than an absolute one, because the two
 * signs are two different conversations: depended on but not confided in is
 * not the same person-shaped problem as confided in but not depended on.
 */
export function facetTable(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  reliabilityLens = 'reliability',
  opennessLens = 'openness',
): FacetRow[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const r = degrees(nos, [...edges], reliabilityLens, tieThreshold);
  const o = degrees(nos, [...edges], opennessLens, tieThreshold);
  return nos
    .map((no) => {
      const reliabilityIn = r.get(no)?.posIn ?? 0;
      const opennessIn = o.get(no)?.posIn ?? 0;
      return { no, reliabilityIn, opennessIn, gap: reliabilityIn - opennessIn };
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.no - b.no);
}

/** One person inside the silos band: their group, and which way their ties run. */
export interface SilosMemberRow {
  no: number;
  /** The active mode's key. Null members are never returned. */
  group: string;
  /** Ties to or from someone in the same group. */
  withinTies: number;
  /** Ties to or from someone in a different group. */
  outTies: number;
}

/**
 * The cohesion table, one row per person instead of one row per group.
 *
 * A group rate says a function is inward-looking; it cannot say whether that is
 * everybody in it or two people carrying the whole number. Ungrouped members
 * are excluded here for the same reason `subgroupCohesion` excludes them: they
 * are not a subgroup, and a row that said they were would be read as one.
 */
export function silosMemberTable(
  nodes: readonly CohortRosterMember[],
  mode: SilosMode,
  ties: readonly DirectedTie[],
): SilosMemberRow[] {
  const groupOf = new Map<number, string>();
  for (const g of silosGroups(nodes, mode)) if (g.group !== null) groupOf.set(g.no, g.group);
  const within = new Map<number, number>();
  const out = new Map<number, number>();
  for (const t of ties) {
    if (t.from === t.to) continue;
    const a = groupOf.get(t.from);
    const b = groupOf.get(t.to);
    if (a === undefined || b === undefined) continue;
    const bucket = a === b ? within : out;
    bucket.set(t.from, (bucket.get(t.from) ?? 0) + 1);
    bucket.set(t.to, (bucket.get(t.to) ?? 0) + 1);
  }
  return [...groupOf.entries()]
    .map(([no, group]) => ({
      no,
      group,
      withinTies: within.get(no) ?? 0,
      outTies: out.get(no) ?? 0,
    }))
    .sort(
      (a, b) =>
        (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) ||
        b.withinTies - a.withinTies ||
        a.no - b.no,
    );
}

/**
 * The top `share` of the group by whatever they have been given — "the few
 * hands" the spread tab haloes.
 *
 * Rank-based, never a value cut: a cohort where the top three all hold four
 * ties has a top decile, and a threshold picked off the numbers would return
 * either nobody or everybody depending on the cohort. Zeroes never qualify —
 * an empty decile is the honest answer for a group nobody has chosen in.
 */
export function topDecile(counts: ReadonlyMap<number, number>, share = 0.1): Set<number> {
  const ranked = [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (ranked.length === 0) return new Set();
  const keep = Math.max(1, Math.ceil(ranked.length * Math.max(0, Math.min(1, share))));
  return new Set(ranked.slice(0, keep).map(([no]) => no));
}

/**
 * One-way ties, in the shape the map draws ties in.
 *
 * They are drawn as single arrows and never as a mutual pair, which is the
 * whole point of the tab: every wire on that map is a reach that was not
 * returned, so `mutual` is false by construction and the bend is the gentle
 * one a lone arc gets everywhere else on the page.
 */
export function oneWayPaneEdges(ties: readonly UnreciprocatedTie[]): PaneEdge[] {
  return ties.map((t) => ({
    key: `${t.a}>${t.b}`,
    from: t.a,
    to: t.b,
    mean: t.aToB,
    mutual: false,
    bend: 0.12,
  }));
}

/**
 * Everyone either end of a set of ties. What the one-way map may name: both
 * halves of an unreturned tie are the finding, and naming only the giver would
 * print half of every sentence.
 */
export function tieEndpoints(edges: readonly PaneEdge[]): Set<number> {
  const out = new Set<number>();
  for (const e of edges) {
    out.add(e.from);
    out.add(e.to);
  }
  return out;
}

/**
 * A fade map for a graph that is about a subset: the named people at full
 * strength, everyone else pushed back to `dim`.
 *
 * Emphasis, never a filter — the same rule the rest of the page runs on. The
 * faded majority stays on the map because "these four, out of these sixty" is
 * the finding, and a map that hid the sixty would be making a much weaker
 * claim at a much larger size.
 */
export function fadeExcept(lit: ReadonlySet<number>, dim: number): (no: number) => number {
  return (no) => (lit.size === 0 || lit.has(no) ? 1 : dim);
}

// ------------------------------------------------------------ insight scope

/**
 * The one filter the insights workspace accepts: which part of the roster the
 * nine questions are asked about. Empty sets mean "everyone" on that axis, so
 * the default scope is the whole cohort and the workspace reads exactly as it
 * did before scoping existed.
 */
export interface InsightScope {
  /** Function / department names, as written on the roster (trimmed). */
  funcs: ReadonlySet<string>;
  /** Tenure bands, as written on the roster. */
  tenures: ReadonlySet<string>;
  /**
   * With two or more departments chosen: read them side by side — each
   * department's territory drawn on the map and a per-department table at
   * the head of the readings — rather than as one merged group.
   */
  compare?: boolean;
}

export const EMPTY_SCOPE: InsightScope = { funcs: new Set(), tenures: new Set(), compare: false };

export function scopeIsWhole(scope: InsightScope): boolean {
  return scope.funcs.size === 0 && scope.tenures.size === 0;
}

export interface ScopeOption {
  key: string;
  label: string;
  /** Roster members carrying this value. */
  count: number;
}

/** What the roster can be scoped by: every distinct function and tenure band, with headcounts. */
export function scopeOptions(nodes: readonly CohortRosterMember[]): {
  funcs: ScopeOption[];
  tenures: ScopeOption[];
} {
  const funcCount = new Map<string, number>();
  const tenureCount = new Map<string, number>();
  for (const n of nodes) {
    const f = n.func.trim();
    if (f) funcCount.set(f, (funcCount.get(f) ?? 0) + 1);
    const t = (n.tenureBand ?? '').trim();
    if (t) tenureCount.set(t, (tenureCount.get(t) ?? 0) + 1);
  }
  const funcs = [...funcCount]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const bandOrder = new Map(TENURE_BANDS.map((b, i) => [b as string, i]));
  const tenures = [...tenureCount]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort(
      (a, b) =>
        (bandOrder.get(a.key) ?? TENURE_BANDS.length) - (bandOrder.get(b.key) ?? TENURE_BANDS.length) ||
        a.key.localeCompare(b.key),
    );
  return { funcs, tenures };
}

export function memberInScope(n: CohortRosterMember, scope: InsightScope): boolean {
  if (scope.funcs.size > 0 && !scope.funcs.has(n.func.trim())) return false;
  if (scope.tenures.size > 0 && !scope.tenures.has((n.tenureBand ?? '').trim())) return false;
  return true;
}

/**
 * The cohort cut down to the scope: the members who match, and only the ties
 * among them. An induced subgraph, deliberately — "most trusted in Sales"
 * means trusted by Sales, so every number on every tab has one reading
 * ("within the people shown") rather than a per-tab mix of inside and outside.
 * The unscoped cohort comes back untouched, same array identities and all, so
 * nothing downstream re-solves for a scope that changed nothing.
 */
export function applyScope(
  nodes: CohortRosterMember[],
  edges: CohortNetworkEdge[],
  scope: InsightScope,
): { nodes: CohortRosterMember[]; edges: CohortNetworkEdge[] } {
  if (scopeIsWhole(scope)) return { nodes, edges };
  const kept = nodes.filter((n) => memberInScope(n, scope));
  const nos = new Set(kept.map((n) => n.no));
  return { nodes: kept, edges: edges.filter((e) => nos.has(e.from) && nos.has(e.to)) };
}

/**
 * The engine's concentration, recomputed over a scope: coverage-normalised
 * tie rate per member (ties received under the lens over colleagues who rated
 * them under it), then `concentrationOfRates` — the engine's own formula,
 * imported rather than copied, because three hand-written copies of this is how
 * the report came to print two different numbers under one word. Members nobody in scope rated are left out, as the engine
 * leaves out members with no tie rate. Null below two rated members.
 */
export function scopedConcentration(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  lens: string,
  tieThreshold: number,
): number | null {
  const rated = new Map<number, number>();
  const ties = new Map<number, number>();
  for (const e of edges) {
    const b = e.blocks[lens];
    if (!b || b.n <= 0) continue;
    rated.set(e.to, (rated.get(e.to) ?? 0) + 1);
    if (b.mean >= tieThreshold) ties.set(e.to, (ties.get(e.to) ?? 0) + 1);
  }
  const rates: number[] = [];
  for (const no of memberNos) {
    const n = rated.get(no) ?? 0;
    if (n > 0) rates.push((ties.get(no) ?? 0) / n);
  }
  return concentrationOfRates(rates);
}

// ------------------------------------------------------------ head-to-head
//
// Comparing two people, and later a shortlist of them, against the same
// measures the rest of the page already reports. One module so a number can
// never read one way in a dossier and another in a comparison.

export interface PairMetric {
  key: string;
  label: string;
  /** For a column head, where the full label does not fit. */
  short: string;
  /**
   * Which way is the stronger standing. `none` is not a hedge: betweenness and
   * coverage are facts about the group's structure and about who answered, not
   * merits, and marking a winner on them would invent a judgement the
   * instrument does not make.
   */
  better: 'high' | 'low' | 'none';
  /** One line on what the measure means, in the room's language. */
  note: string;
  values: (number | null)[];
  texts: string[];
  /**
   * The formatter the texts were made with, so a difference between two of
   * them can be printed in the same units. Without it a comparison has to
   * guess whether 0.2 is two-tenths of a person or twenty per cent.
   */
  fmt: (v: number | null) => string;
}

/** Who leads a metric: the index, or null for a tie or an unjudgeable one. */
export function metricLeader(m: PairMetric): number | null {
  if (m.better === 'none') return null;
  let best: number | null = null;
  let bestVal: number | null = null;
  let tied = false;
  m.values.forEach((v, i) => {
    if (v === null) return;
    if (bestVal === null || (m.better === 'high' ? v > bestVal : v < bestVal)) {
      bestVal = v;
      best = i;
      tied = false;
    } else if (v === bestVal) {
      tied = true;
    }
  });
  return tied ? null : best;
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const int = (v: number | null) => (v === null ? '—' : String(Math.round(v)));
const two = (v: number | null) => (v === null ? '—' : v.toFixed(2));

/**
 * Every comparable standing for a set of people, in reading order.
 *
 * Takes the same inputs as the tables the rest of the page is built from, so
 * the comparison cannot drift from the dossier beside it.
 */
export function comparePeople(
  nos: readonly number[],
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  coverage?: ReadonlyMap<number, number>,
): PairMetric[] {
  const all = [...new Set(memberNos)].sort((a, b) => a - b);
  const list = [...edges];
  const trust = degrees([...all], list, 'trust', tieThreshold);
  const power = degrees([...all], list, 'power_over', tieThreshold);
  const rel = degrees([...all], list, 'reliability', tieThreshold);
  const open = degrees([...all], list, 'openness', tieThreshold);
  const covert = degrees([...all], list, 'covert_power', tieThreshold);
  const bridge = betweenness(
    all,
    list.filter((e) => edgePolarity(e, 'trust', tieThreshold) === 'positive').map((e) => ({ from: e.from, to: e.to })),
  );

  // Returned trust: of the ties this person gives, the share that come back.
  const returned = new Map<number, number | null>();
  for (const no of all) {
    const out = list.filter(
      (e) => e.from === no && edgePolarity(e, 'trust', tieThreshold) === 'positive',
    );
    if (out.length === 0) {
      returned.set(no, null);
      continue;
    }
    const back = out.filter((e) =>
      list.some((r) => r.from === e.to && r.to === no && edgePolarity(r, 'trust', tieThreshold) === 'positive'),
    );
    returned.set(no, back.length / out.length);
  }

  const pick = <T,>(f: (no: number) => T): T[] => nos.map(f);
  const metric = (
    key: string,
    label: string,
    short: string,
    better: PairMetric['better'],
    note: string,
    of: (no: number) => number | null,
    fmt: (v: number | null) => string,
  ): PairMetric => {
    const values = pick(of);
    return { key, label, short, better, note, values, texts: values.map(fmt), fmt };
  };

  return [
    metric('trustIn', 'Trust received', 'Trust in', 'high', 'Colleagues who put them over the line on trust.', (no) => trust.get(no)?.posIn ?? 0, int),
    metric('powerIn', 'Power over received', 'Power in', 'high', 'Colleagues who say they adjust to this person.', (no) => power.get(no)?.posIn ?? 0, int),
    metric('trustOut', 'Trust given', 'Given', 'none', 'How widely they extend trust themselves — a disposition, not a standing.', (no) => trust.get(no)?.posOut ?? 0, int),
    metric('returned', 'Trust returned', 'Returned', 'high', 'Of the trust they extend, the share that comes back.', (no) => returned.get(no) ?? null, pct),
    metric('bridge', 'Bridge score', 'Bridge', 'none', 'Shortest trust paths running through them. A structural fact, not a merit.', (no) => bridge.get(no) ?? 0, two),
    metric('reliability', 'Reliability', 'Reliable', 'high', 'Colleagues who say they deliver what they said they would.', (no) => rel.get(no)?.posIn ?? 0, int),
    metric('openness', 'Openness', 'Open', 'high', 'Colleagues who say they can tell this person what they actually think.', (no) => open.get(no)?.posIn ?? 0, int),
    metric('covert', 'Hidden power received', 'Hidden', 'none', 'Colleagues who say they shape issues before they reach the room. Influence, not merit.', (no) => covert.get(no)?.posIn ?? 0, int),
    metric('coverage', 'Rated by', 'Rated by', 'none', 'How many colleagues had a basis to judge. Context for every row above.', (no) => coverage?.get(no) ?? null, int),
  ];
}

/**
 * Where the group of them leads, said as a sentence.
 *
 * For more than two, naming every winner of every row is a list nobody reads,
 * so it names who leads the most measures and how many are genuinely level.
 */
export function shortlistVerdict(names: readonly string[], metrics: readonly PairMetric[]): string {
  if (names.length < 2) return '';
  if (names.length === 2) return pairVerdict(names, metrics);

  const judged = metrics.filter((m) => m.better !== 'none');
  const wins = new Map<number, number>();
  let level = 0;
  for (const m of judged) {
    const lead = metricLeader(m);
    if (lead === null) level += 1;
    else wins.set(lead, (wins.get(lead) ?? 0) + 1);
  }
  if (wins.size === 0) {
    return `These ${names.length} stand level on all ${judged.length} measures that can be led.`;
  }
  const ranked = [...wins.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0]!;
  const tiedAtTop = ranked.filter(([, n]) => n === top[1]).map(([i]) => names[i]!);
  const who =
    tiedAtTop.length === 1
      ? `${tiedAtTop[0]} leads on ${top[1]} of ${judged.length} measures`
      : `${tiedAtTop.slice(0, -1).join(', ')} and ${tiedAtTop.at(-1)} each lead on ${top[1]} of ${judged.length} measures`;
  return level > 0 ? `${who}; ${level} ${level === 1 ? 'is' : 'are'} level.` : `${who}.`;
}

/** Where each person leads, said as a sentence rather than left as a table. */
export function pairVerdict(names: readonly string[], metrics: readonly PairMetric[]): string {
  if (names.length !== 2) return '';
  const wins: string[][] = [[], []];
  for (const m of metrics) {
    const lead = metricLeader(m);
    if (lead !== null) wins[lead]!.push(m.label.toLowerCase());
  }
  const [a, b] = [wins[0]!, wins[1]!];
  if (a.length === 0 && b.length === 0) {
    return `${names[0]} and ${names[1]} stand level on every measure here.`;
  }
  const side = (who: string, list: string[]) =>
    list.length === 0 ? `${who} leads on none of them` : `${who} leads on ${list.join(', ')}`;
  return `${side(names[0]!, a)}; ${side(names[1]!, b)}.`;
}

// --------------------------------------------------- trust against power
//
// Standing as a share of the colleagues who could rate a person, never as a
// rank. Ranks here came from raw tie counts, and with most of a roster holding
// nought, one or two ties, sixty people collapsed onto three or four distinct
// ranks — so gaining a single tie moved somebody "36 places" and the table
// reported an artefact as a finding.

export interface DivergenceShare {
  no: number;
  /** Trust ties received ÷ colleagues who rated them. Null with no raters. */
  trust: number | null;
  power: number | null;
  /** power − trust, 2dp. Positive = deferred to more than relied on. */
  gap: number | null;
}

export function divergenceShares(
  memberNos: readonly number[],
  edges: readonly CohortNetworkEdge[],
  tieThreshold: number,
  coverage?: ReadonlyMap<number, number>,
): DivergenceShare[] {
  const nos = [...new Set(memberNos)].sort((a, b) => a - b);
  const list = [...edges];
  const t = degrees([...nos], list, 'trust', tieThreshold);
  const p = degrees([...nos], list, 'power_over', tieThreshold);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return nos.map((no) => {
    const raters = coverage?.get(no) ?? 0;
    if (raters <= 0) return { no, trust: null, power: null, gap: null };
    const trust = round2((t.get(no)?.posIn ?? 0) / raters);
    const power = round2((p.get(no)?.posIn ?? 0) / raters);
    return { no, trust, power, gap: round2(power - trust) };
  });
}

/** Gaps below this are noise in a group this size, and are drawn as level. */
export const DIVERGENCE_FLOOR = 0.08;

/**
 * A person's colour on the divergence map: warm where they are deferred to
 * more than relied on, cool where the reverse, neutral where the two agree.
 * Lightness carries the size of the gap, so the map reads at a glance and the
 * exact figure stays in the table.
 */
export function divergenceColor(gap: number | null): string {
  if (gap === null || Math.abs(gap) < DIVERGENCE_FLOOR) return '#B6BECA';
  const strength = Math.min(1, (Math.abs(gap) - DIVERGENCE_FLOOR) / (0.5 - DIVERGENCE_FLOOR));
  const ramp = gap > 0
    ? ['#E8B48A', '#D9832F', '#B4530E'] // toward power
    : ['#8FC9B4', '#33A177', '#0E7C5A']; // toward trust
  return ramp[strength > 0.66 ? 2 : strength > 0.33 ? 1 : 0]!;
}

/** How a gap reads in one phrase, for a tooltip or a row. */
export function divergenceWordFor(gap: number | null): string {
  if (gap === null) return 'Not rated';
  if (Math.abs(gap) < DIVERGENCE_FLOOR) return 'Trust and power agree';
  return gap > 0 ? 'Deferred to, less relied on' : 'Relied on, less say';
}

/** The sentence the map produced, from the same numbers the table shows. */
export function divergenceShareFinding(
  rows: readonly DivergenceShare[],
  nameOf: (no: number) => string,
): string {
  const rated = rows.filter((r) => r.gap !== null);
  if (rated.length === 0) return 'Nobody has been rated enough to compare the two standings.';
  const apart = rated.filter((r) => Math.abs(r.gap!) >= DIVERGENCE_FLOOR);
  if (apart.length === 0) {
    return 'Trust and power sit together across the group — the people relied on are the people deferred to.';
  }
  const worst = [...apart].sort((a, b) => Math.abs(b.gap!) - Math.abs(a.gap!))[0]!;
  const toPower = apart.filter((r) => r.gap! > 0).length;
  const toTrust = apart.length - toPower;
  const lead =
    worst.gap! > 0
      ? `${nameOf(worst.no)} is deferred to well beyond what the group relies on them for`
      : `${nameOf(worst.no)} is relied on well beyond the say they are given`;
  return `${lead} — ${apart.length} of ${rated.length} stand apart on the two, ${toPower} toward power and ${toTrust} toward trust.`;
}
