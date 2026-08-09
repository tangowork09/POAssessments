import { describe, expect, it } from 'vitest';
import {
  BALANCED_WITHIN,
  MAX_ANSWER,
  MAX_SIDE_SCORE,
  MAX_STYLE_SCORE,
  MIN_ANSWER,
  QUESTION_COUNT,
  SCALE_LABELS,
  SCALE_SHORT_LABELS,
  ScoringError,
  bandFor,
  executiveSummary,
  scoreAnswers,
} from '../src/shared/scoring.js';
import { INFLUENCING_METHODS, PULL_STYLES, PUSH_STYLES, STYLES } from '../src/shared/styles.js';

/** Answers built from a per-style map, mirroring how a real response arrives. */
function answersFrom(map: Record<string, [number, number, number, number]>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const style of STYLES) {
    const values = map[style.key];
    if (!values) throw new Error(`fixture missing style ${style.key}`);
    style.items.forEach((no, i) => {
      out[no] = values[i]!;
    });
  }
  return out;
}

const flat = (v: number) =>
  answersFrom(Object.fromEntries(STYLES.map((s) => [s.key, [v, v, v, v]])) as never);

describe('style → item map', () => {
  it('covers statements 1..40 exactly once', () => {
    const seen = new Map<number, string>();
    for (const style of STYLES) {
      for (const no of style.items) {
        expect(seen.has(no), `statement ${no} claimed by ${seen.get(no)} and ${style.key}`).toBe(false);
        seen.set(no, style.key);
      }
    }
    expect(seen.size).toBe(QUESTION_COUNT);
    for (let n = 1; n <= QUESTION_COUNT; n++) {
      expect(seen.has(n), `statement ${n} is not scored by any style`).toBe(true);
    }
  });

  it('has ten styles, five per side, four items each', () => {
    expect(STYLES).toHaveLength(10);
    expect(PUSH_STYLES).toHaveLength(5);
    expect(PULL_STYLES).toHaveLength(5);
    for (const s of STYLES) expect(s.items).toHaveLength(4);
  });

  it('uses unique style keys and names', () => {
    expect(new Set(STYLES.map((s) => s.key)).size).toBe(10);
    expect(new Set(STYLES.map((s) => s.name)).size).toBe(10);
  });

  it('matches the published item allocation', () => {
    const expected: Record<string, number[]> = {
      force: [1, 13, 21, 31],
      rules: [7, 12, 24, 32],
      exchange: [2, 14, 29, 34],
      persuasion: [5, 18, 22, 33],
      assertion: [6, 19, 28, 37],
      magnetism: [9, 17, 30, 38],
      visioning: [3, 11, 25, 35],
      bridging: [4, 16, 26, 39],
      environmental: [10, 15, 27, 36],
      joint: [8, 20, 23, 40],
    };
    for (const s of STYLES) expect([...s.items]).toEqual(expected[s.key]);
  });
});

describe('the published 0–4 rating scale', () => {
  it('runs 0..4, so a style is out of 16 and a side out of 80', () => {
    expect(MIN_ANSWER).toBe(0);
    expect(MAX_ANSWER).toBe(4);
    expect(MAX_STYLE_SCORE).toBe(16);
    expect(MAX_SIDE_SCORE).toBe(80);
  });

  it('carries the published anchors verbatim, one per point', () => {
    expect([...SCALE_LABELS]).toEqual([
      'I never do it',
      'I rarely do this',
      'I sometimes do this',
      'I often do this',
      'I always do this',
    ]);
    expect(SCALE_LABELS).toHaveLength(MAX_ANSWER - MIN_ANSWER + 1);
    expect(SCALE_SHORT_LABELS).toHaveLength(SCALE_LABELS.length);
  });
});

describe('the method descriptions', () => {
  it('reproduces the client copy verbatim', () => {
    expect(INFLUENCING_METHODS.push).toBe(
      'The Push Method — this approach is logical and aggressive with quick results. When using this method, managers may make demands on employees without considering the immediate or long-term impacts on specific individuals. This aggressive approach may not be well-received. As a result, employees may not be receptive or cooperative. However, when used correctly, push strategies can bring about solid results.',
    );
    expect(INFLUENCING_METHODS.pull).toBe(
      'The Pull Method — this approach is all about including the individual in the decision-making process so that the person has a stake in the eventual outcomes. This method usually leads to a proactive response, in which the individual is more likely to fully accomplish the tasks set forth. Results from this approach are generally positive, but may take a bit longer to come to fruition in comparison to those achieved by means of the Push Method approach.',
    );
  });
});

describe('bandFor', () => {
  it('maps 0–6 Low, 7–11 Moderate, 12–16 High', () => {
    for (let n = 0; n <= 6; n++) expect(bandFor(n)).toBe('Low');
    for (let n = 7; n <= 11; n++) expect(bandFor(n)).toBe('Moderate');
    for (let n = 12; n <= MAX_STYLE_SCORE; n++) expect(bandFor(n)).toBe('High');
  });

  it('places the boundaries on the stated side', () => {
    expect(bandFor(6)).toBe('Low');
    expect(bandFor(7)).toBe('Moderate');
    expect(bandFor(11)).toBe('Moderate');
    expect(bandFor(12)).toBe('High');
  });

  it('covers the whole range with no gap', () => {
    for (let n = 0; n <= MAX_STYLE_SCORE; n++) {
      expect(['Low', 'Moderate', 'High']).toContain(bandFor(n));
    }
  });
});

describe('scoreAnswers', () => {
  it('scores an all-zero response at the floor', () => {
    const r = scoreAnswers(flat(0));
    expect(r.push).toBe(0);
    expect(r.pull).toBe(0);
    expect(r.styles.every((s) => s.score === 0 && s.band === 'Low')).toBe(true);
    expect(r.pushShare).toBe(50);
    expect(r.pullShare).toBe(50);
    expect(r.orientation).toBe('Balanced');
  });

  it('scores an all-four response at the ceiling', () => {
    const r = scoreAnswers(flat(MAX_ANSWER));
    expect(r.push).toBe(MAX_SIDE_SCORE);
    expect(r.pull).toBe(MAX_SIDE_SCORE);
    for (const s of r.styles) {
      expect(s.score).toBe(MAX_STYLE_SCORE);
      expect(s.band).toBe('High');
      expect(s.percent).toBe(100);
    }
  });

  it('scores a hand-checked 0–4 fixture', () => {
    // A pull-oriented profile, every item inside the published 0..4 range.
    const answers = answersFrom({
      force: [1, 1, 1, 1], //  4  Low
      rules: [2, 3, 3, 2], // 10  Moderate
      exchange: [2, 2, 2, 1], //  7  Moderate
      persuasion: [3, 4, 4, 3], // 14  High
      assertion: [3, 3, 2, 3], // 11  Moderate
      magnetism: [3, 3, 3, 2], // 11  Moderate
      visioning: [4, 4, 4, 3], // 15  High
      bridging: [4, 3, 4, 4], // 15  High
      environmental: [3, 3, 2, 3], // 11  Moderate
      joint: [4, 3, 3, 3], // 13  High
    });
    const r = scoreAnswers(answers);
    const byKey = Object.fromEntries(r.styles.map((s) => [s.key, s.score]));

    expect(byKey).toEqual({
      force: 4,
      rules: 10,
      exchange: 7,
      persuasion: 14,
      assertion: 11,
      magnetism: 11,
      visioning: 15,
      bridging: 15,
      environmental: 11,
      joint: 13,
    });
    expect(r.push).toBe(4 + 10 + 7 + 14 + 11); // 46
    expect(r.pull).toBe(11 + 15 + 15 + 11 + 13); // 65
    expect(r.orientation).toBe('Pull');
    // Visioning and Bridging tie on 15; the tie breaks on display name.
    expect(r.top3.map((s) => s.key)).toEqual(['bridging', 'visioning', 'persuasion']);
    expect(r.development.key).toBe('force');
    expect(r.development.band).toBe('Low');
    expect(r.pushShare).toBe(41.4);
    expect(r.pullShare).toBe(58.6);
    for (const s of r.styles) expect(s.score).toBeLessThanOrEqual(MAX_STYLE_SCORE);
  });

  it('reads item positions correctly rather than by order', () => {
    // Only statement 21 (Force, third item) is answered above zero.
    const answers: Record<number, number> = {};
    for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = 0;
    answers[21] = 4;
    const r = scoreAnswers(answers);
    expect(r.styles.find((s) => s.key === 'force')!.score).toBe(4);
    expect(r.push).toBe(4);
    expect(r.pull).toBe(0);
    expect(r.orientation).toBe('Balanced'); // within BALANCED_WITHIN
  });

  it(`calls a gap of ${BALANCED_WITHIN} balanced and one more an orientation`, () => {
    const balanced = { ...flat(0), 1: BALANCED_WITHIN };
    expect(scoreAnswers(balanced).orientation).toBe('Balanced');
    const leaning = { ...flat(0), 1: BALANCED_WITHIN, 13: 1 };
    expect(scoreAnswers(leaning).orientation).toBe('Push');
  });

  it('ranks deterministically when scores tie', () => {
    const r1 = scoreAnswers(flat(3));
    const r2 = scoreAnswers(flat(3));
    expect(r1.ranked.map((s) => s.key)).toEqual(r2.ranked.map((s) => s.key));
    // All equal → alphabetical by display name.
    const names = r1.ranked.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('rejects a missing answer', () => {
    const answers = flat(3);
    delete answers[17];
    expect(() => scoreAnswers(answers)).toThrow(ScoringError);
    expect(() => scoreAnswers(answers)).toThrow(/statement 17/);
  });

  it('rejects out-of-range and non-integer answers', () => {
    // 5 was valid on the retired scale and must now be refused outright.
    expect(() => scoreAnswers({ ...flat(3), 4: 5 })).toThrow(/statement 4/);
    expect(() => scoreAnswers({ ...flat(3), 4: -1 })).toThrow(/statement 4/);
    expect(() => scoreAnswers({ ...flat(3), 4: 2.5 })).toThrow(/statement 4/);
    expect(() => scoreAnswers({ ...flat(3), 4: MAX_ANSWER })).not.toThrow();
  });

  it('keeps push and pull shares summing to 100', () => {
    for (let seed = 0; seed < 40; seed++) {
      const answers: Record<number, number> = {};
      for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 7 + seed * 13) % (MAX_ANSWER + 1);
      const r = scoreAnswers(answers);
      expect(r.pushShare + r.pullShare).toBeCloseTo(100, 5);
      expect(r.push + r.pull).toBe(
        r.styles.reduce((t, s) => t + s.score, 0),
      );
      expect(r.push).toBeLessThanOrEqual(MAX_SIDE_SCORE);
      expect(r.pull).toBeLessThanOrEqual(MAX_SIDE_SCORE);
    }
  });
});

describe('executiveSummary', () => {
  it('names the lead style, the runner-up and the development area', () => {
    const r = scoreAnswers(
      answersFrom({
        force: [0, 0, 0, 0],
        rules: [1, 1, 1, 1],
        exchange: [1, 2, 1, 2],
        persuasion: [2, 2, 2, 2],
        assertion: [2, 1, 2, 1],
        magnetism: [3, 3, 3, 3],
        visioning: [4, 4, 4, 4],
        bridging: [2, 3, 2, 3],
        environmental: [1, 2, 2, 1],
        joint: [3, 3, 3, 2],
      }),
    );
    const text = executiveSummary(r, 'Priya');
    expect(text).toContain('Priya');
    expect(text).toContain('Visioning');
    expect(text).toContain('Force');
    expect(text).toContain(`${r.push} of ${MAX_SIDE_SCORE}`);
  });
});
