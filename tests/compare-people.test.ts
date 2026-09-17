import { describe, expect, it } from 'vitest';
import {
  comparePeople,
  metricLeader,
  pairVerdict,
  shortlistVerdict,
} from '../web/src/admin/network/model.js';
import type { CohortNetworkEdge } from '../src/shared/types.js';

/** One directed edge carrying the same mean under every lens named. */
function edge(from: number, to: number, lenses: Record<string, number>): CohortNetworkEdge {
  const blocks: Record<string, { mean: number; n: number; tie: boolean }> = {};
  for (const [k, mean] of Object.entries(lenses)) blocks[k] = { mean, n: 3, tie: mean >= 4 };
  return { from, to, n: 3, mean: 4, blocks, gap: null } as unknown as CohortNetworkEdge;
}

const MEMBERS = [1, 2, 3, 4];

describe('comparePeople', () => {
  it('counts trust and power received separately', () => {
    const edges = [
      edge(2, 1, { trust: 5 }),
      edge(3, 1, { trust: 5 }),
      edge(4, 2, { power_over: 5 }),
      edge(3, 2, { power_over: 5 }),
    ];
    const m = comparePeople([1, 2], MEMBERS, edges, 4);
    const trust = m.find((x) => x.key === 'trustIn')!;
    const power = m.find((x) => x.key === 'powerIn')!;
    expect(trust.values).toEqual([2, 0]);
    expect(power.values).toEqual([0, 2]);
    // Person 1 leads trust, person 2 leads power.
    expect(metricLeader(trust)).toBe(0);
    expect(metricLeader(power)).toBe(1);
  });

  it('reads trust returned as a share of the trust given', () => {
    const edges = [
      // 1 trusts two people; one returns it.
      edge(1, 2, { trust: 5 }),
      edge(2, 1, { trust: 5 }),
      edge(1, 3, { trust: 5 }),
      // 2 trusts one person, and it is returned.
      edge(2, 4, { trust: 5 }),
      edge(4, 2, { trust: 5 }),
    ];
    const m = comparePeople([1, 2], MEMBERS, edges, 4);
    const returned = m.find((x) => x.key === 'returned')!;
    expect(returned.values[0]).toBeCloseTo(0.5, 5);
    expect(returned.values[1]).toBe(1);
    expect(returned.texts).toEqual(['50%', '100%']);
    expect(metricLeader(returned)).toBe(1);
  });

  it('says nothing about trust returned for somebody who extends none', () => {
    const m = comparePeople([1, 2], MEMBERS, [edge(2, 1, { trust: 5 })], 4);
    const returned = m.find((x) => x.key === 'returned')!;
    expect(returned.values[0]).toBeNull();
    expect(returned.texts[0]).toBe('—');
  });

  // Betweenness and coverage describe the group and the response rate; calling
  // a winner on them would invent a judgement the instrument does not make.
  it('never names a leader on a structural measure', () => {
    const edges = [edge(1, 2, { trust: 5 }), edge(2, 3, { trust: 5 })];
    const m = comparePeople([1, 2], MEMBERS, edges, 4);
    for (const key of ['bridge', 'coverage', 'trustOut']) {
      const metric = m.find((x) => x.key === key)!;
      expect(metric.better).toBe('none');
      expect(metricLeader(metric)).toBeNull();
    }
  });

  it('calls a dead heat no leader', () => {
    const edges = [edge(3, 1, { trust: 5 }), edge(3, 2, { trust: 5 })];
    const m = comparePeople([1, 2], MEMBERS, edges, 4);
    expect(metricLeader(m.find((x) => x.key === 'trustIn')!)).toBeNull();
  });

  it('compares more than two people, for the shortlist table', () => {
    const edges = [edge(4, 1, { trust: 5 }), edge(3, 1, { trust: 5 }), edge(4, 2, { trust: 5 })];
    const m = comparePeople([1, 2, 3], MEMBERS, edges, 4);
    expect(m.find((x) => x.key === 'trustIn')!.values).toEqual([2, 1, 0]);
  });
});

describe('pairVerdict', () => {
  it('names where each of the two leads', () => {
    const edges = [
      edge(2, 1, { trust: 5 }),
      edge(3, 1, { trust: 5 }),
      edge(4, 2, { power_over: 5 }),
    ];
    const m = comparePeople([1, 2], MEMBERS, edges, 4);
    const v = pairVerdict(['Kira', 'Tango'], m);
    expect(v).toMatch(/Kira leads on trust received/);
    expect(v).toMatch(/Tango leads on power over received/);
  });

  it('says so plainly when nobody leads anywhere', () => {
    const m = comparePeople([1, 2], MEMBERS, [], 4);
    expect(pairVerdict(['Kira', 'Tango'], m)).toBe('Kira and Tango stand level on every measure here.');
  });
});


describe('shortlistVerdict', () => {
  const members = [1, 2, 3, 4, 5];

  it('falls back to the pair sentence for exactly two', () => {
    const edges = [edge(3, 1, { trust: 5 })];
    const m = comparePeople([1, 2], members, edges, 4);
    expect(shortlistVerdict(['Kira', 'Tango'], m)).toBe(pairVerdict(['Kira', 'Tango'], m));
  });

  it('names who leads the most measures, and how many are level', () => {
    const edges = [
      // 1 leads trust received; everything else is level at zero.
      edge(4, 1, { trust: 5 }),
      edge(5, 1, { trust: 5 }),
    ];
    const m = comparePeople([1, 2, 3], members, edges, 4);
    const v = shortlistVerdict(['Kira', 'Tango', 'Priya'], m);
    expect(v).toMatch(/^Kira leads on 1 of 5 measures/);
    // The other four judgeable measures are dead heats at zero.
    expect(v).toMatch(/4 are level/);
  });

  it('names every winner when several tie at the top', () => {
    const edges = [edge(4, 1, { trust: 5 }), edge(4, 2, { power_over: 5 })];
    const m = comparePeople([1, 2, 3], members, edges, 4);
    const v = shortlistVerdict(['Kira', 'Tango', 'Priya'], m);
    expect(v).toMatch(/Kira and Tango each lead on 1 of 5 measures/);
  });

  it('says so when nobody leads anything', () => {
    const m = comparePeople([1, 2, 3], members, [], 4);
    expect(shortlistVerdict(['Kira', 'Tango', 'Priya'], m)).toMatch(
      /These 3 stand level on all 5 measures/,
    );
  });

  it('has nothing to say about fewer than two people', () => {
    const m = comparePeople([1], members, [], 4);
    expect(shortlistVerdict(['Kira'], m)).toBe('');
  });
});
