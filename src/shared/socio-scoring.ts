/**
 * Scoring engine for Collaboration Sociometry.
 *
 * The unit of analysis is the cohort, not the person. Every completed response
 * contributes one row per colleague the respondent had a basis to judge, and
 * the engine turns that sparse directed matrix into three things:
 *
 *   - what each member receives   (their profile, and their individual report)
 *   - what each member gives      (rating style, and out-degree)
 *   - what the group looks like   (density, reciprocity, concentration, gaps)
 *
 * Blanks are data. "We don't really work together" is the workbook's own
 * instruction and it is what makes the coverage numbers mean anything, so a
 * missing cell is never imputed, never treated as zero, and never silently
 * averaged over.
 *
 * Pure and dependency-free: the same code runs in the Worker, in the browser
 * and under Vitest.
 */

import {
  SOCIO_BLOCKS,
  SOCIO_COVERT_POWER_ITEMS,
  SOCIO_ITEMS,
  SOCIO_MAX_ANSWER,
  SOCIO_MIN_ANSWER,
  SOCIO_OPENNESS_ITEM,
  SOCIO_RELIABILITY_ITEM,
  SOCIO_SUPPORT_GAP_ITEM,
  SOCIO_TIE_THRESHOLD,
  decodeCell,
} from './socio.js';
// Type-only, so the cycle with socio-insights.ts is erased at compile time.
import type { SocioInsights } from './socio-insights.js';

export class SocioScoringError extends Error {}

// ------------------------------------------------------------------- inputs

export interface SocioMember {
  /** Roster position, 1-based and stable for the life of the cohort. */
  no: number;
  /** The cohort_members row id, carried through so reports can be addressed. */
  id: string;
  name: string;
  /** Function or department. May be ''. */
  func: string;
}

export interface SocioResponseInput {
  /** Roster position of the person who gave these ratings. */
  raterNo: number;
  /** Flat cell map exactly as stored in `answers`, keyed by `cellNo`. */
  answers: Readonly<Record<number, number>>;
}

// ------------------------------------------------------------------ outputs

export type SocioBand = 'Low' | 'Mixed' | 'Strong' | 'Very strong';
/** Bands for the one deficit-polarity item, where high is a complaint. */
export type SocioGapBand = 'Little' | 'Some' | 'Marked';

export interface SocioStat {
  /** Mean over the raters who answered this cell, to 2dp. null when n = 0. */
  mean: number | null;
  /** How many raters contributed. */
  n: number;
}

export interface SocioItemStat extends SocioStat {
  itemNo: number;
  short: string;
  blockKey: string;
  /** Every rating received on this statement, added up (guide §5.1's raw score). */
  sum: number;
}

export interface SocioBlockStat extends SocioStat {
  blockKey: string;
  name: string;
  short: string;
  color: string;
  band: SocioBand | null;
  /**
   * How many raters rated this person at or above the tie threshold on this
   * block: the person's in-degree in that block's network.
   */
  ties: number;
  /** ties as a share of `n`, to 2dp. null when n = 0. */
  tieRate: number | null;
  /**
   * Every rating received on the block's statements, added up, and how many
   * ratings that is. The guide's §5.1 scores are these sums. Because a touched
   * colleague must answer every statement, ratingSum / ratingCount equals
   * `mean` whenever the matrix rule held.
   */
  ratingSum: number;
  ratingCount: number;
}

export interface SocioMemberResult {
  memberNo: number;
  memberId: string;
  name: string;
  func: string;
  /** How many colleagues rated this person. */
  coverage: number;
  /** How many colleagues could have (respondents excluding this person). */
  possibleRaters: number;
  /** True when `coverage` is below the cohort's suppression floor. */
  suppressed: boolean;
  items: SocioItemStat[];
  blocks: SocioBlockStat[];
  /** Item 12, kept out of the blocks because a high score there is a deficit. */
  supportGap: SocioStat & {
    /** How many colleagues asked for more, at or above the tie threshold. */
    wanters: number;
    band: SocioGapBand | null;
  };
  /**
   * Power-over mean minus trust mean. Positive means the group falls in line
   * with this person more readily than it relies on them; negative is the
   * reverse. null when either side has no ratings.
   */
  authorityTrustGap: number | null;
  /**
   * Which of the two power bands this person's incoming ties actually sit in.
   * Null when they are over the line on neither. The guide reads this together
   * with trust: it is what separates a bottleneck from an expert.
   */
  powerKind: PowerKind | null;
  /** How many colleagues this person rated, and how they rated them. */
  given: {
    outDegree: number;
    /** Mean of every asset-polarity rating they gave, to 2dp. */
    mean: number | null;
    /** Their mean minus the cohort's mean, to 2dp: leniency, not accuracy. */
    versusCohort: number | null;
  };
  /** True when this member submitted a response of their own. */
  responded: boolean;
}

export interface SocioBlockNetwork {
  blockKey: string;
  name: string;
  short: string;
  color: string;
  /** Directed ties at or above threshold. */
  ties: number;
  /** Ordered pairs where the rater actually rated the target. */
  ratedPairs: number;
  /** ties / ratedPairs, to 2dp. null when no pairs were rated. */
  density: number | null;
  /** Pairs where each rated the other. The base for `reciprocity`. */
  mutualPairs: number;
  /** Of the mutual pairs carrying at least one tie, the share carrying both. */
  reciprocity: number | null;
  /**
   * How unevenly received ties are distributed, 0 (flat) to 1 (one person
   * holds every tie). Computed on coverage-normalised in-degree, so a member
   * rated by four colleagues is comparable with one rated by twelve.
   */
  concentration: number | null;
  /** Members ranked by tie rate then mean, most-connected first. */
  ranked: { memberNo: number; name: string; ties: number; tieRate: number | null; mean: number | null }[];
}

export interface SocioFunctionCell {
  from: string;
  to: string;
  /** Mean trust rating given by `from` people to `to` people, to 2dp. */
  trust: number | null;
  /** Ordered rated pairs behind that mean. */
  n: number;
}

export interface SocioGroupResult {
  kind: 'socio_group';
  /** Roster size. */
  rosterSize: number;
  /** Members who submitted. */
  respondents: number;
  /** respondents / rosterSize, to 2dp. */
  responseRate: number;
  /** Ratings actually given, across every respondent and every target. */
  ratingsGiven: number;
  /** Ordered pairs that could have been rated, given who responded. */
  possiblePairs: number;
  /** ratingsGiven / possiblePairs, to 2dp: how much of the group knows itself. */
  acquaintance: number | null;
  minRaters: number;
  tieThreshold: number;
  members: SocioMemberResult[];
  networks: SocioBlockNetwork[];
  /** Cohort mean of every asset-polarity rating, the baseline for leniency. */
  cohortMean: number | null;
  /** Members nobody rated at or above threshold in any block, despite coverage. */
  isolates: { memberNo: number; name: string; func: string; coverage: number }[];
  /** Members too thinly rated to report on at all. */
  underCovered: { memberNo: number; name: string; func: string; coverage: number }[];
  /**
   * Largest positive authority-minus-trust gaps: complied with, not relied on.
   * `powerKind` says which half of power is doing it, because the guide's fix
   * for the two halves is not the same fix.
   */
  authorityWithoutTrust: { memberNo: number; name: string; gap: number; powerKind: PowerKind | null }[];
  /** Largest negative gaps: relied on, without the leverage to act. */
  trustWithoutAuthority: { memberNo: number; name: string; gap: number }[];
  /**
   * Where the group asks for more than it gets, ranked by how many people ask.
   * `wanters` is the guide's support-gap in-degree; `mean` is how strongly.
   */
  supportGaps: { memberNo: number; name: string; wanters: number; mean: number; n: number }[];
  /** Function-to-function trust, for reading the seams between departments. */
  functionMatrix: SocioFunctionCell[];
  /** Distinct functions present on the roster, in roster order. */
  functions: string[];
  /**
   * The Insights findings, attached when the result is stored for a report.
   *
   * Optional on purpose: it is absent from every report generated before this
   * existed, and from the live dashboard payload, which computes its own. The
   * renderer prints these chapters only when they are here.
   */
  insights?: SocioInsights;
}

// ------------------------------------------------------------------ scoring

/**
 * Which kind of power carries a person — the guide's §5.2 split.
 *
 * "Split by kind of power: high power-OVER = a coercive bottleneck (the
 * priority for redesign); high power-TO but low trust = a capable expert who
 * needs relational development — a different fix."
 *
 * Two people can sit in the same corner of the Power x Trust map and need
 * opposite interventions: one is an organisational problem, the other a
 * personal-development one. Both halves of the split were already counted
 * here; naming which is which is the whole point of banding the two kinds of
 * power apart in the first place.
 */
export type PowerKind = 'bottleneck' | 'capable_expert' | 'mixed';

/**
 * How lopsided the two bands have to be before the split is called. Below it
 * the honest answer is "both", and saying so beats picking the larger of two
 * numbers that are barely apart.
 */
export const POWER_KIND_SHARE = 0.6;

/** Null when the person is over the line on neither band: there is no kind to name. */
export function powerKindOf(enabling: number, controlling: number): PowerKind | null {
  const total = enabling + controlling;
  if (total === 0) return null;
  const enablingShare = enabling / total;
  if (enablingShare >= POWER_KIND_SHARE) return 'capable_expert';
  if (enablingShare <= 1 - POWER_KIND_SHARE) return 'bottleneck';
  return 'mixed';
}

/** What to call each kind, and what the guide says to do about it. */
export function powerKindReading(kind: PowerKind): { label: string; fix: string } {
  switch (kind) {
    case 'bottleneck':
      return {
        label: 'Control, not enablement',
        fix: 'Deference, gatekeeping and agenda-setting carry this person rather than what they offer. Where trust is also low the guide calls this a coercive bottleneck and makes it the priority for redesign — the fix is to the decision rights, not to the person.',
      };
    case 'capable_expert':
      return {
        label: 'Enablement, not control',
        fix: 'People seek this person out rather than having to go through them. Where trust is low alongside it, the guide reads a capable expert who needs relational development — a different fix entirely, and not an organisational one.',
      };
    case 'mixed':
      return {
        label: 'Both kinds, evenly',
        fix: 'Enabling and controlling power are close to even for this person, so the guide\u2019s split does not resolve. Read the trust figure and the support gap before deciding which half to act on.',
      };
  }
}

// ------------------------------------------------ where one person stands

/** The guide's four archetypes (§5.2), keyed as the admin map keys them. */
export type SocioQuadrant = 'anchor' | 'underused' | 'watch' | 'peripheral';

export interface SocioStanding {
  quadrant: SocioQuadrant;
  /** Which half of power carries them; null when over the line on neither. */
  powerKind: PowerKind | null;
  /** Trust ties received per colleague who rated them. */
  trustRate: number;
  /** Power ties received (enabling + controlling) per colleague who rated them. */
  powerRate: number;
  /** The group medians the two rates were split on. */
  medians: { trust: number; power: number };
}

/**
 * Where one member sits on the Power × Trust map.
 *
 * The same reading the admin map makes, so a person told "Trusted Advisor" in
 * a coaching session sits in that corner on the facilitator's screen too:
 * total power (enabling + controlling ties) against trust ties, each divided
 * by how many colleagues rated them, split at the group medians, with a
 * person exactly on a median counted on the higher side unless it is zero. Everyone on the
 * roster counts toward the medians — an unrated member is a zero, as it is on
 * the map. null for a suppressed member: no reading below the rater floor.
 */
export function memberStanding(group: SocioGroupResult, memberNo: number): SocioStanding | null {
  const rateOf = (m: SocioMemberResult, key: string) =>
    m.coverage > 0 ? (m.blocks.find((b) => b.blockKey === key)?.ties ?? 0) / m.coverage : 0;
  const points = group.members.map((m) => ({
    m,
    trust: rateOf(m, 'trust'),
    power: rateOf(m, 'power_to') + rateOf(m, 'power_over'),
  }));
  const me = points.find((p) => p.m.memberNo === memberNo);
  if (!me || me.m.suppressed) return null;
  const median = (vs: number[]) => {
    const s = [...vs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const medians = { trust: median(points.map((p) => p.trust)), power: median(points.map((p) => p.power)) };
  // Zero is never the high side (see quadrantOf in the admin model): with a
  // median of 0, "ties count high" would make everyone with none influential.
  const trusted = me.trust > 0 && me.trust >= medians.trust;
  const influential = me.power > 0 && me.power >= medians.power;
  const quadrant: SocioQuadrant =
    trusted && influential ? 'anchor' : influential ? 'watch' : trusted ? 'underused' : 'peripheral';
  return {
    quadrant,
    powerKind: me.m.powerKind,
    trustRate: round2(me.trust),
    powerRate: round2(me.power),
    medians: { trust: round2(medians.trust), power: round2(medians.power) },
  };
}

/**
 * The archetypes said to the person themselves, for a coaching conversation.
 * Names are the guide's own, so the report, the console and the deck agree.
 */
export const SOCIO_QUADRANT_FOR_MEMBER: Record<SocioQuadrant, { name: string; gloss: string; reading: string }> = {
  anchor: {
    name: 'Collaborative Anchor',
    gloss: 'Trusted and influential',
    reading:
      'Colleagues both rely on you and follow your lead. The guide sees people here as the coalition to lead change through — and names overload as the risk worth watching.',
  },
  underused: {
    name: 'Trusted Advisor',
    gloss: 'Trusted, with less say than that trust would suggest',
    reading:
      'Colleagues rely on you more than the say you are given reflects. The guide reads this corner as under-leveraged: a case for more scope and authority, and a common place to find the next stretch role.',
  },
  watch: {
    name: 'Risk Zone',
    gloss: 'Influential more than trusted',
    reading:
      'Colleagues follow your lead more readily than they rely on you. What helps depends on which kind of power is carrying that influence — see below — because the guide prescribes a different fix for each.',
  },
  peripheral: {
    name: 'Peripheral',
    gloss: 'Fewer ties on either side',
    reading:
      'Fewer colleagues put you over the line on trust or on influence than is typical in this group. That is most often about being new, or working apart from the rest of the group; the guide\u2019s response is to connect, not to correct.',
  },
};

/** Which half of power carries them, said to the person. */
export function powerKindForMember(kind: PowerKind | null): { label: string; reading: string } {
  switch (kind) {
    case 'bottleneck':
      return {
        label: 'Control, more than enablement',
        reading:
          'Your influence comes mostly from people deferring to you or having to go through you, rather than from seeking you out. Where trust is lower alongside it, the guide looks first at decision rights and process, not at the person.',
      };
    case 'capable_expert':
      return {
        label: 'Enablement, more than control',
        reading:
          'Your influence comes mostly from people seeking you out — your judgment, the resources you unlock, the people you bring together — rather than from control. Where trust is lower alongside it, the guide points to relationships as the thing to develop.',
      };
    case 'mixed':
      return {
        label: 'Both kinds, about evenly',
        reading: 'Your influence comes about equally from enabling others and from control.',
      };
    default:
      return {
        label: 'Not enough to split',
        reading: 'Too few colleagues put you over the line on either kind of power for this split to say anything.',
      };
  }
}

export function socioBandFor(mean: number): SocioBand {
  if (mean < 2.5) return 'Low';
  if (mean < 3.5) return 'Mixed';
  if (mean < 4.25) return 'Strong';
  return 'Very strong';
}

export function socioGapBandFor(mean: number): SocioGapBand {
  if (mean < 2.5) return 'Little';
  if (mean < 3.5) return 'Some';
  return 'Marked';
}

/** One respondent's ratings of one colleague, already decoded. */
interface Cell {
  raterNo: number;
  targetNo: number;
  values: Map<number, number>;
}

/**
 * `minRaters` is the cohort's suppression floor: a member rated by fewer than
 * this many colleagues gets no individual report, because in a small named
 * group a two-rater average is a quotation with a decimal point on it.
 */
export function scoreSocioCohort(
  members: readonly SocioMember[],
  responses: readonly SocioResponseInput[],
  opts: { minRaters: number; tieThreshold?: number },
): SocioGroupResult {
  const tieThreshold = opts.tieThreshold ?? SOCIO_TIE_THRESHOLD;
  if (members.length === 0) throw new SocioScoringError('A cohort needs at least one roster member');

  const byNo = new Map(members.map((m) => [m.no, m]));
  const rosterSize = members.length;

  // ------------------------------------------------------------ decode cells
  const cells: Cell[] = [];
  const responded = new Set<number>();

  for (const r of responses) {
    if (!byNo.has(r.raterNo)) {
      throw new SocioScoringError(`Response from roster position ${r.raterNo}, which is not on the roster`);
    }
    responded.add(r.raterNo);
    const rows = new Map<number, Map<number, number>>();

    for (const [key, value] of Object.entries(r.answers)) {
      const no = Number(key);
      if (!Number.isInteger(no) || no < 1) continue;
      const { memberNo, itemNo } = decodeCell(no);
      // A rating aimed at a roster position that no longer exists, or at the
      // rater themselves, is dropped rather than scored: the roster is the
      // authority on who is in the cohort, and a self-rating is the one thing
      // the instrument explicitly forbids.
      if (!byNo.has(memberNo) || memberNo === r.raterNo) continue;
      if (!Number.isInteger(value) || value < SOCIO_MIN_ANSWER || value > SOCIO_MAX_ANSWER) {
        throw new SocioScoringError(
          `Rating of ${String(value)} at cell ${no} is outside ${SOCIO_MIN_ANSWER}..${SOCIO_MAX_ANSWER}`,
        );
      }
      let row = rows.get(memberNo);
      if (!row) {
        row = new Map();
        rows.set(memberNo, row);
      }
      row.set(itemNo, value);
    }

    for (const [targetNo, values] of rows) {
      cells.push({ raterNo: r.raterNo, targetNo, values });
    }
  }

  const respondents = responded.size;
  const possiblePairs = respondents * Math.max(0, rosterSize - 1);
  const ratingsGiven = cells.length;

  // --------------------------------------------------------- cohort baseline
  const assetSet = new Set(SOCIO_ITEMS.filter((i) => i.polarity === 'asset').map((i) => i.no));

  let cohortSum = 0;
  let cohortN = 0;
  for (const c of cells) {
    for (const [itemNo, v] of c.values) {
      if (assetSet.has(itemNo)) {
        cohortSum += v;
        cohortN += 1;
      }
    }
  }
  const cohortMean = cohortN > 0 ? round2(cohortSum / cohortN) : null;

  // -------------------------------------------------------------- per-member
  const receivedBy = new Map<number, Cell[]>();
  const givenBy = new Map<number, Cell[]>();
  for (const c of cells) {
    push(receivedBy, c.targetNo, c);
    push(givenBy, c.raterNo, c);
  }

  const memberResults: SocioMemberResult[] = members.map((m) => {
    const received = receivedBy.get(m.no) ?? [];
    const coverage = received.length;
    // Everyone who submitted, other than this person.
    const possibleRaters = respondents - (responded.has(m.no) ? 1 : 0);

    const items: SocioItemStat[] = SOCIO_ITEMS.map((item) => {
      const values = received.map((c) => c.values.get(item.no)).filter(isNumber);
      return {
        itemNo: item.no,
        short: item.short,
        blockKey: item.blockKey,
        ...stat(values),
        sum: values.reduce((t, v) => t + v, 0),
      };
    });

    const blocks: SocioBlockStat[] = SOCIO_BLOCKS.map((block) => {
      const perRater = received.map((c) => rowMean(c, block.items)).filter(isNumber);
      const s = stat(perRater);
      const ties = perRater.filter((v) => v >= tieThreshold).length;
      const raw = received.flatMap((c) => block.items.map((no) => c.values.get(no)).filter(isNumber));
      return {
        blockKey: block.key,
        name: block.name,
        short: block.short,
        color: block.color,
        ...s,
        band: s.mean === null ? null : socioBandFor(s.mean),
        ties,
        tieRate: perRater.length > 0 ? round2(ties / perRater.length) : null,
        ratingSum: raw.reduce((t, v) => t + v, 0),
        ratingCount: raw.length,
      };
    });

    const gapValues = received.map((c) => c.values.get(SOCIO_SUPPORT_GAP_ITEM)).filter(isNumber);
    const gapStat = stat(gapValues);
    // The facilitator guide scores the support gap as an in-degree — "how many
    // people want more from them" — not as an average. A mean rewards being
    // asked by few people loudly over being asked by many: one colleague
    // answering 5 outranks eight answering 4, which inverts "in demand but not
    // delivering". The mean is kept beside it as the strength of the ask.
    const gapWanters = gapValues.filter((v) => v >= tieThreshold).length;

    const powerOverBlock = blocks.find((b) => b.blockKey === 'power_over')!;
    const powerOver = powerOverBlock.mean;
    const trust = blocks.find((b) => b.blockKey === 'trust')!.mean;
    const enablingTies = blocks.find((b) => b.blockKey === 'power_to')!.ties;

    const gaveCells = givenBy.get(m.no) ?? [];
    const gaveValues: number[] = [];
    for (const c of gaveCells) {
      for (const [itemNo, v] of c.values) if (assetSet.has(itemNo)) gaveValues.push(v);
    }
    const givenMean = gaveValues.length > 0 ? round2(mean(gaveValues)) : null;

    return {
      memberNo: m.no,
      memberId: m.id,
      name: m.name,
      func: m.func,
      coverage,
      possibleRaters,
      suppressed: coverage < opts.minRaters,
      items,
      blocks,
      supportGap: {
        ...gapStat,
        wanters: gapWanters,
        band: gapStat.mean === null ? null : socioGapBandFor(gapStat.mean),
      },
      authorityTrustGap: powerOver !== null && trust !== null ? round2(powerOver - trust) : null,
      powerKind: powerKindOf(enablingTies, powerOverBlock.ties),
      given: {
        outDegree: gaveCells.length,
        mean: givenMean,
        versusCohort: givenMean !== null && cohortMean !== null ? round2(givenMean - cohortMean) : null,
      },
      responded: responded.has(m.no),
    };
  });

  // ---------------------------------------------------------------- networks
  const networks: SocioBlockNetwork[] = SOCIO_BLOCKS.map((block) => {
    let ties = 0;
    const tieSet = new Set<string>();
    // A pair belongs in this network's denominator only if the rater answered
    // at least one of THIS block's statements about that colleague. Counting
    // every rated pair instead — including pairs where only the trust columns
    // were filled in — puts people in the bottom of the fraction who could
    // never appear in the top, and biases every density downward.
    const ratedHere = new Set<string>();
    for (const c of cells) {
      const v = rowMean(c, block.items);
      if (v === null) continue;
      ratedHere.add(`${c.raterNo}>${c.targetNo}`);
      if (v >= tieThreshold) {
        ties += 1;
        tieSet.add(`${c.raterNo}>${c.targetNo}`);
      }
    }
    const ratedPairsHere = ratedHere.size;

    let mutualPairs = 0;
    let mutualWithAny = 0;
    let mutualWithBoth = 0;
    for (const m of members) {
      for (const o of members) {
        if (o.no <= m.no) continue;
        // Same rule for reciprocity: "did they return it" is only a question
        // where both of them answered these statements about each other.
        if (!ratedHere.has(`${m.no}>${o.no}`) || !ratedHere.has(`${o.no}>${m.no}`)) continue;
        mutualPairs += 1;
        const tieAb = tieSet.has(`${m.no}>${o.no}`);
        const tieBa = tieSet.has(`${o.no}>${m.no}`);
        if (tieAb || tieBa) mutualWithAny += 1;
        if (tieAb && tieBa) mutualWithBoth += 1;
      }
    }

    const rates = memberResults
      .map((r) => r.blocks.find((b) => b.blockKey === block.key)!.tieRate)
      .filter(isNumber);

    const ranked = memberResults
      .map((r) => {
        const b = r.blocks.find((x) => x.blockKey === block.key)!;
        return { memberNo: r.memberNo, name: r.name, ties: b.ties, tieRate: b.tieRate, mean: b.mean };
      })
      .sort(
        (a, b) =>
          (b.tieRate ?? -1) - (a.tieRate ?? -1) ||
          (b.mean ?? -1) - (a.mean ?? -1) ||
          a.memberNo - b.memberNo,
      );

    return {
      blockKey: block.key,
      name: block.name,
      short: block.short,
      color: block.color,
      ties,
      ratedPairs: ratedPairsHere,
      density: ratedPairsHere > 0 ? round2(ties / ratedPairsHere) : null,
      mutualPairs,
      reciprocity: mutualWithAny > 0 ? round2(mutualWithBoth / mutualWithAny) : null,
      concentration: concentrationOfRates(rates),
      ranked,
    };
  });

  // ----------------------------------------------------------- group signals
  const isolates = memberResults
    .filter((r) => r.coverage > 0 && r.blocks.every((b) => b.ties === 0))
    .map((r) => ({ memberNo: r.memberNo, name: r.name, func: r.func, coverage: r.coverage }));

  const underCovered = memberResults
    .filter((r) => r.suppressed)
    .map((r) => ({ memberNo: r.memberNo, name: r.name, func: r.func, coverage: r.coverage }));

  const gaps = memberResults
    .filter((r) => !r.suppressed && r.authorityTrustGap !== null)
    .map((r) => ({ memberNo: r.memberNo, name: r.name, gap: r.authorityTrustGap!, powerKind: r.powerKind }));

  const authorityWithoutTrust = gaps
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.memberNo - b.memberNo)
    .slice(0, 5);

  const trustWithoutAuthority = gaps
    .filter((g) => g.gap < 0)
    .sort((a, b) => a.gap - b.gap || a.memberNo - b.memberNo)
    .slice(0, 5);

  const supportGaps = memberResults
    .filter((r) => !r.suppressed && r.supportGap.wanters > 0)
    .map((r) => ({
      memberNo: r.memberNo,
      name: r.name,
      wanters: r.supportGap.wanters,
      mean: r.supportGap.mean ?? 0,
      n: r.supportGap.n,
    }))
    .sort((a, b) => b.wanters - a.wanters || b.mean - a.mean || a.memberNo - b.memberNo)
    .slice(0, 5);

  // ---------------------------------------------------------- function seams
  const functions: string[] = [];
  for (const m of members) {
    const f = m.func || 'Unassigned';
    if (!functions.includes(f)) functions.push(f);
  }
  const trustItems = SOCIO_BLOCKS.find((b) => b.key === 'trust')!.items;
  const buckets = new Map<string, number[]>();
  for (const c of cells) {
    const from = byNo.get(c.raterNo)?.func || 'Unassigned';
    const to = byNo.get(c.targetNo)?.func || 'Unassigned';
    const v = rowMean(c, trustItems);
    if (v === null) continue;
    push(buckets, `${from}\u0000${to}`, v);
  }
  const functionMatrix: SocioFunctionCell[] = [];
  for (const from of functions) {
    for (const to of functions) {
      const vals = buckets.get(`${from}\u0000${to}`) ?? [];
      functionMatrix.push({ from, to, trust: vals.length > 0 ? round2(mean(vals)) : null, n: vals.length });
    }
  }

  return {
    kind: 'socio_group',
    rosterSize,
    respondents,
    responseRate: rosterSize > 0 ? round2(respondents / rosterSize) : 0,
    ratingsGiven,
    possiblePairs,
    acquaintance: possiblePairs > 0 ? round2(ratingsGiven / possiblePairs) : null,
    minRaters: opts.minRaters,
    tieThreshold,
    members: memberResults,
    networks,
    cohortMean,
    isolates,
    underCovered,
    authorityWithoutTrust,
    trustWithoutAuthority,
    supportGaps,
    functionMatrix,
    functions,
  };
}

/** The member slice an individual report renders, pulled out of a group result. */
export function memberResultFor(group: SocioGroupResult, memberNo: number): SocioMemberResult | null {
  return group.members.find((m) => m.memberNo === memberNo) ?? null;
}

// ------------------------------------------------------------------ helpers

/**
 * One rater's mean across the items of one block, for one target.
 *
 * Partial rows are averaged over what is there rather than discarded: a rater
 * who answered three of the four Power items has still expressed a view of that
 * block, and dropping the row would bias the network toward whoever filled
 * every cell.
 */
function rowMean(cell: Cell, items: readonly number[]): number | null {
  const vals = items.map((i) => cell.values.get(i)).filter(isNumber);
  return vals.length > 0 ? mean(vals) : null;
}

function stat(values: readonly number[]): SocioStat {
  return { mean: values.length > 0 ? round2(mean(values)) : null, n: values.length };
}

function mean(values: readonly number[]): number {
  return values.reduce((t, v) => t + v, 0) / values.length;
}

/**
 * How far a distribution sits from flat, on the same 0..1 scale whatever the
 * group size: the summed shortfall from the highest value, over the largest
 * shortfall a group of this size could produce.
 *
 * Exported because concentration is printed in more than one chapter of the
 * report and on more than one screen, and it used to be written out separately
 * in each place. Two of those copies measured the shortfall from the *top* and
 * one from the *mean*, which are different questions — the same trust network
 * read 0.75 in one chapter and 0.43 in another, and 0.50 where the other said
 * "not enough data". There is now one definition and every caller uses it.
 */
export function concentrationOfRates(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const shortfall = values.reduce((t, v) => t + (max - v), 0);
  const maxShortfall = max * (values.length - 1);
  return maxShortfall > 0 ? round2(shortfall / maxShortfall) : 0;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function isNumber(v: number | undefined | null): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- summaries

/**
 * The group's headline paragraph, used identically by the HTML report, the PDF
 * and the facilitator's email so the three cannot drift.
 */
export function socioGroupSummary(g: SocioGroupResult, cohortName: string): string {
  const pct = (v: number | null): string => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
  const trust = g.networks.find((n) => n.blockKey === 'trust');
  const powerTo = g.networks.find((n) => n.blockKey === 'power_to');

  const coverageNote =
    g.acquaintance === null
      ? 'No ratings were given.'
      : g.acquaintance >= 0.6
        ? 'The group knows itself well: most people had a basis to judge most of their colleagues.'
        : g.acquaintance >= 0.35
          ? 'Working contact is partial. A substantial share of pairs had no basis to judge each other, which is itself a finding about how connected this group is.'
          : 'Working contact is thin: most pairs in this group do not work together closely enough to rate one another, so what follows describes a sparse set of real relationships rather than the whole roster.';

  const shape =
    trust?.concentration === null || trust?.concentration === undefined
      ? ''
      : trust.concentration >= 0.5
        ? ' Trust is concentrated in a small number of people rather than spread across the group, which leaves the group dependent on their availability.'
        : trust.concentration >= 0.3
          ? ' Trust is moderately concentrated: there are clear anchors, but they are not carrying the group alone.'
          : ' Trust is spread broadly rather than resting on a few individuals.';

  return (
    `${cohortName}: ${g.respondents} of ${g.rosterSize} members responded (${pct(g.responseRate)}), ` +
    `giving ${g.ratingsGiven} ratings across ${pct(g.acquaintance)} of the pairs those respondents could have rated. ` +
    `${coverageNote} At the ${g.tieThreshold}-and-above threshold, ${pct(trust?.density ?? null)} of rated ` +
    `relationships carry a trust tie and ${pct(powerTo?.density ?? null)} carry an enabling-power tie.` +
    shape +
    ' This is a picture of the group, not a judgement of any individual in it.'
  );
}

/** One member's headline paragraph for their individual report. */
export function socioMemberSummary(m: SocioMemberResult, g: SocioGroupResult): string {
  if (m.suppressed) {
    return (
      `${m.name} was rated by ${m.coverage} ${m.coverage === 1 ? 'colleague' : 'colleagues'}, below the ` +
      `${g.minRaters}-rater floor this cohort reports at. No profile is shown: with this few raters the ` +
      'figures would reproduce what one colleague said rather than describe a pattern, which is the one ' +
      'thing the exercise promised not to do.'
    );
  }

  const ranked = m.blocks.filter((b) => b.mean !== null).sort((a, b) => b.mean! - a.mean!);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];

  const gapLine =
    m.authorityTrustGap === null
      ? ''
      : m.authorityTrustGap >= 0.5
        ? ` Colleagues report more readiness to fall in line with ${m.name} than reliance on them: the group treats this as authority before it treats it as trust.`
        : m.authorityTrustGap <= -0.5
          ? ` Colleagues rely on ${m.name} more than they report deferring to them. Trust here runs ahead of formal leverage.`
          : ' Authority and trust are reported at roughly the same level.';

  const supportLine =
    m.supportGap.mean === null
      ? ''
      : m.supportGap.band === 'Marked'
        ? ` Colleagues also say they would like more support or cooperation than they currently get (${m.supportGap.mean} of 5, ${m.supportGap.n} raters), the clearest single request in this profile.`
        : m.supportGap.band === 'Some'
          ? ` There is a moderate request for more support or cooperation (${m.supportGap.mean} of 5).`
          : '';

  return (
    `${m.coverage} of ${m.possibleRaters} colleagues had a basis to rate ${m.name}. ` +
    (top && bottom
      // The block names are proper labels ("Power — to & with"), so they keep
      // their capitals mid-sentence; lowercasing them read as a typo.
      ? `They are seen most strongly on ${top.name} (${top.mean} of 5) and least on ${bottom.name} (${bottom.mean} of 5).`
      : '') +
    gapLine +
    supportLine +
    " Every figure here is an average of colleagues' views; no individual response is identifiable."
  );
}

// ------------------------------------------------------------------- edges

export interface SocioEdge {
  /** Roster positions, 1-based. */
  from: number;
  to: number;
  /** Asset-item ratings given for this pair. */
  n: number;
  /** Mean of those ratings, 2dp. */
  mean: number;
  /**
   * Per-block means and tie flags. A block with no answers is absent.
   *
   * Alongside the instrument's own blocks this carries three pseudo-blocks:
   * `reliability` (item 8) and `openness` (item 9), two single-item lenses onto
   * the trust block, and `covert_power`, the hidden half of the power-over
   * band. None of them are blocks in their own right.
   */
  blocks: Record<string, { mean: number; n: number; tie: boolean }>;
  /** Item 12, the deficit item, kept apart as everywhere else. */
  gap: { mean: number; n: number } | null;
}

/**
 * The raw directed pair list behind the network views: one edge per ordered
 * pair that carries at least one rating. Pure extraction, no thresholds
 * applied — the console filters live, so the cut-off belongs to the screen,
 * not to the data.
 *
 * A tie is per block: the block's mean at or above the threshold, the same
 * reading `scoreSocioCohort` uses for its densities, so the map and the
 * metrics panel can never disagree about whether a line exists.
 */
export function socioEdges(
  responses: readonly SocioResponseInput[],
  tieThreshold: number,
): SocioEdge[] {
  const itemsByBlock = new Map<string, Set<number>>();
  for (const item of SOCIO_ITEMS) {
    if (item.polarity !== 'asset') continue;
    const set = itemsByBlock.get(item.blockKey) ?? new Set<number>();
    set.add(item.no);
    itemsByBlock.set(item.blockKey, set);
  }

  const edges: SocioEdge[] = [];
  for (const r of responses) {
    // target -> itemNo -> value
    const perTarget = new Map<number, Map<number, number>>();
    for (const [noStr, value] of Object.entries(r.answers)) {
      const { memberNo, itemNo } = decodeCell(Number(noStr));
      if (memberNo === r.raterNo) continue; // self-cells never render
      if (value < SOCIO_MIN_ANSWER || value > SOCIO_MAX_ANSWER) continue;
      const bag = perTarget.get(memberNo) ?? new Map<number, number>();
      bag.set(itemNo, value);
      perTarget.set(memberNo, bag);
    }

    for (const [targetNo, bag] of perTarget) {
      const blocks: SocioEdge['blocks'] = {};
      let assetSum = 0;
      let assetN = 0;
      for (const [blockKey, items] of itemsByBlock) {
        let sum = 0;
        let n = 0;
        for (const itemNo of items) {
          const v = bag.get(itemNo);
          if (v === undefined) continue;
          sum += v;
          n += 1;
        }
        if (n === 0) continue;
        const mean = round2(sum / n);
        blocks[blockKey] = { mean, n, tie: mean >= tieThreshold };
        assetSum += sum;
        assetN += n;
      }

      // Lenses, not blocks of the instrument: each reads cells a real block
      // has already counted, so all of them are added after the asset totals
      // are closed — counting them again would inflate the pair's overall
      // mean — and the real blocks above are untouched.
      //
      // reliability (item 8) and openness (item 9) are the two facets trust
      // comes apart along. `covert_power` is the guide's §5.4 reading: the
      // power-over statements whose every underlying criterion is one of the
      // covert faces, which on the shipped form is item 7 alone — agenda-
      // setting and pre-wiring, and not the veto rights an org chart shows.
      for (const [key, itemNos] of [
        ['reliability', [SOCIO_RELIABILITY_ITEM]],
        ['openness', [SOCIO_OPENNESS_ITEM]],
        ['covert_power', SOCIO_COVERT_POWER_ITEMS],
      ] as const) {
        const vals = itemNos.map((no) => bag.get(no)).filter(isNumber);
        if (vals.length === 0) continue;
        const m = round2(vals.reduce((t, v) => t + v, 0) / vals.length);
        blocks[key] = { mean: m, n: vals.length, tie: m >= tieThreshold };
      }

      const gapValue = bag.get(SOCIO_SUPPORT_GAP_ITEM);
      if (assetN === 0 && gapValue === undefined) continue;
      edges.push({
        from: r.raterNo,
        to: targetNo,
        n: assetN,
        mean: assetN > 0 ? round2(assetSum / assetN) : 0,
        blocks,
        gap: gapValue === undefined ? null : { mean: gapValue, n: 1 },
      });
    }
  }
  return edges;
}

// ------------------------------------------------- the guide's two readings
//
// Both are derived from a scored cohort rather than from the raw responses, so
// they are available for every report ever generated, not only ones scored
// after they were written.

export interface InfluenceMix {
  /** Ties received on the enabling band, across the whole group. */
  enabling: number;
  /** Ties received on the controlling band. */
  controlling: number;
  /** enabling / (enabling + controlling), 2dp. Null when neither exists. */
  share: number | null;
  verdict: string;
}

/**
 * How influence flows in this group — the facilitator guide's first
 * group-level question.
 *
 * "A system where influence runs mainly through enabling power is
 * collaborative; one where it runs through control is a domination culture."
 * It is one number and one sentence, and it is the reading the whole
 * power-to/power-over split exists to produce.
 */
export function influenceMix(group: SocioGroupResult): InfluenceMix {
  const tiesOn = (key: string) => group.networks.find((n) => n.blockKey === key)?.ties ?? 0;
  const enabling = tiesOn('power_to');
  const controlling = tiesOn('power_over');
  const total = enabling + controlling;
  if (total === 0) {
    return { enabling, controlling, share: null, verdict: 'Nobody is over the line on either kind of power yet.' };
  }
  const share = Math.round((enabling / total) * 100) / 100;
  const pct = Math.round(share * 100);
  if (share >= 0.65) {
    return {
      enabling,
      controlling,
      share,
      verdict: `Influence here runs mainly through enabling power — ${pct}% of the power ties are people being sought out, unlocked or rallied rather than deferred to. That is the collaborative pattern.`,
    };
  }
  if (share <= 0.45) {
    return {
      enabling,
      controlling,
      share,
      verdict: `Influence here runs mainly through control — only ${pct}% of the power ties are enabling, the rest are deference, gatekeeping and agenda-setting. The model calls this a domination culture, whatever the org chart says.`,
    };
  }
  return {
    enabling,
    controlling,
    share,
    verdict: `Enabling and controlling power are close to even here (${pct}% enabling). Influence is carried as much by position as by what people offer.`,
  };
}

export type SignatureKind = 'dominating' | 'unreliable' | 'disconnected';

export interface SignatureMember {
  memberNo: number;
  name: string;
  func: string;
  /** The figures behind the flag, already phrased. */
  why: string;
}

/**
 * The three non-collaborative signatures the guide names.
 *
 * Every one is a pattern of absence rather than a rejection: nobody is ever
 * asked who they distrust, so these are read off low ratings, missing ratings
 * and the support gap. They are deliberately not ranked against each other —
 * "connect, don't correct" applies to the third and not to the first.
 */
export function signatures(group: SocioGroupResult): Record<SignatureKind, SignatureMember[]> {
  const out: Record<SignatureKind, SignatureMember[]> = {
    dominating: [],
    unreliable: [],
    disconnected: [],
  };
  const blockMean = (m: SocioMemberResult, key: string) =>
    m.blocks.find((b) => b.blockKey === key)?.mean ?? null;
  const itemMean = (m: SocioMemberResult, no: number) =>
    m.items.find((i) => i.itemNo === no)?.mean ?? null;
  const wantShare = (m: SocioMemberResult) => (m.coverage > 0 ? m.supportGap.wanters / m.coverage : 0);

  // "High" and "low" in the guide are relative to the group, not fixed marks:
  // a lenient group rates everyone 4+, a harsh one nobody. So the dominating
  // signature is read against the people who can actually be judged — those
  // above the rater floor with both bands answered.
  const judged = group.members.filter(
    (m) =>
      m.coverage >= group.minRaters &&
      !m.suppressed &&
      blockMean(m, 'power_over') !== null &&
      blockMean(m, 'trust') !== null,
  );
  const powerCut = topThirdCut(judged.map((m) => blockMean(m, 'power_over')!));
  const trustCut = medianOfValues(judged.map((m) => blockMean(m, 'trust')!));
  const wantCut = medianOfValues(judged.map(wantShare));

  for (const m of group.members) {
    // Disconnected is about reach, so it is the one signature that still
    // applies to somebody whose profile was withheld for thin coverage.
    if (m.coverage < group.minRaters) {
      out.disconnected.push({
        memberNo: m.memberNo,
        name: m.name,
        func: m.func,
        why: `Rated by ${m.coverage} of the group, below the floor of ${group.minRaters}.`,
      });
      continue;
    }
    if (m.suppressed) continue;

    // Dominating without trust: top third on power-over, bottom half on trust,
    // and at least the group's usual share asking for more support. The last
    // guard — power-over above their own trust — keeps a well-trusted person
    // out of it in a group where even the bottom half is trusted.
    const power = blockMean(m, 'power_over');
    const trust = blockMean(m, 'trust');
    const wanted = wantShare(m);
    if (
      power !== null &&
      trust !== null &&
      powerCut !== null &&
      trustCut !== null &&
      wantCut !== null &&
      power >= powerCut &&
      trust <= trustCut &&
      power > trust &&
      m.supportGap.wanters > 0 &&
      wanted >= wantCut
    ) {
      out.dominating.push({
        memberNo: m.memberNo,
        name: m.name,
        func: m.func,
        why: `Power-over ${power.toFixed(2)} (top third) against trust ${trust.toFixed(2)} (bottom half); ${m.supportGap.wanters} of ${m.coverage} ${m.supportGap.wanters === 1 ? 'colleague wants' : 'colleagues want'} more.`,
      });
    }

    // Quietly unreliable: the guide's three statements exactly — on time
    // (item 8), keeps their word (10), easy to work with (11). Item 9, safe to
    // be open, is left out: it is warmth, not dependability, and including it
    // would flag somebody reliable but intimidating as unreliable. "Consistently
    // low" means every one of them answered sits below the line, at least two.
    const dependability = UNRELIABLE_ITEMS.map((no) => ({ no, mean: itemMean(m, no) })).filter(
      (x): x is { no: number; mean: number } => x.mean !== null,
    );
    if (dependability.length >= 2 && dependability.every((x) => x.mean < UNRELIABLE_BELOW)) {
      out.unreliable.push({
        memberNo: m.memberNo,
        name: m.name,
        func: m.func,
        why: dependability.map((x) => `${UNRELIABLE_LABEL[x.no]} ${x.mean.toFixed(2)}`).join(', ') + '.',
      });
    }
  }

  const bySeverity = (a: SignatureMember, b: SignatureMember) => a.name.localeCompare(b.name);
  out.dominating.sort(bySeverity);
  out.unreliable.sort(bySeverity);
  out.disconnected.sort(bySeverity);
  return out;
}


/**
 * "Low" for the unreliable signature: under the scale's neutral middle. 3 is
 * "neither agree nor disagree", so a colleague answered with plain 3s is
 * unremarkable, not unreliable — at 3.5 a sixth of a real group was flagged.
 */
const UNRELIABLE_BELOW = 3;

/** The guide's "quietly unreliable" statements: on time, keeps their word, easy to work with. */
const UNRELIABLE_ITEMS: readonly number[] = [SOCIO_RELIABILITY_ITEM, 10, 11];
const UNRELIABLE_LABEL: Record<number, string> = { 8: 'on time', 10: 'keeps their word', 11: 'ease' };

/** The value a member must reach to sit in the top third; null for an empty group. */
function topThirdCut(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const desc = [...values].sort((a, b) => b - a);
  return desc[Math.max(0, Math.ceil(desc.length / 3) - 1)]!;
}

/** The middle value, mean of the two middles on an even count; null when empty. */
function medianOfValues(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
