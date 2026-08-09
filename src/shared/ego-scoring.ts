/**
 * Scoring engine for the Ego States Scale.
 *
 * Every statement is answered 0..6. Each ego state is the sum of its eleven
 * statements — every sixth one, starting at its column — so a state score runs
 * 0..66, and its percentage is that score out of 66.
 *
 * Pure and dependency-free: the same code runs in the Worker, in the browser
 * and under Vitest.
 */

import { EGO_STATES, egoItemsFor, type EgoState } from './ego.js';

export const EGO_MIN_ANSWER = 0;
export const EGO_MAX_ANSWER = 6;
export const EGO_QUESTION_COUNT = 66;
export const EGO_STATE_COUNT = EGO_STATES.length; // 6
export const EGO_ITEMS_PER_STATE = EGO_QUESTION_COUNT / EGO_STATE_COUNT; // 11
export const EGO_MAX_STATE_SCORE = EGO_ITEMS_PER_STATE * EGO_MAX_ANSWER; // 66

/**
 * Rating anchors. The source instrument names only 0, 3 and 6; the values
 * between are described in the instructions rather than labelled, so the
 * in-between squares carry the shading words that the instructions imply.
 */
export const EGO_SCALE_LABELS = [
  'Never true',
  'Rarely true',
  'Seldom true',
  'Sometimes true',
  'Often true',
  'Usually true',
  'Always true',
] as const;

/** The three anchors that are verbatim in the source instrument. */
export const EGO_SCALE_ANCHORS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Never true' },
  { value: 3, label: 'Sometimes true' },
  { value: 6, label: 'Always true' },
];

export type EgoBand = 'Low' | 'Moderate' | 'High';

/**
 * DRAFT bands. The source instrument publishes no cut-scores — it reports the
 * percentage and reads the *shape* of the profile, which is why the report
 * leads with the ego-gram and with highest/lowest rather than with a band.
 * These thirds are ours, marked draft, and exist only so a single state can be
 * described in words as well as in numbers.
 */
export function egoBandFor(percent: number): EgoBand {
  if (percent < 50) return 'Low';
  if (percent < 75) return 'Moderate';
  return 'High';
}

export interface EgoStateScore {
  key: string;
  name: string;
  abbr: string;
  color: string;
  /** 1-based column in the source scoring grid. */
  column: number;
  /** 0..66 */
  score: number;
  /** score as a percentage of EGO_MAX_STATE_SCORE, one decimal. */
  percent: number;
  band: EgoBand;
}

export interface EgoResult {
  kind: 'ego';
  /** In column order — the order the ego-gram is drawn in. */
  states: EgoStateScore[];
  /** Sorted by score descending, ties broken by column for determinism. */
  ranked: EgoStateScore[];
  highest: EgoStateScore;
  lowest: EgoStateScore;
  /** Sum of all six states — equals the sum of all 66 answers. */
  total: number;
  /** Largest minus smallest state score: how uneven the profile is. */
  spread: number;
  totalAnswered: number;
}

export class EgoScoringError extends Error {}

/**
 * `answers` is a map of 1-based statement number to a 0..6 response. Missing
 * statements are rejected: a report is only ever produced from a complete set,
 * so a partial map is a programming error rather than a state.
 */
export function scoreEgoAnswers(answers: Readonly<Record<number, number>>): EgoResult {
  for (let n = 1; n <= EGO_QUESTION_COUNT; n++) {
    const v = answers[n];
    if (v === undefined || v === null) {
      throw new EgoScoringError(`Missing answer for statement ${n}`);
    }
    if (!Number.isInteger(v) || v < EGO_MIN_ANSWER || v > EGO_MAX_ANSWER) {
      throw new EgoScoringError(
        `Answer for statement ${n} must be an integer ${EGO_MIN_ANSWER}..${EGO_MAX_ANSWER}, received ${String(v)}`,
      );
    }
  }

  const states = EGO_STATES.map((s) => toStateScore(s, answers));
  const ranked = [...states].sort((a, b) => b.score - a.score || a.column - b.column);

  return {
    kind: 'ego',
    states,
    ranked,
    highest: ranked[0]!,
    lowest: ranked[ranked.length - 1]!,
    total: states.reduce((t, s) => t + s.score, 0),
    spread: ranked[0]!.score - ranked[ranked.length - 1]!.score,
    totalAnswered: EGO_QUESTION_COUNT,
  };
}

function toStateScore(s: EgoState, answers: Readonly<Record<number, number>>): EgoStateScore {
  const score = egoItemsFor(s.column, EGO_QUESTION_COUNT).reduce((t, n) => t + (answers[n] ?? 0), 0);
  const percent = round1((score / EGO_MAX_STATE_SCORE) * 100);
  return {
    key: s.key,
    name: s.name,
    abbr: s.abbr,
    color: s.color,
    column: s.column,
    score,
    percent,
    band: egoBandFor(percent),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Executive-summary sentence used identically by the HTML report, the PDF and
 * the report email, so the three can never drift apart.
 */
export function egoExecutiveSummary(r: EgoResult, firstName: string): string {
  const high = r.highest;
  const low = r.lowest;
  const second = r.ranked[1]!;

  const shape =
    r.spread <= 6
      ? 'an unusually level profile — no single ego state is doing much more of the work than the others, which tends to read as adaptability'
      : r.spread <= 15
        ? 'a moderately differentiated profile: clear preferences, but every ego state remains available to you'
        : 'a strongly differentiated profile, where a small number of ego states carry most of your responses';

  return (
    `${firstName} shows ${shape}. The most available ego state is ${high.name} ` +
    `(${high.score} of ${EGO_MAX_STATE_SCORE}, ${high.percent}%), followed by ${second.name} ` +
    `(${second.score} of ${EGO_MAX_STATE_SCORE}, ${second.percent}%). The least available is ` +
    `${low.name} (${low.score} of ${EGO_MAX_STATE_SCORE}, ${low.percent}%), which the ` +
    `development section addresses. An ego-gram is read by its shape rather than by any one ` +
    `figure: there is no good or bad profile, only the pattern you bring to a given situation.`
  );
}
