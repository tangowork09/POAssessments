import { describe, expect, it } from 'vitest';
import { groupPayload, memberPayload, memberScores, confidentialityNote } from '../src/worker/lib/cohort.js';
import { renderCohortReportPdf } from '../src/worker/pdf/socio-report.js';
import { cellNo } from '../src/shared/socio.js';
import { SOCIO_ITEMS, SOCIO_SUPPORT_GAP_ITEM } from '../src/shared/socio.js';
import {
  memberResultFor,
  scoreSocioCohort,
  type SocioGroupResult,
  type SocioMember,
} from '../src/shared/socio-scoring.js';
import type { CohortReportPayload } from '../src/shared/types.js';
import type { CohortRow } from '../src/worker/lib/cohort.js';

/** WinAnsi's non-Latin-1 slots, back to the code points the writer folded in. */
const WIN_ANSI_BACK: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/**
 * Every string the document actually draws. A paragraph is wrapped into one
 * `Tj` per line, so a sentence never appears contiguously in the raw bytes.
 */
function drawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
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

const BRANDING = {
  companyName: 'PO Assessments',
  accentColor: '#0B6FB4',
  logoDataUrl: '',
  supportEmail: 'help@example.com',
};

const COHORT: CohortRow = {
  id: 'coh_test',
  assessment_id: 'asm_sociometry',
  name: 'Acme Pharma leadership',
  organisation: 'Acme Pharma',
  status: 'closed',
  min_raters: 3,
  tie_threshold: 4,
  min_rated_targets: 1,
  created_at: '2026-08-01 09:00:00',
  closed_at: '2026-08-20 09:00:00',
};

const FUNCTIONS = ['Manufacturing', 'Quality', 'R&D', 'Supply Chain', 'Finance'];

/**
 * A twelve-person cohort with enough variety to exercise every chapter: an
 * anchor everyone trusts, someone the group defers to without relying on, a
 * well-liked person nobody defers to, and one leader only two colleagues could
 * rate — who must therefore be suppressed at the cohort's three-rater floor.
 */
function buildCohort(): SocioGroupResult {
  const members: SocioMember[] = Array.from({ length: 12 }, (_, i) => ({
    no: i + 1,
    id: `m${i + 1}`,
    name: `Leader ${String(i + 1).padStart(2, '0')}`,
    func: FUNCTIONS[i % FUNCTIONS.length]!,
  }));

  const responses = members.slice(0, 10).map((rater) => {
    const answers: Record<number, number> = {};
    for (const target of members) {
      if (target.no === rater.no) continue;
      // Leader 12 is rated by only two colleagues, so their profile is withheld.
      if (target.no === 12 && rater.no > 2) continue;
      // Leader 11 is rated by nobody at all.
      if (target.no === 11) continue;

      for (const item of SOCIO_ITEMS) {
        let value: number;
        if (item.no === SOCIO_SUPPORT_GAP_ITEM) {
          value = target.no === 4 ? 5 : 2;
        } else if (item.blockKey === 'power_over') {
          value = target.no === 3 ? 5 : target.no === 5 ? 2 : 3;
        } else if (item.blockKey === 'trust') {
          value = target.no === 1 ? 5 : target.no === 3 ? 2 : target.no === 5 ? 5 : 4;
        } else {
          value = target.no === 1 ? 5 : 3;
        }
        answers[cellNo(target.no, item.no)] = value;
      }
    }
    return { raterNo: rater.no, answers };
  });

  return scoreSocioCohort(members, responses, { minRaters: 3, tieThreshold: 4 });
}

const GROUP = buildCohort();

function group(): CohortReportPayload {
  return groupPayload({
    reportToken: 'tok_group',
    cohort: COHORT,
    round: { no: 1, label: '' },
    assessmentName: 'Collaboration Sociometry',
    generatedAt: '2026-08-24 10:00:00',
    branding: BRANDING,
    group: GROUP,
  });
}

function member(memberNo: number): CohortReportPayload {
  return memberPayload({
    reportToken: 'tok_member',
    cohort: COHORT,
    round: { no: 1, label: '' },
    assessmentName: 'Collaboration Sociometry',
    generatedAt: '2026-08-24 10:00:00',
    branding: BRANDING,
    scores: memberScores(GROUP, memberResultFor(GROUP, memberNo)!),
  });
}

describe('the fixture cohort itself', () => {
  it('produces the shape the report chapters are written for', () => {
    expect(GROUP.rosterSize).toBe(12);
    expect(GROUP.respondents).toBe(10);
    // Leader 12 was rated twice, below the three-rater floor.
    expect(memberResultFor(GROUP, 12)!.coverage).toBe(2);
    expect(memberResultFor(GROUP, 12)!.suppressed).toBe(true);
    // Leader 11 was rated by nobody.
    expect(memberResultFor(GROUP, 11)!.coverage).toBe(0);
    // Leader 3 is deferred to without being relied on; Leader 5 the reverse.
    expect(GROUP.authorityWithoutTrust[0]!.memberNo).toBe(3);
    expect(GROUP.trustWithoutAuthority[0]!.memberNo).toBe(5);
    expect(GROUP.supportGaps[0]!.memberNo).toBe(4);
  });
});

describe('member context', () => {
  it('compares a member with the rest of the cohort, never with themselves', () => {
    const scores = memberScores(GROUP, memberResultFor(GROUP, 1)!);
    const trust = scores.context.find((c) => c.blockKey === 'trust')!;

    expect(trust.memberMean).toBe(5);
    // Everyone else averages below 5 on trust, so the comparison must be too.
    expect(trust.cohortMean).not.toBeNull();
    expect(trust.cohortMean!).toBeLessThan(5);
    expect(trust.delta).toBe(Math.round((trust.memberMean! - trust.cohortMean!) * 100) / 100);
  });

  it('leaves the comparison empty for an unrated member rather than inventing one', () => {
    const scores = memberScores(GROUP, memberResultFor(GROUP, 11)!);
    for (const c of scores.context) {
      expect(c.memberMean).toBeNull();
      expect(c.delta).toBeNull();
    }
  });
});

describe('group report PDF', () => {
  const bytes = renderCohortReportPdf(group());
  const text = drawnText(bytes);

  it('is a well-formed PDF of more than one page', () => {
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(Buffer.from(bytes.slice(-6)).toString('latin1').trim()).toBe('%%EOF');
    expect((text.match(/Page \d+ of \d+/g) ?? []).length).toBeGreaterThan(1);
  });

  it('names the cohort, not a candidate', () => {
    expect(text).toContain('Acme Pharma leadership');
    expect(text).toContain('GROUP REPORT');
  });

  it('states the response figures a reader can check', () => {
    expect(text).toContain('10 of 12');
  });

  it('explains every one of the four blocks', () => {
    expect(text).toContain('Power — to & with');
    expect(text).toContain('Power — over');
    expect(text).toContain('Trust');
    expect(text).toContain('Overall ease');
  });

  it('reports the deficit item apart from the blocks', () => {
    expect(text).toContain('Reported separately');
    expect(text).toContain('Where more is wanted');
  });

  it('says who was withheld and why, rather than leaving a gap', () => {
    expect(text).toContain('Coverage and what was withheld');
    expect(text).toContain('Leader 12');
  });

  it('carries the confidentiality promise and the method', () => {
    expect(text).toContain('never shown');
    expect(text).toContain('This is not a performance review');
  });
});

describe('member report PDF', () => {
  const bytes = renderCohortReportPdf(member(1));
  const text = drawnText(bytes);

  it('names the member and the cohort', () => {
    expect(text).toContain('PEER FEEDBACK REPORT');
    expect(text).toContain('Leader 01');
    expect(text).toContain('Acme Pharma leadership');
  });

  it('shows the block profile and the statement detail', () => {
    expect(text).toContain('How colleagues describe working with you');
    expect(text).toContain('Statement by statement');
    expect(text).toContain('Trusted judgment');
  });

  it('reports how the member rated others, as rating style not accuracy', () => {
    expect(text).toContain('How you rated others');
    expect(text).toContain('not about how accurate you are');
  });

  it('names no colleague of the member anywhere in the document', () => {
    // The one thing every participant was promised. A member report may name
    // its subject and nobody else.
    for (const other of GROUP.members) {
      if (other.memberNo === 1) continue;
      expect(text).not.toContain(other.name);
    }
  });
});

describe('suppressed member report', () => {
  const payload = member(12);
  const bytes = renderCohortReportPdf(payload);
  const text = drawnText(bytes);

  it('is marked suppressed in the payload', () => {
    expect(payload.kind).toBe('socio_member');
    if (payload.kind !== 'socio_member') throw new Error('unreachable');
    expect(payload.suppressed).toBe(true);
  });

  it('explains the withholding instead of printing a two-rater average', () => {
    expect(text).toContain('No profile in this report');
    expect(text).toContain('Withheld deliberately');
    expect(text).toContain('below the 3-rater floor');
  });

  it('prints none of the chapters that would carry the numbers', () => {
    expect(text).not.toContain('How colleagues describe working with you');
    expect(text).not.toContain('Statement by statement');
  });
});

describe('confidentiality note', () => {
  it('states the floor it was generated with, not a hardcoded one', () => {
    expect(confidentialityNote(3)).toContain('below 3 raters');
    expect(confidentialityNote(5)).toContain('below 5 raters');
  });
});

describe('footer', () => {
  /**
   * A cohort name is a sentence rather than a person's name, so the left-hand
   * footer line is long enough to run under the centred company mark. The two
   * overlapped on every page of the first build.
   */
  it('keeps the prepared-for line clear of the centred company name', () => {
    const long: CohortRow = {
      ...COHORT,
      name: 'Acme Pharma Manufacturing and Quality leadership community, September 2026',
    };
    const payload = groupPayload({
      reportToken: 'tok_group',
      cohort: long,
      round: { no: 1, label: '' },
      assessmentName: 'Collaboration Sociometry',
      generatedAt: '2026-08-24 10:00:00',
      branding: BRANDING,
      group: GROUP,
    });
    const text = drawnText(renderCohortReportPdf(payload));

    // The footer line is cut short. The full name still appears on the cover
    // and in the summary, where it has the width for it — this asserts on the
    // footer alone.
    const footers = [...text.matchAll(/Confidential — prepared for [^]*?(?= PO Assessments)/g)].map(
      (m) => m[0],
    );
    expect(footers.length).toBeGreaterThan(1);
    for (const line of footers) {
      expect(line.endsWith('…')).toBe(true);
      expect(line).not.toContain('September 2026');
    }
  });
});
