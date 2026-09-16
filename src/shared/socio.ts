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
 * individual report. Below it their profile is one or two colleagues' opinions
 * wearing the authority of an average, and — since the group is small and named
 * — a suppressed cell is the only thing standing between an "aggregate" and a
 * quotation. Overridable per cohort.
 */
export const SOCIO_DEFAULT_MIN_RATERS = 3;

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
