import { describe, expect, it } from 'vitest';
import {
  DIVERGENCE_FLOOR,
  divergenceColor,
  divergenceShareFinding,
  divergenceShares,
} from '../web/src/admin/network/model.js';
import type { CohortNetworkEdge } from '../src/shared/types.js';

function edge(from: number, to: number, lenses: Record<string, number>): CohortNetworkEdge {
  const blocks: Record<string, { mean: number; n: number; tie: boolean }> = {};
  for (const [k, mean] of Object.entries(lenses)) blocks[k] = { mean, n: 3, tie: mean >= 4 };
  return { from, to, n: 3, mean: 4, blocks, gap: null } as unknown as CohortNetworkEdge;
}

const MEMBERS = [1, 2, 3, 4, 5];

describe('divergenceShares', () => {
  // The bug this replaces: counts produced a handful of distinct ranks, so one
  // extra tie moved somebody dozens of "places".
  it('measures standing against the people who could rate them', () => {
    const edges = [
      edge(2, 1, { trust: 5 }),
      edge(3, 1, { trust: 5 }),
      edge(4, 1, { power_over: 5 }),
    ];
    // Person 1 was rated by 4 colleagues: 2 trust ties, 1 power tie.
    const rows = divergenceShares(MEMBERS, edges, 4, new Map([[1, 4]]));
    const one = rows.find((r) => r.no === 1)!;
    expect(one.trust).toBe(0.5);
    expect(one.power).toBe(0.25);
    expect(one.gap).toBe(-0.25);
  });

  it('is fair to somebody rated by fewer colleagues', () => {
    const edges = [edge(2, 1, { power_over: 5 }), edge(3, 1, { power_over: 5 })];
    // Two of two raters is the same standing as twenty of twenty.
    const few = divergenceShares(MEMBERS, edges, 4, new Map([[1, 2]])).find((r) => r.no === 1)!;
    expect(few.power).toBe(1);
  });

  it('says nothing about somebody nobody rated', () => {
    const row = divergenceShares(MEMBERS, [], 4, new Map()).find((r) => r.no === 1)!;
    expect(row).toEqual({ no: 1, trust: null, power: null, gap: null });
  });
});

describe('divergenceColor', () => {
  it('draws a small gap as level rather than as a finding', () => {
    const level = divergenceColor(DIVERGENCE_FLOOR - 0.01);
    expect(level).toBe(divergenceColor(0));
    expect(level).toBe(divergenceColor(null));
  });

  it('separates the two directions, and deepens with the gap', () => {
    const power = divergenceColor(0.5);
    const trust = divergenceColor(-0.5);
    expect(power).not.toBe(trust);
    expect(power).not.toBe(divergenceColor(0.1));
    expect(trust).not.toBe(divergenceColor(-0.1));
  });
});

describe('divergenceShareFinding', () => {
  const name = (no: number) => `P${no}`;

  it('names the widest gap and counts each direction', () => {
    const rows = [
      { no: 1, trust: 0.1, power: 0.8, gap: 0.7 },
      { no: 2, trust: 0.7, power: 0.2, gap: -0.5 },
      { no: 3, trust: 0.4, power: 0.4, gap: 0 },
    ];
    const v = divergenceShareFinding(rows, name);
    expect(v).toMatch(/^P1 is deferred to well beyond/);
    expect(v).toMatch(/2 of 3 stand apart/);
    expect(v).toMatch(/1 toward power and 1 toward trust/);
  });

  it('says they sit together when nothing clears the floor', () => {
    const rows = [{ no: 1, trust: 0.4, power: 0.42, gap: 0.02 }];
    expect(divergenceShareFinding(rows, name)).toMatch(/Trust and power sit together/);
  });

  it('says so when nobody was rated', () => {
    expect(divergenceShareFinding([{ no: 1, trust: null, power: null, gap: null }], name)).toMatch(
      /Nobody has been rated enough/,
    );
  });
});
