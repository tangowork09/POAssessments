/**
 * The six ego states of the Ego States Scale (66 statements, rated 0–6).
 *
 * ── SCORING ─────────────────────────────────────────────────────────────────
 * The source instrument scores by column: the statements are laid out six to a
 * row, and each column is one ego state. So statement `n` belongs to state
 * `((n - 1) mod 6) + 1`, giving eleven statements per state and a maximum of
 * 66 (11 items × 6). The percentage is `total / 66 × 100`, which is why the
 * denominator happens to equal the statement count — a coincidence of 11 × 6.
 *
 * This is asserted against the client's own worked example in
 * `tests/ego-scoring.test.ts`, which reproduces state totals
 * 54 / 59 / 55 / 52 / 49 / 51 from the answer grid in
 * `data/assessments_extracted.json`.
 *
 * ── LABELS: DRAFT, PENDING CLIENT CONFIRMATION ──────────────────────────────
 * The source workbook names the six columns only as "St no 1..6". The names,
 * abbreviations and descriptive copy below are a transactional-analysis-
 * grounded *draft* supplied by us, not client-approved text. They are declared
 * here as data precisely so that renaming a state is a one-line data change
 * rather than a code change. Every surface that shows them also carries a
 * "draft — pending confirmation" note.
 *
 * The one hint in the source is a stray spreadsheet comment, "groups seems to
 * be low on NP", which is consistent with a Nurturing Parent column but does
 * not by itself pin the ordering. Confirm with the client before release.
 */

export const EGO_LABELS_ARE_DRAFT = true;

/** Shown wherever the state names appear, until the client confirms them. */
export const EGO_DRAFT_NOTE =
  'Ego state names and descriptions are a draft pending confirmation by PO Motivation. The scores themselves are final.';

export interface EgoState {
  /** Stable identifier — also the scoring-config key stored in D1. */
  key: string;
  /** 1-based column in the source scoring grid. */
  column: number;
  /** DRAFT name. */
  name: string;
  /** DRAFT abbreviation used on the ego-gram. */
  abbr: string;
  /** Chart colour — a fixed six-way categorical ramp, brand blue anchored. */
  color: string;
  /** One-line summary shown under the state name. */
  blurb: string;
  /** DRAFT: 2–3 sentences describing the state itself. */
  description: string;
  /** DRAFT: shown when this state is the candidate's highest. */
  high: string;
  /** DRAFT: shown when this state is the candidate's lowest. */
  low: string;
  /** DRAFT: a concrete practice suggestion for the lowest state. */
  dev: string;
}

/**
 * Column order is the source grid's order and must not be reordered — the
 * statement-to-state map is positional.
 */
export const EGO_STATES: readonly EgoState[] = [
  {
    key: 'cp',
    column: 1,
    name: 'Critical Parent',
    abbr: 'CP',
    color: '#B4530E',
    blurb: 'Standards, principles and the willingness to hold a line.',
    description:
      'Critical Parent is the part of you that carries rules, principles and judgement. It knows what ought to happen, says so, and is prepared to be unpopular about it. Used well it is the source of structure, integrity and the courage to correct what is going wrong.',
    high: 'Standards are your strongest instrument. You notice the gap between what was agreed and what happened, you name it, and you hold people — including yourself — to the line. Teams around you are rarely unclear about what good looks like.',
    low: 'You rarely reach for judgement or correction, which makes you easy to work with and hard to argue with. The cost is that standards you assume are shared stay unspoken, and slippage is noticed late.',
    dev: 'Pick one standard you have been letting slide and state it plainly, once, at the start of your next piece of work — then hold it.',
  },
  {
    key: 'np',
    column: 2,
    name: 'Nurturing Parent',
    abbr: 'NP',
    color: '#2FA96B',
    blurb: 'Care, encouragement and permission to grow.',
    description:
      'Nurturing Parent is the caring, protective part of you: the one that encourages, reassures and gives people room. It offers support without taking over, and it is the state from which genuine developmental feedback becomes possible.',
    high: 'People come to you. You give attention generously, notice distress early, and your encouragement is believed because it is specific rather than automatic. This is the state most associated with being trusted with difficult things.',
    low: 'Support is not your default register. You may assume competent adults do not need reassurance, which is often true and occasionally very costly — people under pressure read your neutrality as disapproval.',
    dev: 'Once a week, tell one person specifically what they did well and why it mattered — no advice attached.',
  },
  {
    key: 'adult_perceiving',
    column: 3,
    name: 'Adult — Perceiving',
    abbr: 'A-P',
    color: '#0B6FB4',
    blurb: 'Taking in what is actually there: attention, listening, evidence.',
    description:
      'The perceiving half of the Adult is your data intake: watching, listening, remembering accurately, and separating what happened from what you assumed happened. It is quiet work, and it is the foundation everything the Adult does afterwards stands on.',
    high: 'You see and hear more than most people in the room, including what was not said. Your recall of detail is reliable, which makes you a steady witness to what actually occurred rather than to the story that formed afterwards.',
    low: 'You move to conclusions before the evidence is fully in. Details are collected sparingly and reconstructed later from impression, which works until the situation is one where the detail was the point.',
    dev: 'In your next difficult conversation, write down only what was said — no interpretation — and read it back before deciding anything.',
  },
  {
    key: 'adult_processing',
    column: 4,
    name: 'Adult — Processing',
    abbr: 'A-Pr',
    color: '#5B4FCF',
    blurb: 'Making sense of it: analysis, options, reasoned decisions.',
    description:
      'The processing half of the Adult organises what has been perceived: weighing options, testing logic, planning and deciding on evidence rather than on habit or feeling. It is the state that turns information into a defensible course of action.',
    high: 'You think in structures. Problems get taken apart, options get generated rather than assumed, and your decisions can be explained afterwards because they were reasoned in the first place.',
    low: 'You reach decisions by feel more than by analysis. That is fast and often right, but under scrutiny the reasoning is hard to reconstruct, and a wrong call is hard to diagnose.',
    dev: 'Before your next significant decision, write the three options you are not choosing and one line on why each was rejected.',
  },
  {
    key: 'fc',
    column: 5,
    name: 'Free Child',
    abbr: 'FC',
    color: '#E8A020',
    blurb: 'Spontaneity, feeling, humour and appetite.',
    description:
      'Free Child is the spontaneous, feeling, playful part of you — curious, expressive, and comfortable wanting things. It is where energy, humour and creativity come from, and it is what makes other people enjoy your company rather than merely respect it.',
    high: 'You bring energy into rooms. Feelings are expressed rather than managed, humour arrives naturally, and your enthusiasm is contagious enough to move work that logic alone had stalled.',
    low: 'You keep spontaneity on a short rein. Little is expressed that has not been considered first, which reads as composure and, over time, as distance — and it quietly costs you the creative, unplanned ideas.',
    dev: 'Say the enthusiastic, unpolished version of one idea out loud this week before you have finished tidying it up.',
  },
  {
    key: 'rc',
    column: 6,
    name: 'Rebellious Child',
    abbr: 'RC',
    color: '#C1272D',
    blurb: 'Independence, defiance and resistance to being directed.',
    description:
      'Rebellious Child is the part of you that pushes back — against instruction, convention and being managed. At its best it is the engine of independence and of refusing an unjust arrangement; at its worst it opposes for the sake of opposing, at a cost the rebellion itself does not pay.',
    high: 'You do not accept things simply because they are the arrangement. You question instruction, protect your independence, and will stand against something that most people would quietly absorb — which is valuable exactly as often as it is expensive.',
    low: 'You work comfortably inside the structures you are given. Compliance is easy for you, and the risk is that a poor arrangement survives longer than it should because nobody in the room was willing to be difficult about it.',
    dev: 'Identify one arrangement you have accepted without agreeing with it, and put your objection on the record once, in writing.',
  },
];

export const EGO_STATE_BY_KEY: Readonly<Record<string, EgoState>> = Object.fromEntries(
  EGO_STATES.map((s) => [s.key, s]),
);

/** 1-based statement numbers feeding a state — every sixth item from its column. */
export function egoItemsFor(column: number, questionCount = 66): number[] {
  const items: number[] = [];
  for (let n = column; n <= questionCount; n += EGO_STATES.length) items.push(n);
  return items;
}
