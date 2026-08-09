/**
 * Assembles the single report payload that the HTML report page, the PDF and
 * the report email all render. One source, so the three cannot drift.
 *
 * The payload is a tagged union keyed on the assessment: `buildReport` picks
 * the scoring engine from the assessment id, and everything downstream
 * switches on `payload.kind`.
 */

import { kindForAssessment, type AssessmentKind } from '../../shared/assessments.js';
import {
  EGO_DRAFT_NOTE,
  EGO_LABELS_ARE_DRAFT,
  EGO_STATE_BY_KEY,
} from '../../shared/ego.js';
import {
  egoExecutiveSummary,
  scoreEgoAnswers,
  type EgoResult,
  type EgoStateScore,
} from '../../shared/ego-scoring.js';
import { executiveSummary, scoreAnswers, type ScoreResult } from '../../shared/scoring.js';
import { INFLUENCING_METHODS, STYLE_BY_KEY } from '../../shared/styles.js';
import type {
  Branding,
  CandidateDetails,
  EgoReportPayload,
  EgoStateNarrative,
  IsiReportPayload,
  ReportNarrative,
  ReportPayload,
} from '../../shared/types.js';

/** Whatever a persisted `scores_json` holds — tagged since the ego release. */
export type StoredScores = ScoreResult | EgoResult;

export class UnknownAssessmentError extends Error {
  constructor(assessmentId: string) {
    super(`No scoring engine is registered for assessment ${assessmentId}`);
  }
}

interface BuildInput {
  reportToken: string;
  assessmentId: string;
  assessmentName: string;
  candidate: CandidateDetails;
  completedAt: string;
  branding: Branding;
}

export function buildReport(input: BuildInput & { answers: Record<number, number> }): ReportPayload {
  const kind = kindForAssessment(input.assessmentId);
  if (!kind) throw new UnknownAssessmentError(input.assessmentId);
  const scores: StoredScores =
    kind === 'ego' ? scoreEgoAnswers(input.answers) : scoreAnswers(input.answers);
  return reportFromScores({ ...input, scores });
}

/**
 * Rebuilds a payload from a persisted score object, skipping recomputation.
 *
 * Rows written before the second instrument shipped carry an untagged
 * `ScoreResult`, so the kind is taken from the assessment and the tag is only
 * used as a cross-check.
 */
export function reportFromScores(input: BuildInput & { scores: StoredScores }): ReportPayload {
  const kind = kindForAssessment(input.assessmentId) ?? inferKind(input.scores);
  if (!kind) throw new UnknownAssessmentError(input.assessmentId);

  const base = {
    reportToken: input.reportToken,
    assessmentId: input.assessmentId,
    assessmentName: input.assessmentName,
    candidate: input.candidate,
    completedAt: input.completedAt,
    branding: input.branding,
  };
  const firstName = input.candidate.firstName || 'This candidate';

  if (kind === 'ego') {
    const ego = input.scores as EgoResult;
    const states = ego.states.map(toStateNarrative);
    const byKey = new Map(states.map((s) => [s.stateKey, s]));
    const payload: EgoReportPayload = {
      ...base,
      kind: 'ego',
      ego,
      states,
      highest: byKey.get(ego.highest.key)!,
      lowest: byKey.get(ego.lowest.key)!,
      labelsAreDraft: EGO_LABELS_ARE_DRAFT,
      draftNote: EGO_DRAFT_NOTE,
      summary: egoExecutiveSummary(ego, firstName),
    };
    return payload;
  }

  const scores = input.scores as ScoreResult;
  const payload: IsiReportPayload = {
    ...base,
    kind: 'isi',
    scores,
    narratives: narrativesFor(scores),
    development: developmentFor(scores),
    methods: { push: INFLUENCING_METHODS.push, pull: INFLUENCING_METHODS.pull },
    summary: executiveSummary(scores, firstName),
  };
  return payload;
}

function inferKind(scores: StoredScores): AssessmentKind | null {
  if ((scores as EgoResult).kind === 'ego') return 'ego';
  if ((scores as ScoreResult).styles) return 'isi';
  return null;
}

// ----------------------------------------------------------------------- ISI

function narrativesFor(scores: ScoreResult): ReportNarrative[] {
  return scores.top3.map((s) => {
    const def = STYLE_BY_KEY[s.key]!;
    return {
      styleKey: s.key,
      name: s.name,
      side: s.side,
      blurb: def.blurb,
      score: s.score,
      band: s.band,
      narrative: def.narrative,
      caution: def.caution,
    };
  });
}

function developmentFor(scores: ScoreResult): IsiReportPayload['development'] {
  const d = scores.development;
  const def = STYLE_BY_KEY[d.key]!;
  return {
    styleKey: d.key,
    name: d.name,
    score: d.score,
    band: d.band,
    low: def.low,
    action: def.dev,
  };
}

// ---------------------------------------------------------------- ego states

function toStateNarrative(s: EgoStateScore): EgoStateNarrative {
  const def = EGO_STATE_BY_KEY[s.key]!;
  return {
    stateKey: s.key,
    name: s.name,
    abbr: s.abbr,
    color: s.color,
    blurb: def.blurb,
    score: s.score,
    percent: s.percent,
    band: s.band,
    description: def.description,
    high: def.high,
    low: def.low,
    dev: def.dev,
  };
}
