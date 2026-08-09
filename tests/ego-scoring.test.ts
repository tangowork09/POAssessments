import { describe, expect, it } from 'vitest';
import extracted from '../data/assessments_extracted.json' with { type: 'json' };
import {
  EGO_ITEMS_PER_STATE,
  EGO_MAX_ANSWER,
  EGO_MAX_STATE_SCORE,
  EGO_MIN_ANSWER,
  EGO_QUESTION_COUNT,
  EGO_SCALE_LABELS,
  EGO_STATE_COUNT,
  EgoScoringError,
  egoBandFor,
  egoExecutiveSummary,
  scoreEgoAnswers,
} from '../src/shared/ego-scoring.js';
import { EGO_STATES, egoItemsFor } from '../src/shared/ego.js';

/**
 * The client's own worked example, recovered from the scoring grid in
 * `data/assessments_extracted.json`.
 *
 * The grid is laid out as six (statement, score) column pairs per row, so this
 * reads the statement numbers out of the sheet rather than trusting a
 * transcribed list — a transcription is exactly the thing that silently drops
 * an entry and still looks plausible.
 */
function clientFixture(): { answers: Record<number, number>; totals: number[]; percents: number[] } {
  const grid = (extracted as { ta_ego_states: { scoring_raw: unknown[][] } }).ta_ego_states.scoring_raw;
  const answers: Record<number, number> = {};
  const totals: number[] = [];
  const percents: number[] = [];

  for (const row of grid) {
    for (let col = 2; col < 14; col += 2) {
      const no = row[col];
      const value = row[col + 1];
      if (typeof no === 'number' && typeof value === 'number') answers[no] = value;
      // The two summary rows label their cells 'Total =' and '%'.
      if (typeof no === 'string' && no.trim() === 'Total =' && typeof value === 'number') {
        totals.push(value);
      }
      if (typeof no === 'string' && no.trim() === '%' && typeof value === 'number') {
        percents.push(value);
      }
    }
  }
  return { answers, totals, percents };
}

const fixture = clientFixture();

describe('the client fixture itself', () => {
  it('is a complete set of 66 answers inside the 0..6 range', () => {
    expect(Object.keys(fixture.answers)).toHaveLength(EGO_QUESTION_COUNT);
    for (let n = 1; n <= EGO_QUESTION_COUNT; n++) {
      const v = fixture.answers[n];
      expect(v, `statement ${n} missing from the fixture`).toBeTypeOf('number');
      expect(v).toBeGreaterThanOrEqual(EGO_MIN_ANSWER);
      expect(v).toBeLessThanOrEqual(EGO_MAX_ANSWER);
    }
  });

  it('carries the six published column totals', () => {
    expect(fixture.totals).toEqual([54, 59, 55, 52, 49, 51]);
  });
});

describe('state → item map', () => {
  it('covers statements 1..66 exactly once across six states', () => {
    expect(EGO_STATES).toHaveLength(EGO_STATE_COUNT);
    const seen = new Map<number, string>();
    for (const state of EGO_STATES) {
      const items = egoItemsFor(state.column);
      expect(items, `${state.key} should have ${EGO_ITEMS_PER_STATE} items`).toHaveLength(
        EGO_ITEMS_PER_STATE,
      );
      for (const no of items) {
        expect(seen.has(no), `statement ${no} claimed by ${seen.get(no)} and ${state.key}`).toBe(false);
        seen.set(no, state.key);
      }
    }
    expect(seen.size).toBe(EGO_QUESTION_COUNT);
  });

  it('is the every-sixth-statement column rule', () => {
    for (const state of EGO_STATES) {
      for (const no of egoItemsFor(state.column)) {
        expect(((no - 1) % EGO_STATE_COUNT) + 1).toBe(state.column);
      }
    }
    expect(egoItemsFor(1)).toEqual([1, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61]);
    expect(egoItemsFor(6)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66]);
  });

  it('uses unique keys, names and abbreviations, and columns 1..6 in order', () => {
    expect(new Set(EGO_STATES.map((s) => s.key)).size).toBe(EGO_STATE_COUNT);
    expect(new Set(EGO_STATES.map((s) => s.name)).size).toBe(EGO_STATE_COUNT);
    expect(new Set(EGO_STATES.map((s) => s.abbr)).size).toBe(EGO_STATE_COUNT);
    expect(EGO_STATES.map((s) => s.column)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('offers one scale label per point from 0 to 6', () => {
    expect(EGO_SCALE_LABELS).toHaveLength(EGO_MAX_ANSWER - EGO_MIN_ANSWER + 1);
  });
});

describe('scoreEgoAnswers', () => {
  it('reproduces the client worked example exactly', () => {
    const r = scoreEgoAnswers(fixture.answers);
    expect(r.states.map((s) => s.score)).toEqual(fixture.totals);
    r.states.forEach((s, i) => {
      // The sheet's own percentages, to the precision the report shows.
      expect(s.percent).toBeCloseTo(fixture.percents[i]!, 1);
    });
  });

  it('is the column-sum property, not a coincidence of one fixture', () => {
    // Every sixth answer must be exactly what each state totals, for any input.
    for (let seed = 0; seed < 30; seed++) {
      const answers: Record<number, number> = {};
      for (let n = 1; n <= EGO_QUESTION_COUNT; n++) answers[n] = (n * 5 + seed * 11) % 7;
      const r = scoreEgoAnswers(answers);
      for (const state of r.states) {
        const expected = egoItemsFor(state.column).reduce((t, n) => t + answers[n]!, 0);
        expect(state.score, `${state.key} for seed ${seed}`).toBe(expected);
        expect(state.percent).toBeCloseTo(
          Math.round((expected / EGO_MAX_STATE_SCORE) * 1000) / 10,
          5,
        );
      }
      expect(r.total).toBe(Object.values(answers).reduce((t, v) => t + v, 0));
    }
  });

  it('scores an all-zero response at the floor and an all-six at the ceiling', () => {
    const flat = (v: number): Record<number, number> =>
      Object.fromEntries(Array.from({ length: EGO_QUESTION_COUNT }, (_, i) => [i + 1, v]));

    const low = scoreEgoAnswers(flat(0));
    expect(low.states.every((s) => s.score === 0 && s.percent === 0 && s.band === 'Low')).toBe(true);
    expect(low.spread).toBe(0);

    const high = scoreEgoAnswers(flat(EGO_MAX_ANSWER));
    expect(high.states.every((s) => s.score === EGO_MAX_STATE_SCORE && s.percent === 100)).toBe(true);
    expect(high.states.every((s) => s.band === 'High')).toBe(true);
    expect(high.total).toBe(EGO_QUESTION_COUNT * EGO_MAX_ANSWER);
  });

  it('keeps the states in column order and ranks a separate copy', () => {
    const r = scoreEgoAnswers(fixture.answers);
    expect(r.states.map((s) => s.column)).toEqual([1, 2, 3, 4, 5, 6]);
    // Highest of 54/59/55/52/49/51 is column 2, lowest is column 5.
    expect(r.highest.column).toBe(2);
    expect(r.lowest.column).toBe(5);
    expect(r.spread).toBe(59 - 49);
    const scores = r.ranked.map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('ranks deterministically when scores tie', () => {
    const flat = Object.fromEntries(
      Array.from({ length: EGO_QUESTION_COUNT }, (_, i) => [i + 1, 3]),
    );
    const a = scoreEgoAnswers(flat);
    const b = scoreEgoAnswers(flat);
    expect(a.ranked.map((s) => s.key)).toEqual(b.ranked.map((s) => s.key));
    expect(a.ranked.map((s) => s.column)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reads item positions rather than order', () => {
    const answers: Record<number, number> = {};
    for (let n = 1; n <= EGO_QUESTION_COUNT; n++) answers[n] = 0;
    answers[43] = 6; // 43 = column 1
    const r = scoreEgoAnswers(answers);
    expect(r.states[0]!.score).toBe(6);
    expect(r.states.slice(1).every((s) => s.score === 0)).toBe(true);
  });

  it('rejects a missing answer', () => {
    const answers: Record<number, number> = {};
    for (let n = 1; n <= EGO_QUESTION_COUNT; n++) answers[n] = 3;
    delete answers[40];
    expect(() => scoreEgoAnswers(answers)).toThrow(EgoScoringError);
    expect(() => scoreEgoAnswers(answers)).toThrow(/statement 40/);
  });

  it('rejects out-of-range and non-integer answers', () => {
    const base: Record<number, number> = {};
    for (let n = 1; n <= EGO_QUESTION_COUNT; n++) base[n] = 3;
    expect(() => scoreEgoAnswers({ ...base, 4: 7 })).toThrow(/statement 4/);
    expect(() => scoreEgoAnswers({ ...base, 4: -1 })).toThrow(/statement 4/);
    expect(() => scoreEgoAnswers({ ...base, 4: 2.5 })).toThrow(/statement 4/);
    // 6 is the top of this instrument's scale and must be accepted.
    expect(() => scoreEgoAnswers({ ...base, 4: 6 })).not.toThrow();
  });
});

describe('egoBandFor', () => {
  it('splits the percentage into thirds at 50 and 75', () => {
    expect(egoBandFor(0)).toBe('Low');
    expect(egoBandFor(49.9)).toBe('Low');
    expect(egoBandFor(50)).toBe('Moderate');
    expect(egoBandFor(74.9)).toBe('Moderate');
    expect(egoBandFor(75)).toBe('High');
    expect(egoBandFor(100)).toBe('High');
  });
});

describe('egoExecutiveSummary', () => {
  it('names the candidate, the highest state and the lowest state', () => {
    const r = scoreEgoAnswers(fixture.answers);
    const text = egoExecutiveSummary(r, 'Priya');
    expect(text).toContain('Priya');
    expect(text).toContain(r.highest.name);
    expect(text).toContain(r.lowest.name);
    expect(text).toContain(String(r.highest.score));
  });
});
