import { describe, expect, it } from 'vitest';
import {
  MAX_SIDE_SCORE,
  MAX_STYLE_SCORE,
  QUESTION_COUNT,
  ScoringError,
  bandFor,
  executiveSummary,
  scoreAnswers,
} from '../src/shared/scoring.js';
import { PULL_STYLES, PUSH_STYLES, STYLES } from '../src/shared/styles.js';

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

describe('bandFor', () => {
  it('maps 0–7 Low, 8–13 Moderate, 14–20 High', () => {
    for (let n = 0; n <= 7; n++) expect(bandFor(n)).toBe('Low');
    for (let n = 8; n <= 13; n++) expect(bandFor(n)).toBe('Moderate');
    for (let n = 14; n <= MAX_STYLE_SCORE; n++) expect(bandFor(n)).toBe('High');
  });

  it('places the boundaries on the stated side', () => {
    expect(bandFor(7)).toBe('Low');
    expect(bandFor(8)).toBe('Moderate');
    expect(bandFor(13)).toBe('Moderate');
    expect(bandFor(14)).toBe('High');
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

  it('scores an all-five response at the ceiling', () => {
    const r = scoreAnswers(flat(5));
    expect(r.push).toBe(MAX_SIDE_SCORE);
    expect(r.pull).toBe(MAX_SIDE_SCORE);
    for (const s of r.styles) {
      expect(s.score).toBe(MAX_STYLE_SCORE);
      expect(s.band).toBe('High');
      expect(s.percent).toBe(100);
    }
  });

  it('scores the known Priya Sharma fixture', () => {
    // A pull-oriented profile with hand-checked totals.
    const answers = answersFrom({
      force: [2, 1, 1, 1], //  5
      rules: [3, 3, 4, 2], // 12
      exchange: [2, 3, 2, 2], //  9
      persuasion: [4, 4, 5, 4], // 17
      assertion: [3, 4, 3, 3], // 13
      magnetism: [4, 3, 4, 3], // 14
      visioning: [5, 5, 4, 5], // 19
      bridging: [5, 4, 5, 4], // 18
      environmental: [3, 4, 3, 4], // 14
      joint: [4, 5, 4, 4], // 17
    });
    const r = scoreAnswers(answers);
    const byKey = Object.fromEntries(r.styles.map((s) => [s.key, s.score]));

    expect(byKey).toEqual({
      force: 5,
      rules: 12,
      exchange: 9,
      persuasion: 17,
      assertion: 13,
      magnetism: 14,
      visioning: 19,
      bridging: 18,
      environmental: 14,
      joint: 17,
    });
    expect(r.push).toBe(5 + 12 + 9 + 17 + 13); // 56
    expect(r.pull).toBe(14 + 19 + 18 + 14 + 17); // 82
    expect(r.orientation).toBe('Pull');
    expect(r.top3.map((s) => s.key)).toEqual(['visioning', 'bridging', 'joint']);
    expect(r.development.key).toBe('force');
    expect(r.development.band).toBe('Low');
    expect(r.pushShare).toBe(40.6);
    expect(r.pullShare).toBe(59.4);
  });

  it('reads item positions correctly rather than by order', () => {
    // Only statement 21 (Force, third item) is answered above zero.
    const answers: Record<number, number> = {};
    for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = 0;
    answers[21] = 5;
    const r = scoreAnswers(answers);
    expect(r.styles.find((s) => s.key === 'force')!.score).toBe(5);
    expect(r.push).toBe(5);
    expect(r.pull).toBe(0);
    expect(r.orientation).toBe('Balanced'); // within 5 points
  });

  it('calls a 6-point gap an orientation but 5 balanced', () => {
    const balanced = { ...flat(0), 1: 5 };
    expect(scoreAnswers(balanced).orientation).toBe('Balanced');
    const leaning = { ...flat(0), 1: 5, 13: 1 };
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
    expect(() => scoreAnswers({ ...flat(3), 4: 6 })).toThrow(/statement 4/);
    expect(() => scoreAnswers({ ...flat(3), 4: -1 })).toThrow(/statement 4/);
    expect(() => scoreAnswers({ ...flat(3), 4: 2.5 })).toThrow(/statement 4/);
  });

  it('keeps push and pull shares summing to 100', () => {
    for (let seed = 0; seed < 40; seed++) {
      const answers: Record<number, number> = {};
      for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 7 + seed * 13) % 6;
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
        exchange: [2, 2, 2, 2],
        persuasion: [3, 3, 3, 3],
        assertion: [2, 2, 2, 2],
        magnetism: [4, 4, 4, 4],
        visioning: [5, 5, 5, 5],
        bridging: [3, 3, 3, 3],
        environmental: [2, 2, 2, 2],
        joint: [4, 4, 4, 3],
      }),
    );
    const text = executiveSummary(r, 'Priya');
    expect(text).toContain('Priya');
    expect(text).toContain('Visioning');
    expect(text).toContain('Force');
    expect(text).toContain(`${r.push} of ${MAX_SIDE_SCORE}`);
  });
});
