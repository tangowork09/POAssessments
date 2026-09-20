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
import type { SocioInsights } from '../../shared/socio-insights.js';
import type {
  CohortReportPayload,
  SocioGroupReportPayload,
  SocioMemberReportPayload,
} from '../../shared/types.js';
import { influenceMix, powerKindReading, signatures } from '../../shared/socio-scoring.js';
import { itemVisibility } from '../../shared/socio.js';
import type { SignatureMember, SocioBlockNetwork } from '../../shared/socio-scoring.js';
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
  /* The instrument's own blue, borrowed from the power-to block, for findings
     that are structural rather than good or bad. */
  accent: '#0B6FB4',
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
        // Short enough to survive the tile width: the long form truncated to
        // "0 = spread, 1 = one per…", which reads as a rendering fault.
        note: '0 spread, 1 one person',
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
  // The design's own first group-level question, before any of the detail.
  drawInfluenceMix(ctx, report);
  drawNetworks(ctx, report);
  drawAuthorityTrust(ctx, report);
  drawSupportGaps(ctx, report);
  drawFunctionSeams(ctx, report);
  drawSignatures(ctx, report);
  // The structural chapters. Absent from reports generated before the findings
  // were stored with the scores, so the whole section is skipped rather than
  // printed empty — a heading over "no data" reads as a fault in the group.
  drawInsightChapters(ctx, report);
  drawCoverage(ctx, report);
}

/**
 * Who the group leans on, how it clusters, and where it does not reach across
 * itself. Everything here is read straight off `group.insights`, computed when
 * the report was generated; nothing is recalculated at render time.
 */
function drawInsightChapters(ctx: Ctx, report: SocioGroupReportPayload): void {
  const ins = report.group.insights;
  if (!ins) return;
  drawAnchors(ctx, ins);
  drawBridges(ctx, ins);
  drawClusters(ctx, ins);
  drawUnreturned(ctx, ins, report.group.tieThreshold);
  drawSilos(ctx, ins);
  drawSpread(ctx, ins);
  drawCovertPower(ctx, ins);
  drawReliabilityOpenness(ctx, ins);
}

/** One ranked list in a panel, the shape both anchor lists and bridges take. */
function rankedPanel(
  ctx: Ctx,
  x: number,
  w: number,
  title: string,
  color: string,
  rows: { name: string; func: string; value: number }[],
  fmt: (v: number) => string,
  empty: string,
): number {
  const { doc } = ctx;
  const h = 40 + Math.max(rows.length, 1) * 18;
  doc.roundRect(x, ctx.y, w, h, 7, T.surface);
  doc.rect(x, ctx.y, 3, h, color);
  doc.text(title, x + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });

  let y = ctx.y + 36;
  if (rows.length === 0) doc.text(empty, x + 14, y, { size: 8.4, color: T.ink4 });
  for (const r of rows) {
    doc.text(truncate(r.name, 'Helvetica', 8.6, w - 86), x + 14, y, { size: 8.6, color: T.ink2 });
    doc.textRight(fmt(r.value), x + w - 14, y, { font: 'Helvetica-Bold', size: 8.6, color });
    y += 18;
  }
  return h;
}

function drawAnchors(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  ensure(ctx, 170);
  sectionHead(ctx, 'Anchors', 'Whom the group relies on, and whom it answers to');

  ctx.y = doc.paragraph(
    'Counted by how many colleagues put each person over the tie line — on trust on the left, on power-over on the right. A name in both columns is where reliance and authority sit in the same person, which is the group\u2019s real centre of gravity rather than its chart.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const colW = (CONTENT_W - 16) / 2;
  const rows = Math.max(ins.anchors.trusted.length, ins.anchors.influential.length, 1);
  ensure(ctx, 40 + rows * 18 + 30);

  const asInt = (v: number): string => String(Math.round(v));
  const h1 = rankedPanel(ctx, M.left, colW, 'Most trusted', T.good, ins.anchors.trusted, asInt, 'Nobody is over the line.');
  const h2 = rankedPanel(ctx, M.left + colW + 16, colW, 'Most deferred to', T.warn, ins.anchors.influential, asInt, 'Nobody is over the line.');
  ctx.y += Math.max(h1, h2) + 14;

  if (ins.anchors.both.length > 0) {
    ensure(ctx, 40);
    ctx.y = doc.paragraph(
      `Both at once: ${ins.anchors.both.join(', ')}.`,
      M.left,
      ctx.y,
      CONTENT_W,
      { size: 8.8, color: T.ink, leading: 13 },
    ) + 16;
  } else {
    ensure(ctx, 34);
    ctx.y = doc.paragraph(
      'Nobody holds both at once — the people relied on and the people deferred to are different people here.',
      M.left,
      ctx.y,
      CONTENT_W,
      { size: 8.8, color: T.ink2, leading: 13 },
    ) + 16;
  }
}

function drawBridges(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  ensure(ctx, 150);
  sectionHead(ctx, 'Bridges', 'Who the group would lose touch through');

  ctx.y = doc.paragraph(
    'The share of shortest trust paths that run through each person. A high figure with few ties of their own is the strongest form of this: somebody the group depends on to reach itself, whether or not anyone has noticed. It is a structural fact about the group, not a compliment, and it names a risk if that person leaves.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  ensure(ctx, 40 + Math.max(ins.bridges.length, 1) * 18 + 20);
  const h = rankedPanel(
    ctx,
    M.left,
    CONTENT_W,
    'Most between',
    T.accent,
    ins.bridges,
    (v) => v.toFixed(2),
    'No path runs through anyone: the network is too small or too evenly joined.',
  );
  ctx.y += h + 20;
}

function drawClusters(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  if (ins.clusters.length === 0) return;
  ensure(ctx, 140);
  sectionHead(ctx, 'Clusters', 'Which parts of the group hold together');

  ctx.y = doc.paragraph(
    'Found from the trust ties alone, with nobody told which group they belong to. One cluster means a group that holds together as one. Several mean the trust network has seams in it, and the names below say where.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  ins.clusters.forEach((cl, i) => {
    const names = cl.members.join(', ');
    const textH = doc.paragraphHeight(names, CONTENT_W - 28, { size: 8.6, leading: 12.5 });
    const h = 34 + textH;
    ensure(ctx, h + 10);
    doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, i === 0 ? T.surface2 : T.surface);
    doc.text(`Cluster ${i + 1} · ${cl.size} ${cl.size === 1 ? 'person' : 'people'}`, M.left + 14, ctx.y + 17, {
      font: 'Helvetica-Bold',
      size: 8.8,
      color: T.ink,
    });
    doc.paragraph(names, M.left + 14, ctx.y + 30, CONTENT_W - 28, { size: 8.6, color: T.ink2, leading: 12.5 });
    ctx.y += h + 8;
  });
  ctx.y += 12;
}

function drawUnreturned(ctx: Ctx, ins: SocioInsights, threshold: number): void {
  const { doc } = ctx;
  ensure(ctx, 150);
  sectionHead(ctx, 'One-way trust', 'Where reaching out is not returned');

  ctx.y = doc.paragraph(
    `One person rates another at ${threshold} or above on trust and does not get it back. The two kinds are different findings and are kept apart: "not returned" means the second person had an opinion and put it below the line, which is an asymmetry the group is living with; "no basis" means they never rated the first at all, which is usually distance or seniority rather than rejection.`,
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const h = 40 + Math.max(ins.unreturned.length, 1) * 18;
  ensure(ctx, h + 20);
  doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.surface);
  doc.text('Reaches out', M.left + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.text('Does not return', M.left + 210, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.textRight('Gap', M.left + CONTENT_W - 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });

  let y = ctx.y + 36;
  if (ins.unreturned.length === 0) {
    doc.text('Every tie at this threshold is returned.', M.left + 14, y, { size: 8.4, color: T.ink4 });
  }
  for (const t of ins.unreturned) {
    doc.text(truncate(t.from, 'Helvetica', 8.6, 180), M.left + 14, y, { size: 8.6, color: T.ink2 });
    doc.text(truncate(t.to, 'Helvetica', 8.6, 180), M.left + 210, y, { size: 8.6, color: T.ink2 });
    doc.textRight(
      t.kind === 'no_basis' ? 'no basis' : (t.gap === null ? '—' : t.gap.toFixed(2)),
      M.left + CONTENT_W - 14,
      y,
      { font: 'Helvetica-Bold', size: 8.6, color: t.kind === 'no_basis' ? T.ink4 : T.warn },
    );
    y += 18;
  }
  ctx.y += h + 20;
}

function drawSilos(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  const rows = ins.silos.filter((s) => s.size > 0);
  if (rows.length < 2) return;
  ensure(ctx, 150);
  sectionHead(ctx, 'Silos', 'How much of each function stays inside itself');

  ctx.y = doc.paragraph(
    'Both rates are over the pairs that were possible, not over the ties given, so a small function is not flattered by having fewer people to ignore. A within-rate far above the out-rate is a silo; the two close together is a function that works across its own boundary. Functions of fewer than three people keep their counts but not their rates — in a group this named, a two-person average is two people with a decimal point on it.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const h = 40 + rows.length * 18;
  ensure(ctx, h + 20);
  doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.surface);
  doc.text('Function', M.left + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.textRight('People', M.left + CONTENT_W - 200, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.textRight('Within', M.left + CONTENT_W - 110, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.textRight('Outward', M.left + CONTENT_W - 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });

  let y = ctx.y + 36;
  for (const r of rows) {
    const siloed = r.withinRate !== null && r.outRate !== null && r.withinRate - r.outRate >= 0.2;
    doc.text(truncate(r.key, 'Helvetica', 8.6, 200), M.left + 14, y, { size: 8.6, color: T.ink2 });
    doc.textRight(String(r.size), M.left + CONTENT_W - 200, y, { size: 8.6, color: T.ink3 });
    doc.textRight(
      r.withinRate === null ? 'withheld' : r.withinRate.toFixed(2),
      M.left + CONTENT_W - 110,
      y,
      { font: 'Helvetica-Bold', size: 8.6, color: siloed ? T.warn : T.ink2 },
    );
    doc.textRight(r.outRate === null ? 'withheld' : r.outRate.toFixed(2), M.left + CONTENT_W - 14, y, {
      size: 8.6,
      color: T.ink2,
    });
    y += 18;
  }
  ctx.y += h + 20;
}

function drawSpread(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  const rows = ins.spread.filter((r) => r.concentration !== null);
  if (rows.length === 0) return;
  ensure(ctx, 140);
  sectionHead(ctx, 'Spread', 'Whether each network is held by everyone or by a few');

  ctx.y = doc.paragraph(
    'Zero would be every person receiving the same number of ties; one would be a single person holding all of them. High concentration is not a fault — a group can reasonably route its authority through few people — but concentration on trust is a different matter from concentration on power, and the two are worth reading against each other.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const h = 40 + rows.length * 20;
  ensure(ctx, h + 20);
  doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.surface);
  doc.text('Network', M.left + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
  doc.textRight('Concentration', M.left + CONTENT_W - 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });

  let y = ctx.y + 36;
  const barX = M.left + 190;
  const barW = CONTENT_W - 190 - 70;
  for (const r of rows) {
    const v = r.concentration ?? 0;
    doc.text(truncate(r.name, 'Helvetica', 8.6, 170), M.left + 14, y - 2, { size: 8.6, color: T.ink2 });
    doc.roundRect(barX, y - 9, barW, 7, 3.5, T.track);
    doc.roundRect(barX, y - 9, Math.max(2, barW * Math.min(1, v)), 7, 3.5, v >= 0.5 ? T.warn : T.good);
    doc.textRight(v.toFixed(2), M.left + CONTENT_W - 14, y - 2, { font: 'Helvetica-Bold', size: 8.6, color: T.ink });
    y += 20;
  }
  ctx.y += h + 20;
}

/**
 * The half of power no org chart shows — the guide's §5.4 warning.
 *
 * "If a few leaders hold most incoming power ties — especially covert
 * power-over ('sets the agenda', 'works behind the scenes') — you have a
 * hidden imbalance no structure chart reveals." Concentration across the whole
 * power-over band cannot answer that, because a formal veto right is visible
 * and discussable in a way that pre-meeting agenda-shaping is not. So the
 * covert statements are read on their own and against the band as a whole.
 */
function drawCovertPower(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  const c = ins.covertPower;
  if (!c || c.statements.length === 0) return;

  ensure(ctx, 170);
  sectionHead(ctx, 'Hidden power', 'Influence exercised before the room');

  ctx.y = doc.paragraph(
    `Some power is on show: who signs, who can hold an initiative up. Some is not: who decides which issues get attention, and who has shaped a decision informally before it reaches the room. Only the second kind is invisible to a structure chart, and it is read here on its own — off "${c.statements.join('" and "')}" — rather than averaged in with open decision rights.`,
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const tiles: Tile[] = [
    { label: 'Covert ties', value: String(c.ties), note: 'people put over the line', color: T.warn },
    { label: 'Density', value: pct(c.density), note: 'of the pairs asked', color: T.ink2 },
    {
      label: 'Covert concentration',
      value: c.concentration === null ? '—' : c.concentration.toFixed(2),
      note: '0 spread, 1 one person',
      color: T.ink2,
    },
    {
      label: 'All power-over',
      value: c.overtConcentration === null ? '—' : c.overtConcentration.toFixed(2),
      note: 'for the whole band',
      color: T.ink2,
    },
  ];
  ensure(ctx, 70);
  ctx.y = drawStatTiles(doc, M.left, ctx.y, CONTENT_W, tiles) + 14;

  if (c.holders.length > 0) {
    const rows = c.holders.slice(0, 6);
    const h = 36 + rows.length * 18;
    ensure(ctx, h + 12);
    doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.surface);
    doc.text('Who holds it', M.left + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 8.8, color: T.ink });
    let y = ctx.y + 36;
    for (const r of rows) {
      doc.text(`${r.name}${r.func ? ` · ${r.func}` : ''}`, M.left + 14, y, { size: 8.6, color: T.ink2 });
      doc.textRight(
        `${r.value} ${r.value === 1 ? 'colleague' : 'colleagues'}`,
        M.left + CONTENT_W - 14,
        y,
        { font: 'Helvetica-Bold', size: 8.4, color: T.ink },
      );
      y += 18;
    }
    ctx.y += h + 12;
  }

  ensure(ctx, 46);
  ctx.y = doc.paragraph(c.verdict, M.left, ctx.y, CONTENT_W, { size: 9.2, color: T.ink, leading: 13.5 }) + 8;
  drawNote(
    ctx,
    'Not an accusation',
    'Shaping an issue before a meeting is ordinary leadership, and someone has to set an agenda. The finding is about concentration, not conduct: it matters when the informal half of power sits in markedly fewer hands than the formal half, because that is the half nobody can point at on a chart.',
  );
  ctx.y += 10;
}

function drawReliabilityOpenness(ctx: Ctx, ins: SocioInsights): void {
  const { doc } = ctx;
  const r = ins.reliabilityVsOpenness;
  ensure(ctx, 140);
  sectionHead(ctx, 'Reliability and openness', 'Two halves of trust, read apart');

  ctx.y = doc.paragraph(
    'Trust is asked as three statements, and two of them pull in different directions: whether somebody delivers what they said they would, and whether people say what they actually think to them. Read together they average into one number that hides which is missing. Read apart they name it.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  const colW = (CONTENT_W - 16) / 2;
  // Tall enough for an 18pt figure and a two-line label under it without the
  // two meeting.
  const h = 84;
  ensure(ctx, h + 60);
  const cells: { label: string; value: number | null; color: string }[] = [
    { label: 'Reliability — delivers what they said', value: r.reliability, color: T.good },
    { label: 'Openness — hears what people think', value: r.openness, color: T.accent },
  ];
  cells.forEach((cell, i) => {
    const x = M.left + i * (colW + 16);
    doc.roundRect(x, ctx.y, colW, h, 7, T.surface);
    doc.rect(x, ctx.y, 3, h, cell.color);
    doc.text(cell.value === null ? '—' : cell.value.toFixed(2), x + 14, ctx.y + 32, {
      font: 'Helvetica-Bold',
      size: 18,
      color: T.ink,
    });
    doc.paragraph(cell.label, x + 14, ctx.y + 50, colW - 28, { size: 8.2, color: T.ink3, leading: 11 });
  });
  ctx.y += h + 14;

  ensure(ctx, 40);
  ctx.y = doc.paragraph(r.verdict, M.left, ctx.y, CONTENT_W, { size: 8.8, color: T.ink, leading: 13 }) + 20;
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
    // Power items carry their face — visible, hidden, or both — because the
    // guide's whole warning about concentration turns on which face it is, and
    // a reader who meets "Hidden power" later is owed the wording it came from.
    const itemLines = report.items
      .filter((i) => block.items.includes(i.no))
      .map((i) => {
        const faces = itemVisibility(i.no);
        return faces.length > 0 ? `${i.short} (${faces.join('/')})` : i.short;
      });
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

/**
 * How influence flows — enabling power against controlling power.
 *
 * The whole point of banding power-to/with apart from power-over is to be able
 * to answer this in one sentence, so it is given a chapter of its own near the
 * front rather than being left for a reader to work out from four densities.
 */
function drawInfluenceMix(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const mix = influenceMix(report.group);

  ensure(ctx, 170);
  sectionHead(ctx, 'How influence flows', 'Enabling power against control');

  ctx.y = doc.paragraph(
    'Power here is counted in two bands that are never added together. Enabling power is being sought out, relied on to read the organisation, able to unlock what somebody needs, or trusted to bring people with you. Controlling power is deference, gatekeeping, consequence and agenda-setting. A group can be influential through either.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  if (mix.share === null) {
    doc.text(mix.verdict, M.left, ctx.y, { size: 8.8, color: T.ink4 });
    ctx.y += 26;
    return;
  }

  const h = 56;
  ensure(ctx, h + 60);
  const barW = CONTENT_W;
  const enabW = Math.max(2, barW * mix.share);
  doc.roundRect(M.left, ctx.y + 20, barW, 16, 8, T.surface2);
  doc.roundRect(M.left, ctx.y + 20, enabW, 16, 8, T.good);
  doc.text(`Enabling  ${mix.enabling}`, M.left, ctx.y + 12, { font: 'Helvetica-Bold', size: 8.6, color: T.good });
  doc.textRight(`${mix.controlling}  Controlling`, M.left + CONTENT_W, ctx.y + 12, {
    font: 'Helvetica-Bold',
    size: 8.6,
    color: T.warn,
  });
  ctx.y += h;

  ensure(ctx, 44);
  ctx.y = doc.paragraph(mix.verdict, M.left, ctx.y, CONTENT_W, { size: 9.2, color: T.ink, leading: 13.5 }) + 20;
}

/**
 * The three ways non-collaboration shows up, each as a pattern of absence.
 *
 * Nobody was asked who they distrust, so none of this is a nomination: it is
 * read off low ratings, missing ratings and the support gap. The three are
 * kept apart because they call for opposite responses — the last one is a
 * connection problem, not a conduct one.
 */
function drawSignatures(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const found = signatures(report.group);
  const sections: { title: string; note: string; color: string; rows: SignatureMember[] }[] = [
    {
      title: 'Depended on, not trusted',
      note: 'Control ahead of trust, and colleagues asking for more than they get.',
      color: T.warn,
      rows: found.dominating,
    },
    {
      title: 'Quietly unreliable',
      note: 'Low on delivery and on being straightforward to work with. A trust problem, not a power one.',
      color: T.warn,
      rows: found.unreliable,
    },
    {
      title: 'Outside the network',
      note: 'Too few colleagues had a basis to judge. Connect, do not correct.',
      color: T.ink3,
      rows: found.disconnected,
    },
  ];
  if (sections.every((s) => s.rows.length === 0)) return;

  ensure(ctx, 150);
  sectionHead(ctx, 'Where collaboration is not happening', 'Three patterns of absence');

  ctx.y = doc.paragraph(
    'Nobody was asked to name who they avoid or distrust. These three readings are what a refusal to collaborate looks like in a positive-only instrument: ratings that stay low, colleagues who ask for more, and people nobody had a basis to rate at all.',
    M.left,
    ctx.y,
    CONTENT_W,
    { size: BODY.size, color: T.ink2, leading: BODY.leading },
  ) + 14;

  for (const section of sections) {
    if (section.rows.length === 0) continue;
    const rows = section.rows.slice(0, 6);
    const h = 50 + rows.length * 24 + 6;
    ensure(ctx, h + 12);
    doc.roundRect(M.left, ctx.y, CONTENT_W, h, 7, T.surface);
    doc.rect(M.left, ctx.y, 3, h, section.color);
    doc.text(section.title, M.left + 14, ctx.y + 17, { font: 'Helvetica-Bold', size: 9.2, color: T.ink });
    doc.text(section.note, M.left + 14, ctx.y + 30, { size: 7.8, color: T.ink3 });
    let y = ctx.y + 50;
    for (const r of rows) {
      doc.text(`${r.name}${r.func ? ` · ${r.func}` : ''}`, M.left + 14, y, {
        font: 'Helvetica-Bold',
        size: 8.6,
        color: T.ink,
      });
      doc.textRight(r.why, M.left + CONTENT_W - 14, y, { size: 7.8, color: T.ink2 });
      y += 24;
    }
    ctx.y += h + 10;
    if (section.rows.length > rows.length) {
      doc.text(`and ${section.rows.length - rows.length} more`, M.left + 14, ctx.y, { size: 7.8, color: T.ink4 });
      ctx.y += 14;
    }
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
  drawPowerKindSplit(ctx, report);
}

/**
 * The guide's §5.2 instruction, which the two columns above cannot carry on
 * their own: "split by kind of power".
 *
 * A person colleagues comply with more than they rely on is either a
 * gatekeeper or an expert nobody warms to, and the guide prescribes opposite
 * responses — redesign the decision rights, or develop the relationships. The
 * two used to print identically, which made the list a flag with no action
 * attached to it.
 */
function drawPowerKindSplit(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const named = report.group.authorityWithoutTrust.filter((e) => e.powerKind !== null);
  if (named.length === 0) return;

  const kinds = [...new Set(named.map((e) => e.powerKind!))];
  const rowsH = 34 + named.length * 18;
  const notesH = kinds.length * 46;
  ensure(ctx, rowsH + notesH + 20);

  doc.text('Which kind of power is doing it', M.left, ctx.y, {
    font: 'Helvetica-Bold',
    size: 9.6,
    color: T.ink,
  });
  ctx.y += 18;

  for (const e of named) {
    const reading = powerKindReading(e.powerKind!);
    doc.text(truncate(e.name, 'Helvetica-Bold', 8.8, 200), M.left + 14, ctx.y, {
      font: 'Helvetica-Bold',
      size: 8.8,
      color: T.ink,
    });
    doc.textRight(reading.label, M.left + CONTENT_W - 14, ctx.y, {
      size: 8.4,
      color: e.powerKind === 'bottleneck' ? T.warn : T.ink2,
    });
    ctx.y += 18;
  }
  ctx.y += 8;

  for (const kind of kinds) {
    const reading = powerKindReading(kind);
    ensure(ctx, 52);
    const start = ctx.y;
    const end = doc.paragraph(reading.fix, M.left + 16, start + 12, CONTENT_W - 30, {
      size: 8.4,
      color: T.ink2,
      leading: 12,
    });
    doc.rect(M.left, start, 2, end - start + 10, kind === 'bottleneck' ? T.warn : T.line);
    ctx.y = end + 14;
  }
  ctx.y += 6;
}

function drawSupportGaps(ctx: Ctx, report: SocioGroupReportPayload): void {
  const { doc } = ctx;
  const gaps = report.group.supportGaps;

  ensure(ctx, 120);
  sectionHead(ctx, 'Where more is wanted', 'How many colleagues asked for more');

  ctx.y = doc.paragraph(
    'Colleagues were asked whether they would like more support or cooperation than they currently get. The bar is how many asked — the measure the design calls for, since one person asking loudly is a different finding from eight asking steadily. A high figure is not a verdict on the person named: it is most often a load problem, an unclear boundary, or a queue nobody owns.',
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

  // The bar is how many colleagues asked, which is the guide's measure; the
  // mean beside it is how strongly they asked.
  const mostWanters = Math.max(1, ...gaps.map((g) => g.wanters));
  for (const gp of gaps) {
    doc.text(truncate(gp.name, 'Helvetica', 8.8, 160), M.left, ctx.y, { size: 8.8, color: T.ink2 });
    doc.roundRect(barX, ctx.y - 1, barW, 8, 4, T.track);
    doc.roundRect(barX, ctx.y - 1, Math.max(4, (barW * gp.wanters) / mostWanters), 8, 4, T.warn);
    doc.textRight(
      `${gp.wanters} of ${gp.n} asked  ·  ${gp.mean.toFixed(2)}`,
      RIGHT,
      ctx.y,
      { size: 8, color: T.ink3 },
    );
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
