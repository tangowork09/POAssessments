import { describe, expect, it } from 'vitest';
import {
  COLLAB_ITEMS,
  COLLAB_ITEM_COUNT,
  COLLAB_MAX_ANSWER,
  COLLAB_MIN_ANSWER,
  COLLAB_MIN_SEGMENT,
  COLLAB_SCALE_LABELS,
  COLLAB_SECTIONS,
  collabItemsIn,
  collabSectionFor,
} from '../src/shared/collab.js';
import {
  COLLAB_BANDS,
  COLLAB_MAX_TOTAL,
  COLLAB_MIN_TOTAL,
  COLLAB_SPLIT_TAIL,
  CollabScoringError,
  collabBandForMean,
  collabBandForTotal,
  convertAnswer,
  scoreCollabGroup,
  scoreCollabResponse,
  segmentCollab,
} from '../src/shared/collab-scoring.js';

/**
 * The scoring key, transcribed from the master copy's own item table rather
 * than from the instrument definition the engine reads.
 *
 * The point of writing it out twice is that a wrong `direction` on one item is
 * invisible in the output: it does not throw, it just quietly moves a mean by
 * a fraction. So the table the client published is held here as an independent
 * witness, and the engine is checked against it item by item.
 */
const SCORING_KEY: Record<number, { section: string; direction: 'direct' | 'reverse' }> = {
  1: { section: 'Structure & Goals', direction: 'direct' },
  2: { section: 'Structure & Goals', direction: 'reverse' },
  3: { section: 'Structure & Goals', direction: 'reverse' },
  4: { section: 'Structure & Goals', direction: 'reverse' },
  5: { section: 'Structure & Goals', direction: 'direct' },
  6: { section: 'Collaboration Barriers', direction: 'direct' },
  7: { section: 'Collaboration Barriers', direction: 'reverse' },
  8: { section: 'Collaboration Barriers', direction: 'reverse' },
  9: { section: 'Collaboration Barriers', direction: 'reverse' },
  10: { section: 'Trust & Safety', direction: 'reverse' },
  11: { section: 'Trust & Safety', direction: 'direct' },
  12: { section: 'Trust & Safety', direction: 'reverse' },
  13: { section: 'Trust & Safety', direction: 'direct' },
  14: { section: 'Power & Escalation', direction: 'reverse' },
  15: { section: 'Power & Escalation', direction: 'reverse' },
  16: { section: 'Power & Escalation', direction: 'direct' },
  17: { section: 'Power & Escalation', direction: 'reverse' },
  18: { section: 'Operational & Compliance', direction: 'reverse' },
  19: { section: 'Operational & Compliance', direction: 'reverse' },
  20: { section: 'Operational & Compliance', direction: 'reverse' },
  21: { section: 'Operational & Compliance', direction: 'direct' },
  22: { section: 'Institutional Levers', direction: 'direct' },
  23: { section: 'Institutional Levers', direction: 'direct' },
  24: { section: 'Institutional Levers', direction: 'direct' },
};

/** Every statement answered with the same number. */
function flat(value: number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) answers[no] = value;
  return answers;
}

describe('the instrument, against the published scoring key', () => {
  it('has 24 statements, ten direct and fourteen reverse', () => {
    expect(COLLAB_ITEMS).toHaveLength(24);
    expect(COLLAB_ITEMS.filter((i) => i.direction === 'direct')).toHaveLength(10);
    expect(COLLAB_ITEMS.filter((i) => i.direction === 'reverse')).toHaveLength(14);
  });

  it('files each statement in the section and direction the key gives it', () => {
    for (const [no, expected] of Object.entries(SCORING_KEY)) {
      const item = COLLAB_ITEMS.find((i) => i.no === Number(no))!;
      expect(item, `statement ${no}`).toBeDefined();
      expect(item.direction, `statement ${no} direction`).toBe(expected.direction);
      expect(collabSectionFor(Number(no))!.short, `statement ${no} section`).toBe(expected.section);
    }
  });

  it('covers every statement exactly once across the six sections', () => {
    const seen = COLLAB_SECTIONS.flatMap((s) => s.items);
    expect(new Set(seen).size).toBe(COLLAB_ITEM_COUNT);
    expect(seen).toHaveLength(COLLAB_ITEM_COUNT);
    expect(COLLAB_SECTIONS).toHaveLength(6);
    expect(collabItemsIn('levers').map((i) => i.no)).toEqual([22, 23, 24]);
  });

  it('presents the master copy scale', () => {
    expect(COLLAB_MIN_ANSWER).toBe(1);
    expect(COLLAB_MAX_ANSWER).toBe(5);
    expect(COLLAB_SCALE_LABELS[0]).toBe('Strongly Disagree');
    expect(COLLAB_SCALE_LABELS[2]).toBe('Neither agree nor disagree');
    expect(COLLAB_SCALE_LABELS[4]).toBe('Strongly Agree');
  });
});

describe('conversion', () => {
  it('uses a direct item as answered', () => {
    for (let v = 1; v <= 5; v++) expect(convertAnswer(1, v)).toBe(v);
  });

  it('flips a reverse item with 6 minus the answer', () => {
    expect(convertAnswer(12, 5)).toBe(1);
    expect(convertAnswer(12, 4)).toBe(2);
    expect(convertAnswer(12, 3)).toBe(3);
    expect(convertAnswer(12, 2)).toBe(4);
    expect(convertAnswer(12, 1)).toBe(5);
  });

  it('converts every statement into 1..5', () => {
    for (const item of COLLAB_ITEMS) {
      for (let v = 1; v <= 5; v++) {
        const c = convertAnswer(item.no, v);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(5);
      }
    }
  });

  it('refuses an answer off the scale, or a statement that is not in the set', () => {
    expect(() => convertAnswer(1, 0)).toThrow(CollabScoringError);
    expect(() => convertAnswer(1, 6)).toThrow(CollabScoringError);
    expect(() => convertAnswer(1, 3.5)).toThrow(CollabScoringError);
    expect(() => convertAnswer(25, 3)).toThrow(CollabScoringError);
  });
});

describe('one response', () => {
  it('scores an all-3 sheet at the midpoint, whichever way each item is worded', () => {
    const r = scoreCollabResponse(flat(3));
    expect(r.total).toBe(72);
    expect(r.perItem).toBe(3);
    for (const s of r.sections) expect(s.mean).toBe(3);
  });

  it('puts a leader who agrees with everything in the middle, not at the top', () => {
    // Straight-lining 5s means agreeing with ten good practices and fourteen
    // problems at once. Converted, that is 10 fives and 14 ones: the mixed
    // wording is doing exactly what it is there for.
    const r = scoreCollabResponse(flat(5));
    expect(r.total).toBe(10 * 5 + 14 * 1);
    expect(r.band.key).toBe('barriers');
    expect(r.converted[1]).toBe(5);
    expect(r.converted[2]).toBe(1);
  });

  it('reaches the floor and the ceiling only on a consistent sheet', () => {
    const healthy: Record<number, number> = {};
    const broken: Record<number, number> = {};
    for (const item of COLLAB_ITEMS) {
      healthy[item.no] = item.direction === 'direct' ? 5 : 1;
      broken[item.no] = item.direction === 'direct' ? 1 : 5;
    }
    expect(scoreCollabResponse(healthy).total).toBe(COLLAB_MAX_TOTAL);
    expect(scoreCollabResponse(healthy).band.key).toBe('healthy');
    expect(scoreCollabResponse(broken).total).toBe(COLLAB_MIN_TOTAL);
    expect(scoreCollabResponse(broken).band.key).toBe('breaking');
  });

  it('refuses a partial sheet rather than averaging over what is there', () => {
    const partial = flat(3);
    delete partial[19];
    expect(() => scoreCollabResponse(partial)).toThrow(/19 is unanswered/);
  });
});

describe('bands', () => {
  it('matches the published table at every boundary', () => {
    const cases: [number, string][] = [
      [24, 'breaking'], [47, 'breaking'],
      [48, 'barriers'], [71, 'barriers'],
      [72, 'friction'], [95, 'friction'],
      [96, 'healthy'], [120, 'healthy'],
    ];
    for (const [total, key] of cases) expect(collabBandForTotal(total).key, `total ${total}`).toBe(key);
  });

  it('reads the same band off the per-item scale', () => {
    expect(collabBandForMean(4.0).key).toBe('healthy');
    expect(collabBandForMean(3.9).key).toBe('friction');
    expect(collabBandForMean(3.0).key).toBe('friction');
    expect(collabBandForMean(2.9).key).toBe('barriers');
    expect(collabBandForMean(2.0).key).toBe('barriers');
    expect(collabBandForMean(1.9).key).toBe('breaking');
  });

  it('covers 24..120 with no gap and no overlap', () => {
    for (let total = COLLAB_MIN_TOTAL; total <= COLLAB_MAX_TOTAL; total++) {
      const hits = COLLAB_BANDS.filter((b) => total >= b.minTotal && total <= b.maxTotal);
      expect(hits, `total ${total}`).toHaveLength(1);
    }
    expect(() => collabBandForTotal(23)).toThrow(CollabScoringError);
    expect(() => collabBandForTotal(121)).toThrow(CollabScoringError);
  });
});

describe('the group', () => {
  it('reports the mean, and counts incomplete responses instead of dropping them quietly', () => {
    const partial = flat(4);
    delete partial[7];
    const g = scoreCollabGroup([flat(3), flat(3), flat(3), partial]);
    expect(g.n).toBe(3);
    expect(g.incomplete).toBe(1);
    expect(g.total).toBe(72);
    expect(g.perItem).toBe(3);
  });

  it('separates a split group from a lukewarm one at the same mean', () => {
    // Item 1 is direct, so these answers are also its converted scores.
    const half = (value: number) => ({ ...flat(3), 1: value });
    const lukewarm = [half(3), half(3), half(3), half(3), half(3), half(3)];
    const split = [half(1), half(1), half(1), half(5), half(5), half(5)];

    const a = scoreCollabGroup(lukewarm).items.find((i) => i.no === 1)!;
    const b = scoreCollabGroup(split).items.find((i) => i.no === 1)!;

    expect(a.mean).toBe(b.mean); // the mean cannot tell these apart
    expect(a.split).toBe(false);
    expect(b.split).toBe(true);
    expect(b.sd!).toBeGreaterThan(a.sd!);
    expect(b.lowShare).toBe(0.5);
    expect(b.highShare).toBe(0.5);
    expect(b.counts).toEqual([3, 0, 0, 0, 3]);
  });

  it('holds the split flag to its threshold', () => {
    // Nine at one end and one at the other: 10% is below the tail share, so
    // one dissenter is not a split group.
    const answers = (v: number) => ({ ...flat(3), 1: v });
    const lopsided = [...Array(9).fill(answers(5)), answers(1)];
    const item = scoreCollabGroup(lopsided).items.find((i) => i.no === 1)!;
    expect(item.lowShare).toBeLessThan(COLLAB_SPLIT_TAIL);
    expect(item.split).toBe(false);
  });

  it('ranks the sections and measures the gap between the ends', () => {
    // Institutional Levers answered badly, everything else at the midpoint.
    const weak = { ...flat(3), 22: 1, 23: 1, 24: 1 };
    const g = scoreCollabGroup([weak, weak, weak]);
    const levers = g.sections.find((s) => s.key === 'levers')!;
    expect(levers.mean).toBe(1);
    expect(g.gap.weakestKey).toBe('levers');
    expect(g.gap.value).toBe(2);
    expect(g.attention).toEqual(expect.arrayContaining([22, 23, 24]));
  });

  it('has no spread to report from a single response', () => {
    const g = scoreCollabGroup([flat(3)]);
    expect(g.n).toBe(1);
    for (const item of g.items) expect(item.sd).toBeNull();
    for (const section of g.sections) expect(section.spread).toBeNull();
  });

  it('refuses to score a run with nothing complete in it', () => {
    expect(() => scoreCollabGroup([])).toThrow(CollabScoringError);
    const partial = flat(3);
    delete partial[1];
    expect(() => scoreCollabGroup([partial])).toThrow(/no complete responses/);
  });
});

describe('segments', () => {
  it('suppresses a segment under the floor, keeping its name and its count', () => {
    const small = Array.from({ length: COLLAB_MIN_SEGMENT - 1 }, () => flat(3));
    const big = Array.from({ length: COLLAB_MIN_SEGMENT }, () => flat(4));
    const [quality, operations] = segmentCollab([
      { name: 'Quality & QA', responses: small },
      { name: 'Operations', responses: big },
    ]);

    expect(quality.suppressed).toBe(true);
    expect(quality.n).toBe(COLLAB_MIN_SEGMENT - 1);
    expect(quality.sections).toBeNull();
    expect(quality.perItem).toBeNull();
    expect(quality.name).toBe('Quality & QA'); // still present, still named

    expect(operations.suppressed).toBe(false);
    expect(operations.n).toBe(COLLAB_MIN_SEGMENT);
    expect(operations.sections).not.toBeNull();
  });

  it('counts only complete responses towards the floor', () => {
    const partial = flat(3);
    delete partial[4];
    const responses = [...Array(COLLAB_MIN_SEGMENT - 1).fill(flat(3)), partial];
    const [segment] = segmentCollab([{ name: 'R&D', responses }]);
    expect(segment.n).toBe(COLLAB_MIN_SEGMENT - 1);
    expect(segment.suppressed).toBe(true);
  });
});

describe('the reporting floor', () => {
  it('reports every segment when the floor is one', () => {
    // What a facilitator running twenty leaders usually wants: a four-person
    // Operations is the finding, not a privacy problem to be hidden.
    const [tiny, small] = segmentCollab(
      [
        { name: 'Quality & QA', responses: [flat(4)] },
        { name: 'Operations', responses: [flat(2), flat(2), flat(2), flat(2)] },
      ],
      1,
    );
    expect(tiny!.suppressed).toBe(false);
    expect(tiny!.n).toBe(1);
    expect(tiny!.perItem).not.toBeNull();
    expect(small!.suppressed).toBe(false);
    expect(small!.sections).not.toBeNull();
  });

  it('still reports nobody as nobody', () => {
    // An empty segment has no figures at any floor: there is nothing to average.
    const [empty] = segmentCollab([{ name: 'R&D', responses: [] }], 1);
    expect(empty!.n).toBe(0);
    expect(empty!.suppressed).toBe(true);
    expect(empty!.sections).toBeNull();
  });
});
