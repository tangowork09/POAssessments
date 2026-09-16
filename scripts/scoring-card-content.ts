/**
 * The single source of the Collaboration Sociometry scoring card.
 *
 * Both emitters — the Excel workbook and the print PDF — read this module, so
 * the two artefacts cannot say different things. Every threshold, item and
 * worked figure below is read from, or produced by, the live scoring engine
 * rather than retyped.
 */
import {
  SOCIO_BLOCKS,
  SOCIO_DEFAULT_MIN_RATERS,
  SOCIO_ITEMS,
  SOCIO_ITEM_COUNT,
  SOCIO_MAX_ANSWER,
  SOCIO_MIN_ANSWER,
  SOCIO_OPENNESS_ITEM,
  SOCIO_RELIABILITY_ITEM,
  SOCIO_SCALE_LABELS,
  SOCIO_SUPPORT_GAP_ITEM,
  SOCIO_TIE_THRESHOLD,
  cellNo,
} from '../src/shared/socio.js';
import {
  scoreSocioCohort,
  type SocioMember,
  type SocioResponseInput,
} from '../src/shared/socio-scoring.js';

export {
  SOCIO_BLOCKS,
  SOCIO_DEFAULT_MIN_RATERS,
  SOCIO_ITEMS,
  SOCIO_ITEM_COUNT,
  SOCIO_MAX_ANSWER,
  SOCIO_MIN_ANSWER,
  SOCIO_OPENNESS_ITEM,
  SOCIO_RELIABILITY_ITEM,
  SOCIO_SCALE_LABELS,
  SOCIO_SUPPORT_GAP_ITEM,
  SOCIO_TIE_THRESHOLD,
};

// ------------------------------------------------------------ the example
/*
 * A six-person cohort built to exercise every mechanic the card describes: a
 * positive authority-trust gap, a negative one, a balanced member, an isolate,
 * an under-covered member and a member nobody rated. Every rating is flat
 * within a block, so every figure can be checked by hand.
 */
export const MEMBERS: SocioMember[] = [
  { no: 1, id: 'm1', name: 'Alice', func: 'Operations' },
  { no: 2, id: 'm2', name: 'Bob', func: 'Quality' },
  { no: 3, id: 'm3', name: 'Cara', func: 'R&D' },
  { no: 4, id: 'm4', name: 'Dan', func: 'IT' },
  { no: 5, id: 'm5', name: 'Eve', func: 'Finance' },
  { no: 6, id: 'm6', name: 'Frank', func: 'Operations' },
];

export interface BlockValues {
  powerTo: number;
  powerOver: number;
  trust: number;
  ease: number;
  gap: number;
}

/** One complete row: a flat value per block, plus the support-gap item. */
function row12(targetNo: number, v: BlockValues): Record<number, number> {
  const byBlock: Record<string, number> = {
    power_to: v.powerTo,
    power_over: v.powerOver,
    trust: v.trust,
    ease: v.ease,
  };
  const out: Record<number, number> = {};
  for (const item of SOCIO_ITEMS) {
    out[cellNo(targetNo, item.no)] = item.no === SOCIO_SUPPORT_GAP_ITEM ? v.gap : byBlock[item.blockKey]!;
  }
  return out;
}

/** Alice: deferred to, not relied on. */
export const ON_ALICE: BlockValues = { powerTo: 4, powerOver: 5, trust: 2, ease: 3, gap: 4 };
/** Bob: relied on, without the leverage to act. */
export const ON_BOB: BlockValues = { powerTo: 4, powerOver: 2, trust: 5, ease: 5, gap: 1 };
/** Cara: balanced on power and trust, but harder work day to day. */
export const ON_CARA: BlockValues = { powerTo: 4, powerOver: 4, trust: 4, ease: 3, gap: 2 };
/** Dan: rated by three colleagues, but tied to by none of them. */
export const ON_DAN: BlockValues = { powerTo: 2, powerOver: 2, trust: 2, ease: 2, gap: 5 };
/** Eve: one rater only, which is below the floor. */
export const ON_EVE: BlockValues = { powerTo: 5, powerOver: 5, trust: 5, ease: 5, gap: 1 };

const RESPONSES: SocioResponseInput[] = [
  { raterNo: 1, answers: { ...row12(2, ON_BOB), ...row12(3, ON_CARA), ...row12(4, ON_DAN), ...row12(5, ON_EVE) } },
  { raterNo: 2, answers: { ...row12(1, ON_ALICE), ...row12(3, ON_CARA), ...row12(4, ON_DAN) } },
  { raterNo: 3, answers: { ...row12(1, ON_ALICE), ...row12(2, ON_BOB), ...row12(4, ON_DAN) } },
  { raterNo: 4, answers: { ...row12(1, ON_ALICE), ...row12(2, ON_BOB), ...row12(3, ON_CARA) } },
];

/** The worked example, scored by the live engine at build time. */
export const G = scoreSocioCohort(MEMBERS, RESPONSES, { minRaters: SOCIO_DEFAULT_MIN_RATERS });

export const RATED_BY: Record<string, string> = {
  Alice: 'Bob, Cara, Dan',
  Bob: 'Alice, Cara, Dan',
  Cara: 'Alice, Bob, Dan',
  Dan: 'Alice, Bob, Cara',
  Eve: 'Alice only',
  Frank: 'nobody',
};

export const RATING_ROWS: [string, BlockValues | null][] = [
  ['Alice', ON_ALICE],
  ['Bob', ON_BOB],
  ['Cara', ON_CARA],
  ['Dan', ON_DAN],
  ['Eve', ON_EVE],
  ['Frank', null],
];

// ---------------------------------------------------------------- the copy
export const SUBTITLE =
  'A peer-network instrument. Every member of an intact group rates every other member on twelve statements. The unit of analysis is the cohort, not the person.';

export const STEPS: [string, string, string][] = [
  ['01', 'Rate', `Each respondent rates each assigned colleague on ${SOCIO_ITEM_COUNT} statements, ${SOCIO_MIN_ANSWER}–${SOCIO_MAX_ANSWER}. A colleague may be left entirely blank — that is a valid answer, meaning "no basis to judge".`],
  ['02', 'Row mean', "For one rater and one target, average that rater's answers within a block."],
  ['03', 'Block mean', 'Average those row means across every rater who rated the target. Two steps, not one: a rater who answered a block counts once, whatever the block contains.'],
  ['04', 'Band and tie', `Band the block mean. Separately, count each row mean at or above the tie threshold (${SOCIO_TIE_THRESHOLD}) — that count is the person's in-degree in that block's network.`],
  ['05', 'Aggregate', 'Roll the per-member figures into group density, reciprocity, concentration and the group signals.'],
];

export const TWO_STEP_NOTE =
  "Averaging every raw answer in one pass would weight a rater by how many statements they happened to answer. Averaging each rater's row first, then averaging the rows, gives every rater one vote per block. Partial rows cannot arise in practice — the platform refuses a submission where a colleague is part-rated, at the browser and again at the API — but the two-step mean is what makes the figure well-defined regardless.";

export const CONFIG: [string, string][] = [
  ['Rating scale', `${SOCIO_MIN_ANSWER}–${SOCIO_MAX_ANSWER}, fixed. Anchors: ${SOCIO_SCALE_LABELS.join(' · ')}.`],
  ['Tie threshold', `Default ${SOCIO_TIE_THRESHOLD} ("Mostly true") — the first point where a respondent asserts the statement rather than conceding part of it. Configurable per cohort, 1–5.`],
  ['Rater floor (minRaters)', `Default ${SOCIO_DEFAULT_MIN_RATERS}. Below it a member gets no individual profile. Configurable per cohort, 1–50.`],
  ['Minimum rated targets', 'Default 1. How many colleagues a respondent must rate before submitting. Configurable per cohort, 0–200.'],
  ['Reports to participants', 'Off by default. Turned on per cohort.'],
  ['Email OTP', 'Off by default. When on, a one-time code must verify the roster email before the exercise opens.'],
];

export const ITEM_NOTES: [string, string][] = [
  [
    `Item ${SOCIO_SUPPORT_GAP_ITEM} — deficit polarity`,
    'The only statement where a high score is a complaint rather than a strength. It is kept out of all four blocks and out of the cohort mean, and banded on its own scale. It is not reverse-scored: no answer anywhere in this instrument is recoded.',
  ],
  [
    'Item 10 — double-barrelled',
    `It asserts two things at once — keeping one's word, and sharing difficult news early. It counts in full toward the Trust block, but is excluded from the reliability/openness facet split (items ${SOCIO_RELIABILITY_ITEM} and ${SOCIO_OPENNESS_ITEM}), because assigning it to either facet would invent a reading the respondent never gave. Pending a client decision on splitting the item.`,
  ],
];

export const ASSET_BANDS: [string, string, string][] = [
  ['Low', 'mean < 2.50', 'The group does not, on the whole, see this in the person.'],
  ['Mixed', '2.50 ≤ mean < 3.50', 'Divided, or moderate across the board.'],
  ['Strong', '3.50 ≤ mean < 4.25', 'Consistently seen.'],
  ['Very strong', 'mean ≥ 4.25', 'Close to unanimous, near the top of the scale.'],
];

export const GAP_BANDS: [string, string, string][] = [
  ['Little', 'mean < 2.50', 'The group is broadly getting what it needs from this person.'],
  ['Some', '2.50 ≤ mean < 3.50', 'A real, moderate ask for more.'],
  ['Marked', 'mean ≥ 3.50', 'A clear and widely held request for more support.'],
];

export const BAND_NOTE =
  'Bands are read on the block mean only. A high band on a thinly rated person is still thinly rated — every figure the platform reports carries its rater count (n) beside it, and below the rater floor no profile is produced at all.';

export const RECEIVES: [string, string, string][] = [
  ['coverage', 'How many colleagues rated this person.', 'The denominator behind every figure in their profile.'],
  ['possibleRaters', 'Respondents, excluding the person themselves.', 'What coverage could have been.'],
  ['suppressed', 'coverage < minRaters', 'True means no individual profile is produced at all.'],
  ['items[].mean', 'Mean of one statement across the raters who answered it.', 'Carries its own n.'],
  ['blocks[].mean', 'Mean of per-rater row means, across raters.', 'The two-step mean. Rounded to 2dp.'],
  ['blocks[].band', 'The band that mean falls in.', 'Low / Mixed / Strong / Very strong.'],
  ['blocks[].ties', 'Raters whose row mean was at or above the threshold.', "The person's in-degree in that block."],
  ['blocks[].tieRate', 'ties ÷ n', 'Coverage-normalised, so a person rated by 4 compares with one rated by 12.'],
  ['supportGap', `Item ${SOCIO_SUPPORT_GAP_ITEM} alone, with its own band.`, 'Never averaged into a block.'],
  ['authorityTrustGap', 'power_over mean − trust mean', 'Positive: complied with more than relied on. Negative: relied on more than deferred to. Null when either side has no ratings.'],
];

export const GIVES: [string, string, string][] = [
  ['given.outDegree', 'How many colleagues this person rated.', 'A measure of reach, not of quality.'],
  ['given.mean', 'Mean of every asset-polarity rating they gave.', `Item ${SOCIO_SUPPORT_GAP_ITEM} excluded.`],
  ['given.versusCohort', 'given.mean − cohortMean', 'Leniency, not accuracy. It says how this rater scores relative to the group, never whether they are right.'],
  ['responded', 'Whether this member submitted a response of their own.', 'A member can be rated without responding, and vice versa.'],
];

export const PER_BLOCK: [string, string, string][] = [
  ['ties', 'Directed ties at or above the threshold in this block.', 'One per rater→target row that cleared the bar.'],
  ['density', 'ties ÷ rated pairs', 'How much of the working contact in the group carries this kind of tie.'],
  ['reciprocity', 'Mutual pairs carrying both ties ÷ mutual pairs carrying at least one.', 'Counted only on pairs who actually rated each other, so two people who simply do not work together never read as coldness.'],
  ['concentration', 'Summed shortfall from the highest tie rate ÷ the largest shortfall a group this size could produce.', '0 = flat, 1 = one person holds every tie. Built on coverage-normalised tie rates. Null below two members.'],
  ['ranked', 'Members ordered by tie rate, then mean, then roster position.', 'Most-connected first.'],
];

export const SIGNALS: [string, string, string][] = [
  ['responseRate', 'Respondents ÷ roster size.', ''],
  ['acquaintance', 'Ratings given ÷ pairs those respondents could have rated.', 'How much of the group knows itself well enough to judge.'],
  ['cohortMean', 'Mean of every asset-polarity rating given by anyone to anyone.', `The baseline for leniency. Item ${SOCIO_SUPPORT_GAP_ITEM} excluded.`],
  ['isolates', 'Members rated by colleagues, yet carrying zero ties in all four blocks.', 'A finding about connection, not a low score. A member nobody rated is not an isolate.'],
  ['underCovered', 'Members below the rater floor.', 'No individual report is produced for them.'],
  ['authorityWithoutTrust', 'The five largest positive authority-trust gaps.', 'Complied with, more than relied on. Suppressed members are excluded.'],
  ['trustWithoutAuthority', 'The five largest negative gaps.', 'Relied on, more than deferred to.'],
  ['supportGaps', `The five highest item-${SOCIO_SUPPORT_GAP_ITEM} means.`, 'Where the group asks for more than it gets.'],
  ['functionMatrix', 'Mean trust rating from each function to each function.', 'The seams between departments. Blank where no pair was rated.'],
];

export const EXAMPLE_NOTE =
  'Every rater gave the same figures for a given colleague, so the arithmetic stays checkable by hand. Real data never looks like this — the spread between raters is itself a finding, and the platform reports each figure with the rater count behind it.';

const alice = G.members.find((m) => m.name === 'Alice')!;
const aliceOver = alice.blocks.find((b) => b.blockKey === 'power_over')!;
const aliceTrust = alice.blocks.find((b) => b.blockKey === 'trust')!;

export const HAND_WORKED: [string, string][] = [
  ['Who rated Alice', 'Bob, Cara and Dan. Alice cannot rate herself; Eve and Frank did not respond.'],
  ['Each rater’s Power-over row mean', `Items 5, 6 and 7 are all ${ON_ALICE.powerOver}, so every row mean is ${ON_ALICE.powerOver.toFixed(2)}.`],
  ['Power-over block mean', `Three row means of ${ON_ALICE.powerOver.toFixed(2)} average to ${aliceOver.mean!.toFixed(2)} → band ${aliceOver.band}. All three clear the threshold of ${G.tieThreshold}, so ties = ${aliceOver.ties} of ${aliceOver.n}.`],
  ['Each rater’s Trust row mean', `Items 8, 9 and 10 are all ${ON_ALICE.trust}, so every row mean is ${ON_ALICE.trust.toFixed(2)}.`],
  ['Trust block mean', `${aliceTrust.mean!.toFixed(2)} → band ${aliceTrust.band}. None of the three reaches the threshold, so ties = ${aliceTrust.ties} of ${aliceTrust.n}.`],
  ['The gap', `${aliceOver.mean!.toFixed(2)} − ${aliceTrust.mean!.toFixed(2)} = ${alice.authorityTrustGap!.toFixed(2)}. Positive, and the largest in the cohort, so Alice heads the "complied with, more than relied on" list.`],
  ['How to read it', 'The group adjusts to Alice when she takes a position, but does not rely on her or feel safe with her to the same degree. That is a finding about the group’s relationship to her authority — not a verdict on her competence.'],
];

export const SIGNAL_ROWS: [string, string, string][] = [
  ['Complied with, more than relied on', G.authorityWithoutTrust.map((x) => `${x.name} (+${x.gap.toFixed(2)})`).join(', ') || 'none', 'Power-over sits above trust.'],
  ['Relied on, more than deferred to', G.trustWithoutAuthority.map((x) => `${x.name} (${x.gap.toFixed(2)})`).join(', ') || 'none', 'Trusted, without the leverage to act.'],
  ['Isolates', G.isolates.map((x) => `${x.name} (rated by ${x.coverage})`).join(', ') || 'none', 'Rated by colleagues, yet tied to by none of them in any block. A finding about connection, not a low score.'],
  ['Under-covered', G.underCovered.map((x) => `${x.name} (${x.coverage})`).join(', ') || 'none', `Below the rater floor of ${G.minRaters}, so no individual profile is produced.`],
  ['No profile at all', G.members.filter((m) => m.coverage === 0).map((m) => m.name).join(', ') || 'none', 'Nobody rated them. Not an isolate — the engine distinguishes "unrated" from "rated but untied".'],
  ['Largest support gaps', G.supportGaps.map((x) => `${x.name} (${x.mean.toFixed(2)})`).join(', ') || 'none', 'Where the group asks for more than it currently gets.'],
];

export const TOTALS: [string, string, string][] = [
  ['Roster size', String(G.rosterSize), 'Six people on the roster.'],
  ['Respondents', String(G.respondents), 'Alice, Bob, Cara and Dan submitted; Eve and Frank did not.'],
  ['Response rate', G.responseRate.toFixed(2), 'Respondents over roster size.'],
  ['Ratings given', String(G.ratingsGiven), 'Rater→target rows actually completed.'],
  ['Possible pairs', String(G.possiblePairs), 'What those four respondents could have rated.'],
  ['Acquaintance', G.acquaintance === null ? '—' : G.acquaintance.toFixed(2), 'How much of the group knows itself.'],
  ['Cohort mean', G.cohortMean === null ? '—' : G.cohortMean.toFixed(2), 'Baseline for leniency, asset items only.'],
  ['Rater floor', String(G.minRaters), 'The platform default. Configurable per cohort.'],
  ['Tie threshold', String(G.tieThreshold), 'The default.'],
];

export const RULES: [string, string][] = [
  ['Blanks are data', 'A blank is never imputed, never zero-filled, never quietly averaged over. "We don\'t really work together" is the instrument\'s own instruction, and it is what makes the coverage figures mean anything. A blank is stored as the absence of a row, not as a sentinel inside the 1–5 range.'],
  ['A started colleague must be finished', 'Every statement about a person is mandatory once that person is rated at all — two people rated on different subsets of the statements are not comparable numbers, however alike a report makes them look. Enforced in the browser and again at the API, which rejects a part-rated submission by name.'],
  ['Self-ratings are dropped', 'The instrument forbids them; a self-rating that reached the API is discarded rather than scored.'],
  ['Ratings off the roster are dropped', 'A rating aimed at a roster position that no longer exists is discarded. The roster is the authority on who is in the cohort.'],
  ['Out-of-range values are rejected', 'A value outside 1–5 raises an error. It is never clamped into the scale, because a clamp would turn a data fault into a plausible-looking number.'],
  ['Nothing is reverse-scored', 'No answer is recoded anywhere in this instrument. The one deficit-polarity item is handled by keeping it out of the blocks, not by flipping it.'],
];

export const CONFIDENTIALITY: [string, string][] = [
  ['No individual attribution', 'The group report carries no figure traceable to one respondent. Who rated whom is never shown, and no report names a rater.'],
  ['The rater floor', `Below ${SOCIO_DEFAULT_MIN_RATERS} raters (the default; configurable per cohort) no individual profile is produced at all. In a small named group a two-rater average is a quotation with a decimal point on it.`],
  ['Reports need a quorum', 'A cohort round produces no report until at least the rater floor has responded, so that no figure can be traced back to a single person.'],
  ['Before identification', 'The API sends no roster names at all until a respondent has identified themselves against the roster. An unenrolled email gets a plain "contact the cohort admin".'],
];

export const NOT_PRODUCED: [string, string][] = [
  ['No composite score', 'There is no single number per person and no overall ranking of people. Every figure is a block mean or a network statistic, and every one carries the rater count behind it.'],
  ['No inference about a rater', "A rater's leniency figure says how they score relative to the group. It never says whether they are right."],
  ['No imputation of the unknown', 'Where a pair did not work together, the engine reports that the pair is unrated. It does not estimate what the rating would have been.'],
];

export const SOURCE_NOTE =
  'Engine: scoreSocioCohort() in src/shared/socio-scoring.ts — pure and dependency-free, so the Worker, the browser and the test suite all run the same code. Instrument definition: src/shared/socio.ts. Trend across rounds: src/worker/lib/cohort-trend.ts.';

// ------------------------------------------------------ who comes top
/**
 * The headline question a facilitator asks first: who is most trusted, and who
 * holds the most power. Both are the same computation on a different block.
 */
export const RANKING_STEPS: [string, string][] = [
  [
    'A tie, not a score',
    `Ranking is not done on the average. For each colleague who rated this person, their row mean for the block is taken; if it is at or above the tie threshold (${SOCIO_TIE_THRESHOLD}) that colleague has drawn a tie to them.`,
  ],
  [
    'Tie rate, not tie count',
    'The person is then ranked on the share of their raters who drew a tie — ties ÷ raters — rather than the raw count. Without this, whoever is known by the most people wins by default.',
  ],
  [
    'Ordering',
    'Highest tie rate first. Where two people tie exactly, the higher block mean comes first; where those are equal too, roster order decides, which is arbitrary and should not be read as a ranking.',
  ],
  [
    'Read per block',
    'The same procedure on the Trust block answers "most trusted"; on Power — over it answers "who is most deferred to"; on Power — to & with, "who enables and connects most".',
  ],
];

export const RANKING_HEADLINES: [string, string, string][] = [
  ['Most trusted', 'Trust block — items 8, 9, 10', 'The share of a person’s raters who find them reliable, safe to be wrong in front of, and straight with difficult news.'],
  ['Most power — over', 'Power — over block — items 5, 6, 7', 'The share of raters who adjust to this person’s position, treat their approval as consequential, or see them shape the agenda informally.'],
  ['Most power — to & with', 'Power — to & with block — items 1, 2, 3, 4', 'The share of raters who seek this person’s judgement, depend on them to unlock resources, or route work through them.'],
];

/** The live ranking from the worked example, with coverage shown beside it. */
export const RANKING_EXAMPLE = G.networks.map((n) => ({
  name: n.name,
  color: n.color,
  rows: n.ranked
    .filter((r) => r.tieRate !== null)
    .map((r) => {
      const m = G.members.find((x) => x.memberNo === r.memberNo)!;
      return {
        name: r.name,
        ties: r.ties,
        tieRate: r.tieRate!,
        mean: r.mean,
        coverage: m.coverage,
        suppressed: m.suppressed,
      };
    }),
}));

export const RANKING_CAVEAT_TITLE = 'Coverage is not part of the ranking';
export const RANKING_CAVEAT = `A tie rate says nothing about how many people it rests on. In the worked example below, Eve was rated by a single colleague who rated her highly, giving her a tie rate of 1.00 — joint top on all four networks, and first outright on Power — to & with, above three people whose whole working group rated them. Her coverage of ${G.members.find((m) => m.name === 'Eve')!.coverage} is below the rater floor of ${G.minRaters}, so the platform withholds her individual profile, but the ranked lists are not filtered on the same rule. Read every ranking beside the rater count, and treat a thinly-rated name near the top as an artefact of coverage rather than a finding about the group.`;
