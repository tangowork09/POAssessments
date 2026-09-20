/**
 * The findings the Insights workspace draws, in a form a report can print.
 *
 * The screen recomputes these live from the network payload every time the
 * facilitator changes a filter. A report cannot: it is rendered from
 * `scores_json` months later, and that JSON carries aggregates rather than the
 * pair list the analyses need. So the findings are computed once, where the
 * responses still exist, and stored with the scores — already ranked, already
 * cut to the sizes a page can hold, so the renderer only lays out.
 *
 * Everything here is derived. Nothing in this module is the source of truth for
 * a number that also appears elsewhere in the report: the block densities,
 * authority-trust gaps and coverage lists stay where they were.
 */

import { SOCIO_BLOCKS, SOCIO_COVERT_POWER_ITEMS, SOCIO_ITEM_BY_NO } from './socio.js';
import { concentrationOfRates, socioEdges, type SocioEdge } from './socio-scoring.js';
import type { SocioMember, SocioResponseInput } from './socio-scoring.js';
import {
  betweenness,
  communities,
  subgroupCohesion,
  unreciprocatedTies,
  type DirectedTie,
  type SubgroupTieStats,
  type UnreciprocatedTie,
} from './socio-network.js';

/** How many rows each ranked finding keeps. A page, not a database dump. */
const TOP = 8;

export interface NamedScore {
  memberNo: number;
  name: string;
  func: string;
  value: number;
}

export interface SocioInsights {
  /** Whom the group relies on, and whom it answers to. */
  anchors: {
    trusted: NamedScore[];
    influential: NamedScore[];
    /** Present in both lists — the group's real centre of gravity. */
    both: string[];
  };
  /** Brokers: the share of shortest paths that run through each person. */
  bridges: NamedScore[];
  /** Label-propagation clusters over the trust network, largest first. */
  clusters: { size: number; members: string[] }[];
  /** Reaching out that is not returned, widest gap first. */
  unreturned: {
    from: string;
    to: string;
    kind: UnreciprocatedTie['kind'];
    gap: number | null;
  }[];
  /** How much of each function's connection stays inside it. */
  silos: SubgroupTieStats[];
  /** How evenly received trust is held, per block. */
  spread: { blockKey: string; name: string; concentration: number | null }[];
  /**
   * The two single-item lenses onto trust, side by side: whether the group is
   * relied on to deliver more than it is confided in, or the reverse.
   */
  reliabilityVsOpenness: {
    reliability: number | null;
    openness: number | null;
    gap: number | null;
    verdict: string;
  };
  /**
   * The covert half of power-over, read apart from the open half — the guide's
   * "hidden imbalance no structure chart reveals".
   *
   * `concentration` is over the covert statements alone; `overt` is the same
   * measure over the power-over band as a whole, so the two can be compared.
   * The statements behind it are named because "covert" is a strong word and
   * the reader is owed the wording it was read off.
   */
  covertPower: {
    statements: string[];
    ties: number;
    density: number | null;
    concentration: number | null;
    overtConcentration: number | null;
    holders: NamedScore[];
    verdict: string;
  };
}

/** Ties under one lens, as the network functions want them. */
function tiesFor(edges: readonly SocioEdge[], blockKey: string): DirectedTie[] {
  const out: DirectedTie[] = [];
  for (const e of edges) {
    if (e.blocks[blockKey]?.tie) out.push({ from: e.from, to: e.to });
  }
  return out;
}

/** Ordered-pair density under one lens: ties over pairs that were rated. */
function densityFor(edges: readonly SocioEdge[], blockKey: string): number | null {
  let rated = 0;
  let ties = 0;
  for (const e of edges) {
    const b = e.blocks[blockKey];
    if (!b) continue;
    rated += 1;
    if (b.tie) ties += 1;
  }
  return rated === 0 ? null : Math.round((ties / rated) * 100) / 100;
}

function rank(
  scores: Map<number, number>,
  nameOf: Map<number, { name: string; func: string }>,
  { min = 0 }: { min?: number } = {},
): NamedScore[] {
  return [...scores.entries()]
    .filter(([, v]) => v > min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([no, value]) => ({
      memberNo: no,
      name: nameOf.get(no)?.name ?? `#${no}`,
      func: nameOf.get(no)?.func ?? '',
      value: Math.round(value * 100) / 100,
    }));
}

/** In-degree under one lens: how many colleagues put this person over the line. */
function inDegree(ties: readonly DirectedTie[], nodes: readonly number[]): Map<number, number> {
  const out = new Map<number, number>(nodes.map((n) => [n, 0]));
  for (const t of ties) out.set(t.to, (out.get(t.to) ?? 0) + 1);
  return out;
}

export function socioInsights(
  members: readonly SocioMember[],
  responses: readonly SocioResponseInput[],
  opts: { tieThreshold: number },
): SocioInsights {
  const edges = socioEdges(responses, opts.tieThreshold);
  const nodes = members.map((m) => m.no);
  const nameOf = new Map(members.map((m) => [m.no, { name: m.name, func: m.func }]));

  const trustTies = tiesFor(edges, 'trust');
  const powerTies = tiesFor(edges, 'power_over');

  const trusted = rank(inDegree(trustTies, nodes), nameOf);
  const influential = rank(inDegree(powerTies, nodes), nameOf);
  const influentialNames = new Set(influential.map((m) => m.name));

  // Clusters are read off the trust network: the question is who holds
  // together, and power-over ties describe the chart rather than the group.
  const cluster = communities(nodes, trustTies);
  const byCluster = new Map<number, string[]>();
  for (const [no, id] of cluster) {
    const name = nameOf.get(no)?.name;
    if (!name) continue;
    const list = byCluster.get(id);
    if (list) list.push(name);
    else byCluster.set(id, [name]);
  }

  const unreturned = unreciprocatedTies(
    edges.map((e) => ({ from: e.from, to: e.to, mean: e.blocks.trust?.mean ?? null })),
    opts.tieThreshold,
  )
    .slice(0, TOP)
    .map((t) => ({
      from: nameOf.get(t.a)?.name ?? `#${t.a}`,
      to: nameOf.get(t.b)?.name ?? `#${t.b}`,
      kind: t.kind,
      gap: t.gap,
    }));

  const reliability = densityFor(edges, 'reliability');
  const openness = densityFor(edges, 'openness');
  const gap = reliability !== null && openness !== null
    ? Math.round((reliability - openness) * 100) / 100
    : null;

  return {
    anchors: {
      trusted,
      influential,
      both: trusted.filter((m) => influentialNames.has(m.name)).map((m) => m.name),
    },
    bridges: rank(betweenness(nodes, trustTies), nameOf, { min: 0 }),
    clusters: [...byCluster.values()]
      .map((names) => ({ size: names.length, members: names }))
      .sort((a, b) => b.size - a.size),
    unreturned,
    silos: subgroupCohesion(
      members.map((m) => ({ no: m.no, group: m.func || null })),
      trustTies,
    ),
    spread: SOCIO_BLOCKS.map((b) => ({
      blockKey: b.key,
      name: b.name,
      concentration: concentrationOf(edges, b.key, nodes),
    })),
    reliabilityVsOpenness: { reliability, openness, gap, verdict: verdictFor(gap) },
    covertPower: (() => {
      const covertTies = tiesFor(edges, COVERT_LENS);
      const concentration = concentrationOf(edges, COVERT_LENS, nodes);
      const overtConcentration = concentrationOf(edges, 'power_over', nodes);
      return {
        statements: SOCIO_COVERT_POWER_ITEMS.map((no) => SOCIO_ITEM_BY_NO[no]?.short ?? `Item ${no}`),
        ties: covertTies.length,
        density: densityFor(edges, COVERT_LENS),
        concentration,
        overtConcentration,
        holders: rank(inDegree(covertTies, nodes), nameOf),
        verdict: covertPowerVerdict(covertTies.length, concentration, overtConcentration),
      };
    })(),
  };
}

/**
 * How unevenly received ties are held under one lens, 0 (flat) to 1 (one
 * person holds every tie).
 *
 * This used to carry its own arithmetic — shortfall from the *mean*, over raw
 * in-degree counts — while the scored group result measured shortfall from the
 * *top*, over coverage-normalised tie rates. Both were printed under the word
 * "Concentration", in the same PDF, and disagreed: 0.43 here against 0.75
 * there on identical data. The formula now comes from the engine and the only
 * thing left in this file is turning edges into the rates it takes.
 *
 * Rates, not counts: a person eight colleagues could rate and one only two
 * colleagues could rate are not comparable on a count, and the lens denominator
 * is the pairs that answered *this* lens.
 */
function concentrationOf(
  edges: readonly SocioEdge[],
  blockKey: string,
  nodes: readonly number[],
): number | null {
  const rated = new Map<number, number>();
  const ties = new Map<number, number>();
  for (const e of edges) {
    const b = e.blocks[blockKey];
    if (!b || b.n <= 0) continue;
    rated.set(e.to, (rated.get(e.to) ?? 0) + 1);
    if (b.tie) ties.set(e.to, (ties.get(e.to) ?? 0) + 1);
  }
  const rates: number[] = [];
  for (const no of nodes) {
    const n = rated.get(no) ?? 0;
    if (n > 0) rates.push((ties.get(no) ?? 0) / n);
  }
  return concentrationOfRates(rates);
}

/** How many covert-power ties each person received, ranked. */
const COVERT_LENS = 'covert_power';

/**
 * The guide's §5.4 warning, as a sentence.
 *
 * Concentrated power is not by itself a fault — a group can reasonably route
 * authority through a few people. The finding is concentration in the half of
 * power that no structure chart shows, which is why the covert figure is read
 * against the power-over band as a whole rather than against a fixed line.
 */
export function covertPowerVerdict(ties: number, covert: number | null, overt: number | null): string {
  if (ties === 0 || covert === null) {
    return 'Nobody in this group was put over the line on the covert statements, so there is no hidden concentration to read.';
  }
  const held = covert >= 0.5;
  if (overt !== null && covert >= overt + 0.1) {
    return held
      ? 'Agenda-setting and pre-wiring are held by markedly fewer people than open decision rights are. This is the imbalance the guide warns about: the half of power no structure chart shows is the more concentrated half.'
      : 'Covert power sits in fewer hands than open power does. The gap is not yet wide, but it is pointing the wrong way — watch who is shaping issues before they reach the room.';
  }
  if (held) {
    return 'Covert power is concentrated, but open decision rights are concentrated to a similar degree: influence in this group runs through a few people whichever way it is measured, rather than hiding in the informal half.';
  }
  return 'Shaping issues before they reach the room is spread across the group rather than held by a few. No hidden imbalance on this reading.';
}

/** Said as a sentence, because a gap of 0.18 is not a finding on its own. */
function verdictFor(gap: number | null): string {
  if (gap === null) return 'Not enough was answered on both statements to compare them.';
  if (gap >= 0.15) {
    return 'The group is relied on to deliver more readily than it is confided in — competence is established, candour lags it.';
  }
  if (gap <= -0.15) {
    return 'The group confides more readily than it relies — the relationships are warmer than the track record.';
  }
  return 'Reliability and openness sit close together: the group trusts what people will do and what they will say about equally.';
}
