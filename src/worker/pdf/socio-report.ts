/**
 * Cohort report document.
 *
 * One entry point, `renderCohortReportPdf`, switches on the payload tag and
 * lays out either the facilitator's group report or one leader's peer-feedback
 * report:
 *
 *   cover  ->  how to read this  ->  chapters  ->  method and confidentiality
 *
 * Kept separate from `report.ts` rather than added to it as a third branch.
 * That file's cover, tiles and running header are built around a named
 * candidate and a completion date, and a group report has neither -- it is
 * about a cohort, its date is the day it was generated, and its confidentiality
 * line has to say something different. Sharing the chrome would have meant
 * making every one of those a conditional.
 *
 * Everything is vector except the logo, which the caller decodes and passes in.
 */

import { BRAND_ACCENT, BRAND_COMPANY_NAME } from '../../shared/brand.js';
import type {
  CohortReportPayload,
  SocioGroupReportPayload,
  SocioMemberReportPayload,
} from '../../shared/types.js';
import type { SocioBlockNetwork } from '../../shared/socio-scoring.js';
import { SOCIO_MAX_ANSWER, SOCIO_SCALE_LABELS } from '../../shared/socio.js';
import type { EmbeddedImage } from './image.js';
import { drawLogoLockup, drawRibbon } from './report.js';
import { A4, PdfDoc, measure, wrap, type StdFont } from './writer.js';

// ------------------------------------------------------------------- tokens

const T = {
  ink: '#0C1421',
  ink2: '#3D4859',
  ink3: '#6A7688',
  ink4: '#8D97A6',
  ink5: '#AEB6C2',
  line: '#E4E8EE',
  line2: '#D3DAE3',
  paper: '#FFFFFF',
  surface: '#FAFBFC',
  surface2: '#F2F5F9',
  warn: '#B54708',
  warnSoft: '#FFFAEB',
  warnLine: '#F0C77A',
  warnInk: '#6E3708',
  good: '#0E7C5A',
  track: '#EDF1F6',
} as const;

const M = { left: 56, right: 56, top: 54, bottom: 62 };
const CONTENT_W = A4.width - M.left - M.right;
const RIGHT = A4.width - M.right;
const PAGE_BOTTOM = A4.height - M.bottom;
const HEADER_BOTTOM = M.top + 48;

const BODY = { size: 9.8, leading: 15.4 } as const;

const HEADER_LOGO_MAX_W = 132;
const COVER_LOGO_MAX_W = CONTENT_W * 0.5;

interface Ctx {
  doc: PdfDoc;
  report: CohortReportPayload;
  accent: string;
  logo: EmbeddedImage | null;
  y: number;
}

// -------------------------------------------------------------------- entry

export function renderCohortReportPdf(
  report: CohortReportPayload,
  logo: EmbeddedImage | null = null,
): Uint8Array {
  const accent = normaliseHex(report.branding.accentColor) || BRAND_ACCENT;
  const doc = new PdfDoc(A4, {
    title: `${report.assessmentName} — ${documentSubject(report)}`,
    author: report.branding.companyName || BRAND_COMPANY_NAME,
    subject: report.kind === 'socio_group' ? 'Confidential group report' : 'Confidential peer feedback report',
  });

  const ctx: Ctx = { doc, report, accent, logo, y: M.top };

  drawCover(ctx);
  newPage(ctx);
  drawSummary(ctx);

  if (report.kind === 'socio_group') {
    drawGroupChapters(ctx, report);
  } else {
    drawMemberChapters(ctx, report);
  }

  drawMethod(ctx);
  drawFooters(ctx);
  return doc.build();
}

function documentSubject(report: CohortReportPayload): string {
  return report.kind === 'socio_group' ? report.cohortName : report.member.name;
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
  const markW = drawMark(ctx, M.left, y, 22);
  const company = report.branding.companyName || BRAND_COMPANY_NAME;

  doc.text(company, M.left + markW + 9, y + 3, { font: 'Helvetica-Bold', size: 9, color: T.ink });
  doc.text(report.assessmentName, M.left + markW + 9, y + 14, { size: 7.6, color: T.ink4 });

  doc.textRight('CONFIDENTIAL', RIGHT, y + 3, {
    font: 'Helvetica-Bold',
    size: 7,
    color: T.ink4,
    charSpacing: 1.1,
  });
  doc.textRight(`Ref ${refCode(ctx)}`, RIGHT, y + 14, { size: 7.4, color: T.ink5 });

  doc.hr(M.left, M.top + 24, CONTENT_W, T.line, 0.7);
}

function drawFooters(ctx: Ctx): void {
  const { doc, report } = ctx;
  const total = doc.pageCount;
  const company = report.branding.companyName || BRAND_COMPANY_NAME;
  const who =
    report.kind === 'socio_group'
      ? `Confidential — prepared for the facilitators of ${report.cohortName}`
      : `Confidential — prepared for ${report.member.name}`;

  // A cohort name is a sentence ("Acme Pharma leadership, Sept 2026"), not a
  // person's name, so the left-hand footer runs into the centred company mark
  // unless it is held to its own half of the page.
  const companyW = measure(company, 'Helvetica-Bold', 7.4);
  const whoMax = A4.width / 2 - companyW / 2 - M.left - 14;

  for (let i = 0; i < total; i++) {
    doc.onPage(i, () => {
      const y = A4.height - 44;
      doc.hr(M.left, y, CONTENT_W, i === 0 ? T.line2 : T.line, 0.6);
      doc.text(truncate(who, 'Helvetica', 7.4, whoMax), M.left, y + 10, { size: 7.4, color: T.ink4 });
      doc.textCentre(company, A4.width / 2, y + 10, { font: 'Helvetica-Bold', size: 7.4, color: T.ink4 });
      doc.textRight(`Page ${i + 1} of ${total}`, RIGHT, y + 10, { size: 7.4, color: T.ink4 });
    });
  }
}

// --------------------------------------------------------------------- cover

function drawCover(ctx: Ctx): void {
  const { doc, report, accent } = ctx;

  doc.rect(0, 0, A4.width, 6, accent);
  doc.rect(0, A4.height - 190, A4.width, 190, T.surface);
  doc.hr(0, A4.height - 190, A4.width, T.line, 0.7);

  let y = M.top + 34;
  y = drawCoverLogo(ctx, M.left, y) + 26;

  doc.text(
    report.kind === 'socio_group' ? 'GROUP REPORT' : 'PEER FEEDBACK REPORT',
    M.left,
    y,
    { font: 'Helvetica-Bold', size: 8, color: accent, charSpacing: 1.6 },
  );
  y += 22;

  const titleSize = fitSize(report.assessmentName, 'Helvetica-Bold', 30, CONTENT_W);
  doc.text(report.assessmentName, M.left, y, { font: 'Helvetica-Bold', size: titleSize, color: T.ink });
  y += titleSize + 12;

  const subject = documentSubject(report);
  const subjectSize = fitSize(subject, 'Helvetica', 17, CONTENT_W);
  doc.text(subject, M.left, y, { size: subjectSize, color: T.ink2 });
  y += subjectSize + 10;

  if (report.organisation) {
    doc.text(report.organisation, M.left, y, { size: 11, color: T.ink3 });
    y += 24;
  } else {
    y += 12;
  }

  doc.hr(M.left, y, 92, accent, 2.2);
  y += 26;

  const lede =
    report.kind === 'socio_group'
      ? 'How power and trust actually move through this group, read from what its members said about one another. Every figure is an aggregate; no response is attributable to any individual.'
      : 'How colleagues who work with you describe that experience, averaged across everyone who had a basis to judge. Nothing here is any one person’s answer.';
  y = doc.paragraph(lede, M.left, y, CONTENT_W * 0.82, { size: 10.6, color: T.ink2, leading: 16.6 });

  // Fact strip.
  const facts: [string, string][] =
    report.kind === 'socio_group'
      ? [
          ['Group', report.cohortName],
          ['Responses', `${report.group.respondents} of ${report.group.rosterSize}`],
          ['Ratings given', String(report.group.ratingsGiven)],
          ['Generated', formatDate(report.generatedAt)],
        ]
      : [
          ['Group', report.cohortName],
          ['Rated by', `${report.member.coverage} of ${report.member.possibleRaters}`],
          ['Function', report.member.func || '—'],
          ['Generated', formatDate(report.generatedAt)],
        ];

  const stripY = A4.height - 158;
  const colW = CONTENT_W / facts.length;
  facts.forEach(([label, value], i) => {
    const x = M.left + i * colW;
    doc.text(label.toUpperCase(), x, stripY, {
      font: 'Helvetica-Bold',
      size: 7,
      color: T.ink4,
      charSpacing: 1.2,
    });
    doc.text(truncate(value, 'Helvetica-Bold', 11, colW - 12), x, stripY + 16, {
      font: 'Helvetica-Bold',
      size: 11,
      color: T.ink,
    });
  });

  doc.hr(M.left, stripY + 40, CONTENT_W, T.line2, 0.6);
  doc.paragraph(ctx.report.confidentiality, M.left, stripY + 54, CONTENT_W, {
    size: 7.8,
    color: T.ink3,
    leading: 11.6,
  });
}

// ----------------------------------------------------------------- summary

function drawSummary(ctx: Ctx): void {
  const { doc, report, accent } = ctx;

  sectionHead(ctx, 'At a glance', report.kind === 'socio_group' ? 'The group in one paragraph' : 'Your profile in one paragraph');

  const boxTop = ctx.y;
  const inner = CONTENT_W - 36;
  const h = doc.paragraphHeight(report.summary, inner, { size: 10.2, leading: 16.2 }) + 34;

  doc.roundRect(M.left, boxTop, CONTENT_W, h, 8, T.surface);
  doc.rect(M.left, boxTop, 3.5, h, accent);
  doc.paragraph(report.summary, M.left + 22, boxTop + 20, inner, {
    size: 10.2,
    color: T.ink2,
    leading: 16.2,
  });
  ctx.y = boxTop + h + 22;

  const tiles = statTiles(report, accent);
  ctx.y = drawStatTiles(doc, M.left, ctx.y, CONTENT_W, tiles) + 24;
}

interface Tile {
  label: string;
  value: string;
  note: string;
  color: string;
}

function statTiles(report: CohortReportPayload, accent: string): Tile[] {
  if (report.kind === 'socio_group') {
    const g = report.group;
    const trust = g.networks.find((n) => n.blockKey === 'trust');
    return [
      {
        label: 'Response rate',
        value: pct(g.responseRate),
        note: `${g.respondents} of ${g.rosterSize} members`,
        color: accent,
      },
      {
        label: 'Working contact',
        value: pct(g.acquaintance),
        note: 'of possible pairs rated',
        color: T.ink2,
      },
      {
        label: 'Trust ties',
        value: pct(trust?.density ?? null),
        note: `of rated pairs at ${g.tieThreshold}+`,
        color: T.good,
      },
      {
        label: 'Trust concentration',
        value: trust?.concentration === null || trust?.concentration === undefined ? '—' : trust.concentration.toFixed(2),
        note: '0 = spread, 1 = one person',
        color: T.ink2,
      },
    ];
  }

  const m = report.member;
  const trust = m.blocks.find((b) => b.blockKey === 'trust');
  const powerTo = m.blocks.find((b) => b.blockKey === 'power_to');
  return [
    { label: 'Rated by', value: String(m.coverage), note: `of ${m.possibleRaters} colleagues`, color: accent },
    {
      label: 'Trust',
      value: trust?.mean === null || trust?.mean === undefined ? '—' : trust.mean.toFixed(2),
      note: `of ${SOCIO_MAX_ANSWER}`,
      color: T.good,
    },
    {
      label: 'Enabling power',
      value: powerTo?.mean === null || powerTo?.mean === undefined ? '—' : powerTo.mean.toFixed(2),
      note: `of ${SOCIO_MAX_ANSWER}`,
      color: T.ink2,
    },
    {
      label: 'You rated',
      value: String(m.given.outDegree),
      note: 'colleagues',
      color: T.ink2,
    },
  ];
}

function drawStatTiles(doc: PdfDoc, x: number, y: number, width: number, tiles: Tile[]): number {
  const gap = 12;
  const w = (width - gap * (tiles.length - 1)) / tiles.length;
  const h = 74;

  tiles.forEach((t, i) => {
    const tx = x + i * (w + gap);
    doc.roundRect(tx, y, w, h, 7, T.paper);
    doc.strokeRoundRect(tx, y, w, h, 7, T.line, 0.7);
    doc.rect(tx + 12, y + 13, 22, 2.4, t.color);
    doc.text(t.label.toUpperCase(), tx + 12, y + 24, {
      font: 'Helvetica-Bold',
      size: 6.8,
      color: T.ink4,
      charSpacing: 1,
    });
    doc.text(t.value, tx + 12, y + 38, { font: 'Helvetica-Bold', size: 19, color: T.ink });
    doc.text(truncate(t.note, 'Helvetica', 7.4, w - 24), tx + 12, y + 60, { size: 7.4, color: T.ink4 });
  });

  return y + h;
}

// ------------------------------------------------------------ group chapters

function drawGroupChapters(ctx: Ctx, report: SocioGroupReportPayload): void {
  drawHowToRead(ctx, report);
  drawNetworks(ctx, report);
  drawAuthorityTrust(ctx, report);
  drawSupportGaps(ctx, report);
  drawFunctionSeams(ctx, report);
  drawCoverage(ctx, report);
}

function drawHowToRead(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  ensure(ctx, 220);
  sectionHead(ctx, 'What was asked', 'Twelve statements, in four groups');

  ctx.y = doc.paragraph(
    `Every member rated every colleague they had a basis to judge on twelve statements, from 1 (${SOCIO_SCALE_LABELS[0]}) to ${SOCIO_MAX_ANSWER} (${SOCIO_SCALE_LABELS[SOCIO_MAX_ANSWER - 1]}). Leaving a colleague blank was explicitly allowed and means "we don't really work together" — those blanks are not treated as low scores, and they are what the working-contact figure measures.`,
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  for (const block of report.blocks) {
    const itemLines = report.items.filter((i) => block.items.includes(i.no)).map((i) => i.short);
    const h = 44;
    ensure(ctx, h + 10);
    doc.roundRect(M.left, ctx.y, CONTENT_W, h, 6, T.surface);
    doc.rect(M.left, ctx.y, 3, h, block.color);
    doc.text(block.name, M.left + 16, ctx.y + 15, { font: 'Helvetica-Bold', size: 9.6, color: T.ink });
    doc.text(block.gloss, M.left + 16 + measure(block.name, 'Helvetica-Bold', 9.6) + 8, ctx.y + 15, {
      size: 8.4,
      color: T.ink4,
    });
    doc.text(truncate(itemLines.join('  ·  '), 'Helvetica', 8.4, CONTENT_W - 32), M.left + 16, ctx.y + 31, {
      size: 8.4,
      color: T.ink3,
    });
    ctx.y += h + 8;
  }

  // The deficit item is called out rather than folded into a block, because
  // averaging it with "easy to work with" would cancel a real signal against
  // its own opposite.
  const gapItem = report.items.find((i) => i.polarity === 'deficit');
  if (gapItem) {
    ensure(ctx, 56);
    drawNote(
      ctx,
      'Reported separately',
      `"${gapItem.short}" is the one statement where a high score is a request rather than a strength, so it is never averaged into the four groups above. It is reported on its own as a support gap.`,
    );
  }
  ctx.y += 10;
}

function drawNetworks(ctx: Ctx, report: SocioGroupReportPayload): void {
  const g = report.group;

  ensure(ctx, 120);
  sectionHead(ctx, 'The four networks', `A tie is drawn where a colleague rated someone ${g.tieThreshold} or above`);

  for (const net of g.networks) drawNetworkBlock(ctx, net);
}

function drawNetworkBlock(ctx: Ctx, net: SocioBlockNetwork): void {
  const { doc } = ctx;
  const shown = net.ranked.filter((r) => r.tieRate !== null).slice(0, 8);
  const rowH = 17;
  const headH = 62;
  const needed = headH + Math.max(1, shown.length) * rowH + 26;
  ensure(ctx, needed);

  const top = ctx.y;
  doc.roundRect(M.left, top, CONTENT_W, needed - 12, 8, T.paper);
  doc.strokeRoundRect(M.left, top, CONTENT_W, needed - 12, 8, T.line, 0.7);
  doc.rect(M.left, top, CONTENT_W, 3, net.color);

  doc.text(net.name, M.left + 16, top + 20, { font: 'Helvetica-Bold', size: 11, color: T.ink });

  const stats: { label: string; value: string }[] = [
    { label: 'Density', value: pct(net.density) },
    { label: 'Reciprocity', value: pct(net.reciprocity) },
    { label: 'Concentration', value: net.concentration === null ? '—' : net.concentration.toFixed(2) },
  ];
  let sx = RIGHT - 16;
  for (const { label, value } of [...stats].reverse()) {
    const vw = measure(value, 'Helvetica-Bold', 10);
    const lw = measure(label, 'Helvetica', 7);
    const boxW = Math.max(vw, lw) + 18;
    sx -= boxW;
    doc.textCentre(value, sx + boxW / 2, top + 14, { font: 'Helvetica-Bold', size: 10, color: T.ink });
    doc.textCentre(label, sx + boxW / 2, top + 27, { size: 7, color: T.ink4 });
  }

  doc.text(
    `${net.ties} ties across ${net.ratedPairs} rated pairs · reciprocity measured on ${net.mutualPairs} mutually-rated pairs`,
    M.left + 16,
    top + 38,
    { size: 7.6, color: T.ink4 },
  );
  doc.hr(M.left + 16, top + 50, CONTENT_W - 32, T.line, 0.6);

  let y = top + headH;
  const nameW = 150;
  const barX = M.left + 16 + nameW + 10;
  const barW = RIGHT - 16 - 52 - barX;

  if (shown.length === 0) {
    doc.text('No one in this group was rated on these statements.', M.left + 16, y + 2, {
      size: 8.4,
      color: T.ink4,
    });
  }

  for (const r of shown) {
    const rate = r.tieRate ?? 0;
    doc.text(truncate(r.name, 'Helvetica', 8.6, nameW), M.left + 16, y, { size: 8.6, color: T.ink2 });
    doc.roundRect(barX, y - 1, barW, 8, 4, T.track);
    if (rate > 0) doc.roundRect(barX, y - 1, Math.max(4, barW * rate), 8, 4, net.color);
    doc.textRight(`${r.ties} · ${pct(r.tieRate)}`, RIGHT - 16, y, { size: 8, color: T.ink3 });
    y += rowH;
  }

  ctx.y = top + needed;
}

function drawAuthorityTrust(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const g = report.group;

  ensure(ctx, 150);
  sectionHead(ctx, 'Authority and trust', 'Where the two come apart');

  ctx.y = doc.paragraph(
    'Power-over minus trust, per person. A positive figure means colleagues adjust to that person more readily than they rely on them; a negative one means they are relied on without the leverage to act on it. Both are worth a conversation, and neither is a fault.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const colW = (CONTENT_W - 16) / 2;
  const lists: { title: string; color: string; entries: { name: string; gap: number }[] }[] = [
    { title: 'Complied with, more than relied on', color: T.warn, entries: g.authorityWithoutTrust },
    { title: 'Relied on, more than deferred to', color: T.good, entries: g.trustWithoutAuthority },
  ];

  const rows = Math.max(...lists.map((l) => l.entries.length), 1);
  const h = 40 + rows * 18;
  ensure(ctx, h + 10);

  lists.forEach(({ title, color, entries }, i) => {
    const x = M.left + i * (colW + 16);
    doc.roundRect(x, ctx.y, colW, h, 7, T.surface);
    doc.rect(x, ctx.y, 3, h, color);
    doc.text(title, x + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });

    let y = ctx.y + 36;
    if (entries.length === 0) {
      doc.text('None at this threshold.', x + 14, y, { size: 8.4, color: T.ink4 });
    }
    for (const e of entries) {
      doc.text(truncate(e.name, 'Helvetica', 8.6, colW - 70), x + 14, y, { size: 8.6, color: T.ink2 });
      doc.textRight(signed(e.gap), x + colW - 14, y, { font: 'Helvetica-Bold', size: 8.6, color });
      y += 18;
    }
  });

  ctx.y += h + 20;
}

function drawSupportGaps(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const gaps = report.group.supportGaps;

  ensure(ctx, 120);
  sectionHead(ctx, 'Where more is wanted', 'The one statement where a high score is a request');

  ctx.y = doc.paragraph(
    'Colleagues were asked whether they would like more support or cooperation than they currently get. A high figure here is not a verdict on the person named: it is most often a load problem, an unclear boundary, or a queue nobody owns.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 12;

  if (gaps.length === 0) {
    doc.text('No reportable support gaps at this coverage.', M.left, ctx.y, { size: 8.8, color: T.ink4 });
    ctx.y += 24;
    return;
  }

  const rowH = 20;
  ensure(ctx, gaps.length * rowH + 20);
  const barX = M.left + 170;
  const barW = RIGHT - 74 - barX;

  for (const gp of gaps) {
    doc.text(truncate(gp.name, 'Helvetica', 8.8, 160), M.left, ctx.y, { size: 8.8, color: T.ink2 });
    doc.roundRect(barX, ctx.y - 1, barW, 8, 4, T.track);
    doc.roundRect(barX, ctx.y - 1, Math.max(4, (barW * gp.mean) / SOCIO_MAX_ANSWER), 8, 4, T.warn);
    doc.textRight(`${gp.mean.toFixed(2)}  (n=${gp.n})`, RIGHT, ctx.y, { size: 8, color: T.ink3 });
    ctx.y += rowH;
  }
  ctx.y += 12;
}

function drawFunctionSeams(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const g = report.group;
  const fns = g.functions;

  if (fns.length < 2) return;

  // Beyond about eight functions the cells stop being readable at A4, so the
  // matrix gives way to a plain statement rather than an unreadable grid.
  const drawable = fns.length <= 8;

  ensure(ctx, 170);
  sectionHead(ctx, 'Seams between functions', 'Mean trust, from the row’s function to the column’s');

  if (!drawable) {
    doc.paragraph(
      `This group spans ${fns.length} functions, too many to render as a legible grid at this page size. The function-by-function figures are available in the console export.`,
      M.left,
      ctx.y,
      CONTENT_W,
      { size: BODY.size, color: T.ink2, leading: BODY.leading },
    );
    ctx.y += 40;
    return;
  }

  const labelW = 96;
  const cellW = (CONTENT_W - labelW) / fns.length;
  const cellH = 22;
  const needed = cellH * (fns.length + 1) + 26;
  ensure(ctx, needed);

  const top = ctx.y;
  fns.forEach((f, i) => {
    doc.textCentre(truncate(f, 'Helvetica-Bold', 6.8, cellW - 4), M.left + labelW + i * cellW + cellW / 2, top, {
      font: 'Helvetica-Bold',
      size: 6.8,
      color: T.ink4,
    });
  });

  fns.forEach((from, r) => {
    const y = top + 12 + r * cellH;
    doc.text(truncate(from, 'Helvetica', 7.6, labelW - 8), M.left, y + 8, { size: 7.6, color: T.ink3 });
    fns.forEach((to, cIdx) => {
      const cell = g.functionMatrix.find((x) => x.from === from && x.to === to);
      const x = M.left + labelW + cIdx * cellW;
      const value = cell?.trust ?? null;
      doc.rect(x + 1, y, cellW - 2, cellH - 2, value === null ? T.surface2 : heat(value));
      doc.textCentre(
        value === null ? '—' : value.toFixed(1),
        x + cellW / 2,
        y + 6,
        { font: 'Helvetica-Bold', size: 7.6, color: value !== null && value >= 4 ? T.paper : T.ink2 },
      );
    });
  });

  ctx.y = top + 12 + fns.length * cellH + 12;
  doc.text(
    'Darker is more trust. A blank cell means nobody in that row’s function had a basis to rate anybody in the column’s — itself a seam.',
    M.left,
    ctx.y,
    { size: 7.4, color: T.ink4 },
  );
  ctx.y += 22;
}

function drawCoverage(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const g = report.group;

  ensure(ctx, 140);
  sectionHead(ctx, 'Coverage and what was withheld', 'Who this report could and could not describe');

  const lines: string[] = [];
  lines.push(
    `${g.respondents} of ${g.rosterSize} members responded. Between them they gave ${g.ratingsGiven} ratings, ${pct(g.acquaintance)} of the pairs they could have rated.`,
  );

  if (g.underCovered.length > 0) {
    lines.push(
      `${g.underCovered.length} ${g.underCovered.length === 1 ? 'member was' : 'members were'} rated by fewer than ${g.minRaters} colleagues, so no individual profile was produced for them: ${g.underCovered.map((m) => `${m.name} (${m.coverage})`).join(', ')}.`,
    );
  } else {
    lines.push(`Every member was rated by at least ${g.minRaters} colleagues, so no profile was withheld.`);
  }

  if (g.isolates.length > 0) {
    lines.push(
      `${g.isolates.map((m) => m.name).join(', ')} ${g.isolates.length === 1 ? 'was' : 'were'} rated, but by nobody at or above the tie threshold on any of the four groups. That is a real finding about connection, not a low score.`,
    );
  }

  for (const line of lines) {
    ensure(ctx, 40);
    ctx.y = doc.paragraph(line, M.left, ctx.y, CONTENT_W, {
      size: BODY.size,
      color: T.ink2,
      leading: BODY.leading,
    }) + 8;
  }
  ctx.y += 10;
}

// ----------------------------------------------------------- member chapters

function drawMemberChapters(ctx: Ctx, report: SocioMemberReportPayload): void {
  if (report.suppressed) {
    drawSuppressed(ctx, report);
    return;
  }
  drawMemberProfile(ctx, report);
  drawMemberItems(ctx, report);
  drawMemberGiven(ctx, report);
}

function drawSuppressed(ctx: Ctx, report: SocioMemberReportPayload): void {
  ensure(ctx, 160);
  sectionHead(ctx, 'No profile in this report', 'Too few colleagues had a basis to judge');
  drawNote(
    ctx,
    'Withheld deliberately',
    `${report.member.name} was rated by ${report.member.coverage} of ${report.member.possibleRaters} colleagues, below the ${report.groupContext.minRaters}-rater floor this group set. Reporting an average of one or two responses in a named group of this size would identify who gave them, which is the one thing every participant was promised would not happen. Nothing has gone wrong, and nothing is being kept from you: the numbers simply do not exist in a reportable form.`,
  );
  ctx.y += 12;
}

function drawMemberProfile(ctx: Ctx, report: SocioMemberReportPayload): void {
  const { doc } = ctx;

  ensure(ctx, 210);
  sectionHead(ctx, 'How colleagues describe working with you', `Compared with the rest of ${report.cohortName}`);

  const rowH = 34;
  const needed = report.context.length * rowH + 20;
  ensure(ctx, needed);

  const labelW = 132;
  const barX = M.left + labelW;
  const barW = RIGHT - 96 - barX;

  for (const c of report.context) {
    const value = c.memberMean ?? 0;
    const cohort = c.cohortMean;

    doc.text(c.name, M.left, ctx.y, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
    doc.text(
      c.delta === null ? 'no comparison' : `${signed(c.delta)} vs group`,
      M.left,
      ctx.y + 13,
      { size: 7.4, color: c.delta !== null && c.delta < 0 ? T.warn : T.ink4 },
    );

    doc.roundRect(barX, ctx.y - 1, barW, 11, 5.5, T.track);
    if (c.memberMean !== null) {
      doc.roundRect(barX, ctx.y - 1, Math.max(5, (barW * value) / SOCIO_MAX_ANSWER), 11, 5.5, c.color);
    }

    // The group's own level, as a tick on the same track.
    if (cohort !== null) {
      const tx = barX + (barW * cohort) / SOCIO_MAX_ANSWER;
      doc.rect(tx - 0.7, ctx.y - 5, 1.4, 19, T.ink3);
      doc.textCentre('group', tx, ctx.y + 18, { size: 6.4, color: T.ink4 });
    }

    doc.textRight(c.memberMean === null ? '—' : c.memberMean.toFixed(2), RIGHT, ctx.y, {
      font: 'Helvetica-Bold',
      size: 10,
      color: T.ink,
    });
    ctx.y += rowH;
  }

  ctx.y += 6;
  ensure(ctx, 60);
  const gap = report.member.supportGap;
  drawNote(
    ctx,
    'Support asked for',
    gap.mean === null
      ? 'No colleague answered the support statement about you, so there is nothing to report here.'
      : `Colleagues rated "I would like more support or cooperation from this person than I currently get" at ${gap.mean.toFixed(2)} of ${SOCIO_MAX_ANSWER} (${gap.n} ${gap.n === 1 ? 'rater' : 'raters'}) — ${gap.band === 'Marked' ? 'a clear request' : gap.band === 'Some' ? 'a moderate request' : 'little unmet demand'}. This is the one statement where a high number is a request rather than a strength.`,
  );
  ctx.y += 12;
}

function drawMemberItems(ctx: Ctx, report: SocioMemberReportPayload): void {
  const { doc } = ctx;

  ensure(ctx, 160);
  sectionHead(ctx, 'Statement by statement', 'Every figure is a mean across the colleagues who answered it');

  const rowH = 19;
  const numW = 66;

  for (const block of groupItems(report)) {
    ensure(ctx, 30 + block.rows.length * rowH);
    doc.text(block.name.toUpperCase(), M.left, ctx.y, {
      font: 'Helvetica-Bold',
      size: 7,
      color: T.ink4,
      charSpacing: 1.1,
    });
    ctx.y += 14;

    for (const row of block.rows) {
      const barX = M.left + 150;
      const barW = RIGHT - numW - barX - 8;
      doc.text(truncate(row.short, 'Helvetica', 8.6, 140), M.left, ctx.y, { size: 8.6, color: T.ink2 });
      doc.roundRect(barX, ctx.y - 1, barW, 7, 3.5, T.track);
      if (row.mean !== null) {
        doc.roundRect(barX, ctx.y - 1, Math.max(3, (barW * row.mean) / SOCIO_MAX_ANSWER), 7, 3.5, row.color);
      }
      doc.textRight(row.mean === null ? '— (0)' : `${row.mean.toFixed(2)} (${row.n})`, RIGHT, ctx.y, {
        size: 7.8,
        color: T.ink3,
      });
      ctx.y += rowH;
    }
    ctx.y += 8;
  }
}

interface ItemGroup {
  name: string;
  rows: { short: string; mean: number | null; n: number; color: string }[];
}

function groupItems(report: SocioMemberReportPayload): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const colorFor = (blockKey: string): string =>
    report.context.find((c) => c.blockKey === blockKey)?.color ?? T.ink3;

  for (const c of report.context) {
    const rows = report.member.items
      .filter((i) => i.blockKey === c.blockKey)
      .map((i) => ({ short: i.short, mean: i.mean, n: i.n, color: c.color }));
    if (rows.length > 0) groups.push({ name: c.name, rows });
  }

  const deficit = report.member.items.filter(
    (i) => !report.context.some((c) => c.blockKey === i.blockKey),
  );
  if (deficit.length > 0) {
    groups.push({
      name: 'Reported separately',
      rows: deficit.map((i) => ({ short: i.short, mean: i.mean, n: i.n, color: T.warn })),
    });
  }

  void colorFor;
  return groups;
}

function drawMemberGiven(ctx: Ctx, report: SocioMemberReportPayload): void {
  const { doc } = ctx;
  const given = report.member.given;

  ensure(ctx, 130);
  sectionHead(ctx, 'How you rated others', 'Context for reading your own figures');

  const text =
    given.outDegree === 0
      ? 'You did not rate any colleagues, so there is nothing to compare here. That does not affect the figures above, which come entirely from what others said.'
      : `You rated ${given.outDegree} ${given.outDegree === 1 ? 'colleague' : 'colleagues'}, averaging ${given.mean?.toFixed(2) ?? '—'} of ${SOCIO_MAX_ANSWER}${
          given.versusCohort === null
            ? '.'
            : given.versusCohort >= 0.3
              ? `, which is ${signed(given.versusCohort)} against the group's own average — you rate more generously than most people here.`
              : given.versusCohort <= -0.3
                ? `, which is ${signed(given.versusCohort)} against the group's own average — you rate more strictly than most people here.`
                : `, close to the group's own average (${signed(given.versusCohort)}).`
        } This says something about how you use a rating scale, not about how accurate you are.`;

  ctx.y = doc.paragraph(text, M.left, ctx.y, CONTENT_W, {
    size: BODY.size,
    color: T.ink2,
    leading: BODY.leading,
  }) + 16;
}

// ---------------------------------------------------------- method + closing

function drawMethod(ctx: Ctx): void {
  const { doc, report } = ctx;
  ensure(ctx, 230);
  sectionHead(ctx, 'How to read this, and how it was made', 'Method and confidentiality');

  const threshold =
    report.kind === 'socio_group' ? report.group.tieThreshold : report.groupContext.tieThreshold;
  const minRaters =
    report.kind === 'socio_group' ? report.group.minRaters : report.groupContext.minRaters;

  const paras = [
    `Each figure is an arithmetic mean of the ratings actually given, on a 1–${SOCIO_MAX_ANSWER} scale where 1 is "${SOCIO_SCALE_LABELS[0]}" and ${SOCIO_MAX_ANSWER} is "${SOCIO_SCALE_LABELS[SOCIO_MAX_ANSWER - 1]}". Blanks are never counted as zero and never imputed: a blank means the rater had no basis to judge, which is a different statement from a low rating and is kept as one.`,
    `A tie in the network sections means a rater put someone at ${threshold} or above on that group of statements. ${threshold} is "${SOCIO_SCALE_LABELS[threshold - 1] ?? ''}" — the first point at which a rater is asserting the statement rather than partly conceding it.`,
    `Individual profiles are produced only where at least ${minRaters} colleagues rated the person. Below that the average is close enough to a single quotation to identify who gave it, so it is withheld.`,
    report.confidentiality,
  ];

  for (const p of paras) {
    ensure(ctx, 46);
    ctx.y = doc.paragraph(p, M.left, ctx.y, CONTENT_W, {
      size: 8.8,
      color: T.ink3,
      leading: 14,
    }) + 10;
  }

  ensure(ctx, 46);
  drawNote(
    ctx,
    'This is not a performance review',
    'These statements describe how a working relationship feels from the other side of it. They are shaped by role, by how much contact two people have, and by how much either of them needs from the other. Treat every figure here as the opening of a conversation rather than the conclusion of one.',
  );
}

// -------------------------------------------------------------- shared parts

function sectionHead(ctx: Ctx, title: string, note: string, needed = 0): void {
  const { doc, accent } = ctx;
  if (needed) ensure(ctx, needed);
  ensure(ctx, 46);
  doc.rect(M.left, ctx.y + 2, 20, 2.6, accent);
  doc.text(title, M.left, ctx.y + 16, { font: 'Helvetica-Bold', size: 14, color: T.ink });
  if (note) doc.text(note, M.left, ctx.y + 32, { size: 8.4, color: T.ink4 });
  ctx.y += note ? 50 : 36;
}

function drawNote(ctx: Ctx, title: string, body: string): void {
  const { doc } = ctx;
  const inner = CONTENT_W - 34;
  const h = doc.paragraphHeight(body, inner, { size: 8.6, leading: 13.4 }) + 34;
  ensure(ctx, h + 8);

  doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.warnSoft);
  doc.strokeRoundRect(M.left, ctx.y, CONTENT_W, h, 7, T.warnLine, 0.7);
  doc.text(title, M.left + 17, ctx.y + 16, { font: 'Helvetica-Bold', size: 8.6, color: T.warnInk });
  doc.paragraph(body, M.left + 17, ctx.y + 30, inner, { size: 8.6, color: T.warnInk, leading: 13.4 });
  ctx.y += h + 12;
}

// ---------------------------------------------------------------- the lockup

/** The tenant's mark if a PDF can carry it, otherwise the house lockup. */
function drawMark(ctx: Ctx, x: number, y: number, height: number): number {
  if (ctx.logo) return drawRasterLogo(ctx, x, y, height, HEADER_LOGO_MAX_W);
  return drawRibbon(ctx.doc, x, y, height);
}

function drawCoverLogo(ctx: Ctx, x: number, y: number): number {
  const height = 44;
  if (ctx.logo) {
    drawRasterLogo(ctx, x, y, height, COVER_LOGO_MAX_W);
    return y + height;
  }
  drawLogoLockup(ctx.doc, x, y, height);
  return y + height;
}

function drawRasterLogo(ctx: Ctx, x: number, y: number, height: number, maxWidth: number): number {
  const img = ctx.logo!;
  const ratio = img.width / img.height;
  let h = height;
  let w = h * ratio;
  if (w > maxWidth) {
    w = maxWidth;
    h = w / ratio;
  }
  ctx.doc.image(img, x, y + (height - h) / 2, w, h);
  return w;
}

// ------------------------------------------------------------------ helpers

function refCode(ctx: Ctx): string {
  const source = ctx.report.reportToken || ctx.report.cohortId;
  return source.replace(/^(crpt_|coh_)/, '').slice(0, 10).toUpperCase();
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Trust shading for the function matrix: pale at 1, accent-dark at 5. */
function heat(value: number): string {
  const t = Math.max(0, Math.min(1, (value - 1) / (SOCIO_MAX_ANSWER - 1)));
  return mix('#F4F7FB', '#0E5C93', t);
}

function truncate(value: string, font: StdFont, size: number, maxWidth: number): string {
  if (measure(value, font, size) <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && measure(`${out}…`, font, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function fitSize(value: string, font: StdFont, size: number, maxWidth: number): number {
  let s = size;
  while (s > 9 && measure(value, font, s) > maxWidth) s -= 0.5;
  return s;
}

function normaliseHex(value: string | undefined): string {
  if (!value) return '';
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : '';
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const to = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`;
}

function parseHex(value: string): [number, number, number] {
  const v = value.replace('#', '');
  const full = v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function formatDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Unused-parameter sink kept out of the layout code above. */
void wrap;
