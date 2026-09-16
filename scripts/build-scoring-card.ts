import ExcelJS from 'exceljs';
import {
  ASSET_BANDS,
  CONFIDENTIALITY,
  CONFIG,
  EXAMPLE_NOTE,
  G,
  GAP_BANDS,
  GIVES,
  HAND_WORKED,
  ITEM_NOTES,
  NOT_PRODUCED,
  PER_BLOCK,
  RANKING_CAVEAT,
  RANKING_CAVEAT_TITLE,
  RANKING_EXAMPLE,
  RANKING_HEADLINES,
  RANKING_STEPS,
  RATED_BY,
  RATING_ROWS,
  RECEIVES,
  RULES,
  SIGNALS,
  SIGNAL_ROWS,
  SOCIO_BLOCKS,
  SOCIO_DEFAULT_MIN_RATERS,
  SOCIO_ITEMS,
  SOCIO_OPENNESS_ITEM,
  SOCIO_RELIABILITY_ITEM,
  SOCIO_SUPPORT_GAP_ITEM,
  SOCIO_TIE_THRESHOLD,
  SOURCE_NOTE,
  STEPS,
  SUBTITLE,
  TOTALS,
  TWO_STEP_NOTE,
} from './scoring-card-content.js';

// ----------------------------------------------------------------- palette
const INK = 'FF16191D';
const SOFT = 'FF4A5158';
const FAINT = 'FF868E96';
const RULE = 'FFD8DCE0';
const WASH = 'FFF6F7F9';
const WHITE = 'FFFFFFFF';

const hex = (c: string) => 'FF' + c.replace('#', '').toUpperCase();

const SANS = 'Aptos';
const MONO = 'Consolas';

type Cell = ExcelJS.Cell;

function fill(cell: Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function bottom(cell: Cell, argb = RULE, style: ExcelJS.BorderStyle = 'thin') {
  cell.border = { ...(cell.border ?? {}), bottom: { style, color: { argb } } };
}

/** A sheet title block: kicker, title, and the rule under it. */
function titleBlock(ws: ExcelJS.Worksheet, title: string, sub: string, span: number) {
  ws.mergeCells(1, 1, 1, span);
  const k = ws.getCell(1, 1);
  k.value = 'COLLABORATION SOCIOMETRY · SCORING CARD';
  k.font = { name: SANS, size: 7.5, bold: true, color: { argb: FAINT } };
  k.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 16;

  ws.mergeCells(2, 1, 2, span);
  const t = ws.getCell(2, 1);
  t.value = title;
  t.font = { name: SANS, size: 15, bold: true, color: { argb: INK } };
  t.alignment = { vertical: 'middle' };
  ws.getRow(2).height = 24;

  ws.mergeCells(3, 1, 3, span);
  const s = ws.getCell(3, 1);
  s.value = sub;
  s.font = { name: SANS, size: 9.5, color: { argb: SOFT } };
  s.alignment = { vertical: 'top', wrapText: true };
  ws.getRow(3).height = 28;

  for (let c = 1; c <= span; c += 1) bottom(ws.getCell(3, c), INK, 'medium');
  ws.getRow(4).height = 7;
}

/** A column header row. Returns the next free row. */
function headerRow(ws: ExcelJS.Worksheet, row: number, labels: string[]): number {
  const r = ws.getRow(row);
  labels.forEach((label, i) => {
    const cell = r.getCell(i + 1);
    cell.value = label.toUpperCase();
    cell.font = { name: SANS, size: 7.5, bold: true, color: { argb: FAINT } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    bottom(cell, INK);
  });
  r.height = 18;
  return row + 1;
}

/** A section heading inside a sheet. */
function sectionRow(ws: ExcelJS.Worksheet, row: number, label: string, span: number): number {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = label.toUpperCase();
  c.font = { name: SANS, size: 8, bold: true, color: { argb: INK } };
  c.alignment = { vertical: 'middle' };
  ws.getRow(row).height = 20;
  bottom(c, RULE);
  return row + 1;
}

function body(cell: Cell, opts: { mono?: boolean; bold?: boolean; color?: string; size?: number } = {}) {
  cell.font = {
    name: opts.mono ? MONO : SANS,
    size: opts.size ?? 9.5,
    bold: opts.bold ?? false,
    color: { argb: opts.color ?? INK },
  };
  cell.alignment = { vertical: 'top', wrapText: true };
  bottom(cell, RULE, 'hair');
}

function dataRow(ws: ExcelJS.Worksheet, row: number, values: (string | number | null)[], monoCols: number[] = []) {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const cell = r.getCell(i + 1);
    cell.value = v;
    body(cell, { mono: monoCols.includes(i) });
    if (typeof v === 'number') cell.alignment = { vertical: 'top', horizontal: 'left' };
  });
  return row + 1;
}

// ===========================================================================
const wb = new ExcelJS.Workbook();
wb.creator = 'Assessment Platform';
wb.created = new Date();

// --------------------------------------------------------------- 1. Method
{
  const ws = wb.addWorksheet('Method', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 26 }, { width: 82 }];
  titleBlock(
    ws,
    'How a rating becomes a score',
    SUBTITLE,
    3,
  );

  let r = 5;
  r = sectionRow(ws, r, 'The pipeline', 3);
  const steps = STEPS;
  for (const [n, label, text] of steps) {
    const rr = ws.getRow(r);
    rr.getCell(1).value = n;
    body(rr.getCell(1), { mono: true, color: FAINT });
    rr.getCell(2).value = label;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = text;
    body(rr.getCell(3));
    rr.height = 34;
    r += 1;
  }

  r += 1;
  r = sectionRow(ws, r, 'Why the mean is taken in two steps', 3);
  ws.mergeCells(r, 1, r, 3);
  const note = ws.getCell(r, 1);
  note.value = TWO_STEP_NOTE;
  body(note, { color: SOFT });
  ws.getRow(r).height = 56;
  r += 2;

  r = sectionRow(ws, r, 'Configuration', 3);
  r = headerRow(ws, r, ['', 'Setting', 'Value and meaning']);
  const cfg = CONFIG;
  for (const [k, v] of cfg) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = v;
    body(rr.getCell(3));
    rr.height = 30;
    r += 1;
  }
}

// ---------------------------------------------------------------- 2. Items
{
  const ws = wb.addWorksheet('Items', { views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }] });
  ws.columns = [{ width: 5 }, { width: 22 }, { width: 74 }, { width: 20 }, { width: 11 }];
  titleBlock(
    ws,
    'The twelve statements',
    'Verbatim from the client workbook’s Instructions sheet. Item order is the workbook’s own column order.',
    5,
  );
  let r = headerRow(ws, 5, ['No', 'Short label', 'Statement', 'Block', 'Polarity']);
  for (const item of SOCIO_ITEMS) {
    const block = SOCIO_BLOCKS.find((b) => b.key === item.blockKey);
    const rr = ws.getRow(r);
    rr.getCell(1).value = item.no;
    body(rr.getCell(1), { mono: true, color: FAINT });
    rr.getCell(2).value = item.short;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = item.text;
    body(rr.getCell(3), { color: SOFT });
    rr.getCell(4).value = block ? block.name : 'Support gap (scored alone)';
    body(rr.getCell(4), { color: block ? hex(block.color) : SOFT, bold: true });
    rr.getCell(5).value = item.polarity;
    body(rr.getCell(5), { mono: true, color: item.polarity === 'deficit' ? 'FFB4530E' : FAINT });
    rr.height = item.text.length > 110 ? 44 : 30;
    if (item.no === SOCIO_SUPPORT_GAP_ITEM) for (let c = 1; c <= 5; c += 1) fill(rr.getCell(c), WASH);
    r += 1;
  }

  r += 1;
  r = sectionRow(ws, r, 'Two items that are handled unusually', 5);
  const notes = ITEM_NOTES;
  for (const [k, v] of notes) {
    const rr = ws.getRow(r);
    ws.mergeCells(r, 1, r, 2);
    rr.getCell(1).value = k;
    body(rr.getCell(1), { bold: true });
    ws.mergeCells(r, 3, r, 5);
    rr.getCell(3).value = v;
    body(rr.getCell(3), { color: SOFT });
    rr.height = 52;
    r += 1;
  }
}

// ------------------------------------------------------- 3. Blocks & bands
{
  const ws = wb.addWorksheet('Blocks & Bands', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 24 }, { width: 12 }, { width: 34 }, { width: 46 }];
  titleBlock(ws, 'Blocks, bands and the gap item', 'Four asset blocks are averaged and banded. The deficit item is banded on a scale of its own.', 5);

  let r = 5;
  r = sectionRow(ws, r, 'The four asset blocks', 5);
  r = headerRow(ws, r, ['', 'Block', 'Items', 'Reads', 'Scored as']);
  for (const b of SOCIO_BLOCKS) {
    const rr = ws.getRow(r);
    fill(rr.getCell(1), hex(b.color));
    rr.getCell(2).value = b.name;
    body(rr.getCell(2), { bold: true, color: hex(b.color) });
    rr.getCell(3).value = b.items.join(', ');
    body(rr.getCell(3), { mono: true, color: FAINT });
    rr.getCell(4).value = b.gloss;
    body(rr.getCell(4), { color: SOFT });
    rr.getCell(5).value = 'Mean of per-rater row means; banded; ties counted at threshold.';
    body(rr.getCell(5), { color: SOFT });
    rr.height = 26;
    r += 1;
  }
  const gapRow = ws.getRow(r);
  fill(gapRow.getCell(1), 'FF8A8F96');
  gapRow.getCell(2).value = 'Support gap';
  body(gapRow.getCell(2), { bold: true, color: SOFT });
  gapRow.getCell(3).value = String(SOCIO_SUPPORT_GAP_ITEM);
  body(gapRow.getCell(3), { mono: true, color: FAINT });
  gapRow.getCell(4).value = 'where the group asks for more than it gets';
  body(gapRow.getCell(4), { color: SOFT });
  gapRow.getCell(5).value = 'Scored alone. Never enters a block or the cohort mean.';
  body(gapRow.getCell(5), { color: SOFT });
  gapRow.height = 26;
  r += 2;

  r = sectionRow(ws, r, 'Bands for an asset block mean', 5);
  r = headerRow(ws, r, ['', 'Band', 'Range', 'Reading', '']);
  const bands = ASSET_BANDS;
  for (const [name, range, reading] of bands) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = name;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = range;
    body(rr.getCell(3), { mono: true, color: SOFT });
    ws.mergeCells(r, 4, r, 5);
    rr.getCell(4).value = reading;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 20;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, `Bands for the support gap (item ${SOCIO_SUPPORT_GAP_ITEM})`, 5);
  r = headerRow(ws, r, ['', 'Band', 'Range', 'Reading', '']);
  const gaps = GAP_BANDS;
  for (const [name, range, reading] of gaps) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = name;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = range;
    body(rr.getCell(3), { mono: true, color: SOFT });
    ws.mergeCells(r, 4, r, 5);
    rr.getCell(4).value = reading;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 20;
    r += 1;
  }
  r += 1;
  ws.mergeCells(r, 1, r, 5);
  const bn = ws.getCell(r, 1);
  bn.value = `Bands are read on the block mean only. A high band on a thinly rated person is still thinly rated — every figure the platform reports carries its rater count (n) beside it, and below the rater floor no profile is produced at all.`;
  body(bn, { color: SOFT });
  ws.getRow(r).height = 32;
}

// -------------------------------------------------------------- 4. Metrics
{
  const ws = wb.addWorksheet('Metrics', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 24 }, { width: 40 }, { width: 60 }];
  titleBlock(ws, 'Every figure the engine produces', 'Per member, and for the group as a whole. Nothing here is a composite: there is no single score per person and no overall ranking of people.', 4);

  let r = 5;
  r = sectionRow(ws, r, 'What a member receives', 4);
  r = headerRow(ws, r, ['', 'Figure', 'Definition', 'Note']);
  const recv = RECEIVES;
  for (const [k, d, n] of recv) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { mono: true, bold: true });
    rr.getCell(3).value = d;
    body(rr.getCell(3));
    rr.getCell(4).value = n;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 28;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'What a member gives', 4);
  r = headerRow(ws, r, ['', 'Figure', 'Definition', 'Note']);
  const give = GIVES;
  for (const [k, d, n] of give) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { mono: true, bold: true });
    rr.getCell(3).value = d;
    body(rr.getCell(3));
    rr.getCell(4).value = n;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 28;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'The group, per block', 4);
  r = headerRow(ws, r, ['', 'Figure', 'Definition', 'Note']);
  const grp = PER_BLOCK;
  for (const [k, d, n] of grp) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { mono: true, bold: true });
    rr.getCell(3).value = d;
    body(rr.getCell(3));
    rr.getCell(4).value = n;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 34;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'Group signals', 4);
  r = headerRow(ws, r, ['', 'Figure', 'Definition', 'Note']);
  const sig = SIGNALS;
  for (const [k, d, n] of sig) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { mono: true, bold: true });
    rr.getCell(3).value = d;
    body(rr.getCell(3));
    rr.getCell(4).value = n;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 28;
    r += 1;
  }
}

// ------------------------------------------------------- 5. Worked example
{
  const ws = wb.addWorksheet('Worked example', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 18 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 34 }];
  titleBlock(
    ws,
    'A six-person cohort, worked end to end',
    'Six people, built to exercise every mechanic on the other sheets. Every figure below was produced by the live scoring engine when this workbook was built — none of it is typed in.',
    8,
  );

  let r = 5;
  r = sectionRow(ws, r, 'The roster', 8);
  r = headerRow(ws, r, ['', 'Member', 'Function', 'Responded', 'Coverage', 'Possible raters', 'Suppressed', '']);
  for (const m of G.members) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = m.name;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = m.func;
    body(rr.getCell(3), { color: SOFT });
    rr.getCell(4).value = m.responded ? 'yes' : 'no';
    body(rr.getCell(4), { mono: true, color: m.responded ? INK : FAINT });
    rr.getCell(5).value = m.coverage;
    body(rr.getCell(5), { mono: true });
    rr.getCell(6).value = m.possibleRaters;
    body(rr.getCell(6), { mono: true, color: FAINT });
    rr.getCell(7).value = m.suppressed ? 'yes' : 'no';
    body(rr.getCell(7), { mono: true, color: m.suppressed ? 'FFB4530E' : FAINT });
    rr.getCell(8).value = m.coverage === 0 ? 'Nobody rated Frank, so he has no profile — and is not an isolate.' : '';
    body(rr.getCell(8), { color: SOFT });
    rr.height = 22;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'The ratings that were given', 8);
  r = headerRow(ws, r, ['', 'Target', 'Power to/with', 'Power over', 'Trust', 'Ease', `Item ${SOCIO_SUPPORT_GAP_ITEM}`, 'Rated by']);
  const givenRows = RATING_ROWS;
  for (const [target, v] of givenRows) {
    const raters = RATED_BY[target] ?? '';
    const rr = ws.getRow(r);
    rr.getCell(2).value = target;
    body(rr.getCell(2), { bold: true });
    const cells = v ? [v.powerTo, v.powerOver, v.trust, v.ease, v.gap] : ['—', '—', '—', '—', '—'];
    cells.forEach((x, i) => {
      const cell = rr.getCell(3 + i);
      cell.value = x;
      body(cell, { mono: true, color: v ? INK : FAINT });
    });
    rr.getCell(8).value = raters;
    body(rr.getCell(8), { color: SOFT });
    rr.height = 20;
    r += 1;
  }
  ws.mergeCells(r, 2, r, 8);
  const gnote = ws.getCell(r, 2);
  gnote.value = EXAMPLE_NOTE;
  body(gnote, { color: FAINT });
  ws.getRow(r).height = 30;
  r += 2;

  r = sectionRow(ws, r, 'Block means, bands and ties', 8);
  const blockNames = SOCIO_BLOCKS.map((b) => b.short);
  r = headerRow(ws, r, ['', 'Member', ...blockNames, 'Support gap', 'Authority − trust']);
  for (const m of G.members) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = m.name;
    body(rr.getCell(2), { bold: true });
    SOCIO_BLOCKS.forEach((b, i) => {
      const st = m.blocks.find((x) => x.blockKey === b.key)!;
      const cell = rr.getCell(3 + i);
      cell.value = st.mean === null ? '—' : `${st.mean.toFixed(2)}  ${st.band}  (${st.ties}/${st.n})`;
      body(cell, { mono: true, color: st.mean === null ? FAINT : hex(b.color) });
    });
    const gapCell = rr.getCell(3 + SOCIO_BLOCKS.length);
    gapCell.value = m.supportGap.mean === null ? '—' : `${m.supportGap.mean.toFixed(2)}  ${m.supportGap.band}`;
    body(gapCell, { mono: true, color: m.supportGap.mean === null ? FAINT : SOFT });
    const gCell = rr.getCell(4 + SOCIO_BLOCKS.length);
    gCell.value = m.authorityTrustGap === null ? '—' : m.authorityTrustGap.toFixed(2);
    body(gCell, { mono: true, color: m.authorityTrustGap === null ? FAINT : INK });
    rr.height = 22;
    r += 1;
  }
  ws.mergeCells(r, 2, r, 8);
  const legend = ws.getCell(r, 2);
  legend.value = 'Each block cell reads: mean · band · (ties / raters).';
  body(legend, { color: FAINT });
  ws.getRow(r).height = 18;
  r += 2;

  r = sectionRow(ws, r, 'Worked by hand: Alice’s authority-trust gap', 8);
  const hand = HAND_WORKED;
  for (const [k, v] of hand) {
    const rr = ws.getRow(r);
    ws.mergeCells(r, 2, r, 3);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    ws.mergeCells(r, 4, r, 8);
    rr.getCell(4).value = v;
    body(rr.getCell(4), { color: SOFT });
    rr.height = 32;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'What the group signals picked up', 8);
  r = headerRow(ws, r, ['', 'Signal', 'Who', '', '', 'Why', '', '']);
  const sigRows = SIGNAL_ROWS;
  for (const [label, who, why] of sigRows) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = label;
    body(rr.getCell(2), { bold: true });
    ws.mergeCells(r, 3, r, 5);
    rr.getCell(3).value = who;
    body(rr.getCell(3), { mono: true });
    ws.mergeCells(r, 6, r, 8);
    rr.getCell(6).value = why;
    body(rr.getCell(6), { color: SOFT });
    rr.height = 30;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'The group figures', 8);
  r = headerRow(ws, r, ['', 'Block', 'Ties', 'Density', 'Reciprocity', 'Concentration', '', 'Most connected']);
  for (const n of G.networks) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = n.name;
    body(rr.getCell(2), { bold: true, color: hex(n.color) });
    rr.getCell(3).value = n.ties;
    body(rr.getCell(3), { mono: true });
    rr.getCell(4).value = n.density === null ? '—' : n.density.toFixed(2);
    body(rr.getCell(4), { mono: true });
    rr.getCell(5).value = n.reciprocity === null ? '—' : n.reciprocity.toFixed(2);
    body(rr.getCell(5), { mono: true });
    rr.getCell(6).value = n.concentration === null ? '—' : n.concentration.toFixed(2);
    body(rr.getCell(6), { mono: true });
    rr.getCell(8).value = n.ranked[0] ? `${n.ranked[0].name} (tie rate ${n.ranked[0].tieRate === null ? '—' : n.ranked[0].tieRate!.toFixed(2)})` : '—';
    body(rr.getCell(8), { color: SOFT });
    rr.height = 22;
    r += 1;
  }
  r += 1;

  r = headerRow(ws, r, ['', 'Cohort figure', 'Value', '', '', '', '', 'Meaning']);
  const totals = TOTALS;
  for (const [k, v, meaning] of totals) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = v;
    body(rr.getCell(3), { mono: true });
    ws.mergeCells(r, 8, r, 8);
    rr.getCell(8).value = meaning;
    body(rr.getCell(8), { color: SOFT });
    rr.height = 20;
    r += 1;
  }
}

// ------------------------------------------------------------ 6. Guardrails
{
  const ws = wb.addWorksheet('Guardrails', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 34 }, { width: 92 }];
  titleBlock(ws, 'Rules the engine will not bend', 'These are enforced in code, not by convention, and each is covered by a unit test.', 3);

  let r = 5;
  r = sectionRow(ws, r, 'How data is treated', 3);
  const rules = RULES;
  for (const [k, v] of rules) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = v;
    body(rr.getCell(3), { color: SOFT });
    rr.height = 46;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'Confidentiality', 3);
  const conf = CONFIDENTIALITY;
  for (const [k, v] of conf) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = v;
    body(rr.getCell(3), { color: SOFT });
    rr.height = 40;
    r += 1;
  }
  r += 1;

  r = sectionRow(ws, r, 'What the engine deliberately does not produce', 3);
  const nots = NOT_PRODUCED;
  for (const [k, v] of nots) {
    const rr = ws.getRow(r);
    rr.getCell(2).value = k;
    body(rr.getCell(2), { bold: true });
    rr.getCell(3).value = v;
    body(rr.getCell(3), { color: SOFT });
    rr.height = 36;
    r += 1;
  }
  r += 1;

  ws.mergeCells(r, 2, r, 3);
  const src = ws.getCell(r, 2);
  src.value = SOURCE_NOTE;
  body(src, { mono: true, color: FAINT, size: 8.5 });
  ws.getRow(r).height = 30;
}

const out = process.argv[2] ?? 'sociometry-scoring-card.xlsx';
await wb.xlsx.writeFile(out);
console.log('WROTE', out);
