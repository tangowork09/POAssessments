/**
 * Collaboration Sociometry — the instrument definition.
 *
 * Transcribed from the client workbook `Sociometry_Instrument_12item.xlsx`.
 * The `Instructions` sheet is treated as canonical for the item wording: the
 * workbook also carries twelve cell comments on the matrix header row, but
 * those are a *stale* earlier split of the same material (the comment on the
 * "Unlocks resources" column still describes what is now part of item 4), and
 * shipping both would put two different definitions of the same item in front
 * of the same reader. The comments are deliberately not carried over.
 *
 * Structurally this instrument is unlike the other two on the platform. ISI and
 * the Ego States Scale are self-ratings: one person, one report. Sociometry is
 * a peer network — every member of an intact group rates every *other* member
 * on these twelve statements, and the result only means anything at the level
 * of the whole group. That is what a cohort is: one run of this instrument on
 * one intact group at one point in time.
 *
 * Pure data and pure functions only, so the Worker, the browser and Vitest all
 * read the same definitions.
 */

/** Which direction a high rating points in. */
export type ItemPolarity = 'asset' | 'deficit';

export interface SocioBlock {
  key: string;
  /** The workbook's own group heading. */
  name: string;
  /** The workbook's own parenthetical gloss, or '' where it gives none. */
  gloss: string;
  /** Short label for axes and table headers. */
  short: string;
  /** 1-based item numbers, in workbook column order. */
  items: readonly number[];
  /** Plot/print colour. */
  color: string;
}

export interface SocioItem {
  /** 1-based, in workbook column order C..N. */
  no: number;
  /** The workbook's short column label. */
  short: string;
  /** The full statement, verbatim from the Instructions sheet. */
  text: string;
  blockKey: string;
  polarity: ItemPolarity;
}

export const SOCIO_ITEM_COUNT = 12;
export const SOCIO_MIN_ANSWER = 1;
export const SOCIO_MAX_ANSWER = 5;

/**
 * A blank is a first-class answer here — "we don't really work together" —
 * and is stored as the absence of a row rather than as a value, so nothing
 * downstream has to reserve a sentinel inside the 1..5 range.
 */
export const SOCIO_BLANK_LABEL = "No basis to judge — we don't really work together";

/** Verbatim anchors from the Instructions sheet. */
export const SOCIO_SCALE_LABELS = [
  'Not at all true',
  'Slightly true',
  'Moderately true',
  'Mostly true',
  'Completely true',
] as const;

export const SOCIO_SCALE_SHORT_LABELS = ['Not at all', 'Slightly', 'Moderately', 'Mostly', 'Completely'] as const;

/**
 * Item 12 is the one deficit-polarity statement in the set. The workbook files
 * it under OVERALL alongside "Easy to work with", but a high score on it is a
 * complaint rather than a strength — averaging the two together would cancel a
 * real signal against its opposite. It is scored on its own, as a gap.
 */
export const SOCIO_SUPPORT_GAP_ITEM = 12;

/**
 * The two facets the Trust block is read along when a finer lens is wanted.
 *
 * Item 8 is *reliability* trust — delivery on time, as promised, at a quality
 * you can build on. Item 9 is *openness* trust, the psychological-safety
 * facet — that you could admit a mistake or ask for help without fear it would
 * be used against you. The two come apart in real groups: a team can be
 * entirely dependable and still unsafe to be wrong in front of, and averaging
 * them into one Trust figure hides exactly that.
 *
 * Item 10 is deliberately absent from this split. It is double-barrelled —
 * "does what they say they will" (reliability) *and* "shares information
 * openly, including difficult news, early" (openness) — so it spans both
 * facets and cannot be assigned to either without inventing a reading the
 * respondent never gave. It is excluded pending a client decision on whether
 * to split the item in a future revision of the instrument. It still counts in
 * full toward the overall Trust block, which is unchanged.
 */
export const SOCIO_RELIABILITY_ITEM = 8;
export const SOCIO_OPENNESS_ITEM = 9;

export const SOCIO_BLOCKS: readonly SocioBlock[] = [
  {
    key: 'power_to',
    name: 'Power — to & with',
    gloss: 'who enables and connects',
    short: 'Power to/with',
    items: [1, 2, 3, 4],
    color: '#0B6FB4',
  },
  {
    key: 'power_over',
    name: 'Power — over',
    gloss: 'who controls and decides',
    short: 'Power over',
    items: [5, 6, 7],
    color: '#B4530E',
  },
  {
    key: 'trust',
    name: 'Trust',
    gloss: 'how you experience working with them',
    short: 'Trust',
    items: [8, 9, 10],
    color: '#0E7C5A',
  },
  {
    key: 'ease',
    name: 'Overall ease',
    gloss: 'straightforward and productive to work with',
    short: 'Ease',
    items: [11],
    color: '#6D5AC4',
  },
];

export const SOCIO_ITEMS: readonly SocioItem[] = [
  {
    no: 1,
    short: 'Trusted judgment',
    text: "When I face a difficult problem, I seek out this person's judgment, and I find myself adopting their view out of the respect I have for them.",
    blockKey: 'power_to',
    polarity: 'asset',
  },
  {
    no: 2,
    short: 'Unlocks resources',
    text: 'This person can unlock resources, budget, or priority that I depend on.',
    blockKey: 'power_to',
    polarity: 'asset',
  },
  {
    no: 3,
    short: 'Rallies others',
    text: 'This person brings people together and builds shared commitment across teams.',
    blockKey: 'power_to',
    polarity: 'asset',
  },
  {
    no: 4,
    short: 'Route through',
    text: "To get things moving across departments, this is the person I route them through — and the one I rely on to know what's really happening across the organisation.",
    blockKey: 'power_to',
    polarity: 'asset',
  },
  {
    no: 5,
    short: 'Others fall in line',
    text: 'When this person takes a firm position, others here tend to adjust and fall in line with it.',
    blockKey: 'power_over',
    polarity: 'asset',
  },
  {
    no: 6,
    short: 'Approves or blocks',
    text: 'This person can approve or hold up an initiative largely on their own, and their backing or disapproval has real consequences for how things go for people.',
    blockKey: 'power_over',
    polarity: 'asset',
  },
  {
    no: 7,
    short: 'Shapes it informally',
    text: 'This person shapes which issues get attention, often informally and before they reach the room.',
    blockKey: 'power_over',
    polarity: 'asset',
  },
  {
    no: 8,
    short: 'Reliable delivery',
    text: 'I get what I need from this person on time, as promised, and I trust the quality of their work enough to build on it without re-checking.',
    blockKey: 'trust',
    polarity: 'asset',
  },
  {
    no: 9,
    short: 'Looks out for me',
    text: 'This person looks out for my interests and the shared goal, and I could admit a mistake or ask them for help without fear it would be used against me.',
    blockKey: 'trust',
    polarity: 'asset',
  },
  {
    no: 10,
    short: 'Keeps their word',
    text: 'This person does what they say they will, even when it is inconvenient, and shares information with me openly, including difficult news, early.',
    blockKey: 'trust',
    polarity: 'asset',
  },
  {
    no: 11,
    short: 'Easy to work with',
    text: 'Working with this person is straightforward and productive.',
    blockKey: 'ease',
    polarity: 'asset',
  },
  {
    no: 12,
    short: 'Wish for more support',
    text: 'I would like more support or cooperation from this person in my work than I currently get.',
    blockKey: 'support_gap',
    polarity: 'deficit',
  },
];

export const SOCIO_ITEM_BY_NO: Readonly<Record<number, SocioItem>> = Object.fromEntries(
  SOCIO_ITEMS.map((i) => [i.no, i]),
);

export const SOCIO_BLOCK_BY_KEY: Readonly<Record<string, SocioBlock>> = Object.fromEntries(
  SOCIO_BLOCKS.map((b) => [b.key, b]),
);

/**
 * A rating of 4 is "Mostly true" — the first point on the scale where the
 * respondent is asserting the statement rather than conceding part of it. That
 * is where a directed tie is drawn in the network, and it is the one number in
 * this file most likely to be revisited with the client, so it is named once.
 */
export const SOCIO_TIE_THRESHOLD = 4;

/**
 * How many raters must have rated a person before that person gets an
 * individual report.
 *
 * Two, because that is where the guide's own rule bites and not a step beyond
 * it. Section 6 asks for one thing: "report only patterns, never who said what
 * about whom". With a single rater there is no pattern to report — the printed
 * mean *is* that colleague's answer, reproduced exactly, and in a small named
 * group the person can usually work out whose it was. At two the figure is an
 * aggregate and neither answer can be recovered from it.
 *
 * It used to be three, which withheld profiles the guide would have allowed:
 * the guide expects individuals to be able to learn their own reading in a
 * coaching setting, and a floor set for comfort rather than for confidentiality
 * takes that away from thinly-connected people — exactly the ones a
 * facilitator most needs to talk to. Raise it per cohort where the group is
 * small enough that two raters would still be identifiable; the setting
 * accepts anything from 1 to 50.
 */
export const SOCIO_DEFAULT_MIN_RATERS = 2;

// ------------------------------------------------------------- answer coding

/**
 * The rating matrix is stored in the platform's existing flat `answers` table,
 * which keys a value by a single integer per response. A cell is therefore
 * addressed by its position in the matrix:
 *
 *     no = (memberNo - 1) * 12 + itemNo
 *
 * `memberNo` is the roster position (1-based, stable for the life of a cohort),
 * `itemNo` is 1..12. Nothing else about the platform's answer storage, autosave,
 * resume or rate limiting has to change to carry a network instrument.
 */
export function cellNo(memberNo: number, itemNo: number): number {
  return (memberNo - 1) * SOCIO_ITEM_COUNT + itemNo;
}

export function decodeCell(no: number): { memberNo: number; itemNo: number } {
  const zero = no - 1;
  return {
    memberNo: Math.floor(zero / SOCIO_ITEM_COUNT) + 1,
    itemNo: (zero % SOCIO_ITEM_COUNT) + 1,
  };
}

/** Every cell number that belongs to one target, in item order. */
export function cellsForMember(memberNo: number): number[] {
  return SOCIO_ITEMS.map((i) => cellNo(memberNo, i.no));
}

// --------------------------------------------------- the guide's 19 criteria
//
// The shipped instrument is the client's 12-item workbook, which merges pairs
// of the facilitator guide's nineteen criteria into single statements. The
// merge is the client's, not ours, and every one of the nineteen survives
// inside it — but the guide also tags each criterion with two things the
// merged wording throws away: which *face* of power it samples (visible,
// hidden, invisible) and which base or dimension it rests on.
//
// Section 5.4 of the guide needs the first of those. "If a few leaders hold
// most incoming power ties — especially covert power-over ('sets the agenda',
// 'works behind the scenes') — you have a hidden imbalance no structure chart
// reveals." Without visibility recorded somewhere, covert power cannot be read
// apart from the veto rights an org chart already shows.
//
// So the nineteen are carried here in full, each pointing at the shipped item
// that absorbed it. Nothing scores off this table directly; it is the source
// the visibility lenses and the item documentation derive from, and the place
// the mapping can be checked against the guide by a human or a test.

/** The three expressions of power the instrument samples. Power-within is out of scope. */
export type PowerExpression = 'power_to' | 'power_with' | 'power_over';

/** Lukes' faces, as the guide's Visibility column names them. */
export type PowerVisibility = 'visible' | 'hidden' | 'invisible';

/** What a criterion belongs to, above the level of an individual block. */
export type CriterionFamily = PowerExpression | 'trust' | 'overall';

export interface SocioCriterion {
  /** 1-based, in the guide's own table order. */
  no: number;
  /** The guide's Label column. */
  label: string;
  /** The guide's Statement column, verbatim. */
  statement: string;
  family: CriterionFamily;
  /**
   * The guide's Visibility column. Null for trust and overall criteria, where
   * the guide prints an em dash: visibility is a property of power.
   */
  visibility: readonly PowerVisibility[] | null;
  /** The guide's "Base / dimension" column, verbatim. */
  base: string;
  /** The shipped item that carries this criterion. */
  itemNo: number;
}

export const SOCIO_CRITERIA: readonly SocioCriterion[] = [
  {
    no: 1,
    label: 'Expert judgment',
    statement: "I seek out this person's judgment on tough technical/professional problems.",
    family: 'power_to',
    visibility: ['visible'],
    base: 'Expert · personal',
    itemNo: 1,
  },
  {
    no: 2,
    label: 'Reads the org',
    statement: "I rely on this person to know what's really going on across the organisation.",
    family: 'power_to',
    visibility: ['hidden'],
    base: 'Informational · personal',
    itemNo: 4,
  },
  {
    no: 3,
    label: 'Unlocks resources',
    statement: 'This person can unlock resources, budget or priority I depend on.',
    family: 'power_to',
    visibility: ['visible'],
    base: 'Reward · positional',
    itemNo: 2,
  },
  {
    no: 4,
    label: 'Respected view',
    statement: "I adopt this person's view out of the respect I have for them.",
    family: 'power_with',
    visibility: ['visible'],
    base: 'Referent · personal',
    itemNo: 1,
  },
  {
    no: 5,
    label: 'Rallies others',
    statement: 'This person brings people together and builds shared commitment across teams.',
    family: 'power_with',
    visibility: ['visible'],
    base: 'Mobilising · personal',
    itemNo: 3,
  },
  {
    no: 6,
    label: 'Route through',
    statement: 'To move things across departments, I route them through this person.',
    family: 'power_with',
    visibility: ['hidden'],
    base: 'Brokerage · network',
    itemNo: 4,
  },
  {
    no: 7,
    label: 'Others fall in line',
    statement: 'When this person takes a firm position, others tend to fall in line with it.',
    family: 'power_over',
    visibility: ['visible'],
    base: 'Deference / dominance',
    itemNo: 5,
  },
  {
    no: 8,
    label: 'Approves or blocks',
    statement: 'This person can approve or hold up an initiative largely on their own.',
    family: 'power_over',
    visibility: ['visible'],
    base: 'Gatekeeping · positional',
    itemNo: 6,
  },
  {
    no: 9,
    label: 'Carries consequences',
    statement: 'Their backing or disapproval has real consequences for how things go for people.',
    family: 'power_over',
    visibility: ['visible'],
    base: 'Reward / coercive · positional',
    itemNo: 6,
  },
  {
    no: 10,
    label: 'Sets the agenda',
    statement: 'This person shapes which issues get attention and which quietly slip off.',
    family: 'power_over',
    visibility: ['hidden'],
    base: 'Agenda-setting (2nd face)',
    itemNo: 7,
  },
  {
    no: 11,
    label: 'Works behind scenes',
    statement: 'Many decisions are shaped by this person informally, before they reach the room.',
    family: 'power_over',
    visibility: ['hidden', 'invisible'],
    base: 'Pre-wiring / coalitions · personal',
    itemNo: 7,
  },
  {
    no: 12,
    label: 'On time',
    statement: 'I get what I need from this person on time, as promised.',
    family: 'trust',
    visibility: null,
    base: 'Reliability',
    itemNo: 8,
  },
  {
    no: 13,
    label: 'Quality to build on',
    statement: 'I trust their work enough to build on it without re-checking.',
    family: 'trust',
    visibility: null,
    base: 'Ability (cognitive)',
    itemNo: 8,
  },
  {
    no: 14,
    label: 'Keeps their word',
    statement: 'This person does what they say, even when inconvenient.',
    family: 'trust',
    visibility: null,
    base: 'Integrity',
    itemNo: 10,
  },
  {
    no: 15,
    label: 'Looks out for me',
    statement: 'They look out for my interests and the shared goal, not just their own.',
    family: 'trust',
    visibility: null,
    base: 'Benevolence',
    itemNo: 9,
  },
  {
    no: 16,
    label: 'Safe to be open',
    statement: 'I could admit a mistake or ask for help without fear.',
    family: 'trust',
    visibility: null,
    base: 'Affective / vulnerability',
    itemNo: 9,
  },
  {
    no: 17,
    label: 'Shares openly',
    statement: 'They share information openly, including difficult news, early.',
    family: 'trust',
    visibility: null,
    base: 'Openness / integrity',
    itemNo: 10,
  },
  {
    no: 18,
    label: 'Easy to work with',
    statement: 'Working with this person is straightforward and productive.',
    family: 'overall',
    visibility: null,
    base: 'Overall trust',
    itemNo: 11,
  },
  {
    no: 19,
    label: 'Wish for more support',
    statement: "I'd like more support or cooperation from them than I get.",
    family: 'overall',
    visibility: null,
    base: 'Support gap',
    itemNo: 12,
  },
];

/** The guide criteria a shipped item absorbed, in guide order. */
export function criteriaForItem(itemNo: number): SocioCriterion[] {
  return SOCIO_CRITERIA.filter((c) => c.itemNo === itemNo);
}

/**
 * Every face of power a shipped item samples, deduplicated.
 *
 * Empty for trust and overall items, which the guide leaves unlabelled. A
 * merged item can span two faces — item 7 carries one hidden criterion and one
 * the guide files as "Hidden / invisible" — so this is a set, not a value.
 */
export function itemVisibility(itemNo: number): PowerVisibility[] {
  const seen: PowerVisibility[] = [];
  for (const c of criteriaForItem(itemNo)) {
    for (const v of c.visibility ?? []) if (!seen.includes(v)) seen.push(v);
  }
  return seen;
}

/**
 * True when every criterion behind an item is one of the covert faces.
 *
 * Covert, not merely "contains something hidden": an item that merges a
 * visible criterion with a hidden one describes power that is at least partly
 * on show, and counting it as covert would let a plain veto right in through
 * the back door.
 */
export function isCovertItem(itemNo: number): boolean {
  const vis = criteriaForItem(itemNo).map((c) => c.visibility);
  if (vis.length === 0 || vis.some((v) => v === null || v.length === 0)) return false;
  return vis.every((v) => v!.every((face) => face === 'hidden' || face === 'invisible'));
}

/**
 * The covert half of the power-over band — the guide's §5.4 reading.
 *
 * Derived rather than written down, so that if the client ever re-splits the
 * instrument this follows the criteria table instead of silently pointing at
 * the wrong column. On the shipped 12-item form it resolves to item 7,
 * "shapes which issues get attention, often informally and before they reach
 * the room", which is exactly the guide's "sets the agenda" and "works behind
 * the scenes" and nothing else.
 */
export const SOCIO_COVERT_POWER_ITEMS: readonly number[] = SOCIO_ITEMS.filter(
  (i) => i.blockKey === 'power_over' && isCovertItem(i.no),
).map((i) => i.no);
