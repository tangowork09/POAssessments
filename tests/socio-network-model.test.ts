import { describe, expect, it } from 'vitest';
import { degrees, edgePolarity, roles } from '../web/src/admin/network/model.js';
import type { CohortNetworkEdge } from '../src/shared/types.js';

function edge(from: number, to: number, mean: number, gap?: number): CohortNetworkEdge {
  return {
    from,
    to,
    n: 11,
    mean,
    blocks: { trust: { mean, n: 3, tie: mean >= 4 } },
    gap: gap === undefined ? null : { mean: gap, n: 1 },
  };
}

describe('edgePolarity', () => {
  it('is positive at or above the tie threshold', () => {
    expect(edgePolarity(edge(1, 2, 4), 'overall', 4)).toBe('positive');
    expect(edgePolarity(edge(1, 2, 4.6), 'overall', 4)).toBe('positive');
  });
  it('is negative when cool or when the deficit item is loud', () => {
    expect(edgePolarity(edge(1, 2, 1.8), 'overall', 4)).toBe('negative');
    expect(edgePolarity(edge(1, 2, 3.2, 5), 'overall', 4)).toBe('negative'); // high gap
  });
  it('is neutral between the cool line and the tie threshold', () => {
    expect(edgePolarity(edge(1, 2, 3), 'overall', 4)).toBe('neutral');
  });
  it('reads the chosen block, not the overall mean', () => {
    const e = edge(1, 2, 2); // overall low
    e.blocks.trust = { mean: 4.5, n: 3, tie: true };
    expect(edgePolarity(e, 'trust', 4)).toBe('positive');
  });
});

describe('degrees + roles', () => {
  it('splits in/out degree by polarity', () => {
    const d = degrees([1, 2, 3], [edge(2, 1, 5), edge(3, 1, 1.5), edge(1, 2, 4.2)], 'overall', 4);
    expect(d.get(1)).toMatchObject({ posIn: 1, negIn: 1, posOut: 1 });
    expect(d.get(2)!.posIn).toBe(1);
  });

  it('marks an untied person an isolate', () => {
    const d = degrees([1, 2], [edge(1, 2, 4)], 'overall', 4);
    expect(roles(d).get(2)).not.toBe('isolate'); // received a tie
    const alone = degrees([9], [], 'overall', 4);
    expect(roles(alone).get(9)).toBe('isolate');
  });

  it('marks a net-cool person rejected', () => {
    const edges = [edge(2, 1, 1.5), edge(3, 1, 1.4), edge(4, 1, 1.6)];
    const d = degrees([1, 2, 3, 4], edges, 'overall', 4);
    expect(roles(d).get(1)).toBe('rejected');
  });

  it('marks the most-chosen person a star', () => {
    // Person 1 gets 4 positive ties; nobody else gets any.
    const edges = [edge(2, 1, 5), edge(3, 1, 5), edge(4, 1, 5), edge(5, 1, 5)];
    const d = degrees([1, 2, 3, 4, 5], edges, 'overall', 4);
    expect(roles(d).get(1)).toBe('star');
  });
});
