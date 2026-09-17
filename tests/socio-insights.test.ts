import { describe, expect, it } from 'vitest';
import { socioInsights } from '../src/shared/socio-insights.js';
import { cellNo } from '../src/shared/socio.js';
import type { SocioMember, SocioResponseInput } from '../src/shared/socio-scoring.js';

const TRUST_ITEMS = [8, 9, 10];
const POWER_OVER_ITEMS = [5, 6, 7];

function member(no: number, name: string, func = 'Ops'): SocioMember {
  return { no, id: `m${no}`, name, func };
}

/** One rater's answers: `targets` maps a target position to the score given on every item listed. */
function response(
  raterNo: number,
  targets: Record<number, { items: number[]; value: number }[]>,
): SocioResponseInput {
  const answers: Record<number, number> = {};
  for (const [target, specs] of Object.entries(targets)) {
    for (const spec of specs) {
      for (const item of spec.items) answers[cellNo(Number(target), item)] = spec.value;
    }
  }
  return { raterNo, answers };
}

/** Everyone rates `hub` highly on trust, and nobody else. */
function starOnHub(members: SocioMember[], hub: number): SocioResponseInput[] {
  return members
    .filter((m) => m.no !== hub)
    .map((m) => response(m.no, { [hub]: [{ items: TRUST_ITEMS, value: 5 }] }));
}

describe('anchors', () => {
  const members = [1, 2, 3, 4, 5].map((n) => member(n, `P${n}`));

  it('ranks by how many colleagues put someone over the tie line', () => {
    const ins = socioInsights(members, starOnHub(members, 1), { tieThreshold: 4 });
    expect(ins.anchors.trusted[0]).toMatchObject({ memberNo: 1, name: 'P1', value: 4 });
    expect(ins.anchors.trusted).toHaveLength(1);
  });

  it('separates trust from power-over, and names whoever holds both', () => {
    const responses = [
      // P2 and P3 both trust P1; only P2 defers to P1.
      response(2, { 1: [{ items: TRUST_ITEMS, value: 5 }, { items: POWER_OVER_ITEMS, value: 5 }] }),
      response(3, { 1: [{ items: TRUST_ITEMS, value: 5 }] }),
      // P4 defers to P5 without trusting them.
      response(4, { 5: [{ items: POWER_OVER_ITEMS, value: 5 }] }),
    ];
    const ins = socioInsights(members, responses, { tieThreshold: 4 });
    expect(ins.anchors.trusted.map((m) => m.name)).toEqual(['P1']);
    expect(ins.anchors.influential.map((m) => m.name).sort()).toEqual(['P1', 'P5']);
    // P1 is over the line on both; P5 only on power.
    expect(ins.anchors.both).toEqual(['P1']);
  });
});

describe('bridges', () => {
  it('finds the one person two halves must pass through', () => {
    const members = [1, 2, 3, 4, 5].map((n) => member(n, `P${n}`));
    // A path 1-2-3-4-5 in trust: P3 sits between the halves.
    const pairs: [number, number][] = [[1, 2], [2, 3], [3, 4], [4, 5]];
    const responses = pairs.flatMap(([a, b]) => [
      response(a, { [b]: [{ items: TRUST_ITEMS, value: 5 }] }),
      response(b, { [a]: [{ items: TRUST_ITEMS, value: 5 }] }),
    ]);
    const ins = socioInsights(members, responses, { tieThreshold: 4 });
    expect(ins.bridges[0]!.name).toBe('P3');
  });
});

describe('clusters', () => {
  it('splits a group with no ties between its halves', () => {
    const members = [1, 2, 3, 4].map((n) => member(n, `P${n}`));
    const responses = [
      response(1, { 2: [{ items: TRUST_ITEMS, value: 5 }] }),
      response(2, { 1: [{ items: TRUST_ITEMS, value: 5 }] }),
      response(3, { 4: [{ items: TRUST_ITEMS, value: 5 }] }),
      response(4, { 3: [{ items: TRUST_ITEMS, value: 5 }] }),
    ];
    const ins = socioInsights(members, responses, { tieThreshold: 4 });
    expect(ins.clusters).toHaveLength(2);
    expect(ins.clusters.every((c) => c.size === 2)).toBe(true);
  });
});

describe('one-way trust', () => {
  it('separates a tie put below the line from one never rated', () => {
    const members = [1, 2, 3].map((n) => member(n, `P${n}`));
    const responses = [
      // P1 reaches P2; P2 rates back, but low.
      response(1, { 2: [{ items: TRUST_ITEMS, value: 5 }] }),
      response(2, { 1: [{ items: TRUST_ITEMS, value: 1 }] }),
      // P1 reaches P3; P3 never rates P1 at all.
      response(1, { 3: [{ items: TRUST_ITEMS, value: 5 }] }),
    ];
    const ins = socioInsights(members, responses, { tieThreshold: 4 });
    const kinds = new Map(ins.unreturned.map((u) => [u.to, u.kind]));
    expect(kinds.get('P2')).toBe('not_returned');
    expect(kinds.get('P3')).toBe('no_basis');
    // A gap only exists where there was a second number to subtract.
    expect(ins.unreturned.find((u) => u.to === 'P3')!.gap).toBeNull();
    expect(ins.unreturned.find((u) => u.to === 'P2')!.gap).toBe(4);
  });

  it('says nothing about a pair that ties both ways', () => {
    const members = [1, 2].map((n) => member(n, `P${n}`));
    const ins = socioInsights(
      members,
      [
        response(1, { 2: [{ items: TRUST_ITEMS, value: 5 }] }),
        response(2, { 1: [{ items: TRUST_ITEMS, value: 5 }] }),
      ],
      { tieThreshold: 4 },
    );
    expect(ins.unreturned).toEqual([]);
  });
});

describe('silos', () => {
  it('withholds the rates of a function too small to report on', () => {
    const members = [
      member(1, 'A', 'Sales'),
      member(2, 'B', 'Sales'),
      member(3, 'C', 'Sales'),
      member(4, 'D', 'Legal'),
      member(5, 'E', 'Legal'),
    ];
    const ins = socioInsights(members, starOnHub(members, 1), { tieThreshold: 4 });
    const legal = ins.silos.find((s) => s.key === 'Legal')!;
    expect(legal.size).toBe(2);
    expect(legal.suppressed).toBe(true);
    expect(legal.withinRate).toBeNull();
    // The larger function still reports.
    expect(ins.silos.find((s) => s.key === 'Sales')!.suppressed).toBe(false);
  });
});

describe('reliability against openness', () => {
  it('names the direction when the two come apart', () => {
    const members = [1, 2, 3].map((n) => member(n, `P${n}`));
    // Item 8 is reliability, item 9 openness: everyone delivers, nobody confides.
    const responses = [2, 3].map((n) =>
      response(n, { 1: [{ items: [8], value: 5 }, { items: [9], value: 1 }] }),
    );
    const ins = socioInsights(members, responses, { tieThreshold: 4 });
    expect(ins.reliabilityVsOpenness.reliability).toBe(1);
    expect(ins.reliabilityVsOpenness.openness).toBe(0);
    expect(ins.reliabilityVsOpenness.gap).toBe(1);
    expect(ins.reliabilityVsOpenness.verdict).toMatch(/relied on to deliver/);
  });

  it('says so plainly when neither statement was answered', () => {
    const members = [1, 2].map((n) => member(n, `P${n}`));
    const ins = socioInsights(members, [], { tieThreshold: 4 });
    expect(ins.reliabilityVsOpenness.gap).toBeNull();
    expect(ins.reliabilityVsOpenness.verdict).toMatch(/Not enough/);
  });
});
