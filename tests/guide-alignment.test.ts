/**
 * The facilitator guide is the specification for these numbers. Each test
 * quotes the rule it pins.
 */
import { describe, expect, it } from 'vitest';
import { influenceMix, scoreSocioCohort, signatures } from '../src/shared/socio-scoring.js';
import type { SocioMember, SocioResponseInput } from '../src/shared/socio-scoring.js';
import { cellNo } from '../src/shared/socio.js';

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
