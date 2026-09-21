/**
 * The Collaboration Diagnostic's facilitator report.
 *
 * This is the document a client is handed, and it has one job the console does
 * not: it is read months later, by people who were not in the room, with no
 * chance to ask what a number meant. So it explains itself as it goes.
 *
 *   cover → how to read it → where this organisation stands → the six sections
 *   → where to look first → strengths → every statement → by department
 *   → method and confidentiality
 *
 * Two of the master copy's instructions are structural here rather than
 * decorative. It asks for the average *and* the spread, so no mean is ever
 * printed alone: every statement carries the answers that produced it. And it
 * says the gap between the strongest and weakest section is the clearest
 * signal of strain, so that gap is stated in words, not left to be read off a
 * chart.
 *
 * Kept apart from socio-report.ts. That document is about a group of named
 * people who rated each other; this one is about an organisation and has no
 * members, no roster and no per-person page, and sharing the chrome would have
 * meant a conditional in every chapter.
 *
 * Everything is vector except the logo, which the caller decodes and passes in.
 */

import { BRAND_ACCENT, BRAND_COMPANY_NAME } from '../../shared/brand.js';
import { COLLAB_ITEM_BY_NO, COLLAB_SECTION_BY_KEY } from '../../shared/collab.js';
import { COLLAB_BANDS, COLLAB_MAX_TOTAL, COLLAB_MIN_TOTAL } from '../../shared/collab-scoring.js';
import type { CollabItemStat, CollabSegment } from '../../shared/collab-scoring.js';
import type { Branding } from '../../shared/types.js';
import type { EmbeddedImage } from './image.js';
import { A4, PdfDoc, measure, wrap, type StdFont } from './writer.js';

// ------------------------------------------------------------------- tokens

const T = {
  ink: '#0C1421',
  ink2: '#3D4859',
  ink3: '#616C80',
  ink4: '#8D97A6',
  ink5: '#AEB6C2',
  line: '#E4E8EE',
  line2: '#D3DAE3',
  paper: '#FFFFFF',
  surface: '#FAFBFC',
  surface2: '#F2F5F9',
  track: '#EDF1F6',
  warn: '#B54708',
  warnSoft: '#FFFAEB',
  warnLine: '#F0C77A',
} as const;

/**
 * Converted answers, 1 unhealthy to 5 healthy: two hues with a light neutral
 * midpoint, the same ramp the console uses. Validated for colour-vision
 * separation, and every band is labelled as well as coloured — a report gets
 * photocopied in greyscale.
 */
const VALUE_COLOURS = ['#8F3F08', '#D98C3F', '#D7DCE3', '#4FA57C', '#0B6B46'] as const;

/** The four bands, as ink. Always printed with their name beside them. */
const BAND_COLOURS: Record<string, string> = {
  healthy: '#0E7C5A',
  friction: '#8A6D0B',
  barriers: '#B4530E',
  breaking: '#B42318',
};

const M = { left: 56, right: 56, top: 54, bottom: 62 };
const CONTENT_W = A4.width - M.left - M.right;
const RIGHT = A4.width - M.right;
const PAGE_BOTTOM = A4.height - M.bottom;
const HEADER_BOTTOM = M.top + 48;
const BODY = { size: 9.8, leading: 15.4 } as const;

export interface CollabReportSection {
  key: string;
  short: string;
  mean: number;
  spread: number | null;
}

export interface CollabReportCut {
  label: string;
  segments: CollabSegment[];
}

export interface CollabReportPayload {
  runName: string;
  organisation: string;
  waveName: string;
  /** Respondents whose sheets were complete and scored. */
  n: number;
  incomplete: number;
  /** Ways in a facilitator issued, or 0 when the run used one shared link. */
  invited: number;
  anonymous: boolean;
  minSegment: number;
  total: number;
  perItem: number;
  bandKey: string;
  bandName: string;
  bandReading: string;
  sections: CollabReportSection[];
  items: CollabItemStat[];
  gap: { strongest: string; weakest: string; value: number };
  attention: number[];
  strengths: number[];
  split: number[];
  cuts: CollabReportCut[];
  branding: Branding;
  generatedAt: string;
}

interface Ctx {
  doc: PdfDoc;
  report: CollabReportPayload;
  accent: string;
  logo: EmbeddedImage | null;
  y: number;
}

// -------------------------------------------------------------------- entry

export function renderCollabReportPdf(
  report: CollabReportPayload,
  logo: EmbeddedImage | null = null,
): Uint8Array {
  const accent = normaliseHex(report.branding.accentColor) || BRAND_ACCENT;
  const doc = new PdfDoc(A4, {
    title: `Collaboration Diagnostic — ${report.organisation || report.runName}`,
    author: report.branding.companyName || BRAND_COMPANY_NAME,
    subject: 'Confidential group report',
  });

  const ctx: Ctx = { doc, report, accent, logo, y: M.top };

  drawCover(ctx);
  newPage(ctx);
  drawHowToRead(ctx);
  drawHeadline(ctx);
  drawSections(ctx);
  drawWhereToLook(ctx);
  drawStrengths(ctx);
  drawEveryStatement(ctx);
  drawSegments(ctx);
  drawMethod(ctx);
  drawFooters(ctx);

  return doc.build();
}

// ------------------------------------------------------------- page plumbing

function newPage(ctx: Ctx): void {
  ctx.doc.addPage();
  drawRunningHeader(ctx);
  ctx.y = HEADER_BOTTOM;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y + needed <= PAGE_BOTTOM) return;
  newPage(ctx);
}

function drawRunningHeader(ctx: Ctx): void {
  const { doc, report } = ctx;
  const y = M.top - 12;
  const company = report.branding.companyName || BRAND_COMPANY_NAME;

  doc.text(company, M.left, y + 3, { font: 'Helvetica-Bold', size: 9, color: T.ink });
  doc.text('Collaboration Diagnostic', M.left, y + 14, { size: 7.6, color: T.ink4 });

  doc.textRight('CONFIDENTIAL', RIGHT, y + 3, {
    font: 'Helvetica-Bold',
    size: 7,
    color: T.ink4,
    charSpacing: 1.1,
  });
  doc.textRight(`${report.organisation || report.runName} · ${report.waveName}`, RIGHT, y + 14, {
    size: 7.4,
    color: T.ink5,
  });
  doc.hr(M.left, y + 28, CONTENT_W, T.line);
}

function drawFooters(ctx: Ctx): void {
  const { doc, report } = ctx;
  const total = doc.pageCount;
  for (let i = 1; i < total; i++) {
    doc.onPage(i, () => {
      const y = A4.height - M.bottom + 26;
      doc.hr(M.left, y - 12, CONTENT_W, T.line);
      doc.text(
        `${report.organisation || report.runName} · ${report.waveName} · ${report.n} respondents`,
        M.left,
        y,
        { size: 7.4, color: T.ink4 },
      );
      doc.textRight(`${i + 1} of ${total}`, RIGHT, y, { size: 7.4, color: T.ink4 });
    });
  }
}

// ------------------------------------------------------------------- cover

function drawCover(ctx: Ctx): void {
  const { doc, report, accent } = ctx;
  let y = M.top + 8;

  /*
   * The mark is always the branding image the console holds — an uploaded one,
   * or the house logo it falls back to. Nothing here draws a vector stand-in:
   * a second lockup that only appears when decoding fails is a second brand
   * nobody approved.
   */
  if (ctx.logo) {
    const maxW = CONTENT_W * 0.42;
    const scale = Math.min(maxW / ctx.logo.width, 54 / ctx.logo.height);
    doc.image(ctx.logo, M.left, y, ctx.logo.width * scale, ctx.logo.height * scale);
    y += ctx.logo.height * scale + 40;
  } else {
    // No decodable image: the company's name carries the page rather than a
    // placeholder shape.
    doc.text(report.branding.companyName || BRAND_COMPANY_NAME, M.left, y, {
      font: 'Helvetica-Bold',
      size: 16,
      color: T.ink,
    });
    y += 54;
  }

  doc.text('COLLABORATION DIAGNOSTIC', M.left, y, {
    font: 'Helvetica-Bold',
    size: 8.4,
    color: accent,
    charSpacing: 1.6,
  });
  y += 26;

  const title = report.organisation || report.runName;
  for (const line of wrap(title, 'Helvetica-Bold', 30, CONTENT_W)) {
    doc.text(line, M.left, y, { font: 'Helvetica-Bold', size: 30, color: T.ink });
    y += 36;
  }

  y += 6;
  doc.text(report.waveName, M.left, y, { size: 12, color: T.ink2 });
  y += 30;

  doc.hr(M.left, y, CONTENT_W, T.line2);
  y += 22;

  // What this document is, before any number in it.
  y = paragraph(
    ctx,
    'This is a diagnostic of a collaboration system, not an assessment of the people in it. ' +
      `${report.n} leaders answered the same 24 statements about how work gets done between departments here. ` +
      'No individual is scored, named or reported, and nothing in this document describes one person.',
    y,
    { size: 10.6, leading: 17, color: T.ink2 },
  );
  y += 18;

  const facts: [string, string][] = [
    ['Respondents', String(report.n)],
    [
      'Response rate',
      report.invited > 0
        ? `${Math.round((report.n / report.invited) * 100)}% of ${report.invited} invited`
        : 'Answered through a shared link',
    ],
    ['Responses', report.anonymous ? 'Anonymous' : 'Named'],
    ['Reported', report.generatedAt],
  ];
  const colW = CONTENT_W / 2;
  facts.forEach(([label, value], i) => {
    const x = M.left + (i % 2) * colW;
    const fy = y + Math.floor(i / 2) * 44;
    doc.text(label.toUpperCase(), x, fy, {
      font: 'Helvetica-Bold',
      size: 7,
      color: T.ink4,
      charSpacing: 1.1,
    });
    doc.text(value, x, fy + 13, { font: 'Helvetica-Bold', size: 12.5, color: T.ink });
  });
  y += 44 * Math.ceil(facts.length / 2) + 12;

  doc.hr(M.left, y, CONTENT_W, T.line2);
  y += 18;
  doc.text('Confidential. Prepared for the facilitation team.', M.left, y, {
    size: 8.6,
    color: T.ink3,
  });
}

// --------------------------------------------------------------- how to read

function drawHowToRead(ctx: Ctx): void {
  heading(ctx, 'How to read this');

  ctx.y = paragraph(
    ctx,
    'Ten of the 24 statements describe good practice and fourteen describe problems, so that nobody ' +
      'could answer the whole page without reading it. Every problem statement is converted before it ' +
      'is averaged, using 6 minus the answer given. After that conversion a 5 always means healthy, ' +
      'whichever way the statement was worded, and every figure in this report is of converted scores.',
    ctx.y,
  );
  ctx.y += 10;

  ctx.y = paragraph(
    ctx,
    'Read the average and the spread together. They answer different questions: the average says how ' +
      'healthy this part of the system is, and the spread says how far the leaders disagree with each ' +
      'other about it. A statement where half the group strongly agrees and half strongly disagrees ' +
      'has the same average as one everybody is lukewarm about, and means something entirely ' +
      'different — usually a barrier that one set of functions feels sharply and another cannot see. ' +
      'Those statements are marked as split.',
    ctx.y,
  );
  ctx.y += 16;

  // The strip legend, shown once, before the first strip appears.
  const labels = ['1 unhealthy', '2', '3 neither', '4', '5 healthy'];
  let x = M.left;
  doc(ctx).text('Every statement is shown as the answers behind it:', M.left, ctx.y, {
    size: 8.4,
    color: T.ink3,
  });
  ctx.y += 16;
  labels.forEach((label, i) => {
    doc(ctx).roundRect(x, ctx.y, 11, 9, 2, VALUE_COLOURS[i]!);
    doc(ctx).text(label, x + 15, ctx.y + 1, { size: 7.6, color: T.ink3 });
    x += 15 + measure(label, 'Helvetica', 7.6) + 16;
  });
  ctx.y += 26;
}

// ----------------------------------------------------------------- headline

function drawHeadline(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'Where this organisation stands');
  ensure(ctx, 190);

  const bandColour = BAND_COLOURS[report.bandKey] ?? T.ink2;

  doc(ctx).text(String(report.total), M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 44,
    color: T.ink,
  });
  const numW = measure(String(report.total), 'Helvetica-Bold', 44);
  doc(ctx).text(`/ ${COLLAB_MAX_TOTAL}`, M.left + numW + 8, ctx.y + 22, {
    font: 'Helvetica-Bold',
    size: 14,
    color: T.ink4,
  });
  doc(ctx).text(`${report.perItem.toFixed(2)} average per statement`, M.left, ctx.y + 48, {
    size: 9,
    color: T.ink3,
  });
  doc(ctx).text(report.bandName, M.left, ctx.y + 64, {
    font: 'Helvetica-Bold',
    size: 11,
    color: bandColour,
  });

  ctx.y += 92;

  // The index on the scale it belongs to: 24 to 120, with its four bands.
  const scaleW = CONTENT_W;
  const scaleH = 26;
  const span = COLLAB_MAX_TOTAL - COLLAB_MIN_TOTAL;
  let zoneX = M.left;
  for (const band of [...COLLAB_BANDS].reverse()) {
    const w = ((band.maxTotal - band.minTotal + 1) / (span + 1)) * scaleW;
    doc(ctx).rect(zoneX, ctx.y, w, scaleH, tint(BAND_COLOURS[band.key] ?? T.ink3));
    doc(ctx).text(`${band.minTotal}–${band.maxTotal}`, zoneX + 6, ctx.y + scaleH + 6, {
      font: 'Helvetica-Bold',
      size: 7.4,
      color: T.ink2,
    });
    doc(ctx).text(band.name, zoneX + 6, ctx.y + scaleH + 16, { size: 7, color: T.ink3 });
    zoneX += w;
  }
  doc(ctx).strokeRect(M.left, ctx.y, scaleW, scaleH, T.line2, 0.6);

  const markX = M.left + ((report.total - COLLAB_MIN_TOTAL) / span) * scaleW;
  doc(ctx).rect(markX - 1, ctx.y - 8, 2, scaleH + 16, T.ink);
  doc(ctx).polygon(
    [
      [markX, ctx.y - 10],
      [markX - 5, ctx.y - 18],
      [markX + 5, ctx.y - 18],
    ],
    T.ink,
  );

  ctx.y += scaleH + 34;
  ctx.y = paragraph(ctx, report.bandReading, ctx.y, { color: T.ink2 });
  ctx.y += 6;
  ctx.y = paragraph(
    ctx,
    'The bands are the instrument’s own indicative guide rather than a hard cut-off, and this is a ' +
      `reading taken from ${report.n} people. Treat a band as a direction of travel, not a grade.`,
    ctx.y,
    { size: 8.6, leading: 13.5, color: T.ink3 },
  );
  ctx.y += 14;
}

// ----------------------------------------------------------------- sections

function drawSections(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'The six sections, strongest to weakest');

  ctx.y = paragraph(
    ctx,
    'Each bar is the section’s converted mean on the instrument’s 1 to 5 scale, so the track starts ' +
      'at 1. The thin line behind it is the spread across respondents: a long line means the leaders ' +
      'do not agree with each other about that part of the system.',
    ctx.y,
    { size: 8.8, leading: 13.5, color: T.ink3 },
  );
  ctx.y += 14;

  const ranked = [...report.sections].sort((a, b) => b.mean - a.mean);
  // Six rows plus the axis that gives them meaning. A 1-to-5 bar on a page
  // whose scale is printed overleaf is a bar with no units.
  ensure(ctx, ranked.length * 26 + 30);
  const labelW = 150;
  const trackX = M.left + labelW;
  const trackW = CONTENT_W - labelW - 54;

  for (const section of ranked) {
    ensure(ctx, 30);
    const y = ctx.y;
    doc(ctx).text(section.short, M.left, y + 2, { size: 9, color: T.ink });

    doc(ctx).roundRect(trackX, y + 5, trackW, 7, 3.5, T.track);
    for (const tick of [2, 3, 4]) {
      const tx = trackX + ((tick - 1) / 4) * trackW;
      doc(ctx).rect(tx, y + 2, 0.6, 13, T.line2);
    }
    if (section.spread !== null) {
      const lo = Math.max(1, section.mean - section.spread);
      const hi = Math.min(5, section.mean + section.spread);
      const lx = trackX + ((lo - 1) / 4) * trackW;
      const hx = trackX + ((hi - 1) / 4) * trackW;
      doc(ctx).rect(lx, y + 8, hx - lx, 1.4, '#C2D3FA');
    }
    doc(ctx).roundRect(trackX, y + 5, ((section.mean - 1) / 4) * trackW, 7, 3.5, ctx.accent);

    doc(ctx).textRight(section.mean.toFixed(2), RIGHT, y + 2, {
      font: 'Helvetica-Bold',
      size: 9.6,
      color: T.ink,
    });
    ctx.y += 26;
  }

  // The axis, stated once: a 1–5 bar that starts at 0 lies about its floor.
  doc(ctx).text('1', trackX, ctx.y, { size: 7, color: T.ink4 });
  doc(ctx).textRight('5', trackX + trackW, ctx.y, { size: 7, color: T.ink4 });
  ctx.y += 20;

  ensure(ctx, 60);
  const gap = report.gap;
  panel(ctx, 52, () => {
    doc(ctx).text('THE GAP', M.left + 14, ctx.y + 12, {
      font: 'Helvetica-Bold',
      size: 7,
      color: T.ink4,
      charSpacing: 1.1,
    });
    doc(ctx).text(
      `${gap.value.toFixed(2)} between ${gap.strongest} and ${gap.weakest}`,
      M.left + 14,
      ctx.y + 26,
      { font: 'Helvetica-Bold', size: 10.4, color: T.ink },
    );
  });
  ctx.y = paragraph(
    ctx,
    'The distance between the strongest and weakest section is usually the clearest signal of where ' +
      'the system is under strain. Compare the sections against each other rather than judging any ' +
      'one of them in isolation.',
    ctx.y + 8,
    { size: 8.6, leading: 13.5, color: T.ink3 },
  );
  ctx.y += 14;
}

// ----------------------------------------------------------- where to look

function drawWhereToLook(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'Where to look first');

  const splitItems = report.split.slice(0, 4);
  const weakest = report.attention.filter((no) => !splitItems.includes(no)).slice(0, 5);

  if (splitItems.length > 0) {
    subheading(ctx, 'The group does not agree about these');
    ctx.y = paragraph(
      ctx,
      'At least 30% of answers sit at each end of the scale. The average alone would hide this, and ' +
        'the disagreement is itself the finding: some functions are living something the others ' +
        'cannot see.',
      ctx.y,
      { size: 8.6, leading: 13.5, color: T.ink3 },
    );
    ctx.y += 10;
    for (const no of splitItems) drawItemCard(ctx, no, true);
    ctx.y += 6;
  }

  subheading(ctx, 'The lowest-scoring statements');
  for (const no of weakest) drawItemCard(ctx, no, false);
}

function drawStrengths(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'What is working');
  ctx.y = paragraph(
    ctx,
    'The highest-scoring statements. These are the parts of the system worth protecting when ' +
      'something else is changed.',
    ctx.y,
    { size: 8.6, leading: 13.5, color: T.ink3 },
  );
  ctx.y += 10;
  for (const no of report.strengths.slice(0, 5)) drawItemCard(ctx, no, false);
}

function drawItemCard(ctx: Ctx, no: number, flagSplit: boolean): void {
  const { report } = ctx;
  const item = report.items.find((i) => i.no === no);
  const statement = COLLAB_ITEM_BY_NO.get(no);
  if (!item || !statement) return;

  const textW = CONTENT_W - 32 - 142;
  const lines = wrap(statement.text, 'Helvetica', 9.2, textW);
  // The mean, the spread and the strip stack in one column, so the card has to
  // be tall enough for all three: at 58 the spread label sat on the strip.
  const height = Math.max(70, 30 + lines.length * 13);
  ensure(ctx, height + 10);

  const top = ctx.y;
  doc(ctx).roundRect(M.left, top, CONTENT_W, height, 6, T.surface);
  doc(ctx).strokeRoundRect(M.left, top, CONTENT_W, height, 6, T.line, 0.6);

  doc(ctx).text(String(no).padStart(2, '0'), M.left + 12, top + 12, {
    font: 'Helvetica-Bold',
    size: 8.4,
    color: T.ink4,
  });

  let ty = top + 11;
  for (const line of lines) {
    doc(ctx).text(line, M.left + 32, ty, { size: 9.2, color: T.ink });
    ty += 13;
  }

  const section = COLLAB_SECTION_BY_KEY.get(item.sectionKey)?.short ?? '';
  const scored = statement.direction === 'reverse' ? 'reverse scored' : 'direct';
  doc(ctx).text(`${section} · ${scored}`, M.left + 32, ty + 2, { size: 7.4, color: T.ink4 });

  if (flagSplit && item.split) {
    const label = 'SPLIT';
    const w = measure(label, 'Helvetica-Bold', 6.8) + 12;
    const bx = M.left + 32 + measure(`${section} · ${scored}`, 'Helvetica', 7.4) + 10;
    doc(ctx).roundRect(bx, ty, w, 11, 3, T.warnSoft);
    doc(ctx).strokeRoundRect(bx, ty, w, 11, 3, T.warnLine, 0.5);
    doc(ctx).text(label, bx + 6, ty + 2.6, {
      font: 'Helvetica-Bold',
      size: 6.8,
      color: T.warn,
      charSpacing: 0.8,
    });
  }

  // Figures and the strip, right-aligned in their own column.
  const stripX = M.left + CONTENT_W - 132;
  doc(ctx).textRight(item.mean.toFixed(2), RIGHT - 12, top + 10, {
    font: 'Helvetica-Bold',
    size: 12,
    color: T.ink,
  });
  doc(ctx).textRight(
    item.sd === null ? 'spread n/a' : `spread ${item.sd.toFixed(2)}`,
    RIGHT - 12,
    top + 25,
    { size: 7.2, color: T.ink3 },
  );
  drawStrip(ctx, item, stripX, top + height - 22, 120);

  ctx.y = top + height + 8;
}

/** The answers behind one statement, as a 120pt bar with its counts. */
function drawStrip(ctx: Ctx, item: CollabItemStat, x: number, y: number, width: number): void {
  const total = item.counts.reduce((t, n) => t + n, 0);
  if (total === 0) return;
  const gap = 1.2;
  let cx = x;
  item.counts.forEach((count, i) => {
    const w = (count / total) * (width - gap * 4);
    if (w <= 0) return;
    doc(ctx).roundRect(cx, y, w, 12, 1.5, VALUE_COLOURS[i]!);
    // Only label a segment wide enough to hold the number without crowding.
    if (w >= 13) {
      const label = String(count);
      doc(ctx).text(label, cx + w / 2 - measure(label, 'Helvetica-Bold', 6.4) / 2, y + 3, {
        font: 'Helvetica-Bold',
        size: 6.4,
        color: i === 2 ? T.ink2 : T.paper,
      });
    }
    cx += w + gap;
  });
}

// --------------------------------------------------------- every statement

function drawEveryStatement(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'Every statement');
  ctx.y = paragraph(
    ctx,
    'All 24, in the order they were answered, with the converted mean, the spread and the answers ' +
      'behind each one.',
    ctx.y,
    { size: 8.6, leading: 13.5, color: T.ink3 },
  );
  ctx.y += 12;

  const stripW = 104;
  const figW = 76;
  const textW = CONTENT_W - 22 - stripW - figW - 20;

  const ordered = [...report.items].sort((a, b) => a.no - b.no);
  for (const item of ordered) {
    const statement = COLLAB_ITEM_BY_NO.get(item.no);
    if (!statement) continue;
    const lines = wrap(statement.text, 'Helvetica', 8.6, textW);
    const height = Math.max(30, lines.length * 11.6 + 16);
    ensure(ctx, height);

    const top = ctx.y;
    doc(ctx).text(String(item.no).padStart(2, '0'), M.left, top + 2, {
      font: 'Helvetica-Bold',
      size: 7.6,
      color: T.ink4,
    });

    let ty = top;
    for (const line of lines) {
      doc(ctx).text(line, M.left + 22, ty, { size: 8.6, color: T.ink2 });
      ty += 11.6;
    }
    if (statement.direction === 'reverse') {
      doc(ctx).text('reverse scored', M.left + 22, ty, { size: 6.8, color: T.ink4 });
    }
    if (item.split) {
      const at = M.left + 22 + (statement.direction === 'reverse' ? 62 : 0);
      doc(ctx).text('split opinion', at, ty, { size: 6.8, color: T.warn });
    }

    drawStrip(ctx, item, M.left + 22 + textW + 16, top + 1, stripW);
    doc(ctx).textRight(item.mean.toFixed(2), RIGHT, top + 1, {
      font: 'Helvetica-Bold',
      size: 9,
      color: T.ink,
    });
    doc(ctx).textRight(item.sd === null ? '—' : item.sd.toFixed(2), RIGHT, top + 13, {
      size: 7.2,
      color: T.ink3,
    });

    ctx.y = top + height;
    doc(ctx).hr(M.left, ctx.y - 6, CONTENT_W, T.line);
  }
  ctx.y += 8;
}

// ----------------------------------------------------------------- segments

function drawSegments(ctx: Ctx): void {
  const { report } = ctx;
  if (report.cuts.length === 0) return;

  for (const cut of report.cuts) {
    heading(ctx, `By ${cut.label.toLowerCase()}`);
    ctx.y = paragraph(
      ctx,
      `Average per statement for each ${cut.label.toLowerCase()}. Anything with fewer than ` +
        `${report.minSegment} respondents is not reported: at that size an average is close enough to a ` +
        'quotation to identify who said what, which would break the confidentiality this was answered under.',
      ctx.y,
      { size: 8.6, leading: 13.5, color: T.ink3 },
    );
    ctx.y += 12;

    const nameW = 150;
    const barX = M.left + nameW;
    const barW = CONTENT_W - nameW - 46;

    for (const segment of cut.segments) {
      ensure(ctx, 28);
      const top = ctx.y;
      doc(ctx).text(segment.name, M.left, top + 1, { size: 9, color: T.ink });
      doc(ctx).text(
        `${segment.n} ${segment.n === 1 ? 'respondent' : 'respondents'}`,
        M.left,
        top + 12,
        { size: 7, color: T.ink4 },
      );

      if (segment.suppressed || segment.perItem === null) {
        doc(ctx).roundRect(barX, top + 2, barW + 46, 14, 3, T.surface2);
        doc(ctx).text(
          segment.n === 0
            ? 'Nobody from here answered'
            : `Not reported — fewer than ${report.minSegment} respondents`,
          barX + 8,
          top + 5,
          { size: 7.6, color: T.ink3 },
        );
      } else {
        doc(ctx).roundRect(barX, top + 4, barW, 7, 3.5, T.track);
        doc(ctx).roundRect(barX, top + 4, ((segment.perItem - 1) / 4) * barW, 7, 3.5, ctx.accent);
        doc(ctx).textRight(segment.perItem.toFixed(2), RIGHT, top + 1, {
          font: 'Helvetica-Bold',
          size: 9,
          color: T.ink,
        });
      }
      ctx.y = top + 26;
    }
    ctx.y += 8;
  }
}

// ------------------------------------------------------------------ method

function drawMethod(ctx: Ctx): void {
  const { report } = ctx;
  heading(ctx, 'Method and confidentiality');

  const entries: [string, string][] = [
    [
      'What was asked',
      'Twenty-four statements about how work gets done between departments, each answered on a five-point ' +
        'scale from strongly disagree to strongly agree. The statements were shown without their section ' +
        'headings, so that nobody was primed by knowing what a statement was measuring.',
    ],
    [
      'How it was scored',
      'Ten statements are worded as good practice and are used as answered. Fourteen are worded as problems ' +
        'and are converted with 6 minus the answer. After conversion a 5 always means healthy. Section ' +
        'scores are the mean of their converted statements; the total index is the sum of all 24, between ' +
        `${COLLAB_MIN_TOTAL} and ${COLLAB_MAX_TOTAL}.`,
    ],
    [
      'Spread and split opinion',
      'Spread is the standard deviation across respondents. A statement is marked split when at least 30% ' +
        'of answers sit at each end of the converted scale, which the average on its own would hide.',
    ],
    [
      'Confidentiality',
      report.anonymous
        ? `Responses were collected anonymously and are stored detached from the people who gave them. Any ` +
          `group of fewer than ${report.minSegment} respondents is withheld from the breakdowns rather than ` +
          `reported, because at that size an average identifies individuals.`
        : `Individual responses are seen only by the facilitation team and are never reported. Any group of ` +
          `fewer than ${report.minSegment} respondents is withheld from the breakdowns rather than reported, ` +
          `because at that size an average identifies individuals.`,
    ],
    [
      'What this is not',
      'This is not a psychometric norm and not a benchmark against other organisations. The bands are an ' +
        `indicative guide, and every figure here rests on ${report.n} people answering on one day. Where a ` +
        'figure is quoted elsewhere, quote the number of respondents with it.',
    ],
  ];

  for (const [title, body] of entries) {
    ensure(ctx, 60);
    doc(ctx).text(title, M.left, ctx.y, { font: 'Helvetica-Bold', size: 9.4, color: T.ink });
    ctx.y += 14;
    ctx.y = paragraph(ctx, body, ctx.y, { size: 8.8, leading: 13.6, color: T.ink2 });
    ctx.y += 12;
  }

  if (report.incomplete > 0) {
    ctx.y = paragraph(
      ctx,
      `${report.incomplete} ${report.incomplete === 1 ? 'response was' : 'responses were'} left unfinished ` +
        'and excluded: a mean taken across part of the instrument is not comparable with one taken across ' +
        'all of it.',
      ctx.y,
      { size: 8.6, leading: 13.5, color: T.ink3 },
    );
  }
}

// ------------------------------------------------------------------ helpers

function doc(ctx: Ctx): PdfDoc {
  return ctx.doc;
}

function heading(ctx: Ctx, title: string): void {
  ensure(ctx, 70);
  if (ctx.y > HEADER_BOTTOM + 4) ctx.y += 12;
  doc(ctx).text(title, M.left, ctx.y, { font: 'Helvetica-Bold', size: 15, color: T.ink });
  ctx.y += 20;
  doc(ctx).hr(M.left, ctx.y, CONTENT_W, T.line2);
  ctx.y += 14;
}

function subheading(ctx: Ctx, title: string): void {
  ensure(ctx, 40);
  doc(ctx).text(title, M.left, ctx.y, { font: 'Helvetica-Bold', size: 10, color: T.ink2 });
  ctx.y += 16;
}

function paragraph(
  ctx: Ctx,
  text: string,
  y: number,
  opts: { size?: number; leading?: number; color?: string; font?: StdFont } = {},
): number {
  const size = opts.size ?? BODY.size;
  const leading = opts.leading ?? BODY.leading;
  const font = opts.font ?? 'Helvetica';
  const lines = wrap(text, font, size, CONTENT_W);

  let cursor = y;
  for (const line of lines) {
    if (cursor + leading > PAGE_BOTTOM) {
      newPage(ctx);
      cursor = ctx.y;
    }
    doc(ctx).text(line, M.left, cursor, { size, color: opts.color ?? T.ink2, font });
    cursor += leading;
  }
  return cursor;
}

function panel(ctx: Ctx, height: number, draw: () => void): void {
  ensure(ctx, height + 8);
  doc(ctx).roundRect(M.left, ctx.y, CONTENT_W, height, 6, T.surface2);
  draw();
  ctx.y += height;
}

/** A band colour at about 15% over white, for the scale's zones. */
function tint(hexColour: string): string {
  const v = hexColour.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * 0.15 + 255 * 0.85);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function normaliseHex(value: string): string | null {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}
