/**
 * Enterprise report document.
 *
 * One entry point, `renderReportPdf`, switches on the payload tag and lays out
 * a complete multi-page document:
 *
 *   cover  ->  executive summary  ->  instrument-specific chapters
 *
 * Both instruments share the cover, the executive summary, the running header,
 * the footer and the chart vocabulary; only the chapters differ. Everything is
 * vector except the logo, which the caller decodes (see `./image.ts`) and
 * passes in.
 *
 * The logo used to be vector too — a lemniscate rebuilt from primitives — and
 * that was the bug: it ignored `branding.logoDataUrl` entirely, so a tenant
 * that had uploaded its own mark got the house one on the cover of every
 * report it handed a client, and even an untouched installation disagreed
 * with itself, because the drawn lemniscate and the shipped PNG are not the
 * same artwork. The PDF now embeds the same bytes the app header and the
 * emails render. `drawLogoLockup` survives only as the fallback for a logo a
 * PDF cannot carry: SVG, WebP, or a corrupt upload.
 */

import { BRAND_ACCENT, BRAND_COMPANY_NAME, BRAND_TAGLINE } from '../../shared/brand.js';
import { EGO_MAX_STATE_SCORE } from '../../shared/ego-scoring.js';
import { MAX_SIDE_SCORE, MAX_STYLE_SCORE } from '../../shared/scoring.js';
import type {
  EgoReportPayload,
  EgoStateNarrative,
  IsiReportPayload,
  ReportPayload,
} from '../../shared/types.js';
import type { EmbeddedImage } from './image.js';
import { A4, PdfDoc, measure, wrap, type StdFont } from './writer.js';

// ------------------------------------------------------------------- tokens

/** Design tokens. Neutrals are fixed; anything accent-driven follows branding. */
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
  push: '#B4530E',
  pull: '#0B6FB4',
  warn: '#B54708',
  warnSoft: '#FFFAEB',
  warnLine: '#F0C77A',
  warnInk: '#6E3708',
  bandLow: '#EEF1F5',
  bandMod: '#E2E8F0',
  bandHigh: '#D2DBE6',
  logoInk: '#464646',
} as const;

const M = { left: 56, right: 56, top: 54, bottom: 62 };
const CONTENT_W = A4.width - M.left - M.right;
const RIGHT = A4.width - M.right;
const PAGE_BOTTOM = A4.height - M.bottom;
/** First baseline available on a page that carries the running header. */
const HEADER_BOTTOM = M.top + 48;

const BODY = { size: 9.8, leading: 15.4 } as const;

/** Ratio of the house lockup, in its own 331 x 140 design space. */
/** Below this the tagline is dropped rather than printed as mush. */
const TAGLINE_MIN_SIZE = 3.6;
const LOGO_W = 331;
const LOGO_H = 140;
/** The ribbon mark alone occupies the first 160 units of that design space. */
const MARK_W = 160;

interface Ctx {
  doc: PdfDoc;
  report: ReportPayload;
  accent: string;
  /** A tenant's decoded logo, or null to draw the house lockup. */
  logo: EmbeddedImage | null;
  y: number;
}

// ------------------------------------------------------------------ entry

/**
 * `logo` is the tenant's uploaded mark, already decoded by the caller because
 * inflating a PNG is async and this layer is not. Pass null — the default —
 * for an installation still on the house branding.
 */
export function renderReportPdf(report: ReportPayload, logo: EmbeddedImage | null = null): Uint8Array {
  const accent = normaliseHex(report.branding.accentColor) || BRAND_ACCENT;
  const doc = new PdfDoc(A4, {
    title: `${report.assessmentName} — ${fullName(report)}`,
    author: report.branding.companyName || BRAND_COMPANY_NAME,
    subject: 'Confidential assessment report',
  });

  const ctx: Ctx = { doc, report, accent, logo, y: M.top };

  drawCover(ctx);
  newPage(ctx);
  drawExecutiveSummary(ctx);

  if (report.kind === 'isi') {
    drawIsiChapters(ctx, report);
  } else {
    drawEgoChapters(ctx, report);
  }

  drawFooters(ctx);
  return doc.build();
}

// ------------------------------------------------------------- page plumbing

function newPage(ctx: Ctx): void {
  ctx.doc.addPage();
  drawRunningHeader(ctx);
  ctx.y = HEADER_BOTTOM;
}

/** Breaks the page when `needed` points would not fit below the cursor. */
function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y + needed <= PAGE_BOTTOM) return;
  newPage(ctx);
}

function drawRunningHeader(ctx: Ctx): void {
  const { doc, report } = ctx;
  const y = M.top - 12;
  const markW = drawMark(ctx, M.left, y, 22);
  const company = report.branding.companyName || BRAND_COMPANY_NAME;
  doc.text(company, M.left + markW + 9, y + 3, {
    font: 'Helvetica-Bold',
    size: 9,
    color: T.ink,
  });
  doc.text(report.assessmentName, M.left + markW + 9, y + 14, { size: 7.6, color: T.ink4 });

  doc.textRight('CONFIDENTIAL', RIGHT, y + 3, {
    font: 'Helvetica-Bold',
    size: 7,
    color: T.ink4,
    charSpacing: 1.1,
  });
  doc.textRight(`Ref ${refCode(report)}`, RIGHT, y + 14, { size: 7.4, color: T.ink5 });

  doc.hr(M.left, M.top + 24, CONTENT_W, T.line, 0.7);
}

function drawFooters(ctx: Ctx): void {
  const { doc, report } = ctx;
  const total = doc.pageCount;
  const company = report.branding.companyName || BRAND_COMPANY_NAME;
  for (let i = 0; i < total; i++) {
    doc.onPage(i, () => {
      const y = A4.height - 44;
      doc.hr(M.left, y, CONTENT_W, i === 0 ? T.line2 : T.line, 0.6);
      doc.text(`Confidential — prepared for ${fullName(report)}`, M.left, y + 10, {
        size: 7.4,
        color: T.ink4,
      });
      doc.textCentre(company, A4.width / 2, y + 10, {
        font: 'Helvetica-Bold',
        size: 7.4,
        color: T.ink4,
      });
      doc.textRight(`Page ${i + 1} of ${total}`, RIGHT, y + 10, { size: 7.4, color: T.ink4 });
    });
  }
}

// -------------------------------------------------------------------- cover

function drawCover(ctx: Ctx): void {
  const { doc, report, accent } = ctx;

  drawCoverGeometry(doc, accent);

  // Lockup, top-left.
  drawLockup(ctx, M.left, 74, 54);

  // Kicker rule bleeding off the left edge.
  const kickY = 268;
  doc.shadeRect(0, kickY, 250, 1.6, doc.gradient(0, 0, 250, 0, [
    { offset: 0, color: accent },
    { offset: 1, color: mix(accent, '#FFFFFF', 0.92) },
  ]));

  doc.text('ASSESSMENT REPORT', M.left, kickY + 18, {
    font: 'Helvetica-Bold',
    size: 8,
    color: accent,
    charSpacing: 1.4,
  });

  // Title, up to two lines.
  const titleSize = 31;
  const titleLines = wrap(report.assessmentName, 'Helvetica-Bold', titleSize, CONTENT_W - 40).slice(0, 2);
  let ty = kickY + 42;
  for (const line of titleLines) {
    doc.text(line, M.left, ty, { font: 'Helvetica-Bold', size: titleSize, color: T.ink });
    ty += titleSize * 1.2;
  }

  const subtitle =
    report.kind === 'isi'
      ? 'A profile of how you influence, across ten styles and two methods.'
      : 'A profile of the six ego states, read by the shape of the ego-gram.';
  doc.paragraph(subtitle, M.left, ty + 4, CONTENT_W - 130, {
    size: 11,
    leading: 16.5,
    color: T.ink3,
  });

  // Meta block.
  const rows: [string, string][] = [
    ['PREPARED FOR', fullName(report) || '—'],
    ['ORGANISATION', report.candidate.organisation || '—'],
    ['DATE OF COMPLETION', formatDate(report.completedAt)],
    ['REPORT REFERENCE', refCode(report)],
  ];
  const metaTop = 494;
  const rowH = 40;
  const labelW = 168;
  doc.hr(M.left, metaTop, CONTENT_W, T.line2, 0.7);
  rows.forEach(([label, value], i) => {
    const y = metaTop + i * rowH;
    doc.text(label, M.left, y + 14, {
      font: 'Helvetica-Bold',
      size: 7.2,
      color: T.ink4,
      charSpacing: 1,
    });
    doc.text(truncate(value, 'Helvetica-Bold', 12, CONTENT_W - labelW - 4), M.left + labelW, y + 11, {
      font: 'Helvetica-Bold',
      size: 12,
      color: T.ink,
    });
    doc.hr(M.left, y + rowH, CONTENT_W, T.line, 0.55);
  });

  // Closing strap. The tagline belongs to the house brand, so it is set only
  // while the report is still carrying the house name — printing "Potential,
  // Possibilities" under a tenant's own company is the same leak as printing
  // the house logo over theirs.
  const company = report.branding.companyName || BRAND_COMPANY_NAME;
  const strapY = metaTop + rows.length * rowH + 34;
  doc.rect(M.left, strapY + 1, 22, 2, accent);
  doc.text(company.toUpperCase(), M.left + 32, strapY - 3, {
    font: 'Helvetica-Bold',
    size: 8,
    color: T.ink2,
    charSpacing: 1.2,
  });
  if (company === BRAND_COMPANY_NAME) {
    doc.text(BRAND_TAGLINE.toUpperCase(), M.left + 32, strapY + 10, {
      size: 7.4,
      color: T.ink4,
      charSpacing: 1.2,
    });
  }
}

/**
 * Full-bleed accent geometry: three hairline rings off the top-right corner and
 * a wedge cluster at the foot. Restrained on purpose — it frames the type
 * rather than competing with it.
 */
function drawCoverGeometry(doc: PdfDoc, accent: string): void {
  const W = A4.width;
  const H = A4.height;

  // Left edge spine.
  doc.shadeRect(0, 0, 5, H, doc.gradient(0, 0, 0, H, [
    { offset: 0, color: accent },
    { offset: 0.55, color: mix(accent, '#FFFFFF', 0.35) },
    { offset: 1, color: mix(accent, '#FFFFFF', 0.85) },
  ]));

  // Concentric rings, centred beyond the top-right corner.
  const cx = W + 26;
  const cy = -34;
  for (const [r, t] of [
    [178, 0.86],
    [232, 0.78],
    [286, 0.88],
  ] as const) {
    doc
      .path()
      .ellipse(cx, cy, r, r)
      .ellipse(cx, cy, r - 1.7, r - 1.7)
      .fill(mix(accent, '#FFFFFF', t), true);
  }
  // One filled quadrant sliver for weight.
  doc
    .path()
    .ellipse(cx, cy, 122, 122)
    .ellipse(cx, cy, 116, 116)
    .fill(mix(accent, '#FFFFFF', 0.55), true);

  // Foot wedges, kept clear of the footer band.
  const base = H - 62;
  doc.polygon(
    [
      [0, base],
      [0, base - 176],
      [318, base],
    ],
    mix(accent, '#FFFFFF', 0.93),
  );
  doc.polygon(
    [
      [0, base],
      [0, base - 96],
      [172, base],
    ],
    mix(accent, '#FFFFFF', 0.82),
  );
  doc.polygon(
    [
      [0, base],
      [0, base - 34],
      [60, base],
    ],
    accent,
  );

  // A quiet tick sequence along the right margin.
  for (let i = 0; i < 6; i++) {
    doc.rect(W - 34, 620 + i * 13, 14, 1.4, mix(accent, '#FFFFFF', 0.55 + i * 0.07));
  }
}

// -------------------------------------------------------- executive summary

function drawExecutiveSummary(ctx: Ctx): void {
  const { doc, report, accent } = ctx;
  sectionHead(ctx, 'Executive summary', 'Read this first', 320);

  const head = headlineFor(report);

  // Headline result card.
  const cardH = 104;
  ensure(ctx, cardH + 40);
  const top = ctx.y;
  doc.roundRect(M.left, top, CONTENT_W, cardH, 4, T.surface);
  doc.strokeRoundRect(M.left, top, CONTENT_W, cardH, 4, T.line, 0.7);
  doc.rect(M.left, top + 4, 3.2, cardH - 8, head.color);

  doc.text(head.kicker, M.left + 22, top + 20, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color: T.ink4,
    charSpacing: 1.1,
  });
  doc.text(truncate(head.title, 'Helvetica-Bold', 21, CONTENT_W - 200), M.left + 22, top + 34, {
    font: 'Helvetica-Bold',
    size: 21,
    color: T.ink,
  });
  doc.paragraph(head.blurb, M.left + 22, top + 66, CONTENT_W - 190, {
    size: 9,
    leading: 13,
    color: T.ink3,
  });

  // Big figure, right.
  const figX = RIGHT - 22;
  const unitW = measure(head.unit, 'Helvetica', 12);
  doc.textRight(head.unit, figX, top + 44, { size: 12, color: T.ink4 });
  doc.textRight(head.value, figX - unitW - 2, top + 28, {
    font: 'Helvetica-Bold',
    size: 34,
    color: head.color,
  });
  pillRight(doc, figX, top + 68, head.band, head.color);

  ctx.y = top + cardH + 24;

  // Summary paragraph.
  ensure(ctx, doc.paragraphHeight(report.summary, CONTENT_W, { size: 10.4, leading: 16.6 }) + 20);
  ctx.y = doc.paragraph(report.summary, M.left, ctx.y, CONTENT_W, {
    size: 10.4,
    leading: 16.6,
    color: T.ink2,
  });
  ctx.y += 26;

  // Key numbers.
  const tiles = statTilesFor(report, accent);
  ensure(ctx, 96);
  doc.text('KEY NUMBERS', M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color: T.ink4,
    charSpacing: 1.1,
  });
  ctx.y += 16;
  ctx.y = drawStatTiles(doc, M.left, ctx.y, CONTENT_W, tiles) + 24;

  if (report.kind === 'ego' && report.labelsAreDraft) {
    ctx.y = drawNote(doc, M.left, ctx.y, CONTENT_W, 'DRAFT LABELS', report.draftNote, accent) + 26;
  }

  drawContents(ctx);
}

/** "What follows" — the chapter list, so the reader knows the shape of the document. */
function drawContents(ctx: Ctx): void {
  const { doc, report, accent } = ctx;
  const items: [string, string][] =
    report.kind === 'isi'
      ? [
          ['Push and Pull', 'Your balance between the two methods, described in the instrument’s own words.'],
          ['Your ten-style profile', `Every style scored out of ${MAX_STYLE_SCORE}, banded Low, Moderate and High.`],
          ['Your top three styles', 'What each one looks like in practice — and what it costs when overused.'],
          ['Development area', 'Your least-used style, and one concrete thing to try.'],
        ]
      : [
          ['Your ego-gram', `All six states in the instrument’s column order, each out of ${EGO_MAX_STATE_SCORE}.`],
          ['Highest and lowest', 'The two ends of your profile, and what each tends to mean.'],
          ['The six ego states', 'A description of every state, with the practice suggestion for your lowest.'],
        ];

  const rowH = 34;
  ensure(ctx, 30 + items.length * rowH);
  doc.text('WHAT FOLLOWS', M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color: T.ink4,
    charSpacing: 1.1,
  });
  ctx.y += 16;
  doc.hr(M.left, ctx.y, CONTENT_W, T.line, 0.6);

  items.forEach(([title, note], i) => {
    const y = ctx.y + i * rowH;
    doc.rect(M.left, y + 12, 4, 4, accent);
    doc.text(title, M.left + 14, y + 8, { font: 'Helvetica-Bold', size: 9.6, color: T.ink });
    doc.textRight(truncate(note, 'Helvetica', 8.2, CONTENT_W - 190), RIGHT, y + 9.5, {
      size: 8.2,
      color: T.ink3,
    });
    doc.hr(M.left, y + rowH, CONTENT_W, T.line, 0.5);
  });
  ctx.y += items.length * rowH + 10;
}

interface Headline {
  kicker: string;
  title: string;
  blurb: string;
  value: string;
  unit: string;
  band: string;
  color: string;
}

function headlineFor(report: ReportPayload): Headline {
  if (report.kind === 'isi') {
    const lead = report.narratives[0];
    if (!lead) {
      return {
        kicker: 'RESULT',
        title: report.scores.orientation,
        blurb: 'Push and Pull balance across ten influencing styles.',
        value: String(report.scores.push),
        unit: `/ ${MAX_SIDE_SCORE}`,
        band: report.scores.orientation,
        color: T.pull,
      };
    }
    return {
      kicker: 'DOMINANT INFLUENCING STYLE',
      title: lead.name,
      blurb: lead.blurb,
      value: String(lead.score),
      unit: `/ ${MAX_STYLE_SCORE}`,
      band: `${lead.band} band`,
      color: lead.side === 'push' ? T.push : T.pull,
    };
  }
  const high = report.highest;
  return {
    kicker: 'MOST AVAILABLE EGO STATE',
    title: high.name,
    blurb: high.blurb,
    value: `${high.percent}`,
    unit: '%',
    band: `${high.band} · ${high.score} / ${EGO_MAX_STATE_SCORE}`,
    color: high.color,
  };
}

interface Tile {
  label: string;
  value: string;
  sub: string;
  color: string;
}

function statTilesFor(report: ReportPayload, accent: string): Tile[] {
  if (report.kind === 'isi') {
    const s = report.scores;
    return [
      { label: 'PUSH', value: String(s.push), sub: `of ${MAX_SIDE_SCORE} · ${s.pushShare}%`, color: T.push },
      { label: 'PULL', value: String(s.pull), sub: `of ${MAX_SIDE_SCORE} · ${s.pullShare}%`, color: T.pull },
      { label: 'ORIENTATION', value: s.orientation, sub: 'overall lean', color: accent },
      {
        label: 'DEVELOPMENT AREA',
        value: `${report.development.score}`,
        sub: truncate(report.development.name, 'Helvetica', 7.6, 96),
        color: T.ink2,
      },
    ];
  }
  const e = report.ego;
  return [
    { label: 'HIGHEST', value: report.highest.abbr, sub: `${report.highest.percent}%`, color: report.highest.color },
    { label: 'LOWEST', value: report.lowest.abbr, sub: `${report.lowest.percent}%`, color: report.lowest.color },
    { label: 'PROFILE SPREAD', value: String(e.spread), sub: 'points, high to low', color: accent },
    { label: 'STATEMENTS', value: String(e.totalAnswered), sub: 'all answered', color: T.ink2 },
  ];
}

function drawStatTiles(doc: PdfDoc, x: number, y: number, width: number, tiles: Tile[]): number {
  const gap = 10;
  const w = (width - gap * (tiles.length - 1)) / tiles.length;
  const h = 74;
  tiles.forEach((t, i) => {
    const tx = x + i * (w + gap);
    doc.roundRect(tx, y, w, h, 4, T.surface);
    doc.strokeRoundRect(tx, y, w, h, 4, T.line, 0.7);
    doc.rect(tx + 12, y + 12, 16, 2.4, t.color);
    doc.text(t.label, tx + 12, y + 22, {
      font: 'Helvetica-Bold',
      size: 6.6,
      color: T.ink4,
      charSpacing: 0.8,
    });
    const valueSize = fitSize(t.value, 'Helvetica-Bold', 19, w - 24);
    doc.text(truncate(t.value, 'Helvetica-Bold', valueSize, w - 24), tx + 12, y + 34, {
      font: 'Helvetica-Bold',
      size: valueSize,
      color: T.ink,
    });
    doc.text(truncate(t.sub, 'Helvetica', 7.6, w - 24), tx + 12, y + 58, {
      size: 7.6,
      color: T.ink3,
    });
  });
  return y + h;
}

// --------------------------------------------------------------- ISI chapter

function drawIsiChapters(ctx: Ctx, report: IsiReportPayload): void {
  newPage(ctx);
  drawPushPull(ctx, report);

  newPage(ctx);
  drawStyleProfile(ctx, report);

  // The narrative cards and the development area flow, so pages fill rather
  // than each chapter opening a half-empty sheet.
  drawNarratives(ctx, report);
  drawDevelopment(ctx, report);
}

function drawPushPull(ctx: Ctx, report: IsiReportPayload): void {
  const { doc } = ctx;
  const s = report.scores;
  sectionHead(ctx, 'Push and Pull', `Each method scored out of ${MAX_SIDE_SCORE}`, 220);

  // Split visual.
  const top = ctx.y;
  doc.text('PUSH', M.left, top, { font: 'Helvetica-Bold', size: 8.5, color: T.push, charSpacing: 1.1 });
  doc.text(String(s.push), M.left, top + 13, { font: 'Helvetica-Bold', size: 24, color: T.push });
  doc.text(`${s.pushShare}% of your total`, M.left, top + 42, { size: 8.4, color: T.ink3 });

  doc.textRight('PULL', RIGHT, top, {
    font: 'Helvetica-Bold',
    size: 8.5,
    color: T.pull,
    charSpacing: 1.1,
  });
  doc.textRight(String(s.pull), RIGHT, top + 13, { font: 'Helvetica-Bold', size: 24, color: T.pull });
  doc.textRight(`${s.pullShare}% of your total`, RIGHT, top + 42, { size: 8.4, color: T.ink3 });

  const barY = top + 62;
  const barH = 16;
  const total = s.push + s.pull;
  const pushW = total === 0 ? CONTENT_W / 2 : (s.push / total) * CONTENT_W;

  doc.path().roundRect(M.left, barY, CONTENT_W, barH, 3).clip(() => {
    doc.shadeRect(M.left, barY, Math.max(pushW, 0), barH, doc.gradient(M.left, 0, M.left + pushW, 0, [
      { offset: 0, color: mix(T.push, '#FFFFFF', 0.18) },
      { offset: 1, color: T.push },
    ]));
    doc.shadeRect(
      M.left + pushW,
      barY,
      Math.max(CONTENT_W - pushW, 0),
      barH,
      doc.gradient(M.left + pushW, 0, M.left + CONTENT_W, 0, [
        { offset: 0, color: T.pull },
        { offset: 1, color: mix(T.pull, '#FFFFFF', 0.18) },
      ]),
    );
  });
  // Midpoint marker, so the reader can see which side of balanced they sit on.
  doc.line(M.left + CONTENT_W / 2, barY - 5, M.left + CONTENT_W / 2, barY + barH + 5, T.ink4, 0.8);
  doc.strokeRoundRect(M.left, barY, CONTENT_W, barH, 3, T.line2, 0.6);

  doc.text('All Push', M.left, barY + barH + 10, { size: 7.4, color: T.ink4 });
  doc.textCentre('Balanced', M.left + CONTENT_W / 2, barY + barH + 10, { size: 7.4, color: T.ink4 });
  doc.textRight('All Pull', RIGHT, barY + barH + 10, { size: 7.4, color: T.ink4 });

  const orientY = barY + barH + 30;
  const orientLabel = `Orientation: ${s.orientation}`;
  const ow = measure(orientLabel, 'Helvetica-Bold', 9.4) + 24;
  doc.roundRect(M.left, orientY, ow, 20, 10, T.surface2);
  doc.text(orientLabel, M.left + 12, orientY + 5.5, {
    font: 'Helvetica-Bold',
    size: 9.4,
    color: T.ink2,
  });

  ctx.y = orientY + 44;

  // Verbatim method copy, two columns.
  const gap = 22;
  const colW = (CONTENT_W - gap) / 2;
  const pad = 14;
  const textW = colW - pad * 2;
  const headH = 34;
  const pushH = doc.paragraphHeight(report.methods.push, textW, { size: 8.9, leading: 13.6 });
  const pullH = doc.paragraphHeight(report.methods.pull, textW, { size: 8.9, leading: 13.6 });
  const boxH = headH + Math.max(pushH, pullH) + pad + 6;

  ensure(ctx, boxH + 20);
  const boxTop = ctx.y;
  const columns: [string, string, string][] = [
    ['THE PUSH METHOD', report.methods.push, T.push],
    ['THE PULL METHOD', report.methods.pull, T.pull],
  ];
  columns.forEach(([label, body, color], i) => {
    const cx = M.left + i * (colW + gap);
    doc.roundRect(cx, boxTop, colW, boxH, 4, T.paper);
    doc.strokeRoundRect(cx, boxTop, colW, boxH, 4, T.line, 0.7);
    doc.roundRect(cx, boxTop, colW, 4, 2, color);
    doc.rect(cx, boxTop + 2, colW, 2, color);
    doc.text(label, cx + pad, boxTop + 15, {
      font: 'Helvetica-Bold',
      size: 8,
      color,
      charSpacing: 1.1,
    });
    doc.hr(cx + pad, boxTop + headH - 8, colW - pad * 2, T.line, 0.6);
    doc.paragraph(body, cx + pad, boxTop + headH, textW, {
      size: 8.9,
      leading: 13.6,
      color: T.ink2,
    });
  });

  ctx.y = boxTop + boxH + 14;
  doc.text('Method descriptions are reproduced verbatim from the instrument.', M.left, ctx.y, {
    size: 7.6,
    color: T.ink4,
    font: 'Helvetica-Oblique',
  });
  ctx.y += 28;

  const leaning =
    s.orientation === 'Balanced'
      ? 'Your two totals sit within four points of each other, so neither method is carrying the profile on its own. That flexibility is an asset as long as it is deliberate rather than accidental.'
      : s.orientation === 'Push'
        ? 'Your profile leans to Push. Push moves quickly and is unambiguous, and it works best where the outcome matters more than the ownership. Watch for the situations that need commitment rather than compliance — those are the ones Pull is for.'
        : 'Your profile leans to Pull. Pull builds ownership and tends to hold, and it works best where the work outlives the conversation. Watch for the situations that simply need a decision — those are the ones Push is for.';
  ctx.y = drawNote(doc, M.left, ctx.y, CONTENT_W, 'WHAT YOUR BALANCE SUGGESTS', leaning, ctx.accent);
  ctx.y += 12;
  ctx.y = drawNote(
    doc,
    M.left,
    ctx.y,
    CONTENT_W,
    'NEITHER METHOD IS BETTER',
    `Push and Pull are each scored out of ${MAX_SIDE_SCORE} from the same forty statements, so the two totals are directly comparable. A high total on one side is a description of habit, not of skill — the question the report asks next is which individual styles inside each method you actually reach for.`,
    T.ink4,
  );
  ctx.y += 16;
}

function drawStyleProfile(ctx: Ctx, report: IsiReportPayload): void {
  const { doc } = ctx;
  sectionHead(ctx, 'Your ten-style profile', `Each style scored out of ${MAX_STYLE_SCORE}`, 300);

  // Band legend.
  const legend: [string, string, string][] = [
    ['Low', '0–6', T.bandLow],
    ['Moderate', '7–11', T.bandMod],
    ['High', '12–16', T.bandHigh],
  ];
  let lx = M.left;
  doc.text('BANDS', lx, ctx.y + 2, {
    font: 'Helvetica-Bold',
    size: 6.8,
    color: T.ink4,
    charSpacing: 0.9,
  });
  lx += 44;
  for (const [name, range, colour] of legend) {
    doc.roundRect(lx, ctx.y, 11, 11, 2, colour);
    doc.strokeRoundRect(lx, ctx.y, 11, 11, 2, T.line2, 0.5);
    const label = `${name} ${range}`;
    doc.text(label, lx + 16, ctx.y + 2, { size: 7.8, color: T.ink3 });
    lx += 16 + measure(label, 'Helvetica', 7.8) + 20;
  }
  ctx.y += 26;

  const labelW = 138;
  const valueW = 92;
  const trackX = M.left + labelW;
  const trackW = CONTENT_W - labelW - valueW;

  for (const side of ['push', 'pull'] as const) {
    const styles = report.scores.styles.filter((s) => s.side === side);
    const color = side === 'push' ? T.push : T.pull;
    const heading = side === 'push' ? 'PUSH STYLES' : 'PULL STYLES';
    const note = side === 'push' ? 'What you bring to the exchange' : 'What draws others in';

    ensure(ctx, 34 + styles.length * 24 + 22);
    doc.rect(M.left, ctx.y + 1, 8, 8, color);
    doc.text(heading, M.left + 14, ctx.y, {
      font: 'Helvetica-Bold',
      size: 7.8,
      color: T.ink2,
      charSpacing: 0.9,
    });
    // charSpacing widens the run, so it has to be added back before the note.
    const headingW = measure(heading, 'Helvetica-Bold', 7.8) + 0.9 * heading.length;
    doc.text(note, M.left + 14 + headingW + 14, ctx.y, { size: 7.8, color: T.ink4 });
    ctx.y += 18;

    for (const s of styles) {
      ensure(ctx, 26);
      doc.text(truncate(s.name, 'Helvetica', 9, labelW - 10), M.left, ctx.y + 2.5, {
        size: 9,
        color: T.ink2,
      });
      drawBandedTrack(doc, trackX, ctx.y, trackW, 11, s.score, color);

      const bandLabel = s.band;
      const bandW = measure(bandLabel, 'Helvetica', 7.8);
      const slash = ` / ${MAX_STYLE_SCORE}`;
      const slashW = measure(slash, 'Helvetica', 8);
      doc.textRight(bandLabel, RIGHT, ctx.y + 2.6, { size: 7.8, color: T.ink3 });
      doc.textRight(slash, RIGHT - bandW - 10, ctx.y + 2.4, { size: 8, color: T.ink4 });
      doc.textRight(String(s.score), RIGHT - bandW - 10 - slashW, ctx.y + 1.4, {
        font: 'Helvetica-Bold',
        size: 9.4,
        color: T.ink,
      });
      ctx.y += 23;
    }

    // Scale under each group.
    for (const tick of [0, 6, 11, MAX_STYLE_SCORE]) {
      const tx = trackX + (tick / MAX_STYLE_SCORE) * trackW;
      doc.line(tx, ctx.y - 5, tx, ctx.y - 1, T.line2, 0.6);
      doc.textCentre(String(tick), tx, ctx.y, { size: 6.8, color: T.ink4 });
    }
    ctx.y += 26;
  }

  ctx.y = drawNote(
    doc,
    M.left,
    ctx.y,
    CONTENT_W,
    'HOW TO READ THIS',
    'The dividers on each bar sit at 6 and 11 — the Low / Moderate / High boundaries. A profile is read by its shape: which styles carry the load, and which are available but rarely used.',
    ctx.accent,
  );
  ctx.y += 20;

  // What each band actually means, so the three words are not left undefined.
  const bands: [string, string, string][] = [
    ['LOW', '0–6', 'A style you seldom reach for. Available to you, but not part of your habitual repertoire.'],
    ['MODERATE', '7–11', 'A style you use when the situation calls for it, without it defining how you work.'],
    ['HIGH', '12–16', 'A style you lead with, recognisable to others — and the easiest one to overuse.'],
  ];
  ensure(ctx, 30 + bands.length * 30);
  doc.text('WHAT THE BANDS MEAN', M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color: T.ink4,
    charSpacing: 1.1,
  });
  ctx.y += 16;
  doc.hr(M.left, ctx.y, CONTENT_W, T.line, 0.6);
  bands.forEach(([name, range, note], i) => {
    const y = ctx.y + i * 30;
    doc.text(name, M.left, y + 9, {
      font: 'Helvetica-Bold',
      size: 8,
      color: T.ink2,
      charSpacing: 0.8,
    });
    doc.text(range, M.left + 74, y + 9, { size: 8, color: T.ink4 });
    doc.text(truncate(note, 'Helvetica', 8.6, CONTENT_W - 124), M.left + 124, y + 8.6, {
      size: 8.6,
      color: T.ink3,
    });
    doc.hr(M.left, y + 30, CONTENT_W, T.line, 0.5);
  });
  ctx.y += bands.length * 30 + 10;
}

/** A single style bar with its three band zones and the two boundary rules. */
function drawBandedTrack(
  doc: PdfDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  score: number,
  color: string,
): void {
  const at = (v: number) => x + (v / MAX_STYLE_SCORE) * w;
  doc.rect(x, y, w, h, T.bandLow);
  doc.rect(at(6), y, at(11) - at(6), h, T.bandMod);
  doc.rect(at(11), y, at(MAX_STYLE_SCORE) - at(11), h, T.bandHigh);

  const filled = Math.max(0, Math.min(score, MAX_STYLE_SCORE));
  if (filled > 0) {
    doc.shadeRect(x, y, at(filled) - x, h, doc.gradient(x, 0, at(MAX_STYLE_SCORE), 0, [
      { offset: 0, color: mix(color, '#FFFFFF', 0.24) },
      { offset: 1, color: color },
    ]));
  }
  // Boundaries stay visible over the fill.
  for (const b of [6, 11]) {
    doc.rect(at(b) - 0.45, y, 0.9, h, T.paper);
  }
  doc.strokeRect(x, y, w, h, T.line2, 0.5);
}

function drawNarratives(ctx: Ctx, report: IsiReportPayload): void {
  const first = report.narratives[0];
  const firstH = first ? narrativeCardHeight(ctx.doc, first) : 0;
  sectionHead(ctx, 'Your top three styles', 'Narrative and overuse risk', firstH);
  report.narratives.forEach((n, i) => drawNarrativeCard(ctx, n, i));
  ctx.y += 8;
}

function narrativeCardHeight(doc: PdfDoc, n: IsiReportPayload['narratives'][number]): number {
  const pad = 18;
  const textW = CONTENT_W - pad * 2;
  const narrativeH = doc.paragraphHeight(n.narrative, textW, {
    size: BODY.size,
    leading: BODY.leading,
  });
  const cautionH = doc.paragraphHeight(n.caution, textW - 28, { size: 9.2, leading: 14.2 });
  return 96 + narrativeH + cautionH + 40 + pad;
}

function drawNarrativeCard(
  ctx: Ctx,
  n: IsiReportPayload['narratives'][number],
  index: number,
): void {
  const { doc } = ctx;
  const color = n.side === 'push' ? T.push : T.pull;
  const pad = 18;
  const textW = CONTENT_W - pad * 2;
  const boxH = narrativeCardHeight(doc, n);

  ensure(ctx, Math.min(boxH, PAGE_BOTTOM - HEADER_BOTTOM));
  const top = ctx.y;

  doc.roundRect(M.left, top, CONTENT_W, boxH, 4, T.paper);
  doc.strokeRoundRect(M.left, top, CONTENT_W, boxH, 4, T.line, 0.7);
  doc.rect(M.left, top + 5, 3.2, boxH - 10, color);

  // Title row.
  doc.roundRect(M.left + pad, top + 16, 26, 26, 4, color);
  doc.textCentre(String(index + 1), M.left + pad + 13, top + 22, {
    font: 'Helvetica-Bold',
    size: 12,
    color: T.paper,
  });
  doc.text(
    truncate(n.name, 'Helvetica-Bold', 17, CONTENT_W - 200),
    M.left + pad + 38,
    top + 15,
    { font: 'Helvetica-Bold', size: 17, color: T.ink },
  );
  doc.text(
    `${n.side === 'push' ? 'Push style' : 'Pull style'} · ${truncate(n.blurb, 'Helvetica', 8.4, CONTENT_W - 260)}`,
    M.left + pad + 38,
    top + 35,
    { size: 8.4, color: T.ink3 },
  );

  const suffix = ` / ${MAX_STYLE_SCORE}`;
  const suffixW = measure(suffix, 'Helvetica', 10);
  doc.textRight(suffix, RIGHT - pad, top + 27, { size: 10, color: T.ink4 });
  doc.textRight(String(n.score), RIGHT - pad - suffixW, top + 16, {
    font: 'Helvetica-Bold',
    size: 22,
    color,
  });

  // Score meter with its band boundaries.
  drawBandedTrack(doc, M.left + pad, top + 54, textW, 9, n.score, color);
  doc.text(`${n.band} band`, M.left + pad, top + 68, { size: 7.4, color: T.ink4 });
  doc.textRight(`0 · 6 · 11 · ${MAX_STYLE_SCORE}`, RIGHT - pad, top + 68, {
    size: 7.4,
    color: T.ink4,
  });

  let y = top + 88;
  y = doc.paragraph(n.narrative, M.left + pad, y, textW, {
    size: BODY.size,
    leading: BODY.leading,
    color: T.ink2,
  });

  // Overuse caution.
  y += 10;
  const cautionH = doc.paragraphHeight(n.caution, textW - 28, { size: 9.2, leading: 14.2 });
  doc.roundRect(M.left + pad, y, textW, cautionH + 34, 3, T.warnSoft);
  doc.rect(M.left + pad, y + 4, 2.6, cautionH + 26, T.warn);
  doc.text('WHEN OVERUSED', M.left + pad + 14, y + 11, {
    font: 'Helvetica-Bold',
    size: 7.2,
    color: T.warn,
    charSpacing: 1.1,
  });
  doc.paragraph(n.caution, M.left + pad + 14, y + 25, textW - 28, {
    size: 9.2,
    leading: 14.2,
    color: T.warnInk,
  });

  ctx.y = top + boxH + 16;
}

function drawDevelopment(ctx: Ctx, report: IsiReportPayload): void {
  const { doc, accent } = ctx;
  const d = report.development;
  sectionHead(ctx, 'Development area', 'Your least-used style', 260);

  const top = ctx.y;
  doc.text(truncate(d.name, 'Helvetica-Bold', 20, CONTENT_W - 160), M.left, top, {
    font: 'Helvetica-Bold',
    size: 20,
    color: T.ink,
  });
  doc.text(`${d.band} band · lowest of the ten styles`, M.left, top + 26, {
    font: 'Helvetica-Bold',
    size: 8,
    color: accent,
    charSpacing: 0.6,
  });

  const suffix = ` / ${MAX_STYLE_SCORE}`;
  const suffixW = measure(suffix, 'Helvetica', 11);
  doc.textRight(suffix, RIGHT, top + 14, { size: 11, color: T.ink4 });
  doc.textRight(String(d.score), RIGHT - suffixW, top, {
    font: 'Helvetica-Bold',
    size: 26,
    color: accent,
  });

  ctx.y = top + 46;
  drawBandedTrack(doc, M.left, ctx.y, CONTENT_W, 12, d.score, accent);
  ctx.y += 16;
  for (const tick of [0, 6, 11, MAX_STYLE_SCORE]) {
    doc.textCentre(String(tick), M.left + (tick / MAX_STYLE_SCORE) * CONTENT_W, ctx.y, {
      size: 6.8,
      color: T.ink4,
    });
  }
  ctx.y += 28;

  subHead(ctx, 'What a low score means here', accent);
  ctx.y = doc.paragraph(d.low, M.left, ctx.y, CONTENT_W, {
    size: BODY.size,
    leading: BODY.leading,
    color: T.ink2,
  });
  ctx.y += 24;

  const pad = 16;
  const actionH = doc.paragraphHeight(d.action, CONTENT_W - pad * 2, { size: 9.6, leading: 15 });
  const boxH = actionH + 44;
  ensure(ctx, boxH);
  const aTop = ctx.y;
  doc.roundRect(M.left, aTop, CONTENT_W, boxH, 4, mix(accent, '#FFFFFF', 0.94));
  doc.strokeRoundRect(M.left, aTop, CONTENT_W, boxH, 4, mix(accent, '#FFFFFF', 0.7), 0.7);
  doc.rect(M.left + 1, aTop + 6, 3, boxH - 12, accent);
  doc.text('TRY THIS', M.left + pad, aTop + 15, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color: accent,
    charSpacing: 1.1,
  });
  doc.paragraph(d.action, M.left + pad, aTop + 31, CONTENT_W - pad * 2, {
    size: 9.6,
    leading: 15,
    color: T.ink2,
  });
  ctx.y = aTop + boxH + 20;
}

// --------------------------------------------------------------- ego chapter

function drawEgoChapters(ctx: Ctx, report: EgoReportPayload): void {
  newPage(ctx);
  drawEgoGram(ctx, report);

  newPage(ctx);
  drawEgoExtremes(ctx, report);

  newPage(ctx);
  sectionHead(ctx, 'The six ego states', report.labelsAreDraft ? 'Names and copy are draft' : '', 180);
  // Blocks flow and break themselves, so pages fill instead of each state
  // opening a half-empty sheet.
  for (const state of report.states) drawEgoStateBlock(ctx, report, state);
}

function drawEgoGram(ctx: Ctx, report: EgoReportPayload): void {
  const { doc, accent } = ctx;
  sectionHead(ctx, 'Your ego-gram', `Each state scored out of ${EGO_MAX_STATE_SCORE}`, 380);

  const chartH = 250;
  const axisW = 30;
  const plotX = M.left + axisW;
  const plotW = CONTENT_W - axisW;
  const top = ctx.y;
  const baseline = top + chartH;

  // Gridlines and percentage axis.
  for (const pct of [0, 25, 50, 75, 100]) {
    const gy = baseline - (pct / 100) * chartH;
    doc.hr(plotX, gy, plotW, pct === 0 ? T.line2 : T.line, pct === 0 ? 0.9 : 0.5);
    doc.textRight(`${pct}%`, plotX - 8, gy - 3.5, { size: 6.8, color: T.ink4 });
  }

  const states = report.states;
  const slot = plotW / states.length;
  const barW = Math.min(52, slot * 0.56);

  states.forEach((s, i) => {
    const cx = plotX + slot * (i + 0.5);
    const bx = cx - barW / 2;
    const h = Math.max(2, (Math.max(0, Math.min(100, s.percent)) / 100) * chartH);
    const by = baseline - h;

    doc.path().roundRect(bx, by, barW, h, 3).shade(
      doc.gradient(0, by, 0, baseline, [
        { offset: 0, color: mix(s.color, '#FFFFFF', 0.2) },
        { offset: 1, color: s.color },
      ]),
    );
    doc.strokeRoundRect(bx, by, barW, h, 3, mix(s.color, '#000000', 0.12), 0.5);

    doc.textCentre(`${s.percent}%`, cx, by - 13, {
      font: 'Helvetica-Bold',
      size: 9.2,
      color: T.ink,
    });
    doc.textCentre(s.abbr, cx, baseline + 9, {
      font: 'Helvetica-Bold',
      size: 10.5,
      color: s.color,
    });
    doc.textCentre(truncate(s.name, 'Helvetica', 6.9, slot - 4), cx, baseline + 23, {
      size: 6.9,
      color: T.ink3,
    });
    doc.textCentre(`${s.score}/${EGO_MAX_STATE_SCORE}`, cx, baseline + 34, {
      size: 6.9,
      color: T.ink4,
    });
  });

  ctx.y = baseline + 54;

  ctx.y = drawNote(
    doc,
    M.left,
    ctx.y,
    CONTENT_W,
    'HOW TO READ THIS',
    'Columns are drawn in the instrument’s own column order, not sorted by score. There is no good or bad ego-gram — read the shape, the tallest and the shortest columns, and how even or uneven the profile is overall.',
    accent,
  );
  ctx.y += 12;

  if (report.labelsAreDraft) {
    ctx.y = drawNote(doc, M.left, ctx.y, CONTENT_W, 'DRAFT LABELS', report.draftNote, T.warn, true);
  }
}

function drawEgoExtremes(ctx: Ctx, report: EgoReportPayload): void {
  const { doc, accent } = ctx;
  sectionHead(ctx, 'Highest and lowest', 'The two ends of your profile', 300);

  ctx.y = drawExtremeCard(ctx, 'MOST AVAILABLE', report.highest, report.highest.high, null);
  ctx.y += 22;
  ctx.y = drawExtremeCard(ctx, 'LEAST AVAILABLE', report.lowest, report.lowest.low, report.lowest.dev);

  ctx.y += 20;
  ensure(ctx, 60);
  ctx.y = drawNote(
    doc,
    M.left,
    ctx.y,
    CONTENT_W,
    'PROFILE SPREAD',
    `Your highest and lowest states are ${report.ego.spread} points apart out of a possible ${EGO_MAX_STATE_SCORE}. A wide spread points to a strongly differentiated profile; a narrow one to a level, adaptable profile.`,
    accent,
  );
}

function drawExtremeCard(
  ctx: Ctx,
  kicker: string,
  state: EgoStateNarrative,
  body: string,
  dev: string | null,
): number {
  const { doc } = ctx;
  const pad = 18;
  const textW = CONTENT_W - pad * 2;
  const bodyH = doc.paragraphHeight(body, textW, { size: BODY.size, leading: BODY.leading });
  const devH = dev ? doc.paragraphHeight(dev, textW - 24, { size: 9.4, leading: 14.6 }) + 40 : 0;
  const boxH = 62 + bodyH + devH + pad;

  ensure(ctx, Math.min(boxH, PAGE_BOTTOM - HEADER_BOTTOM));
  const top = ctx.y;

  doc.roundRect(M.left, top, CONTENT_W, boxH, 4, T.paper);
  doc.strokeRoundRect(M.left, top, CONTENT_W, boxH, 4, T.line, 0.7);
  doc.roundRect(M.left, top, CONTENT_W, 4, 2, state.color);
  doc.rect(M.left, top + 2, CONTENT_W, 2, state.color);

  doc.text(kicker, M.left + pad, top + 16, {
    font: 'Helvetica-Bold',
    size: 7.2,
    color: T.ink4,
    charSpacing: 1.1,
  });
  doc.text(truncate(state.name, 'Helvetica-Bold', 16, CONTENT_W - 200), M.left + pad, top + 30, {
    font: 'Helvetica-Bold',
    size: 16,
    color: T.ink,
  });

  const label = `${state.percent}%`;
  const sub = `${state.score} / ${EGO_MAX_STATE_SCORE} · ${state.band}`;
  doc.textRight(label, RIGHT - pad, top + 18, {
    font: 'Helvetica-Bold',
    size: 22,
    color: state.color,
  });
  doc.textRight(sub, RIGHT - pad, top + 44, { size: 7.8, color: T.ink3 });

  doc.paragraph(body, M.left + pad, top + 58, textW, {
    size: BODY.size,
    leading: BODY.leading,
    color: T.ink2,
  });

  if (dev) {
    const dTop = top + 58 + bodyH + 10;
    const dH = devH - 16;
    doc.roundRect(M.left + pad, dTop, textW, dH, 3, T.surface2);
    doc.rect(M.left + pad, dTop + 4, 2.6, dH - 8, state.color);
    doc.text('TRY THIS', M.left + pad + 14, dTop + 11, {
      font: 'Helvetica-Bold',
      size: 7.2,
      color: T.ink3,
      charSpacing: 1.1,
    });
    doc.paragraph(dev, M.left + pad + 14, dTop + 25, textW - 24, {
      size: 9.4,
      leading: 14.6,
      color: T.ink2,
    });
  }

  return top + boxH;
}

function drawEgoStateBlock(ctx: Ctx, report: EgoReportPayload, state: EgoStateNarrative): void {
  const { doc } = ctx;
  const isHighest = state.stateKey === report.highest.stateKey;
  const isLowest = state.stateKey === report.lowest.stateKey;
  const extra = isHighest ? state.high : isLowest ? state.low : '';

  const descH = doc.paragraphHeight(state.description, CONTENT_W, {
    size: BODY.size,
    leading: BODY.leading,
  });
  const extraH = extra
    ? doc.paragraphHeight(extra, CONTENT_W - 32, { size: 9.4, leading: 14.6 }) + 40
    : 0;
  const blockH = 78 + descH + extraH + 26;

  ensure(ctx, Math.min(blockH, PAGE_BOTTOM - HEADER_BOTTOM));
  const top = ctx.y;

  // Identity row.
  doc.roundRect(M.left, top, 34, 34, 4, state.color);
  doc.textCentre(state.abbr, M.left + 17, top + 11, {
    font: 'Helvetica-Bold',
    size: fitSize(state.abbr, 'Helvetica-Bold', 12, 28),
    color: T.paper,
  });
  doc.text(truncate(state.name, 'Helvetica-Bold', 16, CONTENT_W - 200), M.left + 46, top + 2, {
    font: 'Helvetica-Bold',
    size: 16,
    color: T.ink,
  });
  doc.text(truncate(state.blurb, 'Helvetica', 8.6, CONTENT_W - 200), M.left + 46, top + 22, {
    size: 8.6,
    color: T.ink3,
  });

  doc.textRight(`${state.percent}%`, RIGHT, top + 2, {
    font: 'Helvetica-Bold',
    size: 18,
    color: state.color,
  });
  doc.textRight(`${state.score} / ${EGO_MAX_STATE_SCORE} · ${state.band}`, RIGHT, top + 25, {
    size: 7.6,
    color: T.ink3,
  });

  // Percentage meter.
  const meterY = top + 46;
  doc.roundRect(M.left, meterY, CONTENT_W, 8, 4, T.surface2);
  const fillW = Math.max(4, (Math.max(0, Math.min(100, state.percent)) / 100) * CONTENT_W);
  doc.path().roundRect(M.left, meterY, fillW, 8, 4).shade(
    doc.gradient(M.left, 0, M.left + CONTENT_W, 0, [
      { offset: 0, color: mix(state.color, '#FFFFFF', 0.3) },
      { offset: 1, color: state.color },
    ]),
  );
  doc.strokeRoundRect(M.left, meterY, CONTENT_W, 8, 4, T.line2, 0.5);

  ctx.y = top + 68;
  ctx.y = doc.paragraph(state.description, M.left, ctx.y, CONTENT_W, {
    size: BODY.size,
    leading: BODY.leading,
    color: T.ink2,
  });

  if (extra) {
    ctx.y += 12;
    const label = isHighest ? 'YOUR HIGHEST STATE' : 'YOUR LOWEST STATE';
    const h = extraH - 16;
    doc.roundRect(M.left, ctx.y, CONTENT_W, h, 3, T.surface);
    doc.strokeRoundRect(M.left, ctx.y, CONTENT_W, h, 3, T.line, 0.6);
    doc.rect(M.left + 1, ctx.y + 4, 2.6, h - 8, state.color);
    doc.text(label, M.left + 16, ctx.y + 11, {
      font: 'Helvetica-Bold',
      size: 7.2,
      color: T.ink4,
      charSpacing: 1.1,
    });
    doc.paragraph(extra, M.left + 16, ctx.y + 25, CONTENT_W - 32, {
      size: 9.4,
      leading: 14.6,
      color: T.ink2,
    });
    ctx.y += h;
  }

  ctx.y += 24;
  doc.hr(M.left, ctx.y - 12, CONTENT_W, T.line, 0.5);
}

// -------------------------------------------------------------- shared parts

function sectionHead(ctx: Ctx, title: string, note: string, needed = 0): void {
  const { doc, accent } = ctx;
  ensure(ctx, 52 + Math.min(needed, PAGE_BOTTOM - HEADER_BOTTOM - 52));
  doc.rect(M.left, ctx.y + 3, 16, 2.6, accent);
  doc.text(title, M.left + 26, ctx.y - 4, { font: 'Helvetica-Bold', size: 15, color: T.ink });
  if (note) doc.textRight(note, RIGHT, ctx.y, { size: 8, color: T.ink4 });
  ctx.y += 18;
  doc.hr(M.left, ctx.y, CONTENT_W, T.line2, 0.7);
  ctx.y += 20;
}

function subHead(ctx: Ctx, title: string, color: string): void {
  ensure(ctx, 40);
  ctx.doc.text(title.toUpperCase(), M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 7.4,
    color,
    charSpacing: 1.1,
  });
  ctx.y += 16;
}

/** A bordered aside used for reading notes and the ego draft footnote. */
function drawNote(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  label: string,
  body: string,
  color: string,
  emphasise = false,
): number {
  const pad = 14;
  const textW = width - pad * 2;
  const bodyH = doc.paragraphHeight(body, textW, { size: 8.6, leading: 13.2 });
  const h = bodyH + 34;
  doc.roundRect(x, y, width, h, 3, emphasise ? T.warnSoft : T.surface);
  doc.strokeRoundRect(x, y, width, h, 3, emphasise ? T.warnLine : T.line, 0.6);
  doc.rect(x + 1, y + 5, 2.6, h - 10, color);
  doc.text(label, x + pad, y + 11, {
    font: 'Helvetica-Bold',
    size: 7,
    color: emphasise ? T.warn : T.ink4,
    charSpacing: 1.1,
  });
  doc.paragraph(body, x + pad, y + 24, textW, {
    size: 8.6,
    leading: 13.2,
    color: emphasise ? T.warnInk : T.ink3,
  });
  return y + h;
}

function pillRight(doc: PdfDoc, right: number, y: number, label: string, color: string): void {
  const w = measure(label, 'Helvetica-Bold', 7.6) + 20;
  const x = right - w;
  doc.roundRect(x, y, w, 16, 8, mix(color, '#FFFFFF', 0.88));
  doc.strokeRoundRect(x, y, w, 16, 8, mix(color, '#FFFFFF', 0.6), 0.6);
  doc.text(label, x + 10, y + 4.4, { font: 'Helvetica-Bold', size: 7.6, color: mix(color, '#000000', 0.1) });
}

// ---------------------------------------------------------------- the lockup

/**
 * Widest a tenant's logo may run at each size, so a banner-shaped upload
 * cannot collide with the type set beside it. Anything wider is scaled down
 * about its top-left corner rather than cropped.
 */
const HEADER_LOGO_MAX_W = 132;
const COVER_LOGO_MAX_W = CONTENT_W * 0.5;

/**
 * The mark used in the running header: the tenant's logo when there is one,
 * the house ribbon otherwise. Returns the width consumed.
 */
function drawMark(ctx: Ctx, x: number, y: number, height: number): number {
  if (ctx.logo) return drawRasterLogo(ctx.doc, ctx.logo, x, y, height, HEADER_LOGO_MAX_W);
  return drawRibbon(ctx.doc, x, y, height);
}

/** The cover lockup: the tenant's logo when there is one, else the house one. */
function drawLockup(ctx: Ctx, x: number, y: number, height: number): number {
  if (ctx.logo) return drawRasterLogo(ctx.doc, ctx.logo, x, y, height, COVER_LOGO_MAX_W);
  return drawLogoLockup(ctx.doc, x, y, height);
}

/**
 * Places an uploaded logo at the given height, preserving its aspect ratio and
 * shrinking both dimensions if that would make it wider than `maxWidth`. The
 * box stays top-anchored so a squat logo does not drift away from the type it
 * sits beside.
 */
function drawRasterLogo(
  doc: PdfDoc,
  logo: EmbeddedImage,
  x: number,
  y: number,
  height: number,
  maxWidth: number,
): number {
  const ratio = logo.width / logo.height;
  let h = height;
  let w = h * ratio;
  if (w > maxWidth) {
    w = maxWidth;
    h = w / ratio;
  }
  doc.image(logo, x, y, w, h);
  return w;
}

/**
 * The house mark: a lemniscate ribbon built from two rotated elliptical
 * rings, each an even-odd path filled with an axial gradient — green/yellow to
 * deep red on the left lobe, brand blue to red on the right.
 *
 * Returns the width consumed, so callers can set type beside it.
 */
export function drawRibbon(doc: PdfDoc, x: number, y: number, height: number): number {
  const s = height / LOGO_H;
  const px = (dx: number) => x + dx * s;
  const py = (dy: number) => y + dy * s;

  const lobes: {
    cx: number;
    rot: number;
    from: [number, number];
    to: [number, number];
    stops: { offset: number; color: string }[];
  }[] = [
    {
      cx: 46,
      rot: -38,
      from: [2, 126],
      to: [90, 14],
      stops: [
        { offset: 0, color: '#DCD400' },
        { offset: 0.3, color: '#4FAE33' },
        { offset: 0.68, color: '#8E1A17' },
        { offset: 1, color: '#6E1012' },
      ],
    },
    {
      cx: 114,
      rot: 38,
      from: [70, 14],
      to: [158, 126],
      stops: [
        { offset: 0, color: '#0B6FB4' },
        { offset: 0.4, color: '#2F62AA' },
        { offset: 0.72, color: '#C8282C' },
        { offset: 1, color: '#E52629' },
      ],
    },
  ];

  for (const lobe of lobes) {
    const ref = doc.gradient(px(lobe.from[0]), py(lobe.from[1]), px(lobe.to[0]), py(lobe.to[1]), lobe.stops);
    doc
      .path()
      .ellipse(px(lobe.cx), py(70), 54 * s, 38 * s, lobe.rot)
      .ellipse(px(lobe.cx), py(70), 27 * s, 15 * s, lobe.rot)
      .shade(ref, true);
  }

  return MARK_W * s;
}

/** Ribbon + rule + "PO" wordmark + letterspaced tagline, in one 331:140 box. */
export function drawLogoLockup(doc: PdfDoc, x: number, y: number, height: number): number {
  const s = height / LOGO_H;
  drawRibbon(doc, x, y, height);

  // Divider bar.
  doc.roundRect(x + 180 * s, y + 18 * s, 8 * s, 104 * s, 3 * s, T.logoInk);

  // Wordmark, fitted to the remaining width.
  const wordX = x + 206 * s;
  const wordW = (LOGO_W - 206) * s;
  const poSize = wordW / (measure('PO', 'Helvetica-Bold', 1) || 1);
  // Baseline sits at design y = 80; text() places the em-box top.
  doc.text('PO', wordX, y + 80 * s - poSize, {
    font: 'Helvetica-Bold',
    size: poSize,
    color: T.logoInk,
  });

  // Tagline in letterspaced caps, tracked out to the wordmark's width.
  //
  // Sized to FIT that width first, then tracked. It used to be sized off the
  // lockup height alone and tracked by whatever was left over, which at every
  // size this is ever drawn at was a negative number — twenty-four letters
  // asked to fit a space about two-thirds as wide, printed on top of one
  // another. Below the legibility floor the line is dropped instead: a mark
  // with no tagline reads as a mark, and one with unreadable mush under it
  // reads as a fault.
  const tagline = BRAND_TAGLINE.toUpperCase();
  const perPoint = measure(tagline, 'Helvetica-Bold', 1);
  const tagSize = perPoint > 0 ? Math.min(13 * s, wordW / perPoint) : 0;
  if (tagSize >= TAGLINE_MIN_SIZE) {
    const natural = measure(tagline, 'Helvetica-Bold', tagSize);
    // Spread over the gaps BETWEEN letters, so the last glyph's right edge
    // lands on the wordmark's, and never inward.
    const gaps = Math.max(1, tagline.length - 1);
    const tracking = Math.max(0, (wordW - natural) / gaps);
    doc.text(tagline, wordX, y + 112 * s - tagSize, {
      font: 'Helvetica-Bold',
      size: tagSize,
      color: T.logoInk,
      charSpacing: tracking,
    });
  }

  return LOGO_W * s;
}

// ------------------------------------------------------------------ helpers

function fullName(report: ReportPayload): string {
  return `${report.candidate.firstName} ${report.candidate.lastName}`.trim();
}

function refCode(report: ReportPayload): string {
  return report.reportToken.slice(0, 10).toUpperCase();
}

function truncate(value: string, font: StdFont, size: number, maxWidth: number): string {
  if (measure(value, font, size) <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && measure(out + '…', font, size) > maxWidth) out = out.slice(0, -1);
  return out + '…';
}

/** Largest size at or below `size` that fits `value` inside `maxWidth`. */
function fitSize(value: string, font: StdFont, size: number, maxWidth: number): number {
  const natural = measure(value, font, size);
  if (natural <= maxWidth || natural === 0) return size;
  return Math.max(5, Math.floor((size * maxWidth) / natural * 10) / 10);
}

function normaliseHex(value: string | undefined): string {
  if (!value) return '';
  return /^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : '';
}

/** Blends two hex colours; `t` is how much of `b` to take. Deterministic. */
function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (i: number) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * t);
  return `#${[ch(0), ch(1), ch(2)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(value: string): [number, number, number] {
  const v = value.trim().replace('#', '');
  const full =
    v.length === 3 ? v[0]! + v[0]! + v[1]! + v[1]! + v[2]! + v[2]! : v.length === 6 ? v : '000000';
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
