/** Wire types shared by the Worker API and both frontend shells. */

import type { Band, ScoreResult } from './scoring.js';

export interface Question {
  no: number;
  text: string;
}

export interface AssessmentSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'live' | 'planned' | 'retired';
  questionCount: number;
}

export interface Branding {
  companyName: string;
  accentColor: string;
  /** data: URI, or '' when no logo has been uploaded. */
  logoDataUrl: string;
  supportEmail: string;
}

/** Everything a candidate shell needs on first paint of /t/:token. */
export interface CandidateSession {
  /** 'personal' links already know who the candidate is; 'generic' links do not. */
  linkKind: 'personal' | 'generic';
  assessment: AssessmentSummary;
  questions: Question[];
  branding: Branding;
  perPage: number;
  scaleLabels: readonly string[];
  /** Present once a response row exists (personal link, or generic link resumed). */
  response: CandidateResponseState | null;
  /**
   * True once a report exists for this candidate. The report token itself is
   * never returned here — it is stored only as a keyed hash — so the candidate
   * reads their report through their own link instead.
   */
  reportAvailable: boolean;
}

export interface CandidateResponseState {
  responseId: string;
  status: 'invited' | 'in_progress' | 'completed';
  details: CandidateDetails | null;
  answers: Record<number, number>;
  answeredCount: number;
  /** 0-based page the candidate should resume on. */
  resumePage: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CandidateDetails {
  firstName: string;
  lastName: string;
  email: string;
  organisation: string;
  ageBand: string;
  experienceBand: string;
  gender: string;
}

export interface ReportPayload {
  reportToken: string;
  assessmentName: string;
  candidate: CandidateDetails;
  completedAt: string;
  branding: Branding;
  scores: ScoreResult;
  narratives: ReportNarrative[];
  development: {
    styleKey: string;
    name: string;
    score: number;
    band: Band;
    low: string;
    action: string;
  };
  summary: string;
}

export interface ReportNarrative {
  styleKey: string;
  name: string;
  side: 'push' | 'pull';
  blurb: string;
  score: number;
  band: Band;
  narrative: string;
  caution: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
