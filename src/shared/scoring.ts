/**
 * Scoring engine for the Influencing Style Inventory.
 *
 * Every statement is answered 0..5. Each style is the sum of its four
 * statements, so a style score runs 0..20. Push and Pull are the sums of their
 * five styles, expressed out of 100.
 *
 * Pure and dependency-free: the same code runs in the Worker, in the browser
 * preview, and under Vitest.
 */

import { PULL_STYLES, PUSH_STYLES, STYLES, type InfluencingStyle, type Side } from './styles.js';

export const MIN_ANSWER = 0;
export const MAX_ANSWER = 5;
export const ITEMS_PER_STYLE = 4;
export const MAX_STYLE_SCORE = MIN_ANSWER + MAX_ANSWER * ITEMS_PER_STYLE; // 20
export const MAX_SIDE_SCORE = MAX_STYLE_SCORE * 5; // 100
export const QUESTION_COUNT = 40;

export const SCALE_LABELS = [
  'Never',
  'Rarely',
  'Occasionally',
  'Sometimes',
  'Often',
  'Almost always',
] as const;

export type Band = 'Low' | 'Moderate' | 'High';

/** 0–7 Low · 8–13 Moderate · 14–20 High. */
export function bandFor(styleScore: number): Band {
  if (styleScore <= 7) return 'Low';
  if (styleScore <= 13) return 'Moderate';
  return 'High';
}

export interface StyleScore {
  key: string;
  name: string;
  side: Side;
  /** 0..20 */
  score: number;
  /** score as a percentage of MAX_STYLE_SCORE, rounded to one decimal. */
  percent: number;
  band: Band;
}

export interface ScoreResult {
  styles: StyleScore[];
  /** Sum of the five Push styles, 0..100. */
  push: number;
  /** Sum of the five Pull styles, 0..100. */
  pull: number;
  /** Push as a share of (push + pull), 0..100. 50 when both are zero. */
  pushShare: number;
  pullShare: number;
  /** Styles sorted by score descending, ties broken by name for determinism. */
  ranked: StyleScore[];
  /** The three highest-scoring styles. */
  top3: StyleScore[];
  /** The lowest-scoring style — the report's development area. */
  development: StyleScore;
  /** 'Push', 'Pull' or 'Balanced' (within 5 points). */
  orientation: 'Push' | 'Pull' | 'Balanced';
  totalAnswered: number;
}

export class ScoringError extends Error {}

/**
 * `answers` is a map of 1-based statement number to a 0..5 response.
 * Missing statements are rejected — a report is only ever produced from a
 * complete set, so a partial map is a programming error rather than a state.
 */
export function scoreAnswers(answers: Readonly<Record<number, number>>): ScoreResult {
  for (let n = 1; n <= QUESTION_COUNT; n++) {
    const v = answers[n];
    if (v === undefined || v === null) {
      throw new ScoringError(`Missing answer for statement ${n}`);
    }
    if (!Number.isInteger(v) || v < MIN_ANSWER || v > MAX_ANSWER) {
      throw new ScoringError(
        `Answer for statement ${n} must be an integer ${MIN_ANSWER}..${MAX_ANSWER}, received ${String(v)}`,
      );
    }
  }

  const styles: StyleScore[] = STYLES.map((s) => toStyleScore(s, answers));
  const byKey = new Map(styles.map((s) => [s.key, s]));

  const push = PUSH_STYLES.reduce((t, s) => t + (byKey.get(s.key)?.score ?? 0), 0);
  const pull = PULL_STYLES.reduce((t, s) => t + (byKey.get(s.key)?.score ?? 0), 0);
  const total = push + pull;

  const pushShare = total === 0 ? 50 : round1((push / total) * 100);
  const pullShare = round1(100 - pushShare);

  const ranked = [...styles].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const diff = push - pull;
  const orientation = Math.abs(diff) <= 5 ? 'Balanced' : diff > 0 ? 'Push' : 'Pull';

  return {
    styles,
    push,
    pull,
    pushShare,
    pullShare,
    ranked,
    top3: ranked.slice(0, 3),
    development: ranked[ranked.length - 1]!,
    orientation,
    totalAnswered: QUESTION_COUNT,
  };
}

function toStyleScore(s: InfluencingStyle, answers: Readonly<Record<number, number>>): StyleScore {
  const score = s.items.reduce((t, n) => t + (answers[n] ?? 0), 0);
  return {
    key: s.key,
    name: s.name,
    side: s.side,
    score,
    percent: round1((score / MAX_STYLE_SCORE) * 100),
    band: bandFor(score),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Executive-summary sentence used identically by the HTML report, the PDF and
 * the report email, so the three can never drift apart.
 */
export function executiveSummary(r: ScoreResult, firstName: string): string {
  const lead = r.top3[0]!;
  const second = r.top3[1]!;
  const dominant =
    r.orientation === 'Balanced'
      ? 'draws on Push and Pull approaches in roughly equal measure'
      : r.orientation === 'Push'
        ? 'leans toward Push influence — moving others by what you bring to the exchange'
        : 'leans toward Pull influence — moving others by drawing them in';

  return (
    `${firstName} ${dominant}, scoring ${r.push} of ${MAX_SIDE_SCORE} on Push and ` +
    `${r.pull} of ${MAX_SIDE_SCORE} on Pull. The strongest single style is ${lead.name} ` +
    `(${lead.score}/${MAX_STYLE_SCORE}, ${lead.band.toLowerCase()} band), followed by ${second.name} ` +
    `(${second.score}/${MAX_STYLE_SCORE}). The least-used style is ${r.development.name} ` +
    `(${r.development.score}/${MAX_STYLE_SCORE}), which the development section addresses.`
  );
}
