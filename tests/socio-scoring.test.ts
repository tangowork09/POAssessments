import { describe, expect, it } from 'vitest';
import {
  SOCIO_BLOCKS,
  SOCIO_ITEMS,
  SOCIO_ITEM_COUNT,
  SOCIO_MAX_ANSWER,
  SOCIO_SUPPORT_GAP_ITEM,
  cellNo,
  cellsForMember,
  decodeCell,
} from '../src/shared/socio.js';
import {
  SocioScoringError,
  memberResultFor,
  scoreSocioCohort,
  socioBandFor,
  socioGapBandFor,
  socioGroupSummary,
  socioMemberSummary,
  type SocioMember,
  type SocioResponseInput,
} from '../src/shared/socio-scoring.js';

/**
 * A four-person cohort small enough that every figure below is worked out by
 * hand in the comments, rather than snapshotted from whatever the code happened
 * to produce.
 *
 *   1 Alice (Operations)   2 Bob (Quality)   3 Cara (R&D)   4 Dan (IT)
 *
 * Alice, Bob and Cara respond; Dan does not. Nobody rates Dan, and nobody rates
 * themselves. Every rated row is complete.
 */
const MEMBERS: SocioMember[] = [
  { no: 1, id: 'm1', name: 'Alice', func: 'Operations' },
  { no: 2, id: 'm2', name: 'Bob', func: 'Quality' },
  { no: 3, id: 'm3', name: 'Cara', func: 'R&D' },
  { no: 4, id: 'm4', name: 'Dan', func: 'IT' },
];

/** A complete row: `assets` on items 1..11, `gap` on item 12. */
function row(targetNo: number, assets: number, gap = assets): Record<number, number> {
  const out: Record<number, number> = {};
  for (const item of SOCIO_ITEMS) {
    out[cellNo(targetNo, item.no)] = item.no === SOCIO_SUPPORT_GAP_ITEM ? gap : assets;
  }
  return out;
}

const RESPONSES: SocioResponseInput[] = [
  // Alice rates Bob 5s (but asks nothing more of him), and Cara 3s.
  { raterNo: 1, answers: { ...row(2, 5, 1), ...row(3, 3) } },
  // Bob rates Alice 4s throughout, and Cara 2s.
  { raterNo: 2, answers: { ...row(1, 4), ...row(3, 2) } },
  // Cara rates Alice 5s and Bob 4s.
  { raterNo: 3, answers: { ...row(1, 5), ...row(2, 4) } },
];

function score(responses = RESPONSES, minRaters = 2) {
  return scoreSocioCohort(MEMBERS, responses, { minRaters });
}

describe('answer encoding', () => {
  it('round-trips every cell of a fifty-person roster', () => {
    for (let memberNo = 1; memberNo <= 50; memberNo++) {
      for (let itemNo = 1; itemNo <= SOCIO_ITEM_COUNT; itemNo++) {
        expect(decodeCell(cellNo(memberNo, itemNo))).toEqual({ memberNo, itemNo });
      }
    }
  });

  it('gives each roster position a contiguous, non-overlapping block', () => {
    expect(cellsForMember(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(cellsForMember(2)[0]).toBe(13);
    const seen = new Set<number>();
    for (let m = 1; m <= 20; m++) {
      for (const no of cellsForMember(m)) {
        expect(seen.has(no)).toBe(false);
        seen.add(no);
      }
    }
  });
});

describe('instrument definition', () => {
  it('has twelve items across four asset blocks plus one deficit item', () => {
    expect(SOCIO_ITEMS).toHaveLength(SOCIO_ITEM_COUNT);
    const blocked = SOCIO_BLOCKS.flatMap((b) => b.items).sort((a, b) => a - b);
    expect(blocked).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const deficits = SOCIO_ITEMS.filter((i) => i.polarity === 'deficit');
    expect(deficits.map((i) => i.no)).toEqual([SOCIO_SUPPORT_GAP_ITEM]);
  });

  it('keeps the deficit item out of every block, so it cannot be averaged in', () => {
    for (const block of SOCIO_BLOCKS) {
      expect(block.items).not.toContain(SOCIO_SUPPORT_GAP_ITEM);
    }
  });
});

describe('cohort totals', () => {
  const g = score();

  it('counts respondents against the roster, not against itself', () => {
    expect(g.rosterSize).toBe(4);
    expect(g.respondents).toBe(3);
    expect(g.responseRate).toBe(0.75);
  });

  it('measures working contact as rated pairs over pairs those respondents could rate', () => {
    // Three respondents x three colleagues each = 9 possible; 6 were rated.
    expect(g.possiblePairs).toBe(9);
    expect(g.ratingsGiven).toBe(6);
    expect(g.acquaintance).toBe(0.67);
  });

  it('averages the cohort over asset items only', () => {
    // 11 asset items per row: 5,3,4,2,5,4 across six rows
    // = (55 + 33 + 44 + 22 + 55 + 44) / 66 = 253/66 = 3.8333...
    expect(g.cohortMean).toBe(3.83);
  });
});

describe('what a member receives', () => {
  const g = score();
  const alice = memberResultFor(g, 1)!;
  const cara = memberResultFor(g, 3)!;
  const dan = memberResultFor(g, 4)!;

  it('averages each block over the raters who rated it', () => {
    // Alice was rated 4 by Bob and 5 by Cara.
    expect(alice.coverage).toBe(2);
    expect(alice.possibleRaters).toBe(2);
    expect(alice.blocks.find((b) => b.blockKey === 'trust')!.mean).toBe(4.5);
    expect(alice.blocks.find((b) => b.blockKey === 'power_over')!.mean).toBe(4.5);
    expect(alice.authorityTrustGap).toBe(0);
  });

  it('scores the support gap separately from the blocks', () => {
    // Bob asked for 4 more, Cara for 5 — despite Alice's blocks reading well.
    expect(alice.supportGap.mean).toBe(4.5);
    expect(alice.supportGap.n).toBe(2);
    expect(alice.supportGap.band).toBe('Marked');

    // Alice rated Bob 5 everywhere but asked nothing more of him.
    const bob = memberResultFor(g, 2)!;
    expect(bob.supportGap.mean).toBe(2.5);
    expect(bob.supportGap.band).toBe('Some');
  });

  it('draws a tie only at or above the threshold', () => {
    const aliceTrust = alice.blocks.find((b) => b.blockKey === 'trust')!;
    expect(aliceTrust.ties).toBe(2);
    expect(aliceTrust.tieRate).toBe(1);

    // Cara was rated 3 and 2: rated by two people, tied to by neither.
    const caraTrust = cara.blocks.find((b) => b.blockKey === 'trust')!;
    expect(cara.coverage).toBe(2);
    expect(caraTrust.ties).toBe(0);
    expect(caraTrust.tieRate).toBe(0);
  });

  it('leaves an unrated member empty rather than zero', () => {
    expect(dan.coverage).toBe(0);
    expect(dan.responded).toBe(false);
    for (const b of dan.blocks) {
      expect(b.mean).toBeNull();
      expect(b.n).toBe(0);
      expect(b.band).toBeNull();
    }
    expect(dan.authorityTrustGap).toBeNull();
    expect(dan.supportGap.mean).toBeNull();
  });
});

describe('what a member gives', () => {
  const g = score();

  it('reports out-degree and leniency against the cohort', () => {
    const alice = memberResultFor(g, 1)!;
    expect(alice.given.outDegree).toBe(2);
    // Alice gave 5s to Bob and 3s to Cara across 11 asset items each = 4.00.
    expect(alice.given.mean).toBe(4);
    expect(alice.given.versusCohort).toBe(0.17);

    const bob = memberResultFor(g, 2)!;
    // Bob gave 4s and 2s = 3.00, a full 0.83 below the cohort.
    expect(bob.given.mean).toBe(3);
    expect(bob.given.versusCohort).toBe(-0.83);
  });

  it('reports nothing for a member who never responded', () => {
    const dan = memberResultFor(g, 4)!;
    expect(dan.given.outDegree).toBe(0);
    expect(dan.given.mean).toBeNull();
    expect(dan.given.versusCohort).toBeNull();
  });
});

describe('networks', () => {
  const g = score();
  const trust = g.networks.find((n) => n.blockKey === 'trust')!;

  it('measures density over rated pairs, not over the whole roster', () => {
    // Ties: Alice->Bob(5), Bob->Alice(4), Cara->Alice(5), Cara->Bob(4) = 4 of 6.
    expect(trust.ties).toBe(4);
    expect(trust.ratedPairs).toBe(6);
    expect(trust.density).toBe(0.67);
  });

  it('measures reciprocity only on pairs that rated each other', () => {
    // All three pairs among the respondents are mutually rated. Of those,
    // (Alice, Bob) ties both ways; the other two tie one way only.
    expect(trust.mutualPairs).toBe(3);
    expect(trust.reciprocity).toBe(0.33);
  });

  it('ranks by tie rate, most connected first', () => {
    expect(trust.ranked[0]!.name).toBe('Alice');
    expect(trust.ranked.map((r) => r.name)).toContain('Dan');
  });
});

describe('group signals', () => {
  const g = score();

  it('names a member who was rated but tied to by nobody', () => {
    expect(g.isolates.map((i) => i.name)).toEqual(['Cara']);
  });

  it('does not call an unrated member an isolate', () => {
    // Dan has no ties, but that is absence of data rather than absence of
    // connection, and conflating the two would libel him.
    expect(g.isolates.map((i) => i.name)).not.toContain('Dan');
    expect(g.underCovered.map((u) => u.name)).toContain('Dan');
  });

  it('suppresses a member below the rater floor', () => {
    const strict = score(RESPONSES, 3);
    expect(memberResultFor(strict, 1)!.suppressed).toBe(true);
    expect(strict.underCovered).toHaveLength(4);

    const lenient = score(RESPONSES, 2);
    expect(memberResultFor(lenient, 1)!.suppressed).toBe(false);
    expect(lenient.underCovered.map((u) => u.name)).toEqual(['Dan']);
  });

  it('keeps a suppressed member out of the ranked gap lists', () => {
    const strict = score(RESPONSES, 3);
    expect(strict.authorityWithoutTrust).toHaveLength(0);
    expect(strict.trustWithoutAuthority).toHaveLength(0);
    expect(strict.supportGaps).toHaveLength(0);
  });

  it('ranks support gaps highest-first', () => {
    expect(g.supportGaps[0]!.name).toBe('Alice');
    expect(g.supportGaps[0]!.mean).toBe(4.5);
  });
});

describe('function seams', () => {
  const g = score();

  it('lists every function on the roster in roster order', () => {
    expect(g.functions).toEqual(['Operations', 'Quality', 'R&D', 'IT']);
  });

  it('produces a full square matrix, with blanks where nobody rated', () => {
    expect(g.functionMatrix).toHaveLength(16);
    const opsToQuality = g.functionMatrix.find((c) => c.from === 'Operations' && c.to === 'Quality')!;
    expect(opsToQuality.trust).toBe(5);
    expect(opsToQuality.n).toBe(1);

    const anyToIt = g.functionMatrix.filter((c) => c.to === 'IT');
    expect(anyToIt.every((c) => c.trust === null && c.n === 0)).toBe(true);
  });
});

describe('input handling', () => {
  it('drops a self-rating rather than scoring it', () => {
    const withSelf = scoreSocioCohort(
      MEMBERS,
      [{ raterNo: 1, answers: { ...row(1, 5), ...row(2, 4) } }],
      { minRaters: 1 },
    );
    expect(withSelf.ratingsGiven).toBe(1);
    expect(memberResultFor(withSelf, 1)!.coverage).toBe(0);
  });

  it('drops a rating aimed at a roster position that does not exist', () => {
    const stray = scoreSocioCohort(MEMBERS, [{ raterNo: 1, answers: row(99, 5) }], { minRaters: 1 });
    expect(stray.ratingsGiven).toBe(0);
  });

  it('averages a partly-filled block over what is there', () => {
    // Only two of the three trust items answered, both 5.
    const partial = scoreSocioCohort(
      MEMBERS,
      [{ raterNo: 1, answers: { [cellNo(2, 8)]: 5, [cellNo(2, 9)]: 5 } }],
      { minRaters: 1 },
    );
    const bob = memberResultFor(partial, 2)!;
    expect(bob.blocks.find((b) => b.blockKey === 'trust')!.mean).toBe(5);
    expect(bob.blocks.find((b) => b.blockKey === 'power_to')!.mean).toBeNull();
  });

  it('rejects a rating outside the scale rather than clamping it', () => {
    expect(() =>
      scoreSocioCohort(MEMBERS, [{ raterNo: 1, answers: { [cellNo(2, 1)]: SOCIO_MAX_ANSWER + 1 } }], {
        minRaters: 1,
      }),
    ).toThrow(SocioScoringError);
    expect(() =>
      scoreSocioCohort(MEMBERS, [{ raterNo: 1, answers: { [cellNo(2, 1)]: 0 } }], { minRaters: 1 }),
    ).toThrow(SocioScoringError);
  });

  it('rejects a response from someone not on the roster', () => {
    expect(() => scoreSocioCohort(MEMBERS, [{ raterNo: 9, answers: row(1, 4) }], { minRaters: 1 })).toThrow(
      SocioScoringError,
    );
  });

  it('rejects an empty roster', () => {
    expect(() => scoreSocioCohort([], [], { minRaters: 1 })).toThrow(SocioScoringError);
  });

  it('scores an empty cohort without dividing by zero', () => {
    const empty = scoreSocioCohort(MEMBERS, [], { minRaters: 3 });
    expect(empty.respondents).toBe(0);
    expect(empty.ratingsGiven).toBe(0);
    expect(empty.acquaintance).toBeNull();
    expect(empty.cohortMean).toBeNull();
    expect(empty.networks.every((n) => n.density === null && n.reciprocity === null)).toBe(true);
    expect(empty.isolates).toHaveLength(0);
    expect(empty.underCovered).toHaveLength(4);
  });
});

describe('bands', () => {
  it('reads an asset mean upward', () => {
    expect(socioBandFor(1)).toBe('Low');
    expect(socioBandFor(2.49)).toBe('Low');
    expect(socioBandFor(2.5)).toBe('Mixed');
    expect(socioBandFor(3.49)).toBe('Mixed');
    expect(socioBandFor(3.5)).toBe('Strong');
    expect(socioBandFor(4.25)).toBe('Very strong');
    expect(socioBandFor(5)).toBe('Very strong');
  });

  it('reads the deficit item as a request rather than a strength', () => {
    expect(socioGapBandFor(1)).toBe('Little');
    expect(socioGapBandFor(3)).toBe('Some');
    expect(socioGapBandFor(4.5)).toBe('Marked');
  });
});

describe('summaries', () => {
  const g = score();

  it('states the group figures the reader can check against the report', () => {
    const text = socioGroupSummary(g, 'Acme leadership');
    expect(text).toContain('Acme leadership');
    expect(text).toContain('3 of 4 members responded (75%)');
    expect(text).toContain('6 ratings');
    expect(text).toMatch(/picture of the group, not a judgement of any individual/);
  });

  it('explains a suppressed profile instead of showing an empty one', () => {
    const strict = score(RESPONSES, 3);
    const alice = memberResultFor(strict, 1)!;
    const text = socioMemberSummary(alice, strict);
    expect(text).toContain('below the 3-rater floor');
    expect(text).not.toMatch(/\d\.\d{2} of 5/);
  });

  it('names the strongest and weakest blocks for a reportable member', () => {
    const alice = memberResultFor(g, 1)!;
    const text = socioMemberSummary(alice, g);
    expect(text).toContain('2 of 2 colleagues had a basis to rate Alice');
    expect(text).toContain('of 5');
    expect(text).toContain('no individual response is identifiable');
  });
});
