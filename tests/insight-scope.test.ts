import { describe, expect, it } from 'vitest';
import {
  applyScope,
  EMPTY_SCOPE,
  memberInScope,
  scopedConcentration,
  scopeIsWhole,
  scopeOptions,
} from '../web/src/admin/network/model.js';
import type { CohortNetworkEdge, CohortRosterMember } from '../src/shared/types.js';

function member(no: number, func: string, tenureBand: string | null = null): CohortRosterMember {
  return { memberId: `m${no}`, no, name: `Person ${no}`, func, tenureBand };
}

function edge(from: number, to: number, trust: number): CohortNetworkEdge {
  return {
    from,
    to,
    n: 11,
    mean: trust,
    blocks: { trust: { mean: trust, n: 3, tie: trust >= 4 } },
    gap: null,
  };
}

const roster = [
  member(1, 'Sales', '<1y'),
  member(2, 'Sales', '3-7y'),
  member(3, ' Engineering ', '3-7y'),
  member(4, 'Engineering', null),
  member(5, '', '7y+'),
];
const ties = [edge(1, 2, 4.5), edge(2, 1, 4.2), edge(3, 1, 4.8), edge(1, 3, 2.1), edge(4, 3, 4.6), edge(5, 2, 4.0)];

describe('scopeOptions', () => {
  it('lists departments biggest first and tenure bands in band order, trimmed and counted', () => {
    const o = scopeOptions(roster);
    expect(o.funcs).toEqual([
      { key: 'Engineering', label: 'Engineering', count: 2 },
      { key: 'Sales', label: 'Sales', count: 2 },
    ]);
    expect(o.tenures.map((t) => t.key)).toEqual(['<1y', '3-7y', '7y+']);
    expect(o.tenures.find((t) => t.key === '3-7y')?.count).toBe(2);
  });
  it('skips blank functions and unrecorded tenure rather than inventing a bucket', () => {
    const o = scopeOptions(roster);
    expect(o.funcs.some((f) => f.key === '')).toBe(false);
    expect(o.tenures.some((t) => t.key === '')).toBe(false);
  });
});

describe('applyScope', () => {
  it('returns the very same arrays for the whole-cohort scope', () => {
    const out = applyScope(roster, ties, EMPTY_SCOPE);
    expect(out.nodes).toBe(roster);
    expect(out.edges).toBe(ties);
    expect(scopeIsWhole(EMPTY_SCOPE)).toBe(true);
  });
  it('keeps only matching members and the ties among them', () => {
    const out = applyScope(roster, ties, { funcs: new Set(['Sales']), tenures: new Set() });
    expect(out.nodes.map((n) => n.no)).toEqual([1, 2]);
    // 3→1 and 5→2 cross the boundary and are gone; 1↔2 stay.
    expect(out.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['1>2', '2>1']);
  });
  it('intersects department with tenure, and matches a trimmed function name', () => {
    const scope = { funcs: new Set(['Engineering']), tenures: new Set(['3-7y']) };
    expect(applyScope(roster, ties, scope).nodes.map((n) => n.no)).toEqual([3]);
    expect(memberInScope(member(9, 'Engineering', '<1y'), scope)).toBe(false);
  });
  it('lets two departments be scoped together', () => {
    const out = applyScope(roster, ties, { funcs: new Set(['Sales', 'Engineering']), tenures: new Set() });
    expect(out.nodes.map((n) => n.no)).toEqual([1, 2, 3, 4]);
    expect(out.edges.some((e) => e.from === 5)).toBe(false);
  });
});

describe('scopedConcentration', () => {
  it('is null below two rated members', () => {
    expect(scopedConcentration([1, 2], [edge(1, 2, 4.5)], 'trust', 4)).toBeNull();
  });
  it('is 0 when every rated member has the same tie rate', () => {
    expect(scopedConcentration([1, 2], [edge(1, 2, 4.5), edge(2, 1, 4.2)], 'trust', 4)).toBe(0);
  });
  it('is 1 when one person holds every tie and the rest hold none', () => {
    const e = [edge(1, 2, 4.5), edge(3, 2, 4.5), edge(2, 1, 2), edge(2, 3, 2)];
    expect(scopedConcentration([1, 2, 3], e, 'trust', 4)).toBe(1);
  });
  it('normalises by coverage the way the engine does', () => {
    // #2 rated by two, tied by one → 0.5; #1 rated by one, tied by one → 1.
    const e = [edge(1, 2, 4.5), edge(3, 2, 2), edge(2, 1, 4.5)];
    // max 1; shortfall 0.5; maxShortfall 1 × (2−1) = 1 → 0.5
    expect(scopedConcentration([1, 2, 3], e, 'trust', 4)).toBe(0.5);
  });
});
