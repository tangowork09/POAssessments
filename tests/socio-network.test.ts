import { describe, expect, it } from 'vitest';
import {
  betweenness,
  communities,
  subgroupCohesion,
  unreciprocatedTies,
  type DirectedTie,
} from '../src/shared/socio-network.js';
import { socioEdges } from '../src/shared/socio-scoring.js';
import {
  SOCIO_BLOCK_BY_KEY,
  SOCIO_OPENNESS_ITEM,
  SOCIO_RELIABILITY_ITEM,
  cellNo,
} from '../src/shared/socio.js';

/** Both directions of each listed pair, the shape a mutual relationship takes. */
function bidirectional(pairs: readonly [number, number][]): DirectedTie[] {
  return pairs.flatMap(([a, b]) => [
    { from: a, to: b },
    { from: b, to: a },
  ]);
}

describe('betweenness', () => {
  it('puts the middle of a chain on every path and its ends on none', () => {
    // 1 — 2 — 3 — 4 — 5. Node 3 sits between both halves; 1 and 5 are termini.
    const nodes = [1, 2, 3, 4, 5];
    const b = betweenness(nodes, bidirectional([[1, 2], [2, 3], [3, 4], [4, 5]]));

    expect(b.get(1)).toBe(0);
    expect(b.get(5)).toBe(0);
    expect(b.get(3)!).toBeGreaterThan(b.get(2)!);
    expect(b.get(3)!).toBeGreaterThan(b.get(4)!);
    // 8 of the 12 ordered pairs among the other four run through node 3.
    expect(b.get(3)).toBeCloseTo(8 / 12, 6);
    expect(b.get(2)).toBeCloseTo(6 / 12, 6);
  });

  it('scores the hub of a star at exactly 1 after normalisation', () => {
    // Every path between two leaves goes through the centre, and there is no
    // other kind of pair, so the centre holds the whole of what it could hold.
    const b = betweenness([1, 2, 3, 4, 5], bidirectional([[1, 2], [1, 3], [1, 4], [1, 5]]));
    expect(b.get(1)).toBe(1);
    for (const leaf of [2, 3, 4, 5]) expect(b.get(leaf)).toBe(0);
  });

  it('has nothing to measure below three nodes', () => {
    expect([...betweenness([], [])]).toEqual([]);
    const two = betweenness([1, 2], bidirectional([[1, 2]]));
    expect([...two.values()]).toEqual([0, 0]);
    // A three-node cohort has pairs, but an empty one still scores flat.
    const bare = betweenness([1, 2, 3], []);
    expect([...bare.values()]).toEqual([0, 0, 0]);
  });

  it('ignores self-ties and ties reaching off the roster', () => {
    const clean = betweenness([1, 2, 3], bidirectional([[1, 2], [2, 3]]));
    const noisy = betweenness([1, 2, 3], [
      ...bidirectional([[1, 2], [2, 3]]),
      { from: 2, to: 2 },
      { from: 1, to: 99 },
      { from: 99, to: 3 },
    ]);
    expect([...noisy]).toEqual([...clean]);
  });
});

describe('communities', () => {
  const BARBELL: [number, number][] = [
    [1, 2], [2, 3], [1, 3], // triangle
    [3, 4], //                bridge
    [4, 5], [5, 6], [4, 6], // triangle
  ];

  it('splits two triangles joined by a single bridge', () => {
    const c = communities([1, 2, 3, 4, 5, 6], bidirectional(BARBELL));
    expect(new Set(c.values()).size).toBe(2);
    expect(c.get(1)).toBe(c.get(2));
    expect(c.get(2)).toBe(c.get(3));
    expect(c.get(4)).toBe(c.get(5));
    expect(c.get(5)).toBe(c.get(6));
    expect(c.get(3)).not.toBe(c.get(4));
    // Numbered by smallest member, so the triangle holding node 1 is community 0.
    expect(c.get(1)).toBe(0);
    expect(c.get(4)).toBe(1);
  });

  it('leaves a fully connected group whole', () => {
    const c = communities([1, 2, 3, 4], bidirectional([[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]));
    expect(new Set(c.values()).size).toBe(1);
    expect([...c.values()].every((v) => v === 0)).toBe(true);
  });

  it('gives every unconnected member a community of their own', () => {
    const c = communities([1, 2, 3], []);
    expect([...c]).toEqual([[1, 0], [2, 1], [3, 2]]);
  });

  it('projects a one-way tie as contact rather than requiring reciprocity', () => {
    // Nobody rates back, but these two are plainly in each other's world.
    const c = communities([1, 2, 3], [{ from: 1, to: 2 }]);
    expect(c.get(1)).toBe(c.get(2));
    expect(c.get(3)).not.toBe(c.get(1));
  });

  it('returns the same numbering on every run', () => {
    const ties = bidirectional(BARBELL);
    expect([...communities([1, 2, 3, 4, 5, 6], ties)]).toEqual(
      [...communities([1, 2, 3, 4, 5, 6], ties)],
    );
  });
});

describe('unreciprocatedTies', () => {
  const EDGES = [
    { from: 1, to: 2, mean: 5 }, //   Alice reaches Bob; Bob rates her well below
    { from: 2, to: 1, mean: 2 },
    { from: 1, to: 3, mean: 4.5 }, // Cara never rated Alice at all
    { from: 1, to: 4, mean: 4.5 }, // Dan returns it: reciprocated
    { from: 4, to: 1, mean: 4 },
    { from: 5, to: 6, mean: 4 }, //   a narrower version of the first case
    { from: 6, to: 5, mean: 3 },
  ];

  it('separates a tie that was returned cool from one with no basis behind it', () => {
    const out = unreciprocatedTies(EDGES, 4);
    const rated = out.find((t) => t.a === 1 && t.b === 2)!;
    expect(rated.kind).toBe('not_returned');
    expect(rated.bToA).toBe(2);
    expect(rated.gap).toBe(3);

    const unrated = out.find((t) => t.a === 1 && t.b === 3)!;
    expect(unrated.kind).toBe('no_basis');
    expect(unrated.bToA).toBeNull();
    expect(unrated.gap).toBeNull();
  });

  it('excludes a pair that ties in both directions', () => {
    const out = unreciprocatedTies(EDGES, 4);
    expect(out.some((t) => t.a === 1 && t.b === 4)).toBe(false);
    expect(out.some((t) => t.a === 4 && t.b === 1)).toBe(false);
  });

  it('leads with the widest rated asymmetry and puts the unrated ones last', () => {
    const out = unreciprocatedTies(EDGES, 4);
    expect(out.map((t) => [t.a, t.b])).toEqual([
      [1, 2], // not_returned, gap 3
      [5, 6], // not_returned, gap 1
      [1, 3], // no_basis
    ]);
  });

  it('reads a null mean as no basis rather than as a low rating', () => {
    const out = unreciprocatedTies(
      [
        { from: 1, to: 2, mean: 5 },
        { from: 2, to: 1, mean: null },
      ],
      4,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('no_basis');
  });

  it('says nothing about a pair below the threshold in the first place', () => {
    expect(unreciprocatedTies([{ from: 1, to: 2, mean: 3 }], 4)).toEqual([]);
  });
});

describe('subgroupCohesion', () => {
  it('shows a silo as a within-rate well above the out-rate', () => {
    const members = [
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: 'Ops' },
      { no: 4, group: 'R&D' },
      { no: 5, group: 'R&D' },
      { no: 6, group: 'R&D' },
    ];
    const ties = bidirectional([
      [1, 2], [1, 3], [2, 3], // Ops talks to itself
      [4, 5], [4, 6], [5, 6], // so does R&D
      [3, 4], //                one relationship across the seam
    ]);

    const [ops, rnd] = subgroupCohesion(members, ties);
    expect(ops!.key).toBe('Ops');
    expect(ops!.size).toBe(3);
    expect(ops!.withinPossible).toBe(6);
    expect(ops!.withinTies).toBe(6);
    expect(ops!.withinRate).toBe(1);
    expect(ops!.outPossible).toBe(9);
    expect(ops!.outTies).toBe(1);
    expect(ops!.outRate).toBe(0.11);
    expect(ops!.withinRate!).toBeGreaterThan(ops!.outRate!);
    expect(rnd!.withinRate!).toBeGreaterThan(rnd!.outRate!);
    expect(ops!.suppressed).toBe(false);
  });

  it('withholds the rates of a group small enough to identify people in', () => {
    const members = [
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: 'Ops' },
      { no: 4, group: 'Legal' },
      { no: 5, group: 'Legal' },
    ];
    const ties = bidirectional([[1, 2], [4, 5], [1, 4]]);
    const legal = subgroupCohesion(members, ties).find((s) => s.key === 'Legal')!;

    expect(legal.size).toBe(2);
    expect(legal.suppressed).toBe(true);
    expect(legal.withinRate).toBeNull();
    expect(legal.outRate).toBeNull();
    // The counts stay: they are why the row is on the page at all.
    expect(legal.withinTies).toBe(2);
    expect(legal.outTies).toBe(1);
  });

  it('leaves ungrouped members out of the analysis entirely', () => {
    const members = [
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: 'Ops' },
      { no: 4, group: null },
      { no: 5, group: '' },
    ];
    const stats = subgroupCohesion(members, bidirectional([[1, 2], [1, 4], [1, 5]]));
    expect(stats).toHaveLength(1);
    // Nobody is left to be outside Ops, so there is no out-rate to report.
    expect(stats[0]!.outPossible).toBe(0);
    expect(stats[0]!.outRate).toBeNull();
    expect(stats[0]!.outTies).toBe(0);
  });

  it('sorts by size, then by name', () => {
    const members = [
      { no: 1, group: 'Ops' },
      { no: 2, group: 'Ops' },
      { no: 3, group: 'Ops' },
      { no: 4, group: 'Quality' },
      { no: 5, group: 'Quality' },
      { no: 6, group: 'Legal' },
      { no: 7, group: 'Legal' },
    ];
    expect(subgroupCohesion(members, []).map((s) => s.key)).toEqual(['Ops', 'Legal', 'Quality']);
  });
});

describe('socioEdges trust lenses', () => {
  /** One rater's row aimed at one target. */
  function answersFor(target: number, items: Record<number, number>): Record<number, number> {
    const out: Record<number, number> = {};
    for (const [item, value] of Object.entries(items)) out[cellNo(target, Number(item))] = value;
    return out;
  }

  it('draws both facets from inside the trust block, and leaves item 10 out', () => {
    const trust = SOCIO_BLOCK_BY_KEY.trust!.items;
    expect(trust).toContain(SOCIO_RELIABILITY_ITEM);
    expect(trust).toContain(SOCIO_OPENNESS_ITEM);
    // Item 10 is double-barrelled and belongs to neither facet on its own.
    expect(trust.filter((i) => i !== SOCIO_RELIABILITY_ITEM && i !== SOCIO_OPENNESS_ITEM)).toEqual([10]);
  });

  it('reads reliability and openness as separate single-item lenses', () => {
    // Delivers reliably (8 = 5), but not somebody you could be wrong in front
    // of (9 = 2) — the split the overall trust mean of 3 would hide.
    const e = socioEdges([{ raterNo: 1, answers: answersFor(2, { 8: 5, 9: 2, 10: 2 }) }], 4)[0]!;

    expect(e.blocks.reliability).toEqual({ mean: 5, n: 1, tie: true });
    expect(e.blocks.openness).toEqual({ mean: 2, n: 1, tie: false });
    // The real block is untouched: still the mean of items 8, 9 and 10.
    expect(e.blocks.trust).toEqual({ mean: 3, n: 3, tie: false });
  });

  it('does not let the lenses count twice toward the overall mean of the pair', () => {
    const e = socioEdges([{ raterNo: 1, answers: answersFor(2, { 8: 5, 9: 2, 10: 2 }) }], 4)[0]!;
    expect(e.n).toBe(3);
    expect(e.mean).toBe(3);
  });

  it('omits a lens whose item was left blank, as the real blocks do', () => {
    const e = socioEdges([{ raterNo: 1, answers: answersFor(2, { 8: 4 }) }], 4)[0]!;
    expect(e.blocks.reliability).toEqual({ mean: 4, n: 1, tie: true });
    expect(e.blocks.openness).toBeUndefined();
    expect(e.blocks.trust).toEqual({ mean: 4, n: 1, tie: true });
  });
});
