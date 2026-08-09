/**
 * The assessment registry.
 *
 * The database still drives questions, linking and reporting — this file holds
 * only what is *code-shaped*: which scoring engine an assessment uses, the
 * rating scale it presents, and the verbatim begin-test copy. One entry per
 * instrument, keyed by the assessment id in D1, so adding a third instrument is
 * a row here plus a migration.
 */

import { MAX_ANSWER, MIN_ANSWER, SCALE_LABELS, SCALE_SHORT_LABELS } from './scoring.js';
import {
  EGO_MAX_ANSWER,
  EGO_MIN_ANSWER,
  EGO_QUESTION_COUNT,
  EGO_SCALE_LABELS,
} from './ego-scoring.js';

/** Which scoring engine and which report shape an assessment uses. */
export type AssessmentKind = 'isi' | 'ego';

export const ASSESSMENT_ID = {
  isi: 'asm_influencing_style',
  ego: 'asm_ta_ego_states',
} as const satisfies Record<AssessmentKind, string>;

const KIND_BY_ID: Record<string, AssessmentKind> = {
  [ASSESSMENT_ID.isi]: 'isi',
  [ASSESSMENT_ID.ego]: 'ego',
};

/**
 * Resolves an assessment id to its kind. An instrument seeded in D1 without an
 * entry here has no scoring engine, so it cannot go live — callers treat
 * `null` as "not scoreable yet" rather than guessing.
 */
export function kindForAssessment(assessmentId: string): AssessmentKind | null {
  return KIND_BY_ID[assessmentId] ?? null;
}

export interface RatingScale {
  min: number;
  max: number;
  /** One label per value from `min` to `max`, inclusive. */
  labels: readonly string[];
  /** Compact labels for the rating squares; same length as `labels`. */
  shortLabels: readonly string[];
}

/**
 * The intro shown before the details form: what the candidate is about to do,
 * in the instrument's own words.
 */
export interface AssessmentIntro {
  /** Small line above the title. */
  eyebrow: string;
  /** The instrument's own title, as the client states it. */
  title: string;
  /** One or two sentences of plain-language orientation. */
  lede: string;
  /** Heading of the instruction card. */
  instructionsTitle: string;
  /**
   * The numbered instruction lines. Where the source instrument states these
   * verbatim, they are reproduced exactly.
   */
  instructions: readonly string[];
  /**
   * Badge text per instruction line. When the lines are a value legend rather
   * than a sequence (ISI's "0 = …" anchors), sequential numbering would
   * contradict the values, so the badge shows the value itself. Absent = 1-based
   * step numbers.
   */
  instructionBadges?: readonly string[];
  /** A single emphasised line under the card, or '' for none. */
  emphasis: string;
  /** Label of the primary button. */
  cta: string;
  /** Label of the primary button when resuming an unfinished response. */
  ctaResume: string;
}

export interface AssessmentConfig {
  kind: AssessmentKind;
  id: string;
  slug: string;
  /** Display name; the DB row is authoritative, this is the fallback. */
  name: string;
  questionCount: number;
  scale: RatingScale;
  intro: AssessmentIntro;
}

export const ASSESSMENTS: Readonly<Record<AssessmentKind, AssessmentConfig>> = {
  isi: {
    kind: 'isi',
    id: ASSESSMENT_ID.isi,
    slug: 'influencing-style',
    name: 'Influencing Style Inventory',
    questionCount: 40,
    scale: {
      min: MIN_ANSWER,
      max: MAX_ANSWER,
      labels: SCALE_LABELS,
      shortLabels: SCALE_SHORT_LABELS,
    },
    intro: {
      eyebrow: '40 statements · about 10 minutes',
      // The client's own title for the begin-test screen.
      title: 'Influencing Styles Questionnaire',
      lede: 'Forty short statements about how you go about influencing other people at work. There are no right or wrong answers — rate each one as you actually behave, not as you feel you ought to.',
      instructionsTitle: 'Rate each statement from 0 to 4',
      // Verbatim anchors from the instrument.
      instructions: [
        '0 = I never do it',
        '1 = I rarely do this',
        '2 = I sometimes do this',
        '3 = I often do this',
        '4 = I always do this',
      ],
      instructionBadges: ['0', '1', '2', '3', '4'],
      emphasis:
        'Answer with your first instinct. Your progress saves itself, so you can stop at any point and pick up exactly where you left off.',
      cta: 'Begin Test',
      ctaResume: 'Continue where I left off',
    },
  },

  ego: {
    kind: 'ego',
    id: ASSESSMENT_ID.ego,
    slug: 'ta-ego-states',
    name: 'Ego States Scale',
    questionCount: EGO_QUESTION_COUNT,
    scale: {
      min: EGO_MIN_ANSWER,
      max: EGO_MAX_ANSWER,
      labels: EGO_SCALE_LABELS,
      shortLabels: EGO_SCALE_LABELS,
    },
    intro: {
      eyebrow: '66 statements · about 15 minutes',
      title: 'Ego States Scale',
      lede: 'For each statement choose a number from zero to six that describes how true or untrue it is for you in your experience of yourself.',
      instructionsTitle: 'How to use the scale',
      // Verbatim from the source instrument.
      instructions: [
        "For example, the number 0 means ‘never true’ and the number 6 means ‘always true’.",
        "If your response is somewhere between these 2 extremes, that is ‘sometimes true’ or ‘sometimes not true’ your choice will be number 3.",
        "If your response is between ‘never true’ and ‘sometimes true’, then choose between numbers ‘1’ or ‘2’ depending upon your experiences.",
        "Similarly, if your response is between ‘sometimes true’ and ‘always true’, choose between the numbers ‘4’ and ‘5’.",
      ],
      emphasis:
        'In responding to each statement, read it first and once you have understood it, respond intuitively rather than rationally.',
      cta: 'Begin Test',
      ctaResume: 'Continue where I left off',
    },
  },
};

export function configFor(assessmentId: string): AssessmentConfig | null {
  const kind = kindForAssessment(assessmentId);
  return kind ? ASSESSMENTS[kind] : null;
}

/** The rating scale an assessment presents, defaulting to the ISI 0–4 scale. */
export function scaleFor(assessmentId: string): RatingScale {
  return configFor(assessmentId)?.scale ?? ASSESSMENTS.isi.scale;
}
