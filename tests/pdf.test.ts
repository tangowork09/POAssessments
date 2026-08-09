import { describe, expect, it } from 'vitest';
import { A4, PdfDoc, hex, measure, toBase64, wrap } from '../src/worker/lib/../pdf/writer.js';
import { renderReportPdf } from '../src/worker/pdf/report.js';
import { buildReport } from '../src/worker/lib/report.js';
import { ASSESSMENT_ID } from '../src/shared/assessments.js';
import { QUESTION_COUNT } from '../src/shared/scoring.js';
import { EGO_QUESTION_COUNT } from '../src/shared/ego-scoring.js';
import { EGO_DRAFT_NOTE, EGO_STATES } from '../src/shared/ego.js';
import { INFLUENCING_METHODS } from '../src/shared/styles.js';
import type { EgoReportPayload, IsiReportPayload } from '../src/shared/types.js';

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Every string the document actually draws, unescaped and joined with single
 * spaces. Content assertions go through this rather than through the raw bytes,
 * because a paragraph is wrapped into one `Tj` per line — a sentence never
 * appears contiguously in the file.
 */
/** WinAnsi's non-Latin-1 slots, back to the code points the writer folded in. */
const WIN_ANSI_BACK: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function drawnText(bytes: Uint8Array): string {
  const raw = latin1(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/\((.*?)(?<!\\)\) Tj/g)) {
    let s = '';
    const body = m[1]!;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch !== '\\') {
        s += ch;
        continue;
      }
      const next = body[i + 1]!;
      if (next >= '0' && next <= '7') {
        const code = Number.parseInt(body.slice(i + 1, i + 4), 8);
        s += WIN_ANSI_BACK[code] ?? String.fromCharCode(code);
        i += 3;
      } else {
        s += next;
        i += 1;
      }
    }
    out.push(s);
  }
  return out.join(' ');
}

const CANDIDATE = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  organisation: 'Meridian Group',
  ageBand: '35–44',
  experienceBand: '6–10',
  gender: 'Female',
};

const BRANDING = {
  companyName: 'Meridian Group',
  accentColor: '#1A4FD6',
  logoDataUrl: '',
  supportEmail: '',
};

describe('font metrics', () => {
  it('matches published Adobe Helvetica advance widths', () => {
    // Widths are 1/1000 em, so a 1000pt font gives the raw AFM number.
    expect(measure('A', 'Helvetica', 1000)).toBe(667);
    expect(measure(' ', 'Helvetica', 1000)).toBe(278);
    expect(measure('W', 'Helvetica', 1000)).toBe(944);
    expect(measure('i', 'Helvetica', 1000)).toBe(222);
    expect(measure('A', 'Helvetica-Bold', 1000)).toBe(722);
  });

  it('scales linearly with size', () => {
    expect(measure('Hello', 'Helvetica', 20)).toBeCloseTo(measure('Hello', 'Helvetica', 10) * 2, 6);
  });

  it('measures characters outside Latin-1 without throwing', () => {
    expect(measure('—', 'Helvetica', 10)).toBeGreaterThan(0);
    expect(measure('’', 'Helvetica', 10)).toBeGreaterThan(0);
    expect(measure('日本', 'Helvetica', 10)).toBeGreaterThan(0); // falls back to '?'
  });
});

describe('wrap', () => {
  it('keeps every line inside the column', () => {
    const text =
      'You are willing to apply direct pressure when the result matters more than the comfort of getting there.';
    const lines = wrap(text, 'Helvetica', 10, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 'Helvetica', 10)).toBeLessThanOrEqual(200);
  });

  it('preserves all words in order', () => {
    const text = 'one two three four five six seven eight nine ten';
    expect(wrap(text, 'Helvetica', 10, 60).join(' ')).toBe(text);
  });

  it('breaks a single token wider than the column', () => {
    const lines = wrap('A'.repeat(200), 'Helvetica', 10, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 'Helvetica', 10)).toBeLessThanOrEqual(100);
  });

  it('honours explicit newlines', () => {
    expect(wrap('a\nb', 'Helvetica', 10, 500)).toEqual(['a', 'b']);
  });
});

describe('hex', () => {
  it('parses long and short form', () => {
    expect(hex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hex('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hex('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    const accent = hex('#1A4FD6');
    expect(accent.r).toBeCloseTo(26 / 255, 5);
    expect(accent.g).toBeCloseTo(79 / 255, 5);
    expect(accent.b).toBeCloseTo(214 / 255, 5);
  });
});

describe('PdfDoc', () => {
  it('writes a structurally valid single-page document', () => {
    const doc = new PdfDoc(A4, { title: 'Test' });
    doc.text('Hello', 50, 50, { size: 12 });
    const s = latin1(doc.build());

    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('/Type /Pages');
    expect(s).toContain('/Count 1');
    expect(s).toContain('/BaseFont /Helvetica');
    expect(s).toContain('/Encoding /WinAnsiEncoding');
  });

  it('produces byte-accurate xref offsets', () => {
    const doc = new PdfDoc(A4);
    doc.text('Objects at known offsets', 40, 40);
    doc.rect(10, 10, 100, 20, '#1A4FD6');
    doc.addPage();
    doc.text('Second page', 40, 40);
    const bytes = doc.build();
    const s = latin1(bytes);

    const startxref = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');

    const xrefBlock = s.slice(startxref);
    const offsets = [...xrefBlock.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(3);
    offsets.forEach((off, i) => {
      // Each recorded offset must land exactly on "<n> 0 obj".
      expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('escapes parentheses and backslashes in text', () => {
    const doc = new PdfDoc(A4);
    doc.text('a (b) \\ c', 10, 10);
    const s = latin1(doc.build());
    expect(s).toContain('(a \\(b\\) \\\\ c) Tj');
  });

  it('maps typographic punctuation into WinAnsi', () => {
    const doc = new PdfDoc(A4);
    doc.text('—’•', 10, 10);
    const s = latin1(doc.build());
    // 0227 = 0x97 em dash, 0222 = 0x92 right quote, 0225 = 0x95 bullet
    expect(s).toContain('\\227\\222\\225');
  });

  it('counts pages and lets a later pass draw on earlier ones', () => {
    const doc = new PdfDoc(A4);
    doc.addPage();
    doc.addPage();
    expect(doc.pageCount).toBe(3);
    doc.onPage(0, () => doc.text('footer on page one', 10, 800));
    // Drawing on page 0 must not disturb the current page pointer.
    doc.text('still on page three', 10, 100);
    const s = latin1(doc.build());
    expect(s).toContain('/Count 3');
    expect(s).toContain('footer on page one');
  });
});

describe('toBase64', () => {
  it('round-trips binary content', () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 256);
    expect(Buffer.from(toBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('path primitives', () => {
  it('emits a cubic Bezier with the same top-down y convention as text', () => {
    const doc = new PdfDoc(A4);
    doc.path().moveTo(0, 0).curveTo(10, 0, 20, 0, 30, 0).close().fill('#000000');
    const s = latin1(doc.build());
    // y = 0 at the top maps to the page height at the bottom of PDF space.
    expect(s).toContain(`0 ${A4.height} m`);
    expect(s).toContain(`10 ${A4.height} 20 ${A4.height} 30 ${A4.height} c`);
    expect(s).toContain('h');
    expect(s).toContain('f\n');
  });

  it('fills a polygon and strokes a path', () => {
    const doc = new PdfDoc(A4);
    doc.polygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      '#FF0000',
    );
    doc.path().moveTo(0, 0).lineTo(10, 10).stroke('#00FF00', 2);
    const s = latin1(doc.build());
    expect(s).toContain('1 0 0 rg');
    expect(s).toContain('0 1 0 RG');
    expect(s).toContain('2 w');
    expect(s).toContain('S');
  });

  it('draws rounded rectangles with four corner curves', () => {
    const doc = new PdfDoc(A4);
    doc.roundRect(10, 10, 100, 50, 8, '#000000');
    const s = latin1(doc.build());
    expect((s.match(/ c\n/g) ?? []).length).toBe(4);
  });

  it('degrades a rounded rectangle with zero radius to a plain rect', () => {
    const doc = new PdfDoc(A4);
    doc.roundRect(10, 10, 100, 50, 0, '#000000');
    const s = latin1(doc.build());
    expect(s).toContain(' re\n');
    expect(s).not.toContain(' c\n');
  });

  it('closes an ellipse with four Bezier arcs and supports even-odd rings', () => {
    const doc = new PdfDoc(A4);
    doc.path().ellipse(100, 100, 40, 20).ellipse(100, 100, 20, 10).fill('#000000', true);
    const s = latin1(doc.build());
    expect((s.match(/ c\n/g) ?? []).length).toBe(8);
    expect(s).toContain('f*');
  });

  it('rotates an ellipse about its centre', () => {
    const doc = new PdfDoc(A4);
    doc.path().ellipse(100, 100, 40, 10, 90).fill('#000000');
    const s = latin1(doc.build());
    // At 90 degrees the +x vertex moves to +y (downward in layout space).
    expect(s).toContain(`100 ${A4.height - 140} m`);
  });

  it('installs a clip region around nested drawing', () => {
    const doc = new PdfDoc(A4);
    doc.path().rect(0, 0, 50, 50).clip(() => doc.rect(0, 0, 500, 500, '#123456'));
    const s = latin1(doc.build());
    expect(s).toContain('W n');
  });
});

describe('gradients', () => {
  it('registers an axial shading and paints it into a rectangle', () => {
    const doc = new PdfDoc(A4);
    const g = doc.gradient(0, 0, 100, 0, [
      { offset: 0, color: '#FF0000' },
      { offset: 1, color: '#0000FF' },
    ]);
    expect(g.name).toBe('Sh1');
    doc.shadeRect(0, 0, 100, 20, g);
    const s = latin1(doc.build());
    expect(s).toContain('/ShadingType 2');
    expect(s).toContain('/ColorSpace /DeviceRGB');
    expect(s).toContain('/FunctionType 2');
    expect(s).toContain('/C0 [1 0 0]');
    expect(s).toContain('/C1 [0 0 1]');
    expect(s).toContain('/Shading << /Sh1');
    expect(s).toContain('/Sh1 sh');
  });

  it('stitches more than two stops with a type-3 function', () => {
    const doc = new PdfDoc(A4);
    const g = doc.gradient(0, 0, 0, 100, [
      { offset: 0, color: '#FF0000' },
      { offset: 0.5, color: '#00FF00' },
      { offset: 1, color: '#0000FF' },
    ]);
    doc.shadeRect(0, 0, 10, 100, g);
    const s = latin1(doc.build());
    expect(s).toContain('/FunctionType 3');
    expect(s).toContain('/Bounds [0.5]');
    expect(s).toContain('/Encode [0 1 0 1]');
  });

  it('omits the shading resource entirely when no gradient is used', () => {
    const doc = new PdfDoc(A4);
    doc.text('plain', 10, 10);
    expect(latin1(doc.build())).not.toContain('/Shading');
  });

  it('flips gradient coordinates into PDF space', () => {
    const doc = new PdfDoc(A4);
    doc.shadeRect(0, 0, 10, 10, doc.gradient(0, 0, 0, 100, [{ offset: 0, color: '#000' }]));
    const s = latin1(doc.build());
    expect(s).toContain(`/Coords [0 ${A4.height} 0 ${A4.height - 100}]`);
  });
});

// --------------------------------------------------------------- ISI report

describe('renderReportPdf — Influencing Style Inventory', () => {
  const answers: Record<number, number> = {};
  for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 3) % 5;

  const report = buildReport({
    reportToken: 'r'.repeat(43),
    assessmentId: ASSESSMENT_ID.isi,
    assessmentName: 'Influencing Style Inventory',
    candidate: CANDIDATE,
    completedAt: '2026-08-09 10:30:00',
    branding: BRANDING,
    answers,
  }) as IsiReportPayload;

  it('is tagged as an ISI payload with scores inside the new reference frames', () => {
    expect(report.kind).toBe('isi');
    for (const style of report.scores.styles) {
      expect(style.score).toBeGreaterThanOrEqual(0);
      expect(style.score).toBeLessThanOrEqual(16);
    }
    expect(report.scores.push).toBeLessThanOrEqual(80);
    expect(report.scores.pull).toBeLessThanOrEqual(80);
  });

  it('renders a multi-page PDF containing the report content', () => {
    const bytes = renderReportPdf(report);
    const s = latin1(bytes);

    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(bytes.length).toBeGreaterThan(4000);
    expect(Number(s.match(/\/Count (\d+)/)![1])).toBeGreaterThanOrEqual(6);
    expect(s).toContain('Priya');
    expect(s).toContain('ASSESSMENT REPORT'); // cover
    expect(s).toContain('Executive summary');
    expect(s).toContain('KEY NUMBERS');
    expect(s).toContain('WHEN OVERUSED');
    expect(s).toContain('Confidential');
    // Every one of the ten styles must appear on the bars.
    for (const style of report.scores.styles) {
      const first = style.name.split(' ')[0]!;
      expect(s, `missing style ${style.name}`).toContain(first);
    }
  });

  it('carries the /16 and /80 reference frames, not the old /20 and /100', () => {
    const text = drawnText(renderReportPdf(report));
    expect(text).toContain('Each style scored out of 16');
    expect(text).toContain('Each method scored out of 80');
    expect(text).not.toContain('out of 20');
    expect(text).not.toContain('out of 100');
  });

  it('shows the Low / Moderate / High band boundaries at 6 and 11', () => {
    const text = drawnText(renderReportPdf(report));
    expect(text).toContain('Low 0\u20136');
    expect(text).toContain('Moderate 7\u201311');
    expect(text).toContain('High 12\u201316');
    expect(text).toContain('The dividers on each bar sit at 6 and 11');
  });

  it('reproduces the influencing-method copy verbatim', () => {
    const text = drawnText(renderReportPdf(report));
    expect(text).toContain('THE PUSH METHOD');
    expect(text).toContain('THE PULL METHOD');
    // The client's own wording, whole and unparaphrased.
    expect(text).toContain(INFLUENCING_METHODS.push);
    expect(text).toContain(INFLUENCING_METHODS.pull);
    // Distinctive fragments, spelled out so a paraphrase would fail loudly.
    expect(text).toContain('The Push Method');
    expect(text).toContain('stake in the eventual outcomes');
    expect(text).toContain('logical and aggressive with quick results');
  });

  it('numbers every page and reports a consistent total', () => {
    const s = latin1(renderReportPdf(report));
    const count = Number(s.match(/\/Count (\d+)/)![1]);
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 1; i <= count; i++) {
      expect(s, `missing footer for page ${i}`).toContain(`Page ${i} of ${count}`);
    }
  });

  it('is deterministic for the same input', () => {
    expect(Buffer.from(renderReportPdf(report)).equals(Buffer.from(renderReportPdf(report)))).toBe(true);
  });

  it('respects the branding accent colour', () => {
    const branded = { ...report, branding: { ...report.branding, accentColor: '#B4530E' } };
    const s = latin1(renderReportPdf(branded));
    // 0xB4/255=0.706, 0x53/255=0.325, 0x0E/255=0.055, rounded to 2dp by the writer.
    expect(s).toContain('0.71 0.33 0.05 rg');
    // …and the default blue must be gone from the accent-driven marks.
    expect(latin1(renderReportPdf(report))).toContain('0.1 0.31 0.84 rg');
  });

  it('falls back to the house accent when branding supplies rubbish', () => {
    const broken = { ...report, branding: { ...report.branding, accentColor: 'not-a-colour' } };
    const s = latin1(renderReportPdf(broken));
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    // #0B6FB4 -> 0.04 0.44 0.71
    expect(s).toContain('0.04 0.44 0.71 rg');
  });

  it('survives extreme content without corrupting the file', () => {
    const long = {
      ...report,
      candidate: {
        ...report.candidate,
        firstName: 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        lastName: 'Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        organisation: 'A very long organisation name that will not fit inside its cell at all',
      },
      assessmentName:
        'An Extremely Long Instrument Name That Would Never Fit On One Line Of A Cover Page',
    };
    const s = latin1(renderReportPdf(long));
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

// --------------------------------------------------------------- Ego report

describe('renderReportPdf — Ego States Scale', () => {
  const answers: Record<number, number> = {};
  for (let n = 1; n <= EGO_QUESTION_COUNT; n++) answers[n] = (n * 5) % 7;

  const report = buildReport({
    reportToken: 'e'.repeat(43),
    assessmentId: ASSESSMENT_ID.ego,
    assessmentName: 'Ego States Scale',
    candidate: CANDIDATE,
    completedAt: '2026-08-09 10:30:00',
    branding: BRANDING,
    answers,
  }) as EgoReportPayload;

  it('builds an ego payload from 66 answers in 0..6', () => {
    expect(ASSESSMENT_ID.ego).toBe('asm_ta_ego_states');
    expect(report.kind).toBe('ego');
    expect(report.ego.states).toHaveLength(6);
    expect(report.labelsAreDraft).toBe(true);
    for (const s of report.ego.states) {
      expect(s.score).toBeLessThanOrEqual(66);
    }
  });

  it('renders a multi-page PDF with the ego-gram and every state abbreviation', () => {
    const bytes = renderReportPdf(report);
    const s = latin1(bytes);
    const text = drawnText(bytes);

    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(Number(s.match(/\/Count (\d+)/)![1])).toBeGreaterThanOrEqual(5);
    expect(text).toContain('Your ego-gram');
    expect(text).toContain('The six ego states');
    expect(text).toContain('Each state scored out of 66');
    for (const state of EGO_STATES) {
      expect(text, `missing abbr ${state.abbr}`).toContain(state.abbr);
      expect(text, `missing description of ${state.name}`).toContain(
        state.description.split('. ')[0]!,
      );
    }
  });

  it('labels every ego-gram column with its percentage', () => {
    const text = drawnText(renderReportPdf(report));
    for (const state of report.ego.states) {
      expect(text, `missing percent for ${state.abbr}`).toContain(`${state.percent}%`);
      expect(text, `missing raw score for ${state.abbr}`).toContain(`${state.score}/66`);
    }
  });

  it('draws the ego-gram in column order, not sorted by score', () => {
    expect(report.states.map((s) => s.stateKey)).toEqual(EGO_STATES.map((s) => s.key));
  });

  it('prints the draft note where a reader will meet it', () => {
    const text = drawnText(renderReportPdf(report));
    expect(text).toContain('DRAFT LABELS');
    expect(text).toContain(report.draftNote);
    expect(text).toContain(EGO_DRAFT_NOTE);
    // …and the section head of the per-state pages flags it too.
    expect(text).toContain('Names and copy are draft');
  });

  it('names the highest and lowest states with their own narratives', () => {
    const text = drawnText(renderReportPdf(report));
    expect(text).toContain('MOST AVAILABLE');
    expect(text).toContain('LEAST AVAILABLE');
    expect(text).toContain(report.highest.high);
    expect(text).toContain(report.lowest.low);
    expect(text).toContain(report.lowest.dev);
  });

  it('uses each state’s own colour on the chart', () => {
    const s = latin1(renderReportPdf(report));
    // #2FA96B (Nurturing Parent) -> 0.18 0.66 0.42 in a shading C1.
    expect(s).toContain('0.18 0.66 0.42');
  });

  it('numbers every page and reports a consistent total', () => {
    const s = latin1(renderReportPdf(report));
    const count = Number(s.match(/\/Count (\d+)/)![1]);
    for (let i = 1; i <= count; i++) {
      expect(s, `missing footer for page ${i}`).toContain(`Page ${i} of ${count}`);
    }
  });

  it('is deterministic for the same input', () => {
    expect(Buffer.from(renderReportPdf(report)).equals(Buffer.from(renderReportPdf(report)))).toBe(true);
  });

  it('stays small — the lockup is vector, not an embedded raster', () => {
    const bytes = renderReportPdf(report);
    expect(bytes.length).toBeLessThan(120_000);
    expect(latin1(bytes)).not.toContain('/XObject');
  });
});
