/**
 * The raw ratings of one sociometry round, as the long table the facilitator
 * guide asks for (§6, step 4): one row per rater × ratee × criterion.
 *
 * Everything the console shows is computed from these rows, so this is the
 * file a neutral party re-runs the analysis from. It is kept pure — roster and
 * answers in, rows out — so the scope rules can be tested without a database.
 *
 * Scopes:
 *   whole       every rating in the round.
 *   department  ratings *received* by people in one function. The rater's own
 *               function is a column, so within- and cross-function ratings
 *               can be told apart.
 *   member      ratings received by one person.
 *
 * Self cells are never exported: the form never shows them, and a stray value
 * there is noise, not a rating.
 *
 * Rater identity is the caller's decision (`nameRaters`). When it is off, the
 * rater is written as "Rater 07" — stable within one export so rows from the
 * same rater still group, but assigned in a shuffled order that owes nothing
 * to the roster. Keying the label on roster position would undo it: the same
 * sheet lists every ratee's number beside their name, so "Rater 02" would just
 * be roster #2. For the same reason the rater number and the submission time
 * (which the console shows per person) are blanked. Function is kept, because
 * the department split is the point of the column.
 */

import { decodeCell, SOCIO_BLOCKS, SOCIO_ITEM_BY_NO, SOCIO_ITEMS, SOCIO_MAX_ANSWER, SOCIO_MIN_ANSWER } from './socio.js';

export type SocioExportScope = 'whole' | 'department' | 'member';

export interface SocioExportMember {
  no: number;
  name: string;
  func: string;
}

export interface SocioExportResponse {
  raterNo: number;
  submittedAt: string | null;
  answers: Record<number, number>;
}

export interface SocioExportRow {
  round: number;
  raterNo: number;
  raterName: string;
  raterFunc: string;
  rateeNo: number;
  rateeName: string;
  rateeFunc: string;
  itemNo: number;
  criterion: string;
  block: string;
  score: number;
  submittedAt: string;
}

export interface SocioExportOptions {
  round: number;
  scope: SocioExportScope;
  /** The ratee function, for `department`. Compared case-insensitively. */
  dept?: string;
  /** The ratee roster number, for `member`. */
  memberNo?: number;
  /** False writes "Rater 07" in place of the rater's name. */
  nameRaters: boolean;
  /**
   * Seeds the pseudonym shuffle. Random per export when left off, so labels
   * never line up across two downloads; fixed only in tests.
   */
  pseudonymSeed?: number;
}

/** The block a criterion belongs to, as a reader would name it. */
export function blockLabel(blockKey: string): string {
  if (blockKey === 'support_gap') return 'Support gap';
  return SOCIO_BLOCKS.find((b) => b.key === blockKey)?.short ?? blockKey;
}

export function pseudonym(index: number): string {
  return `Rater ${String(index).padStart(2, '0')}`;
}

/** Rater roster number → "Rater NN", in an order shuffled by the seed. */
function pseudonymMap(raterNos: readonly number[], seed: number): Map<number, string> {
  let a = seed | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = [...new Set(raterNos)].sort((x, y) => x - y);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return new Map(order.map((no, i) => [no, pseudonym(i + 1)]));
}

export function socioExportRows(
  roster: readonly SocioExportMember[],
  responses: readonly SocioExportResponse[],
  opts: SocioExportOptions,
): SocioExportRow[] {
  const byNo = new Map(roster.map((m) => [m.no, m]));
  const dept = opts.dept?.trim().toLowerCase();
  const inScope = (ratee: SocioExportMember): boolean => {
    if (opts.scope === 'department') return ratee.func.trim().toLowerCase() === dept;
    if (opts.scope === 'member') return ratee.no === opts.memberNo;
    return true;
  };

  const masks = opts.nameRaters
    ? null
    : pseudonymMap(
        responses.map((r) => r.raterNo),
        opts.pseudonymSeed ?? crypto.getRandomValues(new Uint32Array(1))[0]!,
      );

  const rows: SocioExportRow[] = [];
  for (const r of responses) {
    const rater = byNo.get(r.raterNo);
    if (!rater) continue;
    for (const [noStr, value] of Object.entries(r.answers)) {
      const { memberNo, itemNo } = decodeCell(Number(noStr));
      if (memberNo === r.raterNo) continue;
      if (!Number.isInteger(value) || value < SOCIO_MIN_ANSWER || value > SOCIO_MAX_ANSWER) continue;
      const ratee = byNo.get(memberNo);
      const item = SOCIO_ITEM_BY_NO[itemNo];
      if (!ratee || !item || !inScope(ratee)) continue;
      rows.push({
        round: opts.round,
        raterNo: masks ? 0 : rater.no,
        raterName: masks ? masks.get(rater.no)! : rater.name,
        raterFunc: rater.func,
        rateeNo: ratee.no,
        rateeName: ratee.name,
        rateeFunc: ratee.func,
        itemNo,
        criterion: item.short,
        block: blockLabel(item.blockKey),
        score: value,
        submittedAt: masks ? '' : (r.submittedAt ?? ''),
      });
    }
  }
  // Pseudonymised rows sort by the label, not by the hidden roster order.
  rows.sort(
    (a, b) =>
      a.rateeNo - b.rateeNo ||
      (masks ? a.raterName.localeCompare(b.raterName) : a.raterNo - b.raterNo) ||
      a.itemNo - b.itemNo,
  );
  return rows;
}

/** The criteria sheet: every statement exactly as it was asked. */
export function socioCriteriaRows(): { itemNo: number; short: string; text: string; block: string; polarity: string }[] {
  return SOCIO_ITEMS.map((i) => ({
    itemNo: i.no,
    short: i.short,
    text: i.text,
    block: blockLabel(i.blockKey),
    polarity: i.polarity === 'deficit' ? 'Deficit (high = wants more support)' : 'Asset (high = more)',
  }));
}
