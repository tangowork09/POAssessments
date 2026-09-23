/**
 * The dashboard's own derivations — everything the network card computes
 * before it draws anything. The card itself is React and is not tested here;
 * these functions are the reason it can be trusted, so they live in model.ts
 * and are exercised on plain data.
 *
 * The rule under test throughout: a tie is whatever `edgePolarity` says it is
 * under the active lens and threshold, once, for the map and for every panel.
 */

import { describe, expect, it } from 'vitest';
import {
  anchorTable,
  anchors,
  blockConcentration,
  buildPaneEdges,
  CATEGORICAL_COLORS,
  clusterHulls,
  clusterView,
  convexHull,
  expandHull,
  HALO_PAD,
  MATRIX_CAP,
  placeCallouts,
  rankByCount,
  rankDivergence,
  rankDivergenceLabel,
  roundedHullPath,
  spreadSlots,
  tieMatrix,
  topDecile,
  boxesOverlap,
  concentrationReading,
  concentrationTable,
  cullLabels,
  divergenceMedians,
  divergencePoints,
  divergenceTable,
  facetTable,
  fadeExcept,
  joinNames,
  lensDensity,
  lensPairs,
  medianOf,
  MUTED_GREY,
  oneWayPaneEdges,
  orderSilos,
  orderTiesByFocus,
  outerLabels,
  peripheralMembers,
  quadrantOf,
  rankTable,
  rankByDivergence,
  textBox,
  tieEndpoints,
  topPaneLabels,
  trustPowerOverlapSentence,
  watchLists,
  type DivergencePoint,
  type LabelBox,
  type Pt,
  paneInDegree,
  paneNeighbours,
  positiveTies,
  relOpenVerdict,
  silosGroups,
  silosLabel,
  silosModes,
  silosMemberTable,
  silosVerdict,
  tieOpacity,
  tiePath,
  tieWidth,
  topBridges,
  topPositiveIn,
  unionTies,
} from '../web/src/admin/network/model.js';
import {
  betweenness,
  subgroupCohesion,
  unreciprocatedTies,
  type SubgroupTieStats,
} from '../src/shared/socio-network.js';
import type { CohortNetworkEdge, CohortRosterMember } from '../src/shared/types.js';

/** An edge carrying a per-lens mean for each block key named. */
function edge(from: number, to: number, blocks: Record<string, number>, overall = 3): CohortNetworkEdge {
  return {
    from,
    to,
    n: 11,
    mean: overall,
    blocks: Object.fromEntries(
      Object.entries(blocks).map(([k, mean]) => [k, { mean, n: 2, tie: mean >= 4 }]),
    ),
    gap: null,
  };
}

describe('positiveTies', () => {
  it('keeps only the ties the map would draw as positive', () => {
    const edges = [
      edge(1, 2, { trust: 4.5 }),
      edge(2, 1, { trust: 3.0 }), // neutral — not a tie
      edge(3, 1, { trust: 1.5 }), // cool — a tie, but not a positive one
    ];
    expect(positiveTies(edges, 'trust', 4)).toEqual([{ from: 1, to: 2 }]);
  });

  it('reads the two single-item trust lenses like any other block', () => {
    const edges = [edge(1, 2, { trust: 3, reliability: 5, openness: 2 })];
    expect(positiveTies(edges, 'reliability', 4)).toEqual([{ from: 1, to: 2 }]);
    expect(positiveTies(edges, 'openness', 4)).toEqual([]);
  });

  it('moves with the threshold, so every panel moves with it too', () => {
    const edges = [edge(1, 2, { trust: 3.5 })];
    expect(positiveTies(edges, 'trust', 4)).toHaveLength(0);
    expect(positiveTies(edges, 'trust', 3.5)).toHaveLength(1);
  });
});

describe('lensPairs into unreciprocatedTies', () => {
  const edges = [
    edge(1, 2, { trust: 4.5 }),
    edge(2, 1, { trust: 2.0 }), // rated back, below the line
    edge(1, 3, { trust: 5.0 }), // 3 never rated 1
    edge(4, 5, { trust: 4.2 }),
    edge(5, 4, { trust: 4.4 }), // reciprocated
    edge(6, 7, { power_over: 4.8 }), // nothing under the trust lens at all
  ];

  it('carries a null mean where the lens has no rating', () => {
    const pairs = lensPairs(edges, 'trust');
    expect(pairs.find((p) => p.from === 6)).toEqual({ from: 6, to: 7, mean: null });
  });

  it('separates a tie rated back too low from one never rated back', () => {
    const out = unreciprocatedTies(lensPairs(edges, 'trust'), 4);
    expect(out.map((t) => [t.a, t.b, t.kind])).toEqual([
      [1, 2, 'not_returned'],
      [1, 3, 'no_basis'],
    ]);
    expect(out[0]!.bToA).toBe(2);
    expect(out[0]!.gap).toBe(2.5);
    expect(out[1]!.bToA).toBeNull();
  });

  it('never lists a mutual pair', () => {
    const out = unreciprocatedTies(lensPairs(edges, 'trust'), 4);
    expect(out.some((t) => t.a === 4 || t.a === 5)).toBe(false);
  });
});

describe('topBridges', () => {
  it('ranks by score, drops the zeroes and scales the bar to the top', () => {
    const scores = new Map([
      [1, 0],
      [2, 0.4],
      [3, 0.8],
      [4, 0.1],
    ]);
    const out = topBridges(scores, 5);
    expect(out.map((b) => b.no)).toEqual([3, 2, 4]);
    expect(out[0]!.share).toBe(1);
    expect(out[1]!.share).toBeCloseTo(0.5, 6);
  });

  it('honours the limit and returns nothing when nobody bridges', () => {
    expect(topBridges(new Map([[1, 0]]))).toEqual([]);
    expect(topBridges(new Map([[1, 0.3], [2, 0.2], [3, 0.1]]), 2)).toHaveLength(2);
  });

  it('reads the betweenness of the positive-tie graph the map draws', () => {
    // 1 → 2 → 3 under trust: 2 is the only in-between person.
    const edges = [edge(1, 2, { trust: 5 }), edge(2, 3, { trust: 5 })];
    const scores = betweenness([1, 2, 3], positiveTies(edges, 'trust', 4));
    expect(topBridges(scores).map((b) => b.no)).toEqual([2]);
  });
});

describe('anchors', () => {
  const edges = [
    // 1 is trusted by three people; 2 by one.
    edge(3, 1, { trust: 5 }),
    edge(4, 1, { trust: 4.2 }),
    edge(5, 1, { trust: 4.1 }),
    edge(3, 2, { trust: 4.5 }),
    // 1 also drives decisions; 6 more so.
    edge(3, 6, { power_over: 5 }),
    edge(4, 6, { power_over: 5 }),
    edge(5, 1, { power_over: 4.5 }),
  ];

  it('reads each list under its own lens and marks the overlap', () => {
    const a = anchors([1, 2, 3, 4, 5, 6], edges, 4);
    expect(a.trusted.map((x) => x.no)).toEqual([1, 2]);
    expect(a.trusted[0]!.count).toBe(3);
    expect(a.influential.map((x) => x.no)).toEqual([6, 1]);
    expect([...a.both]).toEqual([1]);
  });

  it('is empty rather than zero-filled when nobody clears the line', () => {
    const a = anchors([1, 2], [edge(1, 2, { trust: 2 })], 4);
    expect(a.trusted).toEqual([]);
    expect(a.influential).toEqual([]);
    expect(a.both.size).toBe(0);
  });

  it('caps each list and breaks ties by roster order', () => {
    const flat = [2, 3, 4, 5].map((from) => edge(from, 1, { trust: 5 }));
    flat.push(edge(2, 3, { trust: 5 }), edge(4, 5, { trust: 5 }), edge(5, 4, { trust: 5 }));
    const a = anchors([1, 2, 3, 4, 5], flat, 4, 3);
    expect(a.trusted).toHaveLength(3);
    expect(a.trusted[0]!.no).toBe(1);
    // 3, 4 and 5 all hold one tie; the lower roster number wins.
    expect(a.trusted.slice(1).map((x) => x.no)).toEqual([3, 4]);
  });
});

describe('topPositiveIn', () => {
  it('counts positive ties received under the given lens only', () => {
    const edges = [edge(2, 1, { trust: 5, power_over: 1 }), edge(3, 1, { trust: 5, power_over: 1 })];
    expect(topPositiveIn([1, 2, 3], edges, 'trust', 4)).toEqual([{ no: 1, count: 2 }]);
    expect(topPositiveIn([1, 2, 3], edges, 'power_over', 4)).toEqual([]);
  });
});

describe('clusterView', () => {
  it('colours real clusters in size order and collapses the lone people', () => {
    const comm = new Map([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 1],
      [5, 1],
      [6, 2], // alone
      [7, 3], // alone
    ]);
    const { entries, fillByNo } = clusterView(comm);
    expect(entries.map((e) => [e.label, e.size])).toEqual([
      ['Cluster 1', 3],
      ['Cluster 2', 2],
      ['Unclustered', 2],
    ]);
    expect(entries[0]!.fill).toBe(CATEGORICAL_COLORS[0]);
    expect(entries[1]!.fill).toBe(CATEGORICAL_COLORS[1]);
    expect(entries[2]!.fill).toBe(MUTED_GREY);
    expect(fillByNo.get(1)).toBe(CATEGORICAL_COLORS[0]);
    expect(fillByNo.get(3)).toBe(CATEGORICAL_COLORS[0]);
    expect(fillByNo.get(4)).toBe(CATEGORICAL_COLORS[1]);
    // Every lone person shares the one muted grey.
    expect(fillByNo.get(6)).toBe(MUTED_GREY);
    expect(fillByNo.get(7)).toBe(MUTED_GREY);
  });

  it('has no legend at all for an empty graph, and no Unclustered row when none are alone', () => {
    expect(clusterView(new Map()).entries).toEqual([]);
    const { entries } = clusterView(new Map([[1, 0], [2, 0]]));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.singleton).toBe(false);
  });
});

describe('compare panes', () => {
  const edges = [
    edge(1, 2, { trust: 4.5, power_over: 2 }),
    edge(2, 1, { trust: 4.1, power_over: 1 }),
    edge(3, 1, { trust: 4.9, power_over: 4.5 }),
    edge(9, 1, { trust: 5, power_over: 5 }), // 9 is filtered off the map
  ];
  const visible = new Set([1, 2, 3]);

  it('draws each pane from its own lens, over the same visible people', () => {
    const trust = buildPaneEdges(edges, 'trust', 4, visible);
    const power = buildPaneEdges(edges, 'power_over', 4, visible);
    expect(trust.map((e) => e.key).sort()).toEqual(['1>2', '2>1', '3>1']);
    expect(power.map((e) => e.key)).toEqual(['3>1']);
    expect(trust.every((e) => e.from !== 9 && e.to !== 9)).toBe(true);
  });

  it('marks a pair mutual only when both directions survive in that pane', () => {
    const trust = buildPaneEdges(edges, 'trust', 4, visible);
    expect(trust.find((e) => e.key === '1>2')!.mutual).toBe(true);
    expect(trust.find((e) => e.key === '2>1')!.mutual).toBe(true);
    // The two arcs of a mutual pair bend opposite ways, so they never overlap.
    expect(trust.find((e) => e.key === '1>2')!.bend).toBeGreaterThan(0);
    expect(trust.find((e) => e.key === '2>1')!.bend).toBeLessThan(0);
    expect(trust.find((e) => e.key === '3>1')!.mutual).toBe(false);
  });

  it('sizes each pane by its own ties received', () => {
    expect(paneInDegree(buildPaneEdges(edges, 'trust', 4, visible)).get(1)).toBe(2);
    expect(paneInDegree(buildPaneEdges(edges, 'power_over', 4, visible)).get(1)).toBe(1);
    expect(paneInDegree(buildPaneEdges(edges, 'power_over', 4, visible)).get(2)).toBeUndefined();
  });

  it("lights the same person's neighbours pane by pane", () => {
    const trust = buildPaneEdges(edges, 'trust', 4, visible);
    const power = buildPaneEdges(edges, 'power_over', 4, visible);
    expect([...paneNeighbours(trust, 1)].sort()).toEqual([2, 3]);
    expect([...paneNeighbours(power, 1)]).toEqual([3]);
  });

  it('lays out on the union of the two lenses, each tie once', () => {
    const union = unionTies(edges, ['trust', 'power_over'], 4);
    expect(union.map((t) => `${t.from}>${t.to}`).sort()).toEqual(['1>2', '2>1', '3>1', '9>1']);
  });
});

describe('tie drawing', () => {
  it('starts at the source rim and stops short of the target for the arrowhead', () => {
    const path = tiePath({ sx: 0, sy: 0, sr: 10, tx: 100, ty: 0, tr: 20, mutual: false, bend: 0 });
    const [startX, startY, , , endX] = path.replace(/[MQ]/g, ' ').trim().split(/\s+/);
    expect(Number(startX)).toBeCloseTo(10, 6);
    expect(Number(startY)).toBeCloseTo(0, 6);
    expect(Number(endX)).toBeCloseTo(75, 6); // 100 - (20 + 5)
  });

  it('separates the two arcs of a mutual pair', () => {
    const g = { sx: 0, sy: 0, sr: 10, tx: 100, ty: 0, tr: 10, bend: 0.28, mutual: true } as const;
    const a = tiePath(g);
    const b = tiePath({ ...g, bend: -0.28 });
    expect(a).not.toBe(b);
  });

  it('draws a stronger rating heavier, and a pending assignment hairline', () => {
    expect(tieWidth('positive', 5, false)).toBeGreaterThan(tieWidth('positive', 4, false));
    expect(tieWidth('positive', 5, true)).toBeGreaterThan(tieWidth('positive', 5, false));
    expect(tieWidth('positive', 5, false, true)).toBe(1);
  });

  it('dims before anything else, and lifts a focused tie above the baseline', () => {
    expect(tieOpacity('positive', { dimmed: true, focused: true })).toBe(0.04);
    expect(tieOpacity('positive', { dimmed: false, focused: true })).toBe(0.9);
    expect(tieOpacity('neutral', { dimmed: false, focused: false })).toBeLessThan(
      tieOpacity('positive', { dimmed: false, focused: false }),
    );
  });
});

describe('silosVerdict', () => {
  const row = (over: Partial<SubgroupTieStats>): SubgroupTieStats => ({
    key: 'Ops',
    size: 4,
    withinTies: 6,
    withinPossible: 12,
    outTies: 2,
    outPossible: 20,
    withinRate: 0.5,
    outRate: 0.1,
    suppressed: false,
    ...over,
  });

  it('speaks when a function keeps its trust at twice the rate it sends it out', () => {
    expect(silosVerdict([row({})])).toBe(true);
    expect(silosVerdict([row({ withinRate: 0.2, outRate: 0.18 })])).toBe(false);
  });

  it('is never tripped by a suppressed group, which has no rates to compare', () => {
    expect(silosVerdict([row({ suppressed: true, withinRate: null, outRate: null })])).toBe(false);
  });

  it('reads real cohesion output', () => {
    const members = [
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: 'Ops' },
      { no: 4, group: 'Sales' },
      { no: 5, group: 'Sales' },
      { no: 6, group: 'Sales' },
    ];
    const edges = [
      edge(1, 2, { trust: 5 }),
      edge(2, 3, { trust: 5 }),
      edge(3, 1, { trust: 5 }),
      edge(4, 5, { trust: 5 }),
      edge(5, 6, { trust: 5 }),
      edge(1, 4, { trust: 2 }), // cool — not a tie, so nothing crosses
    ];
    const stats = subgroupCohesion(members, positiveTies(edges, 'trust', 4));
    expect(stats.map((s) => s.key).sort()).toEqual(['Ops', 'Sales']);
    expect(stats.every((s) => s.outTies === 0)).toBe(true);
    expect(silosVerdict(stats)).toBe(true);
  });
});

// -------------------------------------------------- the silos grouping cuts

/** A roster row carrying only what the grouping functions read. */
function member(
  no: number,
  over: Partial<CohortRosterMember> = {},
): CohortRosterMember {
  return { memberId: `m${no}`, no, name: `P${no}`, func: '', ...over };
}

describe('silosGroups', () => {
  const roster = [
    member(1, { func: 'Ops', tenureBand: '7y+', reportsTo: null }),
    member(2, { func: 'Ops', tenureBand: '<1y', reportsTo: 1 }),
    member(3, { func: ' ', tenureBand: null, reportsTo: 1 }),
    member(4, { func: 'Sales', tenureBand: '1-3y' }),
  ];

  it('keys on the function, and excludes a blank one', () => {
    expect(silosGroups(roster, 'function')).toEqual([
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: null },
      { no: 4, group: 'Sales' },
    ]);
  });

  it('keys on the tenure band, and excludes an unrecorded one', () => {
    expect(silosGroups(roster, 'tenure')).toEqual([
      { no: 1, group: '7y+' },
      { no: 2, group: '<1y' },
      { no: 3, group: null },
      { no: 4, group: '1-3y' },
    ]);
  });

  it('keys a team on the manager position, and excludes people with no manager', () => {
    // 1 reports to nobody (null); 4 has no reportsTo at all (absent).
    expect(silosGroups(roster, 'team')).toEqual([
      { no: 1, group: null },
      { no: 2, group: '1' },
      { no: 3, group: '1' },
      { no: 4, group: null },
    ]);
  });

  it('is the shape subgroupCohesion reads, and its nulls are exclusions', () => {
    const ties = positiveTies([edge(2, 3, { trust: 5 }), edge(3, 2, { trust: 5 })], 'trust', 4);
    const stats = subgroupCohesion(silosGroups(roster, 'team'), ties, 2);
    expect(stats.map((s) => s.key)).toEqual(['1']);
    expect(stats[0]!.size).toBe(2);
    expect(stats[0]!.withinTies).toBe(2);
  });
});

describe('silosLabel', () => {
  const roster = [
    member(1, { name: 'Asha', func: 'Ops' }),
    member(2, { name: 'Bo', func: 'Ops', reportsTo: 1 }),
  ];

  it('leaves a function or tenure key as its own label', () => {
    expect(silosLabel(roster, 'function')('Ops')).toBe('Ops');
    expect(silosLabel(roster, 'tenure')('<1y')).toBe('<1y');
  });

  it('resolves a team key to the manager on the roster', () => {
    expect(silosLabel(roster, 'team')('1')).toBe('Team of Asha');
  });

  it('still names a team whose manager has left the roster', () => {
    expect(silosLabel(roster, 'team')('9')).toBe('Team of position 9 (left roster)');
  });
});

describe('silosModes', () => {
  it('offers only the cuts this roster carries data for', () => {
    expect(silosModes([member(1, { func: 'Ops' })])).toEqual(['function']);
    expect(silosModes([member(1, { tenureBand: '<1y' })])).toEqual(['function', 'tenure']);
    expect(silosModes([member(1, { reportsTo: 2 })])).toEqual(['function', 'team']);
    expect(
      silosModes([member(1, { tenureBand: null, reportsTo: null }), member(2, { tenureBand: ' ' })]),
    ).toEqual(['function']);
    expect(silosModes([member(1, { tenureBand: '7y+', reportsTo: 2 })])).toEqual([
      'function',
      'tenure',
      'team',
    ]);
  });
});

describe('orderSilos', () => {
  const row = (key: string, size: number): SubgroupTieStats => ({
    key,
    size,
    withinTies: 0,
    withinPossible: size * (size - 1),
    outTies: 0,
    outPossible: 0,
    withinRate: 0,
    outRate: 0,
    suppressed: false,
  });

  it('reads tenure rows in band order, never in size order', () => {
    const stats = [row('7y+', 9), row('<1y', 2), row('3-7y', 5)];
    expect(orderSilos(stats, 'tenure').map((s) => s.key)).toEqual(['<1y', '3-7y', '7y+']);
  });

  it('parks a band that is not in the list at the end, alphabetically', () => {
    const stats = [row('legacy', 4), row('7y+', 1), row('<1y', 1), row('archived', 1)];
    expect(orderSilos(stats, 'tenure').map((s) => s.key)).toEqual([
      '<1y',
      '7y+',
      'archived',
      'legacy',
    ]);
  });

  it('leaves function and team rows in the size order cohesion gave them', () => {
    const stats = [row('Ops', 9), row('Sales', 2)];
    expect(orderSilos(stats, 'function').map((s) => s.key)).toEqual(['Ops', 'Sales']);
    expect(orderSilos(stats, 'team').map((s) => s.key)).toEqual(['Ops', 'Sales']);
  });
});

// ------------------------------------------------- reliability vs openness

describe('lensDensity', () => {
  const edges = [
    edge(1, 2, { reliability: 5, openness: 2 }),
    edge(2, 1, { reliability: 4, openness: 5 }),
    edge(3, 1, { reliability: 3 }), // rated on reliability only
    edge(4, 5, { trust: 5 }), // neither facet rated at all
  ];

  it('counts positive ties over the pairs that lens was rated on', () => {
    expect(lensDensity(edges, 'reliability', 4)).toEqual({
      ties: 2,
      ratedPairs: 3,
      density: 0.67,
    });
    expect(lensDensity(edges, 'openness', 4)).toEqual({ ties: 1, ratedPairs: 2, density: 0.5 });
  });

  it('is null rather than zero when nobody was rated under that lens', () => {
    expect(lensDensity([edge(1, 2, { trust: 5 })], 'openness', 4)).toEqual({
      ties: 0,
      ratedPairs: 0,
      density: null,
    });
  });

  it('is zero, not null, when the pairs were rated and none reached the line', () => {
    expect(lensDensity([edge(1, 2, { openness: 2 })], 'openness', 4)).toEqual({
      ties: 0,
      ratedPairs: 1,
      density: 0,
    });
  });

  it('moves with the threshold, like every other reading on the card', () => {
    expect(lensDensity(edges, 'reliability', 3).density).toBe(1);
    expect(lensDensity(edges, 'reliability', 5).density).toBe(0.33);
    // The denominator is what was rated, so the threshold never moves it.
    expect(lensDensity(edges, 'reliability', 5).ratedPairs).toBe(3);
  });

  it('reads the same positive definition the map draws', () => {
    expect(lensDensity(edges, 'reliability', 4).ties).toBe(
      positiveTies(edges, 'reliability', 4).length,
    );
  });
});

describe('relOpenVerdict', () => {
  it('says nothing at all when neither facet has been rated', () => {
    expect(relOpenVerdict(null, null)).toBeNull();
  });

  it('names psychological safety when reliability runs clear of openness', () => {
    expect(relOpenVerdict(0.6, 0.4)).toBe(
      "The group delivers for one another but is guarded — people don't yet feel safe being wrong. That points at psychological safety, not accountability.",
    );
    // Exactly on the line still counts.
    expect(relOpenVerdict(0.55, 0.4)).toMatch(/psychological safety/);
  });

  it('names accountability when openness runs clear of reliability', () => {
    expect(relOpenVerdict(0.4, 0.6)).toBe(
      'People feel safe with one another but delivery trust lags — the work is accountability and follow-through, not safety.',
    );
    expect(relOpenVerdict(0.4, 0.55)).toMatch(/accountability and follow-through/);
  });

  it('says they travel together when neither side is clear of the other', () => {
    expect(relOpenVerdict(0.5, 0.5)).toBe(
      'Reliability and openness travel together in this group.',
    );
    expect(relOpenVerdict(0.5, 0.36)).toBe(
      'Reliability and openness travel together in this group.',
    );
    expect(relOpenVerdict(0, 0)).toBe('Reliability and openness travel together in this group.');
  });

  it('withholds the sentence when only one side has a number', () => {
    expect(relOpenVerdict(0.8, null)).toBeNull();
    expect(relOpenVerdict(null, 0.8)).toBeNull();
  });
});

// ------------------------------------------- the Insights page's derivations
//
// Everything the debrief page claims, tested on plain data. The page itself is
// React and is not tested here; these are the reason its nine cards can be put
// in front of a client.

describe('divergencePoints', () => {
  const edges = [
    edge(2, 1, { trust: 5, power_over: 5 }),
    edge(3, 1, { trust: 5 }),
    edge(4, 1, { trust: 5 }),
    edge(1, 2, { power_over: 5 }),
    edge(3, 2, { power_over: 5 }),
  ];
  const nos = [1, 2, 3, 4];

  it('plots raw counts when no coverage is available', () => {
    const pts = divergencePoints(nos, edges, 4);
    expect(pts.map((p) => [p.no, p.trust, p.power])).toEqual([
      [1, 3, 1],
      [2, 0, 2],
      [3, 0, 0],
      [4, 0, 0],
    ]);
    expect(pts.every((p) => p.normalised === false)).toBe(true);
    // The raw counts survive the normalisation branch either way — a tooltip
    // has to be able to say "three colleagues", not "one point oh".
    expect(pts[0]!.trustCount).toBe(3);
    expect(pts[0]!.powerCount).toBe(1);
  });

  it('divides by the raters who actually rated that person when coverage is known', () => {
    const coverage = new Map([
      [1, 3],
      [2, 2],
      [3, 1],
      [4, 0],
    ]);
    const pts = divergencePoints(nos, edges, 4, coverage);
    expect(pts.every((p) => p.normalised)).toBe(true);
    expect(pts[0]!.trust).toBe(1); // 3 ties from 3 raters
    expect(pts[0]!.power).toBeCloseTo(1 / 3, 6);
    expect(pts[1]!.power).toBe(1); // 2 ties from 2 raters
    // Nobody rated 4, so 4 sits at the origin rather than dividing by zero.
    expect(pts[3]!.trust).toBe(0);
    expect(pts[3]!.power).toBe(0);
  });

  it('falls back to raw counts when the coverage map says nothing', () => {
    const pts = divergencePoints(nos, edges, 4, new Map([[1, 0], [2, 0]]));
    expect(pts[0]!.normalised).toBe(false);
    expect(pts[0]!.trust).toBe(3);
  });

  it('moves with the threshold like every other reading', () => {
    const weak = [edge(2, 1, { trust: 3.5 })];
    expect(divergencePoints([1, 2], weak, 4)[0]!.trust).toBe(0);
    expect(divergencePoints([1, 2], weak, 3.5)[0]!.trust).toBe(1);
  });
});

describe('medianOf and divergenceMedians', () => {
  it('takes the middle value, or the mean of the two middles', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([5])).toBe(5);
  });

  it('is zero for an empty group rather than NaN', () => {
    expect(medianOf([])).toBe(0);
  });

  it('reads each axis on its own', () => {
    const pts = divergencePoints([1, 2, 3], [edge(2, 1, { trust: 5, power_over: 5 })], 4);
    expect(divergenceMedians(pts)).toEqual({ trust: 0, power: 0 });
  });
});

/** A point on the plane, without going through the edge maths. */
function point(no: number, trust: number, power: number): DivergencePoint {
  return { no, trust, power, trustCount: trust, powerCount: power, normalised: false };
}

describe('quadrantOf', () => {
  const m = { trust: 2, power: 2 };

  it('names each corner for what it means', () => {
    expect(quadrantOf(point(1, 3, 3), m)).toBe('anchor');
    expect(quadrantOf(point(2, 1, 3), m)).toBe('watch');
    expect(quadrantOf(point(3, 3, 1), m)).toBe('underused');
    expect(quadrantOf(point(4, 1, 1), m)).toBe('peripheral');
  });

  it('counts a person sitting exactly on a median as the higher side of it', () => {
    expect(quadrantOf(point(5, 2, 2), m)).toBe('anchor');
    expect(quadrantOf(point(6, 2, 1), m)).toBe('underused');
    expect(quadrantOf(point(7, 1, 2), m)).toBe('watch');
  });

  it('never puts a zero on the high side, even when the median is zero', () => {
    // Most of the group has no power ties, so the power median is 0. A person
    // trusted by many with no power ties is a Trusted Advisor, not an Anchor.
    const zero = { trust: 1, power: 0 };
    expect(quadrantOf(point(8, 3, 0), zero)).toBe('underused');
    expect(quadrantOf(point(9, 0, 0), zero)).toBe('peripheral');
    expect(quadrantOf(point(10, 3, 1), zero)).toBe('anchor');
    expect(quadrantOf(point(11, 0, 1), { trust: 0, power: 0 })).toBe('watch');
  });
});

describe('watchLists', () => {
  const m = { trust: 2, power: 2 };
  const pts = [
    point(1, 0, 4), // watch, both margins wide
    point(2, 1, 3), // watch, both margins narrow
    point(3, 4, 0), // underused, wide
    point(4, 3, 1), // underused, narrow
    point(5, 3, 3), // anchor — on neither list
    point(6, 1, 1), // peripheral — on neither list
  ];

  it('splits the two off-diagonal quadrants and ranks by distance into each', () => {
    const { watch, underused } = watchLists(pts, m);
    expect(watch.map((e) => e.no)).toEqual([1, 2]);
    expect(underused.map((e) => e.no)).toEqual([3, 4]);
    expect(watch[0]!.gap).toBe(4);
    expect(underused[0]!.gap).toBe(4);
  });

  it('never lists the trusted-and-influential or the peripheral', () => {
    const { watch, underused } = watchLists(pts, m);
    expect([...watch, ...underused].some((e) => e.no === 5 || e.no === 6)).toBe(false);
  });

  it('honours the limit', () => {
    expect(watchLists(pts, m, 1).watch.map((e) => e.no)).toEqual([1]);
  });

  it('breaks a tie in distance by roster order', () => {
    const tied = [point(9, 1, 3), point(2, 1, 3)];
    expect(watchLists(tied, m).watch.map((e) => e.no)).toEqual([2, 9]);
  });

  it('says nothing at all when everyone sits on the diagonal', () => {
    const flat = [point(1, 2, 2), point(2, 2, 2)];
    const { watch, underused } = watchLists(flat, { trust: 2, power: 2 });
    expect(watch).toEqual([]);
    expect(underused).toEqual([]);
  });
});

describe('outerLabels', () => {
  it('labels only the outer share of the cloud, and always at least one', () => {
    const m = { trust: 2, power: 2 };
    const pts = [point(1, 2, 2), point(2, 2.1, 2), point(3, 5, 5), point(4, 0, 0)];
    expect([...outerLabels(pts, m, 0.5)].sort()).toEqual([3, 4]);
    expect(outerLabels(pts, m, 0).size).toBe(1);
    expect(outerLabels([], m, 0.6).size).toBe(0);
  });
});

describe('peripheralMembers', () => {
  const roster = [
    member(1, { func: 'Ops' }),
    member(2, { func: 'Ops' }),
    member(3, { func: 'Sales' }),
    member(4, { func: 'Sales', tenureBand: '3-7y' }),
    member(5, { func: 'Legal' }),
    member(6, { func: 'Support', tenureBand: '<1y' }),
  ];
  // trust in: 1→3, 2→2, 3→1, 6→1, 4→0.  power in: 1→2, 2→1, 3→1, 4→0, 6→0.
  const edges = [
    edge(2, 1, { trust: 5, power_over: 5 }),
    edge(3, 1, { trust: 5, power_over: 5 }),
    edge(6, 1, { trust: 5 }),
    edge(1, 2, { trust: 5, power_over: 5 }),
    edge(3, 2, { trust: 5 }),
    edge(1, 3, { trust: 5, power_over: 5 }),
    edge(1, 6, { trust: 5 }),
  ];
  const coverage = new Map([
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 1],
    [6, 4],
  ]);

  it('pulls the under-covered out before judging anybody', () => {
    const out = peripheralMembers(roster, edges, 4, { coverageOf: coverage, minRaters: 3 });
    expect(out.thinlyRated).toEqual([{ no: 5, coverage: 1 }]);
    expect(out.members.some((m) => m.no === 5)).toBe(false);
  });

  it('separates an isolate from a merely peripheral member', () => {
    const out = peripheralMembers(roster, edges, 4, {
      coverageOf: coverage,
      minRaters: 3,
      bottomShare: 0.4,
    });
    expect(out.members.map((m) => [m.no, m.kind])).toEqual([
      [4, 'isolate'],
      [6, 'peripheral'],
    ]);
    expect(out.members[0]!.trustIn).toBe(0);
    expect(out.members[1]!.trustIn).toBe(1);
  });

  it('needs the bottom band under BOTH lenses, not just one', () => {
    const out = peripheralMembers(roster, edges, 4, {
      coverageOf: coverage,
      minRaters: 3,
      bottomShare: 0.4,
    });
    // 3 is in the bottom band on trust but holds a power-over tie, which is the
    // divergence finding rather than this one.
    expect(out.members.some((m) => m.no === 3)).toBe(false);
  });

  it('flags the newest tenure band, which often explains the position', () => {
    const out = peripheralMembers(roster, edges, 4, {
      coverageOf: coverage,
      minRaters: 3,
      bottomShare: 0.4,
    });
    expect(out.members.find((m) => m.no === 6)!.newerHire).toBe(true);
    expect(out.members.find((m) => m.no === 4)!.newerHire).toBe(false);
  });

  it('judges everyone when there is no coverage to withhold on', () => {
    const out = peripheralMembers(roster, edges, 4, {});
    expect(out.thinlyRated).toEqual([]);
    // 5 was rated by nobody, so with no floor to hide behind they read as an isolate.
    expect(out.members.map((m) => m.no)).toContain(5);
  });
});

describe('concentrationReading', () => {
  it('reads a few hands, broadly spread, or somewhere between', () => {
    expect(concentrationReading(0.5)).toBe('held by a few hands');
    expect(concentrationReading(0.82)).toBe('held by a few hands');
    expect(concentrationReading(0.25)).toBe('broadly spread');
    expect(concentrationReading(0)).toBe('broadly spread');
    expect(concentrationReading(0.26)).toBe('somewhere between');
    expect(concentrationReading(0.49)).toBe('somewhere between');
  });

  it('says nothing rather than guessing when the lens was never scored', () => {
    expect(concentrationReading(null)).toBeNull();
  });
});

describe('blockConcentration', () => {
  it('reads one block out of the network payload, and null for anything missing', () => {
    const nets = [
      { blockKey: 'trust', concentration: 0.4 },
      { blockKey: 'power_over', concentration: null },
    ];
    expect(blockConcentration(nets, 'trust')).toBe(0.4);
    expect(blockConcentration(nets, 'power_over')).toBeNull();
    expect(blockConcentration(nets, 'ease')).toBeNull();
    expect(blockConcentration(undefined, 'trust')).toBeNull();
  });
});

describe('joinNames', () => {
  it('writes a list the way a person would read it aloud', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Asha'])).toBe('Asha');
    expect(joinNames(['Asha', 'Bo'])).toBe('Asha and Bo');
    expect(joinNames(['Asha', 'Bo', 'Cy'])).toBe('Asha, Bo and Cy');
  });
});

describe('trustPowerOverlapSentence', () => {
  const names = new Map([
    [1, 'Asha'],
    [2, 'Bo'],
    [3, 'Cy'],
    [4, 'Dev'],
  ]);
  const nameOf = (no: number) => names.get(no) ?? `#${no}`;

  it('says so plainly when the two lists are the same people', () => {
    expect(trustPowerOverlapSentence([1, 2], [2, 1], nameOf)).toBe(
      'The people the group trusts are the people driving decisions.',
    );
  });

  it('sends the facilitator straight there when the lists share nobody', () => {
    expect(trustPowerOverlapSentence([1, 2], [3, 4], nameOf)).toBe(
      "The group's trust and its decision power sit with different people — start the debrief here.",
    );
  });

  it('names who carries both when the overlap is partial', () => {
    const s = trustPowerOverlapSentence([1, 2], [2, 3], nameOf)!;
    expect(s).toContain('Bo');
    expect(s).not.toContain('Asha');
    expect(s).toMatch(/on both lists/);
    const two = trustPowerOverlapSentence([1, 2, 3], [1, 2, 4], nameOf)!;
    expect(two.startsWith('Asha and Bo are on both lists')).toBe(true);
  });

  it('is a longer list on one side than the other, and still partial', () => {
    const s = trustPowerOverlapSentence([1], [1, 2], nameOf)!;
    expect(s.startsWith('Asha is on both lists')).toBe(true);
  });

  it('withholds the sentence when either side is empty', () => {
    expect(trustPowerOverlapSentence([], [1], nameOf)).toBeNull();
    expect(trustPowerOverlapSentence([1], [], nameOf)).toBeNull();
  });
});

// ------------------------------------------------ label placement on the plot
//
// The scatter's failure mode is not a wrong number, it is two names printed on
// top of each other. These are the functions that stop that happening, so they
// are tested on boxes rather than on rendered pixels.

describe('textBox', () => {
  it('climbs above the baseline and centres on a middle anchor', () => {
    const b = textBox('Priya Rao', 100, 200, 10, 'middle', { x: 0, y: 0 });
    expect(b.w).toBeCloseTo(9 * 10 * 0.58, 6);
    expect(b.x).toBeCloseTo(100 - b.w / 2, 6);
    // The baseline sits inside the box, near its foot.
    expect(b.y).toBeLessThan(200);
    expect(b.y + b.h).toBeGreaterThan(200);
  });

  it('hangs left or right off a start or end anchor', () => {
    const start = textBox('Bo', 100, 50, 10, 'start', { x: 0, y: 0 });
    const end = textBox('Bo', 100, 50, 10, 'end', { x: 0, y: 0 });
    expect(start.x).toBe(100);
    expect(end.x + end.w).toBeCloseTo(100, 6);
  });

  it('grows with the text, the size and the padding', () => {
    const small = textBox('Bo', 0, 0, 10);
    expect(textBox('Bo Bo Bo', 0, 0, 10).w).toBeGreaterThan(small.w);
    expect(textBox('Bo', 0, 0, 20).w).toBeGreaterThan(small.w);
    expect(textBox('Bo', 0, 0, 10, 'middle', { x: 20, y: 20 }).h).toBeGreaterThan(small.h);
  });
});

describe('boxesOverlap', () => {
  const box = (x: number, y: number, w = 10, h = 10): LabelBox => ({ x, y, w, h });

  it('is true only where the rectangles actually meet', () => {
    expect(boxesOverlap(box(0, 0), box(5, 5))).toBe(true);
    expect(boxesOverlap(box(0, 0), box(20, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(0, 20))).toBe(false);
  });

  it('treats touching edges as clear, and the gap as breathing room', () => {
    expect(boxesOverlap(box(0, 0), box(10, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(10, 0), 2)).toBe(true);
  });
});

describe('cullLabels', () => {
  const box = (x: number, y: number, w = 10, h = 10): LabelBox => ({ x, y, w, h });
  const one = (id: number, b: LabelBox) => ({ id, boxes: [b] });

  it('keeps the first of two colliding labels and drops the second', () => {
    const placed = cullLabels([one(1, box(0, 0)), one(2, box(4, 4)), one(3, box(40, 40))]);
    expect([...placed.keys()].sort()).toEqual([1, 3]);
    expect(placed.get(1)).toBe(0);
  });

  it('is order-dependent on purpose: the notable name wins the space', () => {
    expect([...cullLabels([one(1, box(0, 0)), one(2, box(4, 0))]).keys()]).toEqual([1]);
    expect([...cullLabels([one(2, box(4, 0)), one(1, box(0, 0))]).keys()]).toEqual([2]);
  });

  it('falls back to a label\'s second seat when its first is taken', () => {
    const placed = cullLabels([
      one(1, box(0, 0)),
      { id: 2, boxes: [box(4, 0), box(0, 40)] },
    ]);
    expect(placed.get(1)).toBe(0);
    // 2 could not sit above, so it sat below — and is still drawn.
    expect(placed.get(2)).toBe(1);
  });

  it('drops a label whose every seat is taken', () => {
    const placed = cullLabels([
      one(1, box(0, 0)),
      { id: 2, boxes: [box(4, 0), box(6, 2)] },
    ]);
    expect(placed.has(2)).toBe(false);
  });

  it('skips a seat the caller has ruled out, WITHOUT shifting the indices', () => {
    // The returned number addresses the seat list the caller passed in. If a
    // ruled-out seat were compacted away, the caller would draw the label at a
    // position that was never checked — which is exactly how names ended up
    // hanging off the axis.
    const placed = cullLabels([{ id: 1, boxes: [null, box(0, 0)] }]);
    expect(placed.get(1)).toBe(1);
    expect(cullLabels([{ id: 1, boxes: [null, null] }]).size).toBe(0);
  });

  it('never places a label over the fixed furniture', () => {
    const corner = box(0, 0, 200, 24);
    expect(cullLabels([one(1, box(20, 10))], [corner]).size).toBe(0);
    expect(cullLabels([one(1, box(20, 40))], [corner]).size).toBe(1);
  });

  it('places everything when nothing collides, and nothing when there is nothing', () => {
    const spread = [0, 30, 60, 90].map((x, i) => one(i, box(x, 0)));
    expect(cullLabels(spread).size).toBe(4);
    expect(cullLabels([]).size).toBe(0);
  });
});

describe('rankByDivergence', () => {
  const p = (no: number, trust: number, power: number): DivergencePoint => ({
    no,
    trust,
    power,
    trustCount: trust,
    powerCount: power,
    normalised: false,
  });

  it('puts the outliers first and the middle of the group last', () => {
    const m = { trust: 2, power: 2 };
    const ranked = rankByDivergence([p(1, 2, 2), p(2, 4, 4), p(3, 2.2, 2)], m);
    expect(ranked[0]!.no).toBe(2);
    expect(ranked[2]!.no).toBe(1);
  });

  it('measures each axis in units of its own spread, not in raw units', () => {
    // Trust runs 0..100, influence 0..2. The person at the far end of the SHORT
    // axis is exactly as notable as the one at the far end of the long axis.
    const m = { trust: 50, power: 1 };
    const ranked = rankByDivergence([p(1, 50, 2), p(2, 100, 1), p(3, 50, 1)], m);
    expect(ranked.map((r) => r.no).slice(0, 2).sort()).toEqual([1, 2]);
    expect(ranked[2]!.no).toBe(3);
  });

  it('breaks a tie by roster order and keeps everyone', () => {
    const m = { trust: 0, power: 0 };
    expect(rankByDivergence([p(3, 1, 0), p(1, 1, 0)], m).map((r) => r.no)).toEqual([1, 3]);
  });
});

describe('topPaneLabels', () => {
  const edges = [
    edge(1, 2, { trust: 5 }),
    edge(3, 2, { trust: 5 }),
    edge(4, 2, { trust: 5 }),
    edge(1, 3, { trust: 5 }),
    edge(2, 3, { trust: 5 }),
    edge(2, 4, { trust: 5 }),
  ];
  const panes = () => buildPaneEdges(edges, 'trust', 4, new Set([1, 2, 3, 4]));

  it('names the most-chosen people in that pane, and nobody else', () => {
    expect([...topPaneLabels(panes(), 2)].sort()).toEqual([2, 3]);
  });

  it('never names someone with no ties received', () => {
    // 1 gives three ties and receives none.
    expect(topPaneLabels(panes(), 8).has(1)).toBe(false);
    expect(topPaneLabels(panes(), 8).size).toBe(3);
  });

  it('breaks a tie in in-degree by roster order', () => {
    expect([...topPaneLabels(panes(), 3)].sort()).toEqual([2, 3, 4]);
    expect([...topPaneLabels(panes(), 1)]).toEqual([2]);
  });

  it('names nobody in an empty pane', () => {
    expect(topPaneLabels([], 8).size).toBe(0);
  });
});

describe('orderTiesByFocus', () => {
  const ties = [
    { a: 1, b: 2 },
    { a: 3, b: 4 },
    { a: 5, b: 1 },
    { a: 6, b: 7 },
  ];

  it('lifts every row touching the focused person, in either direction', () => {
    expect(orderTiesByFocus(ties, 1).map((t) => [t.a, t.b])).toEqual([
      [1, 2],
      [5, 1],
      [3, 4],
      [6, 7],
    ]);
  });

  it('is stable: the ranking inside each half is the one it arrived with', () => {
    expect(orderTiesByFocus(ties, 3).map((t) => t.a)).toEqual([3, 1, 5, 6]);
  });

  it('changes nothing when nobody is focused, or the focus is in no row', () => {
    expect(orderTiesByFocus(ties, null)).toEqual(ties);
    expect(orderTiesByFocus(ties, 99)).toEqual(ties);
  });

  it('never drops or duplicates a row', () => {
    expect(orderTiesByFocus(ties, 1)).toHaveLength(ties.length);
  });
});

// ============================================================ community hulls

describe('convexHull', () => {
  const at = (x: number, y: number): Pt => ({ x, y });

  it('returns the corners of a square and drops what is inside it', () => {
    const hull = convexHull([at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(50, 50), at(20, 80)]);
    expect(hull).toEqual([at(0, 0), at(100, 0), at(100, 100), at(0, 100)]);
  });

  it('drops collinear points: a hull is the shape, not the sample', () => {
    const hull = convexHull([at(0, 0), at(50, 0), at(100, 0), at(0, 100)]);
    // The midpoint of the bottom edge adds nothing to the outline.
    expect(hull).toContainEqual(at(0, 0));
    expect(hull).toContainEqual(at(100, 0));
    expect(hull).not.toContainEqual(at(50, 0));
  });

  it('collapses duplicates, and hands back what it was given below three points', () => {
    expect(convexHull([at(5, 5), at(5, 5), at(5, 5)])).toEqual([at(5, 5)]);
    expect(convexHull([at(0, 0), at(10, 10)])).toEqual([at(0, 0), at(10, 10)]);
    expect(convexHull([])).toEqual([]);
    // Three people standing in a line have no area, and say so.
    expect(convexHull([at(0, 0), at(10, 10), at(20, 20)])).toEqual([at(0, 0), at(20, 20)]);
  });
});

describe('expandHull', () => {
  const at = (x: number, y: number): Pt => ({ x, y });

  it('pushes a square out by the full padding at every corner', () => {
    const hull = convexHull([at(0, 0), at(100, 0), at(100, 100), at(0, 100)]);
    const padded = expandHull(hull, 10);
    // The mitre is what makes a 90-degree corner clear its node by the whole
    // padding rather than by pad/sqrt(2).
    expect(padded.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [-10, -10],
      [110, -10],
      [110, 110],
      [-10, 110],
    ]);
  });

  it('gives a two-point hull a capsule and a one-point hull a square', () => {
    const capsule = expandHull([at(0, 0), at(100, 0)], 10);
    expect(capsule).toHaveLength(4);
    for (const p of capsule) {
      expect(Math.abs(p.y)).toBe(10);
      expect(p.x === -10 || p.x === 110).toBe(true);
    }
    const dot = expandHull([at(5, 5)], 10);
    expect(dot).toHaveLength(4);
    expect(dot).toContainEqual(at(-5, -5));
    expect(dot).toContainEqual(at(15, 15));
  });

  it('has nothing to expand when there is nothing there', () => {
    expect(expandHull([], 10)).toEqual([]);
  });

  it('never throws the mitre off to infinity on a near-degenerate spike', () => {
    const spike = expandHull([at(0, 0), at(100, 0.001), at(200, 0)], 10);
    for (const p of spike) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.y)).toBeLessThan(40); // capped at 3x the padding
    }
  });
});

describe('roundedHullPath', () => {
  const at = (x: number, y: number): Pt => ({ x, y });

  it('closes the path and rounds every corner', () => {
    const d = roundedHullPath([at(0, 0), at(100, 0), at(100, 100), at(0, 100)], 14);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    // One quadratic per corner.
    expect(d.match(/Q /g)).toHaveLength(4);
  });

  it('never cuts a corner past the midpoint of its own edge', () => {
    // Radius far larger than the shape: the corners meet, they do not invert.
    const d = roundedHullPath([at(0, 0), at(10, 0), at(10, 10), at(0, 10)], 900);
    for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
      expect(Number(n)).toBeGreaterThanOrEqual(-0.01);
      expect(Number(n)).toBeLessThanOrEqual(10.01);
    }
  });

  it('degrades rather than disappearing on the degenerate shapes', () => {
    expect(roundedHullPath([], 14)).toBe('');
    expect(roundedHullPath([at(0, 0), at(10, 0)], 14)).toBe('M 0 0 L 10 0');
    expect(roundedHullPath([at(0, 0)], 6)).toContain('a 6 6');
  });
});

describe('clusterHulls', () => {
  const communityOf = new Map([
    [1, 0], [2, 0], [3, 0], [4, 0], // four
    [5, 1], [6, 1], [7, 1],         // three
    [8, 2], [9, 2],                 // two — no hull
    [10, 3],                        // alone
  ]);
  const positions = new Map(
    [...communityOf.keys()].map((no) => [no, { x: no * 40, y: (no % 3) * 40 }]),
  );

  it('draws a hull for every cluster of three or more and none for the rest', () => {
    const hulls = clusterHulls(communityOf, positions);
    expect(hulls.map((h) => h.label)).toEqual(['Cluster 1', 'Cluster 2']);
    expect(hulls[0]!.members).toEqual([1, 2, 3, 4]);
    expect(hulls[1]!.members).toEqual([5, 6, 7]);
  });

  it('numbers and colours the hulls exactly as the legend does', () => {
    const hulls = clusterHulls(communityOf, positions);
    const { entries, fillByNo } = clusterView(communityOf);
    // Same size order, same palette slot, same label — one rule, two drawings.
    expect(hulls[0]!.fill).toBe(CATEGORICAL_COLORS[0]);
    expect(hulls[1]!.fill).toBe(CATEGORICAL_COLORS[1]);
    expect(hulls[0]!.fill).toBe(fillByNo.get(1));
    expect(hulls[1]!.fill).toBe(fillByNo.get(5));
    expect(entries[0]!.label).toBe(hulls[0]!.label);
  });

  it('skips a cluster whose people are not all on the map', () => {
    const thin = new Map([[5, positions.get(5)!], [6, positions.get(6)!]]);
    expect(clusterHulls(communityOf, thin)).toEqual([]);
  });

  it('honours a caller who wants a different floor, and pads what it keeps', () => {
    const hulls = clusterHulls(communityOf, positions, { minMembers: 2, pad: 25 });
    expect(hulls.map((h) => h.label)).toEqual(['Cluster 1', 'Cluster 2', 'Cluster 3']);
    // Padding actually moved the outline off the people it wraps.
    const xs = hulls[0]!.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(40);
  });

  it('clears the rim of the widest node when the caller says how big they are', () => {
    // Everyone on a line at y = 0 so the vertical reach is only ever padding.
    const flat = new Map([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }], [3, { x: 200, y: 0 }]]);
    const comm = new Map([[1, 0], [2, 0], [3, 0]]);
    const centres = clusterHulls(comm, flat, { pad: 10 })[0]!;
    const rims = clusterHulls(comm, flat, { pad: 10, radiusOf: () => 30 })[0]!;
    const reach = (h: { points: Pt[] }) => Math.max(...h.points.map((p) => Math.abs(p.y)));
    expect(reach(centres)).toBeCloseTo(10, 6);
    // Padded off a 30-unit node rim instead of off its centre.
    expect(reach(rims)).toBeCloseTo(40, 6);
  });

  it('has no hulls at all for a graph nobody clustered', () => {
    expect(clusterHulls(new Map(), new Map())).toEqual([]);
    expect(clusterHulls(new Map([[1, 0], [2, 1]]), positions)).toEqual([]);
  });
});

// ============================================================== the tie matrix

describe('tieMatrix', () => {
  const pair = (from: number, to: number, mean: number | null) => ({ from, to, mean });

  // 1 → 2 is not returned; 4 → 5 was never rated back; 1 ↔ 3 and 2 ↔ 3 are
  // mutual. So 3 has no one-way tie and never appears, and the two mutual
  // cells that survive are the ones between people who are there for another
  // reason — which is exactly what "muted, not absent" is for.
  const pairs = [
    pair(1, 2, 4.5),
    pair(2, 1, 3.0),
    pair(1, 3, 4.2),
    pair(3, 1, 4.1),
    pair(2, 3, 4.0),
    pair(3, 2, 4.0),
    pair(4, 5, 4.6),
  ];
  const communityOf = new Map([[1, 0], [2, 0], [3, 0], [4, 1], [5, 1]]);

  it('keeps only the people with at least one one-way tie', () => {
    const m = tieMatrix(pairs, 4, communityOf);
    expect([...m.order].sort((a, b) => a - b)).toEqual([1, 2, 4, 5]);
    expect(m.involvement.get(3)).toBeUndefined();
    expect(m.total).toBe(4);
    expect(m.capped).toBe(false);
  });

  it('orders by community first, then by ties received inside it', () => {
    const m = tieMatrix(pairs, 4, communityOf);
    // Community 0 before community 1; inside each, the person who receives
    // ties comes first. An unsorted matrix is confetti — this is the feature.
    expect(m.order).toEqual([2, 1, 5, 4]);
    expect(m.inDegree.get(2)).toBe(1);
    expect(m.inDegree.get(1)).toBe(0);
  });

  it('reads each cell exactly as unreciprocatedTies would', () => {
    const m = tieMatrix(pairs, 4, communityOf);
    const key = (from: number, to: number) => m.cells.find((c) => c.from === from && c.to === to);
    expect(key(1, 2)!.kind).toBe('not_returned');
    expect(key(1, 2)!.mean).toBe(4.5);
    expect(key(4, 5)!.kind).toBe('no_basis');
    // 2 → 1 is below the line, so there is no cell at all — an empty cell is
    // "no tie", never "a weak one".
    expect(key(2, 1)).toBeUndefined();
    // 3 is off the matrix, so its mutual ties are off it too.
    expect(m.cells.every((c) => c.from !== 3 && c.to !== 3)).toBe(true);
  });

  it('never puts anything on the diagonal', () => {
    const withSelf = [...pairs, pair(1, 1, 5)];
    const m = tieMatrix(withSelf, 4, communityOf);
    expect(m.cells.every((c) => c.from !== c.to)).toBe(true);
  });

  it('keeps mutual ties between people the matrix already holds', () => {
    // 1 ↔ 2 mutual, plus a one-way tie apiece that earns them both a row.
    const both = [
      pair(1, 2, 4.5),
      pair(2, 1, 4.5),
      pair(1, 9, 4.5),
      pair(2, 9, 4.5),
      pair(9, 1, 2.0),
      pair(9, 2, 2.0),
    ];
    const m = tieMatrix(both, 4, new Map([[1, 0], [2, 0], [9, 0]]));
    const mutual = m.cells.filter((c) => c.kind === 'mutual');
    expect(mutual.map((c) => `${c.from}>${c.to}`).sort()).toContain('1>2');
  });

  it('caps at the most-involved and says it capped', () => {
    // One person everyone reaches for and nobody hears back from.
    const many = Array.from({ length: 30 }, (_, i) => pair(i + 1, 100, 5));
    const comm = new Map<number, number>(many.map((p) => [p.from, 0]));
    comm.set(100, 0);

    const capped = tieMatrix(many, 4, comm, 25);
    expect(capped.total).toBe(31);
    expect(capped.order).toHaveLength(25);
    expect(capped.capped).toBe(true);
    expect(capped.limit).toBe(25);
    // The person on 30 one-way ties is never the one dropped.
    expect(capped.order).toContain(100);

    const whole = tieMatrix(many, 4, comm, 100);
    expect(whole.order).toHaveLength(31);
    expect(whole.capped).toBe(false);
  });

  it('is empty when every tie is returned', () => {
    const m = tieMatrix([pair(1, 2, 4.5), pair(2, 1, 4.5)], 4, new Map([[1, 0], [2, 0]]));
    expect(m.order).toEqual([]);
    expect(m.cells).toEqual([]);
    expect(m.total).toBe(0);
  });

  it('defaults to the cap the card draws at', () => {
    expect(MATRIX_CAP).toBe(25);
  });
});

// ==================================================== trust vs power standing

describe('rankByCount', () => {
  it('gives equal counts equal rank and skips the ranks they used up', () => {
    const ranks = rankByCount(new Map([[1, 5], [2, 3], [3, 3], [4, 1]]));
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(2)).toBe(2);
    expect(ranks.get(3)).toBe(2);
    expect(ranks.get(4)).toBe(4);
  });

  it('has nothing to rank in an empty group', () => {
    expect(rankByCount(new Map()).size).toBe(0);
  });
});

describe('rankDivergence', () => {
  // Trust runs 1 > 2 > 3 > 4; decision power runs exactly backwards.
  const mirrored = [
    edge(2, 1, { trust: 4.5, power_over: 2 }),
    edge(3, 1, { trust: 4.5, power_over: 2 }),
    edge(4, 1, { trust: 4.5, power_over: 2 }),
    edge(3, 2, { trust: 4.5, power_over: 2 }),
    edge(4, 2, { trust: 4.5, power_over: 2 }),
    edge(4, 3, { trust: 4.5, power_over: 2 }),
    edge(1, 2, { trust: 2, power_over: 4.5 }),
    edge(1, 3, { trust: 2, power_over: 4.5 }),
    edge(2, 3, { trust: 2, power_over: 4.5 }),
    edge(1, 4, { trust: 2, power_over: 4.5 }),
    edge(2, 4, { trust: 2, power_over: 4.5 }),
    edge(3, 4, { trust: 2, power_over: 4.5 }),
  ];

  it('ranks each lens on its own positive in-degree', () => {
    const all = rankDivergence([1, 2, 3, 4], mirrored, 4, 10);
    const of = new Map(all.map((d) => [d.no, d]));
    expect(of.get(1)).toMatchObject({ trustRank: 1, powerRank: 4, trustCount: 3, powerCount: 0 });
    expect(of.get(4)).toMatchObject({ trustRank: 4, powerRank: 1, trustCount: 0, powerCount: 3 });
  });

  it('takes the three whose standings disagree most, biggest gap first', () => {
    const top = rankDivergence([1, 2, 3, 4], mirrored, 4, 3);
    expect(top.map((d) => d.no)).toEqual([1, 4, 2]);
    expect(top.map((d) => d.delta)).toEqual([3, 3, 1]);
  });

  it('breaks a tie toward the person who stands higher on one of the two lists', () => {
    const top = rankDivergence([1, 2, 3, 4], mirrored, 4, 4);
    // 1 and 4 both diverge by 3; 1 leads on trust and 4 on power, so roster
    // order settles it — deterministically, never by whichever came back first.
    expect(top.slice(0, 2).map((d) => d.no)).toEqual([1, 4]);
    expect(top.slice(2).map((d) => d.no)).toEqual([2, 3]);
  });

  it('returns fewer than three when fewer than three diverge', () => {
    const two = rankDivergence(
      [1, 2, 3],
      [
        edge(2, 1, { trust: 4.5, power_over: 2 }),
        edge(3, 1, { trust: 4.5, power_over: 2 }),
        edge(1, 2, { trust: 2, power_over: 4.5 }),
        edge(3, 2, { trust: 2, power_over: 4.5 }),
      ],
      4,
      3,
    );
    expect(two.map((d) => d.no)).toEqual([1, 2]);
  });

  it('finds nobody when the two lenses agree — a zero gap is not a weak finding', () => {
    const agreed = rankDivergence(
      [1, 2],
      [
        edge(1, 2, { trust: 4.5, power_over: 4.5 }),
        edge(2, 1, { trust: 4.5, power_over: 4.5 }),
      ],
      4,
    );
    expect(agreed).toEqual([]);
    expect(rankDivergence([], [], 4)).toEqual([]);
  });

  it('says what a ring means in the words the tooltip uses', () => {
    expect(
      rankDivergenceLabel({ no: 7, trustRank: 2, powerRank: 14, trustCount: 9, powerCount: 1, delta: 12 }),
    ).toBe('Trusted #2 · drives decisions #14');
  });
});

// ======================================================== margin annotations

describe('spreadSlots', () => {
  it('pushes crowded positions apart without reordering them', () => {
    expect(spreadSlots([10, 12, 14], 30, 0, 300)).toEqual([10, 40, 70]);
  });

  it('leaves positions that already clear each other alone', () => {
    expect(spreadSlots([10, 100, 200], 30, 0, 300)).toEqual([10, 100, 200]);
  });

  it('walks a stack that ran off the bottom back up', () => {
    expect(spreadSlots([290, 295], 30, 0, 300)).toEqual([270, 300]);
  });

  it('respects the top clamp', () => {
    expect(spreadSlots([-40, -30], 20, 0, 300)).toEqual([0, 20]);
  });

  it('has nothing to spread when there is nothing', () => {
    expect(spreadSlots([], 30, 0, 300)).toEqual([]);
    expect(spreadSlots([50], 30, 0, 300)).toEqual([50]);
  });
});

describe('placeCallouts', () => {
  const box = { w: 900, h: 520 };
  const target = (no: number, x: number, y: number, r = 20) => ({ no, x, y, r, text: `P${no} · 0.3${no}` });

  it('puts each annotation in the margin on its own side of the field', () => {
    const out = placeCallouts([target(1, 100, 100), target(2, 800, 300)], box, { gap: 46, inset: 14 });
    const left = out.find((c) => c.no === 1)!;
    const right = out.find((c) => c.no === 2)!;
    expect(left.side).toBe('left');
    expect(left.x).toBe(-14);
    expect(left.anchor).toBe('end');
    expect(right.side).toBe('right');
    expect(right.x).toBe(box.w + 14);
    expect(right.anchor).toBe('start');
    // Both are OUTSIDE the node field, which is the whole point of a margin.
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(box.w);
  });

  it('spreads two annotations on the same side so neither sits on the other', () => {
    const out = placeCallouts([target(1, 100, 100), target(2, 120, 110)], box, { gap: 46, inset: 14 });
    const ys = out.map((c) => c.y);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(46);
  });

  it('never lets two leaders on one side cross', () => {
    const targets = [target(1, 100, 300), target(2, 120, 100), target(3, 80, 105)];
    const out = placeCallouts(targets, box, { gap: 46, inset: 14 });
    const byNo = new Map(out.map((c) => [c.no, c]));
    const order = [...out].sort((a, b) => a.y - b.y).map((c) => c.no);
    // Same vertical order at the margin as at the nodes: with one shared start
    // edge, that is exactly the condition under which the leaders cannot cross.
    const nodeOrder = [...targets].sort((a, b) => a.y - b.y).map((t) => t.no);
    expect(order).toEqual(nodeOrder);
    for (const c of out) expect(byNo.get(c.no)!.side).toBe('left');
  });

  it('stops each leader on the halo rim instead of running through it', () => {
    const t = target(1, 300, 260, 24);
    const [c] = placeCallouts([t], box, { gap: 46, inset: 14 });
    const reach = Math.hypot(c!.line.x2 - t.x, c!.line.y2 - t.y);
    expect(reach).toBeCloseTo(t.r + HALO_PAD, 6);
    // And it starts at the field edge, not somewhere in the picture.
    expect(c!.line.x1).toBeCloseTo(-11, 6);
  });

  it('keeps every annotation inside the height of the field', () => {
    const crowded = [1, 2, 3].map((n) => target(n, 100, 515));
    const out = placeCallouts(crowded, box, { gap: 46, inset: 14 });
    for (const c of out) expect(c.y).toBeLessThanOrEqual(box.h);
    expect(out).toHaveLength(3);
  });

  it('sends a person on the centre line to the right margin, and has nothing to place for nobody', () => {
    const [mid] = placeCallouts([target(1, 450, 100)], box, {});
    expect(mid!.side).toBe('right');
    expect(placeCallouts([], box, {})).toEqual([]);
  });

  // The bridges map draws these into a viewBox widened by `margin` on each
  // side. Text on the left is anchored at its RIGHT edge and grows leftwards,
  // so a label wider than the margin used to run out through x = -margin and
  // lose its first characters — "Aarav Menon · 0.29" printed as
  // "arav Menon · 0.29". Given the margin, no label may leave the picture.
  describe('clamping labels inside the viewBox', () => {
    const size = 26;
    const margin = 300;
    const long = { no: 1, x: 120, y: 100, r: 22, text: 'Aarav Menon · 0.29' };
    /** The text box as drawn: same estimate the placer clamps against. */
    const boxOf = (c: { x: number; y: number; anchor: 'start' | 'end'; text: string }) =>
      textBox(c.text, c.x, c.y, size, c.anchor);

    it('keeps a left-margin label inside the left edge of the viewBox', () => {
      const [c] = placeCallouts([long], box, { gap: 50, inset: 16, margin, fontSize: size });
      expect(c!.side).toBe('left');
      expect(boxOf(c!).x).toBeGreaterThanOrEqual(-margin);
      // And it has not been dragged off the margin and into the field either.
      expect(c!.x).toBeLessThanOrEqual(0);
    });

    it('keeps a right-margin label inside the right edge of the viewBox', () => {
      const far = { ...long, no: 2, x: box.w - 120 };
      const [c] = placeCallouts([far], box, { gap: 50, inset: 16, margin, fontSize: size });
      expect(c!.side).toBe('right');
      const b = boxOf(c!);
      expect(b.x + b.w).toBeLessThanOrEqual(box.w + margin);
      expect(c!.x).toBeGreaterThanOrEqual(box.w);
    });

    it('pulls a label that cannot fit back towards the field rather than clipping it', () => {
      // A margin far too narrow for the text: the label has to give ground.
      const tight = 90;
      const [c] = placeCallouts([long], box, { gap: 50, inset: 16, margin: tight, fontSize: size });
      expect(boxOf(c!).x).toBeGreaterThanOrEqual(-tight);
      // Its leader still starts at the label, so the hairline stays attached.
      expect(c!.line.x1).toBeCloseTo(c!.x + 3, 6);
      // Unclamped, the same call puts it where the design asks for it.
      const [free] = placeCallouts([long], box, { gap: 50, inset: 16 });
      expect(free!.x).toBe(-16);
      expect(c!.x).toBeGreaterThan(free!.x);
    });

    it('leaves a label that already fits exactly where it was placed', () => {
      const short = { ...long, text: 'Ish · 0.4' };
      const [c] = placeCallouts([short], box, { gap: 50, inset: 16, margin, fontSize: size });
      expect(c!.x).toBe(-16);
      expect(c!.line.x1).toBe(-13);
    });
  });
});

// ==========================================================================
// The workspace tables — the per-person detail band under each insight's
// graph. Each one is the same finding as the picture above it, spelled out a
// row at a time, so what is tested here is mostly that the two cannot drift:
// the same lens, the same threshold, the same definition of a tie.
// ==========================================================================

describe('anchorTable', () => {
  const edges = [
    edge(2, 1, { trust: 5, power_over: 5 }),
    edge(3, 1, { trust: 5 }),
    edge(4, 1, { trust: 5 }),
    edge(1, 2, { power_over: 5 }),
    edge(3, 2, { power_over: 5 }),
    edge(1, 3, { trust: 5 }),
  ];
  const nos = [1, 2, 3, 4];

  it('gives every member both standings, ranked by trust received', () => {
    expect(anchorTable(nos, edges, 4)).toEqual([
      { no: 1, trustIn: 3, powerIn: 1, onBoth: true },
      { no: 3, trustIn: 1, powerIn: 0, onBoth: false },
      { no: 2, trustIn: 0, powerIn: 2, onBoth: false },
      { no: 4, trustIn: 0, powerIn: 0, onBoth: false },
    ]);
  });

  it('marks "on both lists" from the same anchors() the sidebar ranks with', () => {
    // 1 tops trust and is second on power, so a top-five overlap holds them
    // and a top-ONE overlap does not. The column is the sidebar's claim,
    // narrowed or widened with it, never a second opinion about it.
    expect(anchorTable(nos, edges, 4, 5).find((r) => r.no === 1)!.onBoth).toBe(true);
    expect(anchorTable(nos, edges, 4, 1).find((r) => r.no === 1)!.onBoth).toBe(false);
  });

  it('never puts somebody nobody chose on a list — a zero does not rank', () => {
    // 2 tops the power list but has no trust ties at all, so "both" is false
    // however wide the limit goes.
    expect(anchorTable(nos, edges, 4, 5).find((r) => r.no === 2)!.onBoth).toBe(false);
  });

  it('moves with the threshold, like the map above it', () => {
    const weak = [edge(2, 1, { trust: 3.5 })];
    expect(anchorTable([1, 2], weak, 4)[0]!.trustIn).toBe(0);
    expect(anchorTable([1, 2], weak, 3.5)[0]!.trustIn).toBe(1);
  });

  it('lists everybody, including people nobody chose', () => {
    expect(anchorTable([1, 2, 3, 4, 9], edges, 4)).toHaveLength(5);
  });
});

describe('divergenceTable', () => {
  const points: DivergencePoint[] = [
    { no: 1, trust: 5, power: 5, trustCount: 5, powerCount: 5, normalised: false },
    { no: 2, trust: 0, power: 5, trustCount: 0, powerCount: 5, normalised: false },
    { no: 3, trust: 5, power: 0, trustCount: 5, powerCount: 0, normalised: false },
    { no: 4, trust: 2, power: 2, trustCount: 2, powerCount: 2, normalised: false },
  ];

  it('names the quadrant every plotted person landed in', () => {
    const m = divergenceMedians(points);
    const rows = divergenceTable(points, m);
    const by = new Map(rows.map((r) => [r.no, r.quadrant]));
    expect(by.get(1)).toBe('anchor');
    expect(by.get(2)).toBe('watch');
    expect(by.get(3)).toBe('underused');
    expect(by.get(4)).toBe('peripheral');
  });

  it('reads in the same order the chart offers its labels in', () => {
    const m = divergenceMedians(points);
    expect(divergenceTable(points, m).map((r) => r.no)).toEqual(
      rankByDivergence(points, m).map((p) => p.no),
    );
  });

  it('carries the raw counts through, so a row can say people not rates', () => {
    const rows = divergenceTable(points, divergenceMedians(points));
    expect(rows.find((r) => r.no === 1)!.trustCount).toBe(5);
  });

  it('is empty for a group nobody has plotted yet', () => {
    expect(divergenceTable([], { trust: 0, power: 0 })).toEqual([]);
  });
});

describe('concentrationTable', () => {
  // 1 receives four, 2 receives two, 3 receives one, 4 receives none: seven
  // ties in all, and the top person alone is over half of them.
  const edges = [
    edge(2, 1, { trust: 5 }),
    edge(3, 1, { trust: 5 }),
    edge(4, 1, { trust: 5 }),
    edge(5, 1, { trust: 5 }),
    edge(1, 2, { trust: 5 }),
    edge(3, 2, { trust: 5 }),
    edge(1, 3, { trust: 5 }),
  ];
  const nos = [1, 2, 3, 4, 5];

  it('ranks by ties received and runs a cumulative share down the column', () => {
    const t = concentrationTable(nos, edges, 'trust', 4);
    expect(t.total).toBe(7);
    expect(t.rows.map((r) => [r.no, r.count])).toEqual([
      [1, 4],
      [2, 2],
      [3, 1],
      [4, 0],
      [5, 0],
    ]);
    expect(t.rows[0]!.share).toBeCloseTo(4 / 7, 6);
    expect(t.rows[0]!.cumulative).toBeCloseTo(4 / 7, 6);
    expect(t.rows[1]!.cumulative).toBeCloseTo(6 / 7, 6);
    expect(t.rows[4]!.cumulative).toBe(1);
  });

  it('answers "how few hold half" — the sentence the meter cannot say', () => {
    expect(concentrationTable(nos, edges, 'trust', 4).halfCount).toBe(1);
  });

  it('needs a second person when the top one is only just short of half', () => {
    // Three ties each to 1 and 2, one to 3: seven in all, so 1 alone is 3/7.
    const spread = [
      edge(2, 1, { trust: 5 }),
      edge(3, 1, { trust: 5 }),
      edge(4, 1, { trust: 5 }),
      edge(1, 2, { trust: 5 }),
      edge(3, 2, { trust: 5 }),
      edge(4, 2, { trust: 5 }),
      edge(1, 3, { trust: 5 }),
    ];
    expect(concentrationTable(nos, spread, 'trust', 4).halfCount).toBe(2);
  });

  it('credits nobody with holding half of nothing', () => {
    const t = concentrationTable(nos, [], 'trust', 4);
    expect(t.total).toBe(0);
    expect(t.halfCount).toBe(0);
    expect(t.rows.every((r) => r.share === 0 && r.cumulative === 0)).toBe(true);
  });

  it('reads whichever lens it is handed', () => {
    const both = [edge(2, 1, { trust: 5, power_over: 2 })];
    expect(concentrationTable([1, 2], both, 'trust', 4).total).toBe(1);
    expect(concentrationTable([1, 2], both, 'power_over', 4).total).toBe(0);
  });
});

describe('rankTable', () => {
  const edges = [
    edge(2, 1, { trust: 5 }),
    edge(3, 1, { trust: 5 }),
    edge(1, 2, { power_over: 5 }),
    edge(3, 2, { power_over: 5 }),
    edge(1, 3, { trust: 5, power_over: 5 }),
  ];
  const nos = [1, 2, 3];

  it('keeps everybody, including the people whose two standings agree', () => {
    const rows = rankTable(nos, edges, 4);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.delta === 0)).toBe(true);
  });

  it('sorts by the widest disagreement first', () => {
    const deltas = rankTable(nos, edges, 4).map((r) => r.delta);
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });

  it('agrees exactly with the three rankDivergence rings the panes draw', () => {
    const ringed = rankDivergence(nos, edges, 4, 3);
    const table = new Map(rankTable(nos, edges, 4).map((r) => [r.no, r]));
    for (const d of ringed) {
      expect(table.get(d.no)!.trustRank).toBe(d.trustRank);
      expect(table.get(d.no)!.powerRank).toBe(d.powerRank);
      expect(table.get(d.no)!.delta).toBe(d.delta);
    }
  });

  it('gives equal counts equal rank rather than inventing a gap', () => {
    const flat = [edge(2, 1, { trust: 5, power_over: 5 }), edge(1, 2, { trust: 5, power_over: 5 })];
    for (const r of rankTable([1, 2], flat, 4)) expect(r.delta).toBe(0);
  });
});

describe('facetTable', () => {
  const edges = [
    edge(2, 1, { reliability: 5, openness: 5 }),
    edge(3, 1, { reliability: 5, openness: 2 }),
    edge(4, 1, { reliability: 5, openness: 2 }),
    edge(1, 2, { reliability: 2, openness: 5 }),
    edge(3, 2, { openness: 5 }),
  ];
  const nos = [1, 2, 3];

  it('counts each facet as its own lens and signs the gap', () => {
    const rows = facetTable(nos, edges, 4);
    const by = new Map(rows.map((r) => [r.no, r]));
    expect(by.get(1)).toEqual({ no: 1, reliabilityIn: 3, opennessIn: 1, gap: 2 });
    expect(by.get(2)).toEqual({ no: 2, reliabilityIn: 0, opennessIn: 2, gap: -2 });
    expect(by.get(3)).toEqual({ no: 3, reliabilityIn: 0, opennessIn: 0, gap: 0 });
  });

  it('sorts by the size of the gap, whichever way it leans', () => {
    expect(facetTable(nos, edges, 4).map((r) => Math.abs(r.gap))).toEqual([2, 2, 0]);
  });

  it('reads whichever pair of lenses it is handed', () => {
    const rows = facetTable(nos, edges, 4, 'openness', 'reliability');
    expect(rows.find((r) => r.no === 1)!.gap).toBe(-2);
  });
});

describe('silosMemberTable', () => {
  const roster = [
    member(1, { func: 'Ops' }),
    member(2, { func: 'Ops' }),
    member(3, { func: 'Sales' }),
    member(4, { func: '  ' }),
  ];
  const ties = [
    { from: 1, to: 2 }, // inside Ops
    { from: 1, to: 3 }, // Ops to Sales
    { from: 3, to: 4 }, // to an ungrouped person — not a subgroup tie at all
  ];

  it('splits each person`s ties into inside and outside their own group', () => {
    expect(silosMemberTable(roster, 'function', ties)).toEqual([
      { no: 1, group: 'Ops', withinTies: 1, outTies: 1 },
      { no: 2, group: 'Ops', withinTies: 1, outTies: 0 },
      { no: 3, group: 'Sales', withinTies: 0, outTies: 1 },
    ]);
  });

  it('leaves ungrouped people out entirely, exactly as the group rates do', () => {
    expect(silosMemberTable(roster, 'function', ties).some((r) => r.no === 4)).toBe(false);
  });

  it('counts a tie for both ends of it', () => {
    const rows = silosMemberTable(roster, 'function', [{ from: 1, to: 2 }]);
    expect(rows.map((r) => [r.no, r.withinTies])).toEqual([
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
  });

  it('re-keys on whichever line the reader asked for', () => {
    const withTenure = [
      member(1, { func: 'Ops', tenureBand: '<1y' }),
      member(2, { func: 'Sales', tenureBand: '<1y' }),
    ];
    expect(silosMemberTable(withTenure, 'tenure', [{ from: 1, to: 2 }])).toEqual([
      { no: 1, group: '<1y', withinTies: 1, outTies: 0 },
      { no: 2, group: '<1y', withinTies: 1, outTies: 0 },
    ]);
  });

  it('ignores a self-tie rather than counting it as cohesion', () => {
    expect(silosMemberTable(roster, 'function', [{ from: 1, to: 1 }])[0]!.withinTies).toBe(0);
  });
});

describe('topDecile', () => {
  it('takes the top tenth by rank, never by a value threshold', () => {
    const counts = new Map(Array.from({ length: 20 }, (_, i) => [i + 1, 20 - i]));
    expect([...topDecile(counts, 0.1)].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('always returns at least one person when anyone has been chosen', () => {
    expect(topDecile(new Map([[1, 3], [2, 1]]), 0.01).size).toBe(1);
  });

  it('never counts a zero — an empty decile is the honest answer', () => {
    expect(topDecile(new Map([[1, 0], [2, 0]])).size).toBe(0);
    expect(topDecile(new Map()).size).toBe(0);
  });

  it('breaks a tie on roster order, so the same data haloes the same people', () => {
    expect([...topDecile(new Map([[7, 2], [3, 2], [5, 1]]), 0.3)]).toEqual([3]);
  });
});

describe('oneWayPaneEdges and tieEndpoints', () => {
  const ties = [
    { a: 1, b: 2, aToB: 4.5, bToA: 2 as number | null, kind: 'not_returned' as const, gap: 2.5 },
    { a: 3, b: 2, aToB: 5, bToA: null, kind: 'no_basis' as const, gap: null },
  ];

  it('draws every one-way tie as a lone arrow, never as a mutual pair', () => {
    const drawn = oneWayPaneEdges(ties);
    expect(drawn.map((e) => [e.from, e.to, e.mutual])).toEqual([
      [1, 2, false],
      [3, 2, false],
    ]);
    expect(drawn.every((e) => e.bend === 0.12)).toBe(true);
  });

  it('carries the giver`s own mean, which is what sizes the wire', () => {
    expect(oneWayPaneEdges(ties)[0]!.mean).toBe(4.5);
  });

  it('names both ends of every tie — half a sentence is not a finding', () => {
    expect([...tieEndpoints(oneWayPaneEdges(ties))].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('is empty for a group whose every tie is returned', () => {
    expect(oneWayPaneEdges([])).toEqual([]);
    expect(tieEndpoints([]).size).toBe(0);
  });
});

describe('fadeExcept', () => {
  it('keeps the named people at full strength and pushes the rest back', () => {
    const fade = fadeExcept(new Set([1, 2]), 0.25);
    expect(fade(1)).toBe(1);
    expect(fade(9)).toBe(0.25);
  });

  it('fades nobody when the tab has nobody to name', () => {
    const fade = fadeExcept(new Set(), 0.25);
    expect(fade(1)).toBe(1);
  });
});
