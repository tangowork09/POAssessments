import { describe, expect, it } from 'vitest';
import { socioEdges } from '../src/shared/socio-scoring.js';
import { cellNo } from '../src/shared/socio.js';

/** Rater 1 rates member 2 on the given items. */
function answersFor(target: number, items: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [item, value] of Object.entries(items)) out[cellNo(target, Number(item))] = value;
  return out;
}

describe('socioEdges', () => {
  it('builds one directed edge per rated pair with per-block means', () => {
    const edges = socioEdges(
      [{ raterNo: 1, answers: answersFor(2, { 1: 5, 2: 5, 3: 5, 4: 5, 8: 3 }) }],
      4,
    );
    expect(edges).toHaveLength(1);
    const e = edges[0]!;
    expect(e.from).toBe(1);
    expect(e.to).toBe(2);
    expect(e.blocks.power_to).toEqual({ mean: 5, n: 4, tie: true });
    expect(e.blocks.trust).toEqual({ mean: 3, n: 1, tie: false });
    expect(e.n).toBe(5);
    expect(e.mean).toBeCloseTo(4.6, 2);
  });

  it('keeps the deficit item out of the asset mean and in gap', () => {
    const edges = socioEdges([{ raterNo: 1, answers: answersFor(2, { 11: 4, 12: 5 }) }], 4);
    const e = edges[0]!;
    expect(e.mean).toBe(4); // item 12 never inflates the asset mean
    expect(e.blocks.ease).toEqual({ mean: 4, n: 1, tie: true });
    expect(e.gap).toEqual({ mean: 5, n: 1 });
  });

  it('drops self-cells and empty pairs', () => {
    const edges = socioEdges(
      [{ raterNo: 2, answers: { ...answersFor(2, { 1: 5 }), ...answersFor(3, { 1: 4 }) } }],
      4,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.to).toBe(3);
  });

  it('draws the tie line exactly at the threshold', () => {
    const at = socioEdges([{ raterNo: 1, answers: answersFor(2, { 8: 4 }) }], 4)[0]!;
    const below = socioEdges([{ raterNo: 1, answers: answersFor(2, { 8: 4 }) }], 5)[0]!;
    expect(at.blocks.trust!.tie).toBe(true);
    expect(below.blocks.trust!.tie).toBe(false);
  });

  it('a gap-only pair still yields an edge with zero asset mean', () => {
    const e = socioEdges([{ raterNo: 1, answers: answersFor(2, { 12: 3 }) }], 4)[0]!;
    expect(e.n).toBe(0);
    expect(e.mean).toBe(0);
    expect(e.gap).toEqual({ mean: 3, n: 1 });
  });
});
