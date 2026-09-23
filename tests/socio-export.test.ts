import { describe, expect, it } from 'vitest';
import { cellNo } from '../src/shared/socio.js';
import { pseudonym, socioCriteriaRows, socioExportRows, type SocioExportResponse } from '../src/shared/socio-export.js';

const ROSTER = [
  { no: 1, name: 'Asha', func: 'Sales' },
  { no: 2, name: 'Bilal', func: 'Sales' },
  { no: 3, name: 'Chen', func: 'Ops' },
];

/** rater → target → item → score */
function resp(raterNo: number, targets: Record<number, Record<number, number>>, at = '2026-09-01 10:00:00'): SocioExportResponse {
  const answers: Record<number, number> = {};
  for (const [t, items] of Object.entries(targets)) {
    for (const [i, v] of Object.entries(items)) answers[cellNo(Number(t), Number(i))] = v;
  }
  return { raterNo, submittedAt: at, answers };
}

const RESPONSES = [
  resp(1, { 2: { 8: 5, 12: 2 }, 3: { 5: 4 } }),
  resp(2, { 1: { 1: 3 }, 3: { 8: 1 } }),
  resp(3, { 1: { 11: 4 } }),
];

describe('socioExportRows', () => {
  it('decodes every cell into rater, ratee, criterion and block', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 2, scope: 'whole', nameRaters: true });
    expect(rows).toHaveLength(6);
    const r = rows.find((x) => x.raterNo === 1 && x.rateeNo === 2 && x.itemNo === 12)!;
    expect(r).toMatchObject({
      round: 2,
      raterName: 'Asha',
      raterFunc: 'Sales',
      rateeName: 'Bilal',
      rateeFunc: 'Sales',
      criterion: 'Wish for more support',
      block: 'Support gap',
      score: 2,
      submittedAt: '2026-09-01 10:00:00',
    });
    expect(rows.find((x) => x.itemNo === 5)!.block).toBe('Power over');
    expect(rows.find((x) => x.itemNo === 8)!.block).toBe('Trust');
  });

  it('never exports a self cell, and drops out-of-range values', () => {
    const rows = socioExportRows(
      ROSTER,
      [resp(1, { 1: { 8: 5 }, 2: { 8: 9, 9: 0, 10: 4 } })],
      { round: 1, scope: 'whole', nameRaters: true },
    );
    expect(rows.map((r) => [r.rateeNo, r.itemNo])).toEqual([[2, 10]]);
  });

  it('department scope keeps ratings received by that function, from any rater', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'department', dept: ' ops ', nameRaters: true });
    expect(rows.every((r) => r.rateeFunc === 'Ops')).toBe(true);
    expect(rows.map((r) => r.raterFunc).sort()).toEqual(['Sales', 'Sales']);
  });

  it('member scope keeps only what that person received', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'member', memberNo: 1, nameRaters: true });
    expect(rows.map((r) => [r.raterNo, r.itemNo])).toEqual([[2, 1], [3, 11]]);
  });

  it('pseudonymises raters when names are withheld, keeping ratees and functions', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'whole', nameRaters: false });
    expect(rows.every((r) => /^Rater \d{2}$/.test(r.raterName))).toBe(true);
    expect(rows.some((r) => r.rateeName === 'Asha')).toBe(true);
    expect(rows.some((r) => r.raterFunc === 'Ops')).toBe(true);
    expect(pseudonym(3)).toBe('Rater 03');
  });

  it('gives away nothing that maps a pseudonym back to the roster', () => {
    // The ratee column carries roster numbers beside names, so a label keyed on
    // roster position ("Rater 02" = #2) would undo the whole point.
    const raterNos = [...new Set(RESPONSES.map((r) => r.raterNo))];
    for (let seed = 1; seed <= 40; seed++) {
      const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'whole', nameRaters: false, pseudonymSeed: seed });
      expect(rows.every((r) => r.raterNo === 0 && r.submittedAt === '')).toBe(true);
    }
    // Across seeds the same rater gets different labels, so no seed-free mapping exists.
    const labelsForFirst = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'member', memberNo: 1, nameRaters: false, pseudonymSeed: i + 1 });
        return rows[0]!.raterName;
      }),
    );
    expect(labelsForFirst.size).toBeGreaterThan(1);
    expect(raterNos.length).toBeGreaterThan(1);
  });

  it('keeps one label per rater within an export', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'whole', nameRaters: false, pseudonymSeed: 7 });
    const named = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'whole', nameRaters: true });
    const distinct = new Set(rows.map((r) => r.raterName));
    expect(distinct.size).toBe(new Set(named.map((r) => r.raterNo)).size);
  });

  it('orders by ratee, then rater, then item', () => {
    const rows = socioExportRows(ROSTER, RESPONSES, { round: 1, scope: 'whole', nameRaters: true });
    const keys = rows.map((r) => r.rateeNo * 10_000 + r.raterNo * 100 + r.itemNo);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });
});

describe('socioCriteriaRows', () => {
  it('lists all twelve statements, with item 12 marked as a deficit', () => {
    const c = socioCriteriaRows();
    expect(c).toHaveLength(12);
    expect(c[11]!.polarity).toMatch(/Deficit/);
    expect(c[0]!.block).toBe('Power to/with');
  });
});
