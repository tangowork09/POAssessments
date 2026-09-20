/**
 * Collaboration Diagnostic — the instrument definition.
 *
 * Transcribed from the client's `Collaboration_Diagnostic_Master.docx`
 * (facilitator version, with scoring key). The master copy is treated as
 * canonical for wording, section membership and item direction.
 *
 * Structurally this is a third shape for the platform. ISI and the Ego States
 * Scale are self-ratings that report on the person who answered. Sociometry is
 * a peer network that reports on a group by having members rate each other.
 * This one is a *self-report about the organisation*: every leader answers the
 * same 24 statements about the company they work in, and the finding only
 * exists once ~50 of those sets are averaged. Nobody here is being measured —
 * the collaboration system is.
 *
 * Two facts from the master copy drive everything downstream:
 *
 *   1. Ten statements are worded as good practice and fourteen as problems, so
 *      that respondents read rather than tick the same number down the page.
 *      Reverse items are flipped (6 − answer) before any average is taken; see
 *      `convertAnswer` in collab-scoring.ts.
 *   2. The participant version carries only the instructions, the scale and the
 *      24 statements. No section titles, no direct/reverse tags. A leader who
 *      can see that item 12 sits under "Trust & Safety" answers it differently,
 *      so `COLLAB_SECTIONS` is facilitator-side data and must never reach the
 *      candidate payload.
 *
 * Pure data and pure functions only, so the Worker, the browser and Vitest all
 * read the same definitions.
 */

export const COLLAB_ITEM_COUNT = 24;
export const COLLAB_MIN_ANSWER = 1;
export const COLLAB_MAX_ANSWER = 5;

/**
 * How a statement is worded, and therefore how it is scored.
 *
 * 'direct'  — worded as good practice; the number chosen is used as given.
 * 'reverse' — worded as a problem; the score is 6 − the number chosen.
 */
export type CollabDirection = 'direct' | 'reverse';

/** Verbatim anchors from the master copy's rating scale. */
export const COLLAB_SCALE_LABELS = [
  'Strongly Disagree',
  'Disagree',
  'Neither agree nor disagree',
  'Agree',
  'Strongly Agree',
] as const;

/** Short forms for the rating squares, where the full anchor will not fit. */
export const COLLAB_SCALE_SHORT_LABELS = [
  'Strongly disagree',
  'Disagree',
  'Neither',
  'Agree',
  'Strongly agree',
] as const;

export interface CollabSection {
  key: string;
  /** The master copy's own section heading, without its "Section n:" prefix. */
  name: string;
  /** The short name the scoring key uses in its item table. */
  short: string;
  /** The master copy's own description of what the section looks at. */
  focus: string;
  /** 1-based item numbers, in master-copy order. */
  items: readonly number[];
  /** Plot and print colour. */
  color: string;
}

export interface CollabItem {
  /**
   * 1-based, in master-copy order.
   *
   * This number is an address, not a label: it is what the `answers` table
   * stores and what a stored response is read back through. Items are never
   * renumbered and a retired item's number is never reused — the same rule
   * roster positions follow in sociometry — because renumbering silently
   * reassigns every answer already given.
   */
  no: number;
  /** The statement, verbatim from the master copy. */
  text: string;
  sectionKey: string;
  direction: CollabDirection;
}

/**
 * The six sections, in master-copy order.
 *
 * Facilitator-side only. Section membership is what makes a section mean
 * something, and showing it to a respondent primes the answer.
 */
export const COLLAB_SECTIONS: readonly CollabSection[] = [
  {
    key: 'structure',
    name: 'Structural Interdependence & Goal Gridlock',
    short: 'Structure & Goals',
    focus:
      'How the company is set up and how performance is measured — and whether this design itself makes it hard for leaders to support each other.',
    items: [1, 2, 3, 4, 5],
    color: '#0F5E57',
  },
  {
    key: 'barriers',
    name: "Morten Hansen's Collaboration Barriers",
    short: 'Collaboration Barriers',
    focus:
      'Four well-known barriers to teamwork, and the practical problems each one creates in day-to-day work.',
    items: [6, 7, 8, 9],
    color: '#2F7D62',
  },
  {
    key: 'trust',
    name: 'The Cost of Low Trust & Psychological Safety',
    short: 'Trust & Safety',
    focus: 'The guarded, self-protective behaviour that shows up when people do not trust each other.',
    items: [10, 11, 12, 13],
    color: '#9A7B10',
  },
  {
    key: 'power',
    name: 'Power Dynamics & Escalation Autonomy',
    short: 'Power & Escalation',
    focus:
      'How rank and hierarchy get in the way, and whether people at the same level can sort out issues on their own.',
    items: [14, 15, 16, 17],
    color: '#C4622D',
  },
  {
    key: 'pressure',
    name: 'The Operational & Compliance Pressure Cooker',
    short: 'Operational & Compliance',
    focus: 'The specific pressures of the pharma business and how they affect the way people work together.',
    items: [18, 19, 20, 21],
    color: '#A32E2E',
  },
  {
    key: 'levers',
    name: "Hansen's Institutional Levers",
    short: 'Institutional Levers',
    focus: 'Whether good collaboration is actively encouraged and supported by the wider organisation.',
    items: [22, 23, 24],
    color: '#4B4FA6',
  },
];

/**
 * The 24 statements, verbatim, with the direction the scoring key assigns.
 *
 * Ten direct and fourteen reverse. The counts are asserted below rather than
 * left as a comment, because a typo in one `direction` is invisible in the
 * output — it just quietly moves a section mean.
 */
export const COLLAB_ITEMS: readonly CollabItem[] = [
  // ------------------------------------------- 1. Structure & goal gridlock
  {
    no: 1,
    text: 'When my department depends on other teams, we have clear shared agreements and enough joint authority to deliver together.',
    sectionKey: 'structure',
    direction: 'direct',
  },
  {
    no: 2,
    text: 'When another department is late, it directly stops my team from delivering our own results.',
    sectionKey: 'structure',
    direction: 'reverse',
  },
  {
    no: 3,
    text: "The way our performance is measured pushes me to protect my own department's targets, even when this creates problems for another department.",
    sectionKey: 'structure',
    direction: 'reverse',
  },
  {
    no: 4,
    text: 'Work often comes to a standstill because two departments that must work together have completely different priorities.',
    sectionKey: 'structure',
    direction: 'reverse',
  },
  {
    no: 5,
    text: 'When several departments work on a project, it is clear who has the final say, so decisions do not get stuck.',
    sectionKey: 'structure',
    direction: 'direct',
  },

  // ------------------------------------------------ 2. Hansen's barriers
  {
    no: 6,
    text: 'Not-Invented-Here: Teams readily adopt proven methods and solutions from other departments, instead of insisting on building their own.',
    sectionKey: 'barriers',
    direction: 'direct',
  },
  {
    no: 7,
    text: 'Hoarding: Important information or expertise is held tightly within certain departments, so other teams are left working with incomplete information.',
    sectionKey: 'barriers',
    direction: 'reverse',
  },
  {
    no: 8,
    text: 'Search: We lose a lot of time simply trying to find the right person or expert in another department to solve an urgent problem.',
    sectionKey: 'barriers',
    direction: 'reverse',
  },
  {
    no: 9,
    text: 'Transfer: We often have to redo work because the handover from one department to the next is poorly managed.',
    sectionKey: 'barriers',
    direction: 'reverse',
  },

  // ------------------------------------------------- 3. Trust & safety
  {
    no: 10,
    text: 'To avoid difficult discussions, leaders often pretend to agree in the meeting, but voice their disagreement later, outside the room.',
    sectionKey: 'trust',
    direction: 'reverse',
  },
  {
    no: 11,
    text: 'When a mistake happens, our first reaction is to fix the real cause, rather than to find someone to blame.',
    sectionKey: 'trust',
    direction: 'direct',
  },
  {
    no: 12,
    text: 'In meetings with other departments, leaders hold back or carefully filter information to protect themselves or their teams.',
    sectionKey: 'trust',
    direction: 'reverse',
  },
  {
    no: 13,
    text: 'People feel safe asking other departments for help, without worrying that it will be seen as a sign of weakness.',
    sectionKey: 'trust',
    direction: 'direct',
  },

  // --------------------------------------------- 4. Power & escalation
  {
    no: 14,
    text: 'When two departments disagree, work comes to a stop until a senior executive steps in to settle it.',
    sectionKey: 'power',
    direction: 'reverse',
  },
  {
    no: 15,
    text: "In joint meetings, a leader's rank or influence in the company regularly wins over data, facts, or logic.",
    sectionKey: 'power',
    direction: 'reverse',
  },
  {
    no: 16,
    text: 'Even junior or less powerful leaders speak up when they see a decision that could put company goals at risk.',
    sectionKey: 'power',
    direction: 'direct',
  },
  {
    no: 17,
    text: 'We depend heavily on formal, written escalation rules because relationships between colleagues are not strong enough to handle disagreements.',
    sectionKey: 'power',
    direction: 'reverse',
  },

  // ------------------------------------ 5. Operational & compliance pressure
  {
    no: 18,
    text: 'The strong pressure for “zero errors” makes leaders hide early risks or bad news until they turn into a full crisis.',
    sectionKey: 'pressure',
    direction: 'reverse',
  },
  {
    no: 19,
    text: 'Tight production and delivery deadlines regularly force us to cut corners on teamwork and alignment across departments.',
    sectionKey: 'pressure',
    direction: 'reverse',
  },
  {
    no: 20,
    text: 'At times, departments use strict regulatory and compliance rules as an excuse to delay or block joint efforts.',
    sectionKey: 'pressure',
    direction: 'reverse',
  },
  {
    no: 21,
    text: 'Even under pressure to follow rules and procedures, leaders stay focused on solving problems between departments.',
    sectionKey: 'pressure',
    direction: 'direct',
  },

  // ------------------------------------------- 6. Institutional levers
  {
    no: 22,
    text: 'Senior executives consistently set an example of working across departments, even during times of high pressure.',
    sectionKey: 'levers',
    direction: 'direct',
  },
  {
    no: 23,
    text: 'Our leaders share one clear, common view of what success looks like for the whole company, above their own department targets.',
    sectionKey: 'levers',
    direction: 'direct',
  },
  {
    no: 24,
    text: "We clearly reward and promote leaders who help other departments succeed — not only those who meet their own department's targets.",
    sectionKey: 'levers',
    direction: 'direct',
  },
];

export const COLLAB_ITEM_BY_NO: ReadonlyMap<number, CollabItem> = new Map(
  COLLAB_ITEMS.map((item) => [item.no, item]),
);

export const COLLAB_SECTION_BY_KEY: ReadonlyMap<string, CollabSection> = new Map(
  COLLAB_SECTIONS.map((section) => [section.key, section]),
);

export function collabSectionFor(no: number): CollabSection | null {
  const item = COLLAB_ITEM_BY_NO.get(no);
  return item ? (COLLAB_SECTION_BY_KEY.get(item.sectionKey) ?? null) : null;
}

/** The items of one section, in master-copy order. */
export function collabItemsIn(sectionKey: string): readonly CollabItem[] {
  return COLLAB_ITEMS.filter((item) => item.sectionKey === sectionKey);
}

/**
 * How many leaders must sit in a segment before it is reported on.
 *
 * Below this, a department's mean is close enough to a quotation to identify
 * who said what, which breaks the confidentiality the diagnostic was answered
 * under. A suppressed segment is shown as suppressed rather than merged into
 * another, because silently folding Quality into Operations reports a number
 * for a group that does not exist.
 */
export const COLLAB_MIN_SEGMENT = 5;

/**
 * The instrument as declared, checked against the instrument as written.
 *
 * The master copy states 24 statements, ten direct and fourteen reverse, six
 * sections covering every item exactly once. A transcription slip in any of
 * those is silent in the output — it moves a mean without erroring — so it is
 * caught here at module load instead.
 */
function assertInstrument(): void {
  if (COLLAB_ITEMS.length !== COLLAB_ITEM_COUNT) {
    throw new Error(`Collaboration Diagnostic: expected ${COLLAB_ITEM_COUNT} items, found ${COLLAB_ITEMS.length}`);
  }
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) {
    if (!COLLAB_ITEM_BY_NO.has(no)) throw new Error(`Collaboration Diagnostic: item ${no} is missing`);
  }
  const direct = COLLAB_ITEMS.filter((i) => i.direction === 'direct').length;
  if (direct !== 10) throw new Error(`Collaboration Diagnostic: expected 10 direct items, found ${direct}`);
  const reverse = COLLAB_ITEMS.filter((i) => i.direction === 'reverse').length;
  if (reverse !== 14) throw new Error(`Collaboration Diagnostic: expected 14 reverse items, found ${reverse}`);

  const seen = new Set<number>();
  for (const section of COLLAB_SECTIONS) {
    for (const no of section.items) {
      const item = COLLAB_ITEM_BY_NO.get(no);
      if (!item) throw new Error(`Collaboration Diagnostic: section ${section.key} lists unknown item ${no}`);
      if (item.sectionKey !== section.key) {
        throw new Error(`Collaboration Diagnostic: item ${no} is in ${item.sectionKey}, listed under ${section.key}`);
      }
      if (seen.has(no)) throw new Error(`Collaboration Diagnostic: item ${no} is in more than one section`);
      seen.add(no);
    }
  }
  if (seen.size !== COLLAB_ITEM_COUNT) {
    throw new Error(`Collaboration Diagnostic: ${COLLAB_ITEM_COUNT - seen.size} item(s) belong to no section`);
  }
}

assertInstrument();
