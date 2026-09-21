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
import {
  COLLAB_ITEM_COUNT,
  COLLAB_MAX_ANSWER,
  COLLAB_MIN_ANSWER,
  COLLAB_SCALE_LABELS,
  COLLAB_SCALE_SHORT_LABELS,
} from './collab.js';
import {
  SOCIO_ITEM_COUNT,
  SOCIO_MAX_ANSWER,
  SOCIO_MIN_ANSWER,
  SOCIO_SCALE_LABELS,
  SOCIO_SCALE_SHORT_LABELS,
} from './socio.js';

/** Which scoring engine and which report shape an assessment uses. */
export type AssessmentKind = 'isi' | 'ego' | 'socio' | 'collab';

export const ASSESSMENT_ID = {
  isi: 'asm_influencing_style',
  ego: 'asm_ta_ego_states',
  socio: 'asm_sociometry',
  collab: 'asm_collaboration_diagnostic',
} as const satisfies Record<AssessmentKind, string>;

const KIND_BY_ID: Record<string, AssessmentKind> = {
  [ASSESSMENT_ID.isi]: 'isi',
  [ASSESSMENT_ID.ego]: 'ego',
  [ASSESSMENT_ID.socio]: 'socio',
  [ASSESSMENT_ID.collab]: 'collab',
};

/**
 * Cohort instruments are rated about *other people*, so they need a roster
 * before anyone can start, they are scored across the whole group rather than
 * per response, and their reports live in `cohort_reports` rather than
 * `reports`. Everything that branches on that branches on this.
 */
export function isCohortKind(kind: AssessmentKind | null): boolean {
  return kind === 'socio';
}

export function isCohortAssessment(assessmentId: string): boolean {
  return isCohortKind(kindForAssessment(assessmentId));
}

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
  /**
   * What happens to the answers, said before any are given.
   *
   * Named relational data asks more of a respondent than a self-rating does,
   * and the design guide is explicit that trust in the exercise is a
   * precondition for honest data about trust. Absent for instruments that only
   * ask somebody about themselves.
   */
  confidentiality?: string;
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
  /** True when the instrument is answered about a roster rather than oneself. */
  cohortBased?: boolean;
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

  socio: {
    kind: 'socio',
    cohortBased: true,
    id: ASSESSMENT_ID.socio,
    slug: 'collaboration-sociometry',
    name: 'Collaboration Sociometry',
    // Twelve statements, but answered once per colleague rather than once in
    // total, so the real length depends on the roster and how much of it the
    // respondent actually works with. `questionCount` stays the item count
    // because that is what the `questions` table holds.
    questionCount: SOCIO_ITEM_COUNT,
    scale: {
      min: SOCIO_MIN_ANSWER,
      max: SOCIO_MAX_ANSWER,
      labels: SOCIO_SCALE_LABELS,
      shortLabels: SOCIO_SCALE_SHORT_LABELS,
    },
    intro: {
      eyebrow: '12 statements per colleague - about 15 minutes',
      // The consent wording the facilitator guide supplies, close to verbatim.
      confidentiality:
        'Your individual responses are seen only by the facilitation team and are never shared with other participants — nobody is told who rated them, or how. Results are reported as group-level patterns, to help strengthen how the leadership team works together.',
      // The workbook's own title for the exercise.
      title: 'Collaboration Sociometry',
      lede: 'This short exercise looks at how leaders in the group work together - who you rely on, and who you find it easy to work with. Your answers, combined with everyone else\'s, help build an honest picture of where collaboration is strong and where it can be strengthened. It is not a performance review, and it is not scored against any individual.',
      instructionsTitle: 'How to fill it in',
      // Verbatim from the workbook's Instructions sheet, with the two
      // spreadsheet-specific lines rewritten for a screen that already knows
      // who you are and already leaves your own row out.
      instructions: [
        'You will see the leaders in the group one at a time.',
        'For each leader, rate how true each statement is of your experience with them.',
        'Rate only the people you actually work with. If you have no real basis to judge someone, skip them - a skip is fine and is useful information in itself.',
        'There are no right or wrong answers. Answer for how things actually are, not how they should be.',
      ],
      emphasis:
        'Your own name is left out automatically. Your progress saves itself, so you can stop at any point and pick up exactly where you left off.',
      cta: 'Begin',
      ctaResume: 'Continue where I left off',
    },
  },

  /**
   * A third shape. ISI and the Ego States Scale report on the person who
   * answered; Sociometry reports on a group by having its members rate each
   * other. This one is a self-report *about the organisation*: every leader
   * answers the same 24 statements about the company, and the finding only
   * exists once the whole group's answers are averaged. So the candidate flow
   * is an ordinary self-rating — no roster, no matrix, `cohortBased` false —
   * while the report belongs to the run rather than to any respondent.
   *
   * Note what the intro does *not* carry: section titles. The master copy's
   * participant version is the instructions, the scale and the 24 statements,
   * in that order and nothing else. A leader who can see that a statement sits
   * under "Trust & Safety" answers it differently, so section membership stays
   * facilitator-side (src/shared/collab.ts) and never reaches this payload.
   */
  collab: {
    kind: 'collab',
    id: ASSESSMENT_ID.collab,
    slug: 'collaboration-diagnostic',
    name: 'Collaboration Diagnostic',
    questionCount: COLLAB_ITEM_COUNT,
    scale: {
      min: COLLAB_MIN_ANSWER,
      max: COLLAB_MAX_ANSWER,
      labels: COLLAB_SCALE_LABELS,
      shortLabels: COLLAB_SCALE_SHORT_LABELS,
    },
    intro: {
      eyebrow: '24 statements · about 8 minutes',
      /*
       * The general promise only. What happens to a small department depends
       * on the floor this particular run is set to, so that sentence is built
       * per run in collab-candidate.ts rather than promised here for every
       * run in advance.
       */
      confidentiality:
        'Your individual answers are seen only by the facilitation team and are never shown to anyone in your organisation. Results are reported for the leadership group as a whole.',
      title: 'Collaboration Diagnostic',
      lede: 'Twenty-four short statements about how work gets done between departments here. You are not being assessed: the questions are about the organisation, and your answers join everyone else\'s to show where collaboration is strong and where it is under strain.',
      instructionsTitle: 'Rate each statement from 1 to 5',
      // The master copy's own scale, verbatim.
      instructions: [
        '1 = Strongly Disagree',
        '2 = Disagree',
        '3 = Neither agree nor disagree',
        '4 = Agree',
        '5 = Strongly Agree',
      ],
      instructionBadges: ['1', '2', '3', '4', '5'],
      emphasis:
        'Some statements describe good practice and others describe problems, so read each one before answering. Answer for how things actually are, not how they should be. Your progress saves itself, so you can stop at any point and pick up exactly where you left off.',
      cta: 'Begin',
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
