import { describe, expect, it } from 'vitest';
import { A4, PdfDoc, hex, measure, toBase64, wrap } from '../src/worker/lib/../pdf/writer.js';
import { renderReportPdf } from '../src/worker/pdf/report.js';
import { buildReport } from '../src/worker/lib/report.js';
import { QUESTION_COUNT } from '../src/shared/scoring.js';

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

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

describe('renderReportPdf', () => {
  const answers: Record<number, number> = {};
  for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 3) % 6;

  const report = buildReport({
    reportToken: 'r'.repeat(43),
    assessmentName: 'Influencing Style Inventory',
    candidate: {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      organisation: 'Meridian Group',
      ageBand: '35–44',
      experienceBand: '6–10',
      gender: 'Female',
    },
    completedAt: '2026-08-09 10:30:00',
    branding: {
      companyName: 'Meridian Group',
      accentColor: '#1A4FD6',
      logoDataUrl: '',
      supportEmail: '',
    },
    answers,
  });

  it('renders a multi-page PDF containing the report content', () => {
    const bytes = renderReportPdf(report);
    const s = latin1(bytes);

    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(bytes.length).toBeGreaterThan(4000);
    expect(s).toContain('Priya');
    expect(s).toContain('EXECUTIVE SUMMARY');
    expect(s).toContain('WHEN OVERUSED');
    expect(s).toContain('Confidential');
    // Every one of the ten styles must appear on the bars.
    for (const style of report.scores.styles) {
      const first = style.name.split(' ')[0]!;
      expect(s, `missing style ${style.name}`).toContain(first);
    }
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

  it('survives extreme content without corrupting the file', () => {
    const long = {
      ...report,
      candidate: {
        ...report.candidate,
        firstName: 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        lastName: 'Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        organisation: 'A very long organisation name that will not fit inside its cell at all',
      },
    };
    const s = latin1(renderReportPdf(long));
    expect(s.startsWith('%PDF-1.7')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
