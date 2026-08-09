/**
 * Assembles the single report payload that the HTML report page, the PDF and
 * the report email all render. One source, so the three cannot drift.
 */

import { executiveSummary, scoreAnswers, type ScoreResult } from '../../shared/scoring.js';
import { STYLE_BY_KEY } from '../../shared/styles.js';
import type { Branding, CandidateDetails, ReportNarrative, ReportPayload } from '../../shared/types.js';

export function buildReport(input: {
  reportToken: string;
  assessmentName: string;
  candidate: CandidateDetails;
  completedAt: string;
  branding: Branding;
  answers: Record<number, number>;
}): ReportPayload {
  const scores = scoreAnswers(input.answers);
  return {
    reportToken: input.reportToken,
    assessmentName: input.assessmentName,
    candidate: input.candidate,
    completedAt: input.completedAt,
    branding: input.branding,
    scores,
    narratives: narrativesFor(scores),
    development: developmentFor(scores),
    summary: executiveSummary(scores, input.candidate.firstName || 'This candidate'),
  };
}

/** Rebuilds a payload from a persisted ScoreResult, skipping recomputation. */
export function reportFromScores(input: {
  reportToken: string;
  assessmentName: string;
  candidate: CandidateDetails;
  completedAt: string;
  branding: Branding;
  scores: ScoreResult;
}): ReportPayload {
  return {
    ...input,
    narratives: narrativesFor(input.scores),
    development: developmentFor(input.scores),
    summary: executiveSummary(input.scores, input.candidate.firstName || 'This candidate'),
  };
}

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

function developmentFor(scores: ScoreResult): ReportPayload['development'] {
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
