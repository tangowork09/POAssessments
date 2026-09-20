/**
 * Scoring engine for the Collaboration Diagnostic.
 *
 * Every statement is answered 1..5 on the published anchors. Ten are worded as
 * good practice and scored as given; fourteen are worded as problems and are
 * flipped with `6 − answer`. After that conversion a 5 always means healthy,
 * whichever way the statement was worded, and only then may anything be
 * averaged.
 *
 * The instrument reports at two levels and the engine mirrors that:
 *
 *   - `scoreCollabResponse` scores one leader. It exists for the optional
 *     "your answers against the group" sheet and for validation; it is *not*
 *     the deliverable. Nobody is diagnosed by this instrument.
 *   - `scoreCollabGroup` scores the run. This is the product: section means,
 *     the total index and its band, the strongest-to-weakest gap, and for every
 *     statement both its mean and the spread of opinion around it.
 *
 * The spread is not decoration. The master copy is explicit that an item where
 * half the group strongly agrees and half strongly disagrees is itself a
 * finding — a barrier some functions feel sharply and others cannot see — and
 * that such an item is invisible in the mean alone. So `split` is computed and
 * carried beside every mean rather than left for a reader to notice.
 *
 * Pure and dependency-free: the same code runs in the Worker, in the browser
 * and under Vitest.
 */

import {
  COLLAB_ITEMS,
  COLLAB_ITEM_BY_NO,
  COLLAB_ITEM_COUNT,
  COLLAB_MAX_ANSWER,
  COLLAB_MIN_ANSWER,
  COLLAB_MIN_SEGMENT,
  COLLAB_SECTIONS,
  type CollabSection,
} from './collab.js';

export class CollabScoringError extends Error {}

/** Lowest and highest possible total, i.e. 24 and 120. */
export const COLLAB_MIN_TOTAL = COLLAB_ITEM_COUNT * COLLAB_MIN_ANSWER;
export const COLLAB_MAX_TOTAL = COLLAB_ITEM_COUNT * COLLAB_MAX_ANSWER;

/**
 * An item counts as splitting the group when at least this share of answers
 * sits at *each* end of the converted scale. Two heavy ends with a hollow
 * middle is a different fact from a soft consensus at the same mean, and 30%
 * is the point where the smaller camp is too large to read as a handful of
 * dissenters.
 */
export const COLLAB_SPLIT_TAIL = 0.3;

export type CollabBandKey = 'healthy' | 'friction' | 'barriers' | 'breaking';

export interface CollabBand {
  key: CollabBandKey;
  /** Inclusive bounds on the 24..120 total. */
  minTotal: number;
  maxTotal: number;
  /** Short name for a chart or a table cell. */
  name: string;
  /** The master copy's own reading of the band, verbatim. */
  reading: string;
}

/**
 * The four bands, verbatim from the scoring key. The master copy calls these
 * "an indicative guide, not a hard cut-off", which is why nothing in the
 * engine branches on a band: it is a label carried alongside the number, never
 * a gate.
 */
export const COLLAB_BANDS: readonly CollabBand[] = [
  {
    key: 'healthy',
    minTotal: 96,
    maxTotal: 120,
    name: 'Healthy collaboration system',
    reading: 'Healthy collaboration system — protect and build on it.',
  },
  {
    key: 'friction',
    minTotal: 72,
    maxTotal: 95,
    name: 'Workable, with real friction',
    reading: 'Workable, but with real friction — target the weakest sections.',
  },
  {
    key: 'barriers',
    minTotal: 48,
    maxTotal: 71,
    name: 'Significant systemic barriers',
    reading: 'Significant systemic barriers — needs focused intervention.',
  },
  {
    key: 'breaking',
    minTotal: COLLAB_MIN_TOTAL,
    maxTotal: 47,
    name: 'Collaboration is breaking down',
    reading: 'Collaboration is breaking down — treat as a priority.',
  },
];

/** The band a 24..120 total falls in. */
export function collabBandForTotal(total: number): CollabBand {
  const band = COLLAB_BANDS.find((b) => total >= b.minTotal && total <= b.maxTotal);
  if (!band) throw new CollabScoringError(`total ${total} is outside ${COLLAB_MIN_TOTAL}..${COLLAB_MAX_TOTAL}`);
  return band;
}

/**
 * The band a per-item mean falls in. The scoring key publishes both scales
 * against the same four bands, so this is the total's band read on the 1..5
 * scale rather than a second, looser rule.
 */
export function collabBandForMean(mean: number): CollabBand {
  return collabBandForTotal(mean * COLLAB_ITEM_COUNT);
}

/**
 * One answer, converted. Direct items are used as chosen; reverse items are
 * flipped with 6 − answer, so 5 becomes 1, 3 stays 3, and 1 becomes 5.
 */
export function convertAnswer(no: number, answer: number): number {
  const item = COLLAB_ITEM_BY_NO.get(no);
  if (!item) throw new CollabScoringError(`statement ${no} is not part of this instrument`);
  if (!Number.isInteger(answer) || answer < COLLAB_MIN_ANSWER || answer > COLLAB_MAX_ANSWER) {
    throw new CollabScoringError(`statement ${no}: ${answer} is not a whole number in 1..5`);
  }
  return item.direction === 'reverse' ? COLLAB_MIN_ANSWER + COLLAB_MAX_ANSWER - answer : answer;
}

export interface CollabSectionScore {
  key: string;
  name: string;
  short: string;
  color: string;
  /** Mean of this section's converted items, 1..5. */
  mean: number;
}

export interface CollabResponseResult {
  kind: 'collab';
  /** Converted score per statement number, 1..5. */
  converted: Record<number, number>;
  sections: CollabSectionScore[];
  /** Sum of the 24 converted scores, 24..120. */
  total: number;
  /** The same figure per statement, 1.00..5.00. */
  perItem: number;
  band: CollabBand;
}

/**
 * Scores one complete response.
 *
 * A partial map is rejected rather than scored over what is present: a mean
 * taken across 19 of 24 answers is not comparable with one taken across 24,
 * and the platform only ever submits complete sets, so a gap here is a
 * programming error rather than a state to accommodate.
 */
export function scoreCollabResponse(answers: Readonly<Record<number, number>>): CollabResponseResult {
  const converted: Record<number, number> = {};
  for (const item of COLLAB_ITEMS) {
    const raw = answers[item.no];
    if (raw === undefined) throw new CollabScoringError(`statement ${item.no} is unanswered`);
    converted[item.no] = convertAnswer(item.no, raw);
  }

  const sections = COLLAB_SECTIONS.map((section) => ({
    key: section.key,
    name: section.name,
    short: section.short,
    color: section.color,
    mean: round2(meanOf(section.items.map((no) => at(converted, no)))),
  }));

  const total = COLLAB_ITEMS.reduce((sum, item) => sum + at(converted, item.no), 0);
  return {
    kind: 'collab',
    converted,
    sections,
    total,
    perItem: round2(total / COLLAB_ITEM_COUNT),
    band: collabBandForTotal(total),
  };
}

export interface CollabItemStat {
  no: number;
  sectionKey: string;
  /** Count of converted answers at 1, 2, 3, 4 and 5, in that order. */
  counts: [number, number, number, number, number];
  /** Mean converted score across the group, 1.00..5.00. */
  mean: number;
  /** Sample standard deviation across respondents; null below two responses. */
  sd: number | null;
  /** Share of answers at 1 or 2, and at 4 or 5, each 0..1. */
  lowShare: number;
  highShare: number;
  /** Both ends heavy: the group is split rather than merely lukewarm. */
  split: boolean;
}

export interface CollabGroupSection extends CollabSectionScore {
  /** Spread of this section's per-respondent means; null below two responses. */
  spread: number | null;
}

export interface CollabGap {
  strongestKey: string;
  weakestKey: string;
  /** Strongest section mean minus weakest, on the 1..5 scale. */
  value: number;
}

export interface CollabGroupResult {
  kind: 'collab';
  /** Complete responses scored. */
  n: number;
  /** Responses rejected as incomplete, counted rather than silently dropped. */
  incomplete: number;
  sections: CollabGroupSection[];
  items: CollabItemStat[];
  /** Mean of the respondents' totals, rounded to a whole index point. */
  total: number;
  perItem: number;
  band: CollabBand;
  gap: CollabGap;
  /** The five weakest and five strongest statements, by converted mean. */
  attention: number[];
  strengths: number[];
  /** Statement numbers where the group splits, weakest mean first. */
  split: number[];
}

/**
 * Scores a whole run.
 *
 * Incomplete responses are excluded and counted. A group figure built from a
 * different set of answers per item is not one figure, and the count is
 * reported so a reader can see how much was set aside.
 */
export function scoreCollabGroup(responses: readonly Readonly<Record<number, number>>[]): CollabGroupResult {
  const scored: CollabResponseResult[] = [];
  let incomplete = 0;
  for (const answers of responses) {
    try {
      scored.push(scoreCollabResponse(answers));
    } catch (err) {
      if (err instanceof CollabScoringError) incomplete++;
      else throw err;
    }
  }
  if (scored.length === 0) throw new CollabScoringError('no complete responses to score');

  const items: CollabItemStat[] = COLLAB_ITEMS.map((item) => {
    const values = scored.map((r) => at(r.converted, item.no));
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const v of values) counts[v - 1] = (counts[v - 1] ?? 0) + 1;
    const low = (counts[0] + counts[1]) / values.length;
    const high = (counts[3] + counts[4]) / values.length;
    return {
      no: item.no,
      sectionKey: item.sectionKey,
      counts,
      mean: round2(meanOf(values)),
      sd: sampleSd(values),
      lowShare: round2(low),
      highShare: round2(high),
      split: low >= COLLAB_SPLIT_TAIL && high >= COLLAB_SPLIT_TAIL,
    };
  });

  const sections: CollabGroupSection[] = COLLAB_SECTIONS.map((section) => {
    const perRespondent = scored.map((r) => {
      const scoredSection = r.sections.find((s) => s.key === section.key);
      if (!scoredSection) throw new CollabScoringError(`section ${section.key} was not scored`);
      return scoredSection.mean;
    });
    return {
      key: section.key,
      name: section.name,
      short: section.short,
      color: section.color,
      mean: round2(meanOf(perRespondent)),
      spread: sampleSd(perRespondent),
    };
  });

  const ranked = [...sections].sort((a, b) => b.mean - a.mean || a.key.localeCompare(b.key));
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  if (!strongest || !weakest) throw new CollabScoringError('the instrument defines no sections');

  const byMean = [...items].sort((a, b) => a.mean - b.mean || a.no - b.no);
  const perItem = round2(meanOf(scored.map((r) => r.perItem)));
  const total = Math.round(meanOf(scored.map((r) => r.total)));

  return {
    kind: 'collab',
    n: scored.length,
    incomplete,
    sections,
    items,
    total,
    perItem,
    band: collabBandForTotal(total),
    gap: {
      strongestKey: strongest.key,
      weakestKey: weakest.key,
      value: round2(strongest.mean - weakest.mean),
    },
    attention: byMean.slice(0, 5).map((i) => i.no),
    strengths: byMean.slice(-5).reverse().map((i) => i.no),
    split: byMean.filter((i) => i.split).map((i) => i.no),
  };
}

export interface CollabSegmentInput {
  /** What the cut is called — a department, a function, a level. */
  name: string;
  responses: readonly Readonly<Record<number, number>>[];
}

export interface CollabSegment {
  name: string;
  /** Complete responses in this segment, reported whether or not it is scored. */
  n: number;
  /**
   * Section means, or null when the segment is too small to report. Null is
   * not "no data": it is the confidentiality floor doing its job, and the
   * console says so rather than leaving the row blank.
   */
  sections: CollabGroupSection[] | null;
  perItem: number | null;
  suppressed: boolean;
}

/**
 * Section means per segment, with anything under the floor suppressed.
 *
 * Below the floor a departmental mean is close enough to a quotation to
 * identify who said what, which breaks the confidentiality the diagnostic was
 * answered under. Suppressed segments keep their name and their count — the
 * facilitator still needs to know the department took part — and lose only
 * their figures. They are never merged into a neighbouring segment, because a
 * number reported for a group that does not exist is worse than no number.
 */
export function segmentCollab(
  segments: readonly CollabSegmentInput[],
  floor: number = COLLAB_MIN_SEGMENT,
): CollabSegment[] {
  return segments.map((segment) => {
    const complete = segment.responses.filter((answers) =>
      COLLAB_ITEMS.every((item) => answers[item.no] !== undefined),
    );
    if (complete.length < floor) {
      return { name: segment.name, n: complete.length, sections: null, perItem: null, suppressed: true };
    }
    const group = scoreCollabGroup(complete);
    return {
      name: segment.name,
      n: group.n,
      sections: group.sections,
      perItem: group.perItem,
      suppressed: false,
    };
  });
}

/** The section a statement belongs to, for a caller that has only the number. */
export function sectionOf(no: number): CollabSection {
  const item = COLLAB_ITEM_BY_NO.get(no);
  if (!item) throw new CollabScoringError(`statement ${no} is not part of this instrument`);
  const section = COLLAB_SECTIONS.find((s) => s.key === item.sectionKey);
  if (!section) throw new CollabScoringError(`statement ${no} names an unknown section`);
  return section;
}

/**
 * Reads one answer, refusing a gap.
 *
 * Under `noUncheckedIndexedAccess` a record lookup is `number | undefined`, and
 * the honest handling of that is the same as the instrument's rule: a mean over
 * a missing answer is not a mean, so the gap stops here rather than turning
 * into a NaN three functions away.
 */
function at(answers: Readonly<Record<number, number>>, no: number): number {
  const value = answers[no];
  if (value === undefined) throw new CollabScoringError(`statement ${no} is unanswered`);
  return value;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((t, v) => t + v, 0) / values.length;
}

/** Sample standard deviation. Null below two values, where spread has no meaning. */
function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = meanOf(values);
  const ss = values.reduce((t, v) => t + (v - m) ** 2, 0);
  return round2(Math.sqrt(ss / (values.length - 1)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
