/** Wire types shared by the Worker API and both frontend shells. */

import type { AssessmentIntro, AssessmentKind } from './assessments.js';
import type { EgoBand, EgoResult } from './ego-scoring.js';
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
  /** null for an instrument seeded in D1 that has no scoring engine yet. */
  kind: AssessmentKind | null;
}

export interface Branding {
  companyName: string;
  accentColor: string;
  /**
   * A data: URI from the API — never empty, because an absent upload falls
   * back to the house logo. The frontend's own pre-load placeholder uses a
   * same-origin asset path instead, to keep the base64 out of the bundle.
   */
  logoDataUrl: string;
  supportEmail: string;
}

/** The rating control's shape, sent with the session so it is never guessed. */
export interface ScaleInfo {
  min: number;
  max: number;
  labels: readonly string[];
  shortLabels: readonly string[];
}

/** Everything a candidate shell needs on first paint of /t/:token. */
export interface CandidateSession {
  /** 'personal' links already know who the candidate is; 'generic' links do not. */
  linkKind: 'personal' | 'generic';
  assessment: AssessmentSummary;
  questions: Question[];
  branding: Branding;
  perPage: number;
  /** Rating scale bounds and anchors for this instrument. */
  scale: ScaleInfo;
  /** Begin-test copy for this instrument. */
  intro: AssessmentIntro;
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
  /** Exact age in years, as digits. The column is TEXT and older rows hold a
      band label ("35–44"); nothing downstream parses it, so both render. */
  ageBand: string;
  /** Exact years of work experience, as digits. Same history as `ageBand`. */
  experienceBand: string;
  gender: string;
}

/**
 * Bounds for the two numeric details. Declared here rather than in the form so
 * the slider, the browser's own number input and the server all clamp to the
 * same range — a value the UI cannot produce is a value the API rejects.
 */
export const AGE_MIN = 16;
export const AGE_MAX = 80;
export const EXPERIENCE_MIN = 0;
export const EXPERIENCE_MAX = 50;

// ------------------------------------------------------------------- reports

/**
 * Report payloads are a tagged union: the HTML report page, the PDF and the
 * report email all switch on `kind`, so a new instrument cannot be rendered
 * with another instrument's layout by accident.
 */
export type ReportPayload = IsiReportPayload | EgoReportPayload;

interface ReportBase {
  reportToken: string;
  assessmentId: string;
  assessmentName: string;
  candidate: CandidateDetails;
  completedAt: string;
  branding: Branding;
  /** Plain-language headline paragraph, identical in every rendering. */
  summary: string;
}

export interface IsiReportPayload extends ReportBase {
  kind: 'isi';
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
  /** Verbatim client copy describing the two influencing methods. */
  methods: { push: string; pull: string };
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

export interface EgoReportPayload extends ReportBase {
  kind: 'ego';
  ego: EgoResult;
  /** One per state, in ego-gram order. */
  states: EgoStateNarrative[];
  highest: EgoStateNarrative;
  lowest: EgoStateNarrative;
  /** True while the state names and copy await client confirmation. */
  labelsAreDraft: boolean;
  draftNote: string;
}

export interface EgoStateNarrative {
  stateKey: string;
  name: string;
  abbr: string;
  color: string;
  blurb: string;
  score: number;
  percent: number;
  band: EgoBand;
  description: string;
  /** Shown when this state is the candidate's highest. */
  high: string;
  /** Shown when this state is the candidate's lowest. */
  low: string;
  /** Practice suggestion, shown for the lowest state. */
  dev: string;
}

// --------------------------------------------------------------------- admin

export type AdminRole = 'superadmin' | 'admin';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
