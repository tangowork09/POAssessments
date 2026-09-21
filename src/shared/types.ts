/** Wire types shared by the Worker API and both frontend shells. */

/** One cut a diagnostic run collects, as the respondent is asked it. */
export interface CollabFacet {
  key: string;
  label: string;
  /** The values that may be chosen, in the order they are offered. */
  options: string[];
  /** A cut the respondent may decline. Declined is absent, never "Not given". */
  required: boolean;
}

/**
 * One wave of a Collaboration Diagnostic run, as the respondent sees it.
 *
 * There is no roster here and no list of colleagues: the statements are about
 * the organisation, not about people. What the respondent is told up front is
 * which wave they are answering, whether their answers are stored detached
 * from them, and which cuts the run collects — a promise of anonymity is
 * worthless if the person it is made to is never told.
 */
export interface CollabRunForCandidate {
  cohortId: string;
  organisation: string;
  waveNo: number;
  waveName: string;
  anonymous: boolean;
  /** An optional free-text question asked after the statements; '' for none. */
  openQuestion: string;
  /** What this run does with a small group, in words the respondent reads. */
  groupingNote: string;
  /** What this respondent has already typed there. */
  openAnswer: string;
  facets: CollabFacet[];
  /** What this respondent has already chosen, on a resumed session. */
  chosen: Record<string, string>;
}


import type { AssessmentIntro, AssessmentKind } from './assessments.js';
import type { EgoBand, EgoResult } from './ego-scoring.js';
import type { Band, ScoreResult } from './scoring.js';
import type { SocioGroupResult, SocioMemberResult } from './socio-scoring.js';

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
  /**
   * Present only for a cohort instrument (Collaboration Sociometry). Carries
   * the roster the respondent rates and who they have identified themselves
   * as. null for the self-rating instruments, which have no cohort.
   */
  cohort: CandidateCohort | null;
  /**
   * Present only for a Collaboration Diagnostic run: which wave is being
   * answered, whether answers are stored anonymously, and the cuts the run
   * collects. null for every other instrument, which collects none of this.
   */
  run: CollabRunForCandidate | null;
  /** Present once a response row exists (personal link, or generic link resumed). */
  response: CandidateResponseState | null;
  /**
   * True once a report exists for this candidate. The report token itself is
   * never returned here — it is stored only as a keyed hash — so the candidate
   * reads their report through their own link instead.
   */
  reportAvailable: boolean;
}

/**
 * One run of a cohort instrument, as the respondent sees it: who else is in the
 * group, and which of them they are.
 *
 * The roster is not a list of candidates. Roster membership is the cohort's own
 * fact, fixed by the facilitator before anyone is invited, and `no` is the
 * position the answer encoding addresses -- so it never renumbers.
 */
export interface CandidateCohort {
  cohortId: string;
  name: string;
  organisation: string;
  /** The wave being answered. Shown only when a cohort has run more than once. */
  roundNo: number;
  roundName: string;
  /** Fewest colleagues that must be rated before the matrix can be submitted. */
  minRatedTargets: number;
  /**
   * How many people are in the group — a number, not names. Before the
   * respondent identifies themselves the roster below is empty: names are the
   * facilitator's information and are only released to an identified rater,
   * and then only the ones that rater is assigned to see.
   */
  rosterSize: number;
  /**
   * Whether this cohort's facilitator has chosen to send participants their own
   * peer-feedback report. False by default, and false is not "not yet decided" —
   * it is the instruction to promise the respondent nothing. The completion
   * screen says thank you and stops; it does not mention a report, a PDF or an
   * email, because for most cohorts none of the three is coming.
   */
  shareReports: boolean;
  /**
   * Whether the respondent must type a one-time code mailed to their address
   * before being bound to a roster position. Off by default.
   */
  otpRequired: boolean;
  /**
   * Whether this cohort takes personal links only. True means the identity
   * step is not offered on the shared generic link at all — the shell draws
   * the dead-end notice instead of an email form. Off by default, and the
   * server refuses the claim regardless of what the client chooses to draw.
   */
  linkOnly: boolean;
  roster: CohortRosterMember[];
  /**
   * The respondent's own roster position, once identified. Their row is
   * excluded from the matrix -- the instrument forbids self-rating.
   */
  selfMemberId: string | null;
  /**
   * The member ids this respondent has been assigned to rate, or null when the
   * cohort runs unrestricted for them (no assignment map, or none for them).
   * Null means the whole roster, as before assignments existed.
   */
  allowedTargetIds: string[] | null;
}

/**
 * How long someone has been here, banded. Optional everywhere: it is a lens the
 * network is read through, never something the instrument needs to score.
 *
 * Banded rather than a hire date because a band is what a facilitator can fill
 * in from memory for a whole roster in one sitting, and it is the only
 * granularity the reading ever uses.
 */
export const TENURE_BANDS = ['<1y', '1-3y', '3-7y', '7y+'] as const;
export type TenureBand = (typeof TENURE_BANDS)[number];

export interface CohortRosterMember {
  memberId: string;
  /** Roster position, 1-based. What `cellNo` encodes against. */
  no: number;
  name: string;
  /** Function or department. May be ''. */
  func: string;
  /** True once this member has submitted, so the console and roster can say so. */
  responded?: boolean;
  /**
   * One of `TENURE_BANDS`, or null for not recorded. Typed as a string rather
   * than `TenureBand` because it arrives from a column with no CHECK on it: a
   * band retired from the list has to keep reading back rather than making the
   * row unparseable.
   *
   * Absent — not merely null — on the candidate-facing roster: this is
   * facilitator information, and the rating screen has no business carrying it.
   */
  tenureBand?: string | null;
  /**
   * The roster `no` of this member's manager within this cohort, or null for
   * not recorded / top of the tree. A position, not a member id, so the formal
   * line survives a rename the way every other address here does. May point at
   * a position that has since been deactivated; a dangling one reads as not
   * recorded rather than as an error.
   *
   * Absent on the candidate-facing roster, for the same reason as `tenureBand`.
   */
  reportsTo?: number | null;
}

export interface CandidateResponseState {
  responseId: string;
  status: 'invited' | 'in_progress' | 'completed';
  details: CandidateDetails | null;
  answers: Record<number, number>;
  answeredCount: number;
  /** 0-based page the candidate should resume on. */
  resumePage: number;
  /** Cohort instruments only: the roster position these ratings come from. */
  raterMemberId: string | null;
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

export type AdminRole = 'superadmin' | 'admin' | 'cohort_admin';

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

// ------------------------------------------------------------ cohort reports

/**
 * Sociometry reports are not facts about one response, so they are a separate
 * union from `ReportPayload` rather than a third member of it: there is no
 * candidate, no completion date and no single set of answers behind them. Both
 * scopes share this base, and every renderer switches on `kind`.
 */
export interface CohortReportBase {
  /** Empty when the reader reached the report by a door that cannot recover it. */
  reportToken: string;
  cohortId: string;
  cohortName: string;
  organisation: string;
  assessmentId: string;
  assessmentName: string;
  /** Which wave of rating this report describes. 1 for a cohort run once. */
  roundNo: number;
  /** The facilitator's name for that wave, or "Round 2". */
  roundName: string;
  generatedAt: string;
  branding: Branding;
  /** Plain-language headline paragraph, identical in every rendering. */
  summary: string;
  /** The confidentiality promise the workbook makes, restated in the report. */
  confidentiality: string;
}

/** Item and block labels, sent with the payload so a renderer needs no imports. */
export interface SocioItemInfo {
  no: number;
  short: string;
  text: string;
  blockKey: string;
  polarity: 'asset' | 'deficit';
}

export interface SocioBlockInfo {
  key: string;
  name: string;
  gloss: string;
  short: string;
  color: string;
  items: number[];
}

/** The facilitator's report: the whole network, no individual attribution. */
export interface SocioGroupReportPayload extends CohortReportBase {
  kind: 'socio_group';
  group: SocioGroupResult;
  blocks: SocioBlockInfo[];
  items: SocioItemInfo[];
}

/** One leader's peer-feedback report, suppressed below the cohort rater floor. */
export interface SocioMemberReportPayload extends CohortReportBase {
  kind: 'socio_member';
  member: SocioMemberResult;
  /** This member's block means beside the cohort's, for reading in context. */
  context: {
    blockKey: string;
    name: string;
    short: string;
    color: string;
    memberMean: number | null;
    cohortMean: number | null;
    delta: number | null;
  }[];
  /** Just enough of the group to make the numbers legible. */
  groupContext: {
    rosterSize: number;
    respondents: number;
    minRaters: number;
    tieThreshold: number;
    cohortMean: number | null;
  };
  items: SocioItemInfo[];
  /** True when coverage was under the floor and the profile is withheld. */
  suppressed: boolean;
}

export type CohortReportPayload = SocioGroupReportPayload | SocioMemberReportPayload;

// -------------------------------------------------------------- cohort admin

/** One wave of rating: its own link, its own responses, its own reports. */
export interface CohortRoundSummary {
  no: number;
  label: string;
  name: string;
  openedAt: string;
  closedAt: string | null;
  /** The generic link for this wave. Previous waves keep theirs. */
  linkToken: string | null;
  linkActive: boolean;
  respondents: number;
  reports: { group: boolean; members: number; suppressed: number };
}

export interface CohortSummary {
  id: string;
  assessmentId: string;
  name: string;
  organisation: string;
  status: 'draft' | 'open' | 'closed';
  minRaters: number;
  tieThreshold: number;
  minRatedTargets: number;
  /**
   * How long a personal link lasts, in days. Zero means it never expires.
   * Fourteen by default, which is what the instrument tells participants.
   */
  linkTtlDays: number;
  /**
   * Whether participants are told, on finishing, that their own report is
   * coming. Off by default; the completion screen promises nothing until the
   * facilitator turns this on.
   */
  shareReports: boolean;
  /**
   * Whether a one-time code must verify the roster email before a respondent
   * is bound to a position — two-factor identity, off by default.
   */
  otpRequired: boolean;
  /**
   * Whether the shared generic link has stopped accepting identity claims, so
   * the only way in is a per-member personal link. Off by default. While it is
   * on, `otpRequired` is ignored rather than cleared — see migration 0019 and
   * `cohortIdentityMode`, which turns the pair into the one setting a
   * facilitator actually chooses.
   */
  linkOnlyIdentity: boolean;
  /** Memorable alias for the open link, or null. Reached as a bare path. */
  shortSlug: string | null;
  /** Whether the alias resolves. Off keeps the slug reserved and 404s the path. */
  slugActive: boolean;
  /** The alias is namespaced by the instrument: `/<instrumentSlug>/<shortSlug>`. */
  instrumentSlug: string | null;
  rosterSize: number;
  respondents: number;
  createdAt: string;
  closedAt: string | null;
  /** The generic link token, retained for a cohort so the console can re-show it. */
  linkToken: string | null;
  linkActive: boolean;
  /** How many reports exist, by scope. */
  reports: { group: boolean; members: number; suppressed: number };
  /** The wave a link issued today belongs to. */
  roundNo: number;
  roundName: string;
  roundCount: number;
}

/** One directed rater→target aggregate for the console's network view. */
export interface CohortNetworkEdge {
  /** Roster positions, 1-based — the same addresses the answers use. */
  from: number;
  to: number;
  /** Asset-item ratings given, across the eleven asset statements. */
  n: number;
  /** Mean of the asset-item ratings, 2dp. */
  mean: number;
  /** Per-block means and tie flags, keyed by block key. Absent block: no answers. */
  blocks: Record<string, { mean: number; n: number; tie: boolean }>;
  /** Item 12, the deficit item, kept apart as everywhere else. */
  gap: { mean: number; n: number } | null;
}

/**
 * Everything the cohort dashboard draws: the roster as nodes, every directed
 * pair with at least one rating as an edge, the scored group result for the
 * metrics panel, and the assignment map for the who-rates-whom view. Admin
 * eyes only — this is the facilitator's instrument, never the candidate's.
 */
export interface CohortNetwork {
  cohortId: string;
  roundNo: number;
  roundName: string;
  roundClosed: boolean;
  tieThreshold: number;
  minRaters: number;
  respondents: number;
  rosterSize: number;
  nodes: CohortRosterMember[];
  edges: CohortNetworkEdge[];
  /** Null until at least one response is in — nothing to score. */
  group: SocioGroupResult | null;
  assignments: { raterMemberId: string; targetMemberIds: string[] }[];
}

export interface CohortDetail extends CohortSummary {
  roster: (CohortRosterMember & { email: string; active: boolean })[];
  /** Every wave this group has been rated in, oldest first. */
  rounds: CohortRoundSummary[];
  /**
   * How many active personal links exist for the current round. Only the
   * console needs it, and only to answer one question: with personal links as
   * the only door, is anybody standing outside it? A count below the active
   * roster size means someone on the list has no way in at all.
   */
  personalLinkCount: number;
}

// --------------------------------------------------------------- cohort trend

/** One round's figures, for reading a group's movement across waves. */
export interface CohortTrendRound {
  no: number;
  name: string;
  openedAt: string;
  closedAt: string | null;
  rosterSize: number;
  respondents: number;
  /** Respondents over roster, 0..1. Engagement, per wave. */
  responseRate: number;
  /** Ratings actually given over ratings possible, 0..1. Coverage, per wave. */
  coverage: number;
  density: number | null;
  reciprocity: number | null;
  concentration: number | null;
  cohortMean: number | null;
  isolates: number;
  blocks: { blockKey: string; name: string; short: string; mean: number | null }[];
  reportsReady: boolean;
}

export interface CohortTrend {
  cohortId: string;
  cohortName: string;
  organisation: string;
  minRaters: number;
  rounds: CohortTrendRound[];
  /** Leaders whose overall mean moved most between the first and last round. */
  movers: { memberId: string; name: string; func: string; first: number | null; last: number | null; delta: number | null }[];
}
