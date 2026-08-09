/**
 * The ten influencing styles of the Influencing Style Inventory.
 *
 * `items` are 1-based statement numbers. Together the ten styles must cover
 * statements 1..40 exactly once — `tests/scoring.test.ts` asserts this.
 *
 * Narrative copy is the approved report language from the design source.
 */

export type Side = 'push' | 'pull';

export interface InfluencingStyle {
  /** Stable identifier — also the scoring-config key stored in D1. */
  key: string;
  name: string;
  side: Side;
  /** 1-based statement numbers contributing to this style. */
  items: readonly number[];
  /** One-line summary shown under the style name. */
  blurb: string;
  /** Shown when the style ranks in the candidate's top three. */
  narrative: string;
  /** Overuse risk, shown alongside the narrative. */
  caution: string;
  /** Shown when the style is the candidate's development area. */
  low: string;
  /** Concrete practice suggestion for the development area. */
  dev: string;
}

export const STYLES: readonly InfluencingStyle[] = [
  {
    key: 'force',
    name: 'Force',
    side: 'push',
    items: [1, 13, 21, 31],
    blurb: 'Pressure, demands and position power.',
    narrative:
      'You are willing to apply direct pressure when the result matters more than the comfort of getting there. Deadlines move because you move them, and nobody is left wondering whether a decision has been taken.',
    caution:
      'Sustained pressure buys compliance, not commitment. Where Force becomes the default, expect quiet resistance, information withheld, and a team that waits to be told rather than moving on its own.',
    low: 'Direct pressure is not part of your repertoire, and in most situations that reads as maturity. The exception is the deadline that will not move on goodwill alone, where a single clear, unpopular demand is the only thing that works.',
    dev: 'Choose one situation this quarter where the outcome genuinely outranks the relationship, state the non-negotiable plainly once, and then stop pushing.',
  },
  {
    key: 'rules',
    name: 'Rules & Standards',
    side: 'push',
    items: [7, 12, 24, 32],
    blurb: 'Clear principles and stated expectations.',
    narrative:
      'You set the standard out loud before work starts and hold the line afterwards. People on your projects know what good looks like and where the boundaries sit, which removes a great deal of guesswork.',
    caution:
      'Standards harden into bureaucracy. Over-applied, this style reads as inflexibility and suppresses exactly the judgement calls that unfamiliar situations require.',
    low: 'You rarely state the standard out loud, which leaves people inferring it. Expectations you treat as obvious stay invisible to everyone else until they have already been missed.',
    dev: 'Write down the three standards you assume everyone already knows, and say them out loud at the start of your next project.',
  },
  {
    key: 'exchange',
    name: 'Exchange',
    side: 'push',
    items: [2, 14, 29, 34],
    blurb: 'Trades favours, concessions and reciprocity.',
    narrative:
      'You influence through reciprocity — offering support, trading concessions, finding the deal that lets both sides move. Negotiations rarely stall while you are in the room.',
    caution:
      'When everything is negotiable, the relationship starts to feel transactional. Colleagues begin to price their cooperation rather than simply give it.',
    low: 'You seldom trade or bargain, which often means carrying more of the load than you need to. Reciprocity is not manipulation — it is how most organisations actually allocate help.',
    dev: 'Before your next significant ask, work out what you can offer in return — and lead with that rather than the request.',
  },
  {
    key: 'persuasion',
    name: 'Persuasion',
    side: 'push',
    items: [5, 18, 22, 33],
    blurb: 'Logic, evidence and well-built arguments.',
    narrative:
      'You make the case. Proposals arrive with the reasoning attached, you take care to explain your thinking, and you will advance an unpopular position when the evidence supports it.',
    caution:
      "Argument can become a contest to win. Pressed too hard, persuasion crowds out the other person's reasoning — you gain their agreement and lose their commitment.",
    low: 'You make your case sparingly and let the merits speak for themselves. Good proposals routinely lose to weaker ones that arrived with an argument attached.',
    dev: "Take one proposal you currently 'just know' is right and build the two-slide evidence case for it.",
  },
  {
    key: 'assertion',
    name: 'Assertion',
    side: 'push',
    items: [6, 19, 28, 37],
    blurb: 'Direct statement of wishes; open challenge.',
    narrative:
      'You say what you want and question what you doubt, early and plainly. Your motives are visible, so very little time is lost decoding your position.',
    caution:
      'Directness without pacing lands as bluntness. Quieter colleagues stop putting half-formed ideas on the table at all, and you lose the thinking you most needed to hear.',
    low: 'Your wishes are not reliably on the table, so colleagues have to infer what you want. Inference is slow, and it is wrong more often than anyone admits.',
    dev: "In your next meeting, state your own view once before inviting others' — then hold your peace and notice what changes.",
  },
  {
    key: 'magnetism',
    name: 'Personal Magnetism',
    side: 'pull',
    items: [9, 17, 30, 38],
    blurb: 'Energy, humour and personal presence.',
    narrative:
      'You carry a room. Enthusiasm is contagious, humour lands where it should, and ideas travel further than their merits alone would take them because of how you present them.',
    caution:
      'Charm can outrun substance. If presence is doing the persuading, the decision may not survive the first serious scrutiny after you leave the room.',
    low: 'You let the content carry the message with little help from the delivery. Sound ideas can land flat simply because nothing in the telling made anyone lean in.',
    dev: 'Open your next presentation with a story or a single concrete image rather than the agenda.',
  },
  {
    key: 'visioning',
    name: 'Visioning',
    side: 'pull',
    items: [3, 11, 25, 35],
    blurb: 'A compelling, shared picture of the future.',
    narrative:
      'You lift attention from the task to the point of the task — articulating a future people can picture, and connecting it to goals and values they already hold.',
    caution:
      'Vision without a next step becomes noise. Repeated often enough without delivery behind it, the picture stops motivating and starts being discounted.',
    low: 'You stay close to the task and rarely lift the conversation to the point of it. People execute for you competently without quite knowing what they are building toward.',
    dev: 'Spend five minutes of your next team meeting on why the work matters twelve months out, not on what is due Friday.',
  },
  {
    key: 'bridging',
    name: 'Bridging / Consensus',
    side: 'pull',
    items: [4, 16, 26, 39],
    blurb: 'Listening, common ground, shared ownership.',
    narrative:
      'You build agreement rather than announce it — checking understanding, naming what people already share, and leaving others with a genuine stake in the outcome.',
    caution:
      'Consensus-seeking can defer the decision indefinitely. Some calls have to be made before everyone in the room agrees, and waiting reads as an absence of leadership.',
    low: 'You spend little time surfacing common ground or checking that you have understood correctly. Agreement that is assumed rather than built tends to come apart at the first obstacle.',
    dev: 'Summarise the other person’s position in their own words before you offer yours — in every meeting, for two weeks.',
  },
  {
    key: 'environmental',
    name: 'Environmental',
    side: 'pull',
    items: [10, 15, 27, 36],
    blurb: 'Shapes the climate; involves people; defuses tension.',
    narrative:
      'You work on the conditions around the conversation — bringing quiet people in, using humour to release pressure, keeping disagreement workable rather than personal.',
    caution:
      'Smoothing becomes avoidance. Conflict that is repeatedly defused is rarely resolved, and the underlying issue keeps returning in new clothes.',
    low: 'You take the room as you find it. Tension goes unnamed and quieter people stay quiet, so you hear from a narrower group than is actually in the meeting.',
    dev: 'Identify the person who speaks least in your regular meeting and ask them one direct, answerable question.',
  },
  {
    key: 'joint',
    name: 'Joint Problem Solving',
    side: 'pull',
    items: [8, 20, 23, 40],
    blurb: 'Open collaboration toward the best joint answer.',
    narrative:
      'You share information freely and work problems with people rather than for them, steadily building the trust that makes joint working possible. Solutions tend to hold after you have moved on.',
    caution:
      'Not every problem deserves a workshop. Applied indiscriminately, collaboration spends senior time on decisions one person could have made in five minutes.',
    low: 'You tend to solve the problem and then present the answer. It is efficient, and it leaves the people who have to live with the solution with no hand in it.',
    dev: 'Take one problem you would normally solve alone and bring the half-finished version to the people it affects.',
  },
];

/**
 * The client's own description of the two influencing methods, reproduced
 * verbatim. This is approved copy: do not paraphrase, reflow or "improve" it.
 */
export const INFLUENCING_METHODS = {
  push: 'The Push Method — this approach is logical and aggressive with quick results. When using this method, managers may make demands on employees without considering the immediate or long-term impacts on specific individuals. This aggressive approach may not be well-received. As a result, employees may not be receptive or cooperative. However, when used correctly, push strategies can bring about solid results.',
  pull: 'The Pull Method — this approach is all about including the individual in the decision-making process so that the person has a stake in the eventual outcomes. This method usually leads to a proactive response, in which the individual is more likely to fully accomplish the tasks set forth. Results from this approach are generally positive, but may take a bit longer to come to fruition in comparison to those achieved by means of the Push Method approach.',
} as const;

export const STYLE_BY_KEY: Readonly<Record<string, InfluencingStyle>> = Object.fromEntries(
  STYLES.map((s) => [s.key, s]),
);

export const PUSH_STYLES = STYLES.filter((s) => s.side === 'push');
export const PULL_STYLES = STYLES.filter((s) => s.side === 'pull');
