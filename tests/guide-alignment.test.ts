/**
 * The facilitator guide is the specification for these numbers. Each test
 * quotes the rule it pins.
 */
import { describe, expect, it } from 'vitest';
import { influenceMix, powerKindOf, scoreSocioCohort, signatures } from '../src/shared/socio-scoring.js';
import type { SocioMember, SocioResponseInput } from '../src/shared/socio-scoring.js';
import { socioInsights } from '../src/shared/socio-insights.js';
import {
  cellNo,
  criteriaForItem,
  isCovertItem,
  itemVisibility,
  SOCIO_COVERT_POWER_ITEMS,
  SOCIO_CRITERIA,
  SOCIO_ITEM_BY_NO,
  SOCIO_ITEMS,
} from '../src/shared/socio.js';

const MEMBERS: SocioMember[] = [1, 2, 3, 4, 5, 6].map((no) => ({
  no,
  id: `m${no}`,
  name: `P${no}`,
  func: no <= 3 ? 'Sales' : 'Ops',
}));

/** One rater's answers: target → { item: score }. */
function response(raterNo: number, targets: Record<number, Record<number, number>>): SocioResponseInput {
  const answers: Record<number, number> = {};
  for (const [target, items] of Object.entries(targets)) {
    for (const [item, v] of Object.entries(items)) answers[cellNo(Number(target), Number(item))] = v;
  }
  return { raterNo, answers };
}

const ENABLING = [1, 2, 3, 4];
const CONTROLLING = [5, 6, 7];
const TRUST = [8, 9, 10];
const EASE = 11;
const SUPPORT = 12;

const all = (items: number[], v: number) => Object.fromEntries(items.map((i) => [i, v]));

describe('support gap — guide §5.1', () => {
  // "Support-gap in-degree = how many people want more from them."
  it('counts the people asking, not how loudly one person asks', () => {
    const responses = [
      // P1: one colleague asks, at the top of the scale.
      response(2, { 1: { [SUPPORT]: 5, ...all(TRUST, 4) } }),
      response(3, { 1: all(TRUST, 4) }),
      response(4, { 1: all(TRUST, 4) }),
      // P5: three colleagues ask, each a little less loudly.
      response(2, { 5: { [SUPPORT]: 4, ...all(TRUST, 4) } }),
      response(3, { 5: { [SUPPORT]: 4, ...all(TRUST, 4) } }),
      response(4, { 5: { [SUPPORT]: 4, ...all(TRUST, 4) } }),
    ];
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 });
    const one = g.members.find((m) => m.memberNo === 1)!;
    const five = g.members.find((m) => m.memberNo === 5)!;
    expect(one.supportGap.wanters).toBe(1);
    expect(five.supportGap.wanters).toBe(3);
    // A mean would have ranked P1 above P5; the in-degree does not.
    expect(one.supportGap.mean!).toBeGreaterThan(five.supportGap.mean!);
    expect(g.supportGaps[0]!.memberNo).toBe(5);
  });

  it('ignores an ask below the tie threshold', () => {
    const responses = [2, 3, 4].map((r) => response(r, { 1: { [SUPPORT]: 2, ...all(TRUST, 4) } }));
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 });
    expect(g.members.find((m) => m.memberNo === 1)!.supportGap.wanters).toBe(0);
  });
});

describe('influence mix — guide §5.4', () => {
  // "Compare the group's total power-to/with against its total power-over."
  it('calls a group that runs on enabling power collaborative', () => {
    const responses = [2, 3, 4, 5].map((r) => response(r, { 1: all(ENABLING, 5) }));
    const mix = influenceMix(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(mix.controlling).toBe(0);
    expect(mix.share).toBe(1);
    expect(mix.verdict).toMatch(/enabling power/);
  });

  it('names a domination culture when control carries the influence', () => {
    const responses = [2, 3, 4, 5].map((r) => response(r, { 1: all(CONTROLLING, 5) }));
    const mix = influenceMix(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(mix.enabling).toBe(0);
    expect(mix.share).toBe(0);
    expect(mix.verdict).toMatch(/domination culture/);
  });

  it('says so plainly when nobody is over the line on either', () => {
    const mix = influenceMix(scoreSocioCohort(MEMBERS, [], { minRaters: 3, tieThreshold: 4 }));
    expect(mix.share).toBeNull();
  });
});

describe('the three signatures — guide §5.3', () => {
  it('flags power without trust, where people also want more', () => {
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { ...all(CONTROLLING, 5), ...all(TRUST, 2), [SUPPORT]: 5, [EASE]: 2 } }),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.dominating.map((m) => m.name)).toContain('P1');
    expect(s.dominating[0]!.why).toMatch(/colleagues want more/);
  });

  it('flags a trust problem that is not a power problem', () => {
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { ...all(TRUST, 2), [EASE]: 2, ...all(ENABLING, 2) } }),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.unreliable.map((m) => m.name)).toContain('P1');
    expect(s.dominating.map((m) => m.name)).not.toContain('P1');
  });

  it('does not call somebody reliable but intimidating unreliable', () => {
    // On time, keeps their word and easy to work with are all strong; only
    // "safe to be open" (item 9) is low. That is a warmth finding, not this one.
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { 8: 5, 9: 1, 10: 5, [EASE]: 5 } }),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.unreliable.map((m) => m.name)).not.toContain('P1');
  });

  it('reads unreliable off on time, keeps their word and ease, and names them', () => {
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { 8: 2, 9: 5, 10: 2, [EASE]: 2 } }),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    const one = s.unreliable.find((m) => m.name === 'P1');
    expect(one).toBeDefined();
    expect(one!.why).toBe('on time 2.00, keeps their word 2.00, ease 2.00.');
  });

  it('does not call plain neutral 3s unreliable', () => {
    const responses = [2, 3, 4].map((r) => response(r, { 1: { 8: 3, 9: 3, 10: 3, [EASE]: 3 } }));
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.unreliable.map((m) => m.name)).not.toContain('P1');
  });

  it('flags dominating only against the group: top third on power-over, bottom half on trust', () => {
    // Everyone rates everyone. P1 is the controlling, untrusted one. P2 also
    // has power-over above their own trust, but only middling power — under
    // the old absolute rule that was enough to be flagged; it no longer is.
    const profile: Record<number, Record<number, number>> = {
      1: { ...all(CONTROLLING, 5), ...all(TRUST, 2), [SUPPORT]: 5 },
      2: { ...all(CONTROLLING, 2), 8: 2, 9: 1, 10: 2, [SUPPORT]: 5 },
      3: { ...all(CONTROLLING, 3), ...all(TRUST, 5), [SUPPORT]: 1 },
      4: { ...all(CONTROLLING, 3), ...all(TRUST, 5), [SUPPORT]: 1 },
      5: { ...all(CONTROLLING, 1), ...all(TRUST, 4), [SUPPORT]: 1 },
      6: { ...all(CONTROLLING, 1), ...all(TRUST, 4), [SUPPORT]: 1 },
    };
    const responses = [1, 2, 3, 4, 5, 6].map((r) =>
      response(
        r,
        Object.fromEntries(Object.entries(profile).filter(([t]) => Number(t) !== r)),
      ),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.dominating.map((m) => m.name)).toEqual(['P1']);
    expect(s.dominating[0]!.why).toMatch(/top third.*bottom half/);
  });

  it('flags nobody as dominating when the powerful are also the trusted', () => {
    const profile: Record<number, Record<number, number>> = {
      1: { ...all(CONTROLLING, 5), ...all(TRUST, 5), [SUPPORT]: 5 },
      2: { ...all(CONTROLLING, 4), 8: 5, 9: 4, 10: 5, [SUPPORT]: 5 },
      3: { ...all(CONTROLLING, 2), ...all(TRUST, 3), [SUPPORT]: 1 },
      4: { ...all(CONTROLLING, 2), ...all(TRUST, 3), [SUPPORT]: 1 },
      5: { ...all(CONTROLLING, 1), ...all(TRUST, 3), [SUPPORT]: 1 },
      6: { ...all(CONTROLLING, 1), ...all(TRUST, 3), [SUPPORT]: 1 },
    };
    const responses = [1, 2, 3, 4, 5, 6].map((r) =>
      response(r, Object.fromEntries(Object.entries(profile).filter(([t]) => Number(t) !== r))),
    );
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    expect(s.dominating).toEqual([]);
  });

  // "Not withholding — simply outside the network. Connect, don't correct."
  // The row carries the reach figure; the "connect, don't correct" framing is
  // the section's, so it is stated once rather than once per person.
  it('flags thin reach as disconnected, on the reach figure alone', () => {
    const responses = [response(2, { 1: all(TRUST, 5) })];
    const s = signatures(scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 }));
    const one = s.disconnected.find((m) => m.name === 'P1');
    expect(one).toBeDefined();
    expect(one!.why).toMatch(/Rated by 1 of the group, below the floor of 3/);
    // Reach is the whole finding: somebody nobody could rate is never also
    // accused of dominating or of being unreliable on the same thin evidence.
    expect(s.dominating.map((m) => m.name)).not.toContain('P1');
    expect(s.unreliable.map((m) => m.name)).not.toContain('P1');
  });
});

describe('the guide’s nineteen criteria — guide §4', () => {
  it('records every criterion, and every one lands on a shipped item', () => {
    expect(SOCIO_CRITERIA).toHaveLength(19);
    const nos = SOCIO_CRITERIA.map((c) => c.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
    for (const c of SOCIO_CRITERIA) {
      expect(SOCIO_ITEM_BY_NO[c.itemNo], `criterion ${c.no} points at a real item`).toBeDefined();
    }
    // Nothing was dropped in the merge: every shipped item carries at least one.
    for (const item of SOCIO_ITEMS) {
      expect(criteriaForItem(item.no).length, `item ${item.no} carries a criterion`).toBeGreaterThan(0);
    }
  });

  it('keeps the guide’s band counts: six enabling, five controlling, six trust', () => {
    const count = (f: string) => SOCIO_CRITERIA.filter((c) => c.family === f).length;
    expect(count('power_to') + count('power_with')).toBe(6);
    expect(count('power_over')).toBe(5);
    expect(count('trust')).toBe(6);
    expect(count('overall')).toBe(2);
  });

  it('tags power with a face and leaves trust unlabelled, as the guide does', () => {
    for (const c of SOCIO_CRITERIA) {
      const isPower = c.family !== 'trust' && c.family !== 'overall';
      if (isPower) expect(c.visibility, `criterion ${c.no}`).not.toBeNull();
      else expect(c.visibility, `criterion ${c.no}`).toBeNull();
    }
  });

  // "especially covert power-over ('sets the agenda', 'works behind the scenes')"
  it('resolves covert power-over to the item carrying those two criteria alone', () => {
    expect(SOCIO_COVERT_POWER_ITEMS).toEqual([7]);
    const labels = criteriaForItem(7).map((c) => c.label);
    expect(labels).toEqual(['Sets the agenda', 'Works behind scenes']);
    // An item that merges a visible criterion with a hidden one is not covert:
    // power that is partly on show must not reach the hidden reading.
    expect(isCovertItem(6)).toBe(false);
    expect(itemVisibility(6)).toEqual(['visible']);
  });
});

describe('kind of power — guide §5.2', () => {
  // "high power-OVER = a coercive bottleneck … high power-TO but low trust =
  //  a capable expert who needs relational development — a different fix."
  it('names the two halves, and refuses to pick one when they are even', () => {
    expect(powerKindOf(0, 7)).toBe('bottleneck');
    expect(powerKindOf(8, 1)).toBe('capable_expert');
    expect(powerKindOf(5, 5)).toBe('mixed');
    expect(powerKindOf(0, 0)).toBeNull();
  });

  it('carries the split onto the person and onto the report’s watch list', () => {
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { ...all(CONTROLLING, 5), ...all(TRUST, 2), [EASE]: 2 } }),
    );
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 });
    expect(g.members.find((m) => m.memberNo === 1)!.powerKind).toBe('bottleneck');
    expect(g.authorityWithoutTrust[0]!.powerKind).toBe('bottleneck');
  });
});

describe('one concentration, one density — guide §5.4', () => {
  it('reports the same concentration in the scored result and in the findings', () => {
    const responses: SocioResponseInput[] = [];
    for (const r of [1, 2, 3, 4, 5, 6]) {
      const targets: Record<number, Record<number, number>> = {};
      for (const t of [1, 2, 3, 4, 5, 6]) {
        if (t === r) continue;
        targets[t] = all(TRUST, t <= 2 ? 5 : 2);
      }
      responses.push(response(r, targets));
    }
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 1, tieThreshold: 4 });
    const ins = socioInsights(MEMBERS, responses, { tieThreshold: 4 });
    const engine = g.networks.find((n) => n.blockKey === 'trust')!.concentration;
    const findings = ins.spread.find((s) => s.blockKey === 'trust')!.concentration;
    expect(engine).not.toBeNull();
    expect(findings).toBe(engine);
  });

  it('counts only the pairs that answered a block in that block’s density', () => {
    const responses = [
      response(2, { 1: all(CONTROLLING, 5) }),
      response(3, { 1: all(CONTROLLING, 5) }),
      // This rater answered the trust statements about P2 and no power ones,
      // so they belong in the trust denominator and in no power denominator.
      response(4, { 1: all(CONTROLLING, 5), 2: all(TRUST, 5) }),
    ];
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 1, tieThreshold: 4 });
    const power = g.networks.find((n) => n.blockKey === 'power_over')!;
    expect(power.ratedPairs).toBe(3);
    expect(power.density).toBe(1);
  });
});

describe('hidden power — guide §5.4', () => {
  it('reads the covert statements apart from the band as a whole', () => {
    // Everyone agrees P1 shapes things informally; open decision rights are flat.
    const responses = [2, 3, 4].map((r) =>
      response(r, { 1: { 5: 2, 6: 2, 7: 5 }, 2: { 5: 2, 6: 2, 7: 1 } }),
    );
    const ins = socioInsights(MEMBERS, responses, { tieThreshold: 4 });
    expect(ins.covertPower.statements).toEqual(['Shapes it informally']);
    expect(ins.covertPower.ties).toBe(3);
    expect(ins.covertPower.holders[0]!.name).toBe('P1');
    expect(ins.covertPower.concentration).toBeGreaterThan(ins.covertPower.overtConcentration ?? 0);
    expect(ins.covertPower.verdict).toMatch(/markedly fewer people/i);
  });

  it('says so plainly when nobody is over the line on them', () => {
    const responses = [2, 3].map((r) => response(r, { 1: all(TRUST, 5) }));
    const ins = socioInsights(MEMBERS, responses, { tieThreshold: 4 });
    expect(ins.covertPower.ties).toBe(0);
    expect(ins.covertPower.verdict).toMatch(/no hidden concentration/i);
  });
});

describe('raw sums — guide §5.1 "add up the ratings they receive"', () => {
  it('adds every rating per statement and per block, and the average matches the block mean', () => {
    const responses = [
      response(2, { 1: { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 4, 11: 3, 12: 2 } }),
      response(3, { 1: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 4, 7: 3, 8: 2, 9: 1, 10: 2, 11: 3, 12: 4 } }),
      response(4, { 1: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3 } }),
    ];
    const g = scoreSocioCohort(MEMBERS, responses, { minRaters: 3, tieThreshold: 4 });
    const p1 = g.members.find((m) => m.memberNo === 1)!;
    expect(p1.items.find((i) => i.itemNo === 1)!.sum).toBe(9);
    expect(p1.items.find((i) => i.itemNo === 12)!.sum).toBe(9);
    const trust = p1.blocks.find((b) => b.blockKey === 'trust')!;
    expect(trust.ratingSum).toBe(4 + 5 + 4 + 2 + 1 + 2 + 3 + 3 + 3);
    expect(trust.ratingCount).toBe(9);
    expect(trust.ratingSum / trust.ratingCount).toBeCloseTo(trust.mean!, 2);
    const powerTo = p1.blocks.find((b) => b.blockKey === 'power_to')!;
    expect(powerTo.ratingSum).toBe(14 + 10 + 12);
    expect(powerTo.ratingCount).toBe(12);
  });
});
