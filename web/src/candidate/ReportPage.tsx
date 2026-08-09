/**
 * The report as a business document — the same sections, in the same order, as
 * the PDF, rendered from the same payload so the two can never disagree.
 *
 * Two instruments, two layouts, one chrome. The payload is a tagged union, so
 * the branch below is exhaustive: an instrument cannot be rendered with
 * another instrument's sections by accident.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { DEFAULT_BRANDING, LogoSlot, Shell, useAccent } from './Shell.js';
import { MAX_SIDE_SCORE, MAX_STYLE_SCORE } from '../../../src/shared/scoring.js';
import { EGO_MAX_STATE_SCORE } from '../../../src/shared/ego-scoring.js';
import type {
  EgoReportPayload,
  IsiReportPayload,
  ReportPayload,
} from '../../../src/shared/types.js';

/** Band boundaries on the 0–16 style scale: Low 0–6, Moderate 7–11, High 12–16. */
const BAND_BOUNDARIES = [6, 11];

export function ReportPage({ source }: { source: 'report' | 'link' }) {
  const { token = '' } = useParams();
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base =
    source === 'report'
      ? `/api/report/${encodeURIComponent(token)}`
      : `/api/report/by-link/${encodeURIComponent(token)}`;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // A candidate arriving straight from the completion screen can beat the
    // pipeline here by a second or two, so a 404 is retried a few times before
    // it is treated as a real failure.
    const load = (attempt: number): void => {
      api
        .get<ReportPayload>(base)
        .then((r) => {
          if (!cancelled) setReport(r);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const notReady = err instanceof ApiError && err.status === 404;
          if (notReady && attempt < 6) {
            timer = setTimeout(() => load(attempt + 1), 2000);
            return;
          }
          setError(
            err instanceof ApiError
              ? err.message
              : 'This report could not be opened. Please try the link in your email.',
          );
        });
    };

    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base]);

  useAccent(report?.branding ?? DEFAULT_BRANDING);

  if (error) {
    return (
      <Shell branding={DEFAULT_BRANDING}>
        <div className="card" style={{ padding: 40, marginTop: 48, maxWidth: 620 }}>
          <p className="eyebrow">Report unavailable</p>
          <h1 className="display" style={{ fontSize: 24, marginTop: 10 }}>
            {error}
          </h1>
          <p className="hint" style={{ marginTop: 14 }}>
            Reports are prepared a moment after submission. If you have just finished, try again shortly.
          </p>
        </div>
      </Shell>
    );
  }

  if (!report) {
    return (
      <Shell branding={DEFAULT_BRANDING}>
        <p className="hint" style={{ marginTop: 48 }}>
          Preparing your report…
        </p>
      </Shell>
    );
  }

  const b = report.branding;

  return (
    <Shell branding={b} subtitle={report.assessmentName}>
      <div className="report-toolbar no-print">
        <a className="btn btn-primary btn-sm" href={`${base}/pdf`} target="_blank" rel="noreferrer">
          Download PDF
        </a>
        <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className="sheet">
        <header className="sheet-head">
          <div className="brand">
            <LogoSlot branding={b} size={34} />
            <div className="brand-text">
              <span className="brand-sub">{report.assessmentName}</span>
            </div>
          </div>
          <div className="sheet-doc">
            <b>Confidential report</b>
            Issued {formatDate(report.completedAt)}
            {report.reportToken ? (
              <>
                <br />
                Ref {report.reportToken.slice(0, 10).toUpperCase()}
              </>
            ) : null}
          </div>
        </header>

        <div className="rpt-title">
          <p className="eyebrow">Assessment report</p>
          <h1 className="display">{report.assessmentName}</h1>
        </div>

        <dl className="rpt-subject">
          <div>
            <dt>Candidate</dt>
            <dd>
              {report.candidate.firstName} {report.candidate.lastName}
            </dd>
          </div>
          <div>
            <dt>Organisation</dt>
            <dd>{report.candidate.organisation || '—'}</dd>
          </div>
          <div>
            <dt>Experience</dt>
            <dd>{report.candidate.experienceBand || '—'}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatDate(report.completedAt)}</dd>
          </div>
        </dl>

        <section className="exec">
          <h3>Executive summary</h3>
          <p>{report.summary}</p>
        </section>

        {report.kind === 'isi' ? <IsiSections report={report} /> : <EgoSections report={report} />}

        <footer className="sheet-foot">
          <span>
            Confidential — prepared for {report.candidate.firstName} {report.candidate.lastName}
          </span>
          <span>{b.companyName}</span>
        </footer>
      </article>
    </Shell>
  );
}

// ------------------------------------------------------- Influencing Styles

function IsiSections({ report }: { report: IsiReportPayload }) {
  const s = report.scores;
  const pushStyles = s.styles.filter((x) => x.side === 'push');
  const pullStyles = s.styles.filter((x) => x.side === 'pull');
  const total = s.push + s.pull;
  const pushPct = total === 0 ? 50 : (s.push / total) * 100;
  const lead = report.narratives[0];

  return (
    <>
      {lead ? (
        <section className="headline">
          <div>
            <p className="eyebrow">Dominant style</p>
            <div className="hl-name display">{lead.name}</div>
            <div className="hl-blurb">{lead.blurb}</div>
          </div>
          <div className="hl-score">
            <span className="v" style={{ color: sideColor(lead.side) }}>
              {lead.score}
            </span>
            <span className="d"> / {MAX_STYLE_SCORE}</span>
            <div className="b">
              <span className={`pill ${bandPill(lead.band)}`}>{lead.band} band</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sec">
        <div className="sec-head">
          <h2>Push and Pull balance</h2>
          <span className="n">Each side scored out of {MAX_SIDE_SCORE}</span>
        </div>
        <div className="split">
          <div className="split-labels">
            <div className="split-push">
              <div className="sl">PUSH</div>
              <div className="sv num">{s.push}</div>
              <div className="sd">{s.pushShare}% of total</div>
            </div>
            <div className="split-pull" style={{ textAlign: 'right' }}>
              <div className="sl">PULL</div>
              <div className="sv num">{s.pull}</div>
              <div className="sd">{s.pullShare}% of total</div>
            </div>
          </div>
          <div className="split-bar">
            <div className="sp" style={{ width: `${pushPct}%` }} />
            <div className="su" style={{ width: `${100 - pushPct}%` }} />
          </div>
          <div className="split-scale">
            <span>All Push</span>
            <span>Balanced</span>
            <span>All Pull</span>
          </div>
          <p className="sec-note">
            <b>Orientation: {s.orientation}.</b>{' '}
            {s.orientation === 'Balanced'
              ? 'You draw on both repertoires in roughly equal measure, which gives you range across different situations.'
              : s.orientation === 'Push'
                ? 'You most often move others by what you bring to the exchange — pressure, standards, reciprocity, argument and directness.'
                : 'You most often move others by drawing them in — presence, vision, common ground, climate and joint working.'}
          </p>

          {/* The instrument's own description of the two methods, verbatim. */}
          <div className="methods">
            <div className="method method-push">
              <h4>Push</h4>
              <p>{report.methods.push}</p>
            </div>
            <div className="method method-pull">
              <h4>Pull</h4>
              <p>{report.methods.pull}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>All ten styles</h2>
          <span className="n">Each style scored out of {MAX_STYLE_SCORE}</span>
        </div>
        <div className="bars">
          <BarGroup
            title="Push styles"
            note="What you bring to the exchange"
            styles={pushStyles}
            side="push"
          />
          <BarGroup title="Pull styles" note="What draws others in" styles={pullStyles} side="pull" />
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Your top three styles</h2>
          <span className="n">Narrative and overuse risk</span>
        </div>
        {report.narratives.map((n, i) => (
          <div className="detail" key={n.styleKey}>
            <div className="detail-head">
              <div className="detail-rank">
                <span className="r">{i + 1}</span>
                <div>
                  <div className="detail-name">{n.name}</div>
                  <div className="detail-meta">
                    {n.side === 'push' ? 'Push style' : 'Pull style'} · {n.blurb}
                  </div>
                </div>
              </div>
              <div className="detail-score" style={{ color: sideColor(n.side) }}>
                {n.score}
                <span> / {MAX_STYLE_SCORE}</span>
              </div>
            </div>
            <div className="detail-body">
              <p>{n.narrative}</p>
              <div className="caution">
                <h4>When overused</h4>
                <p>{n.caution}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Development area</h2>
          <span className="n">Your least-used style</span>
        </div>
        <div className="dev-block">
          <div className="dv-head">
            <h3>{report.development.name}</h3>
            <span className="dv-score num">
              {report.development.score} / {MAX_STYLE_SCORE} · {report.development.band}
            </span>
          </div>
          <p>{report.development.low}</p>
          <div className="action">
            <b>Try this.</b> {report.development.action}
          </div>
        </div>
      </section>
    </>
  );
}

function BarGroup({
  title,
  note,
  styles,
  side,
}: {
  title: string;
  note: string;
  styles: IsiReportPayload['scores']['styles'];
  side: 'push' | 'pull';
}) {
  return (
    <div className="bar-group">
      <div className="bar-group-head">
        <span className="swatch" style={{ background: sideColor(side) }} />
        {title}
        <span className="gh-note">{note}</span>
      </div>
      {styles.map((s) => (
        <div className="bar-row" key={s.key}>
          <div className="bar-label">{s.name}</div>
          <div className="bar-track-wrap">
            <div className="bar-track">
              {BAND_BOUNDARIES.map((b) => (
                <span key={b} className="bar-band" style={{ left: `${(b / MAX_STYLE_SCORE) * 100}%` }} />
              ))}
              <div
                className={`bar-fill ${side}`}
                style={{ width: `${(s.score / MAX_STYLE_SCORE) * 100}%` }}
              />
            </div>
          </div>
          <div className="bar-val num">
            {s.score}
            <span className="slash"> / {MAX_STYLE_SCORE}</span>
            <span className="band">{s.band}</span>
          </div>
        </div>
      ))}
      <div className="bar-axis">
        <span>0</span>
        <span>{MAX_STYLE_SCORE / 2}</span>
        <span>{MAX_STYLE_SCORE}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Ego States

function EgoSections({ report }: { report: EgoReportPayload }) {
  const { ego } = report;

  return (
    <>
      <section className="headline">
        <div>
          <p className="eyebrow">Most available ego state</p>
          <div className="hl-name display">{report.highest.name}</div>
          <div className="hl-blurb">{report.highest.blurb}</div>
        </div>
        <div className="hl-score">
          <span className="v" style={{ color: report.highest.color }}>
            {report.highest.percent}
          </span>
          <span className="d">%</span>
          <div className="b">
            <span className="pill pill-neutral">
              {report.highest.score} of {EGO_MAX_STATE_SCORE}
            </span>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Your ego-gram</h2>
          <span className="n">Each state scored out of {EGO_MAX_STATE_SCORE}</span>
        </div>
        <EgoGram report={report} />
        {report.labelsAreDraft ? <p className="draft-note">{report.draftNote}</p> : null}
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>The shape of your profile</h2>
          <span className="n">Highest and lowest</span>
        </div>

        <div className="detail">
          <div className="detail-head">
            <div className="detail-rank">
              <span className="r" style={{ background: report.highest.color, color: '#fff' }}>
                ▲
              </span>
              <div>
                <div className="detail-name">{report.highest.name}</div>
                <div className="detail-meta">Most available · {report.highest.blurb}</div>
              </div>
            </div>
            <div className="detail-score" style={{ color: report.highest.color }}>
              {report.highest.score}
              <span> / {EGO_MAX_STATE_SCORE}</span>
            </div>
          </div>
          <div className="detail-body">
            <p>{report.highest.high}</p>
          </div>
        </div>

        <div className="detail">
          <div className="detail-head">
            <div className="detail-rank">
              <span className="r" style={{ background: report.lowest.color, color: '#fff' }}>
                ▼
              </span>
              <div>
                <div className="detail-name">{report.lowest.name}</div>
                <div className="detail-meta">Least available · {report.lowest.blurb}</div>
              </div>
            </div>
            <div className="detail-score" style={{ color: report.lowest.color }}>
              {report.lowest.score}
              <span> / {EGO_MAX_STATE_SCORE}</span>
            </div>
          </div>
          <div className="detail-body">
            <p>{report.lowest.low}</p>
            <div className="caution">
              <h4>Try this</h4>
              <p>{report.lowest.dev}</p>
            </div>
          </div>
        </div>

        <p className="sec-note">
          The spread between your highest and lowest state is {ego.spread} points. An ego-gram is read
          by its shape rather than by any single figure — there is no good or bad profile, only the
          pattern you bring to a given situation.
        </p>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>The six ego states</h2>
          <span className="n">Your score against each</span>
        </div>
        {report.states.map((s) => (
          <div className="detail" key={s.stateKey}>
            <div className="detail-head">
              <div className="detail-rank">
                <span className="r" style={{ background: s.color, color: '#fff' }}>
                  {s.abbr}
                </span>
                <div>
                  <div className="detail-name">{s.name}</div>
                  <div className="detail-meta">{s.blurb}</div>
                </div>
              </div>
              <div className="detail-score" style={{ color: s.color }}>
                {s.percent}
                <span>%</span>
              </div>
            </div>
            <div className="detail-body">
              <p>{s.description}</p>
            </div>
          </div>
        ))}
        {report.labelsAreDraft ? <p className="draft-note">{report.draftNote}</p> : null}
      </section>
    </>
  );
}

/**
 * The ego-gram: one column per state in the instrument's column order, which
 * is the order that makes the classic profile shape readable. Inline SVG, so
 * the chart carries no charting dependency and prints as vector.
 */
function EgoGram({ report }: { report: EgoReportPayload }) {
  const states = report.ego.states;
  const W = 640;
  const H = 260;
  const pad = { top: 18, right: 12, bottom: 46, left: 34 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const slot = innerW / states.length;
  const barW = Math.min(64, slot * 0.62);

  return (
    <div className="egogram">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Ego-gram: ${states.map((s) => `${s.name} ${s.percent}%`).join(', ')}`}
      >
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = pad.top + innerH * (1 - pct / 100);
          return (
            <g key={pct}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">
                {pct}
              </text>
            </g>
          );
        })}

        {states.map((s, i) => {
          const h = (s.percent / 100) * innerH;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          return (
            <g key={s.key}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx="3" fill={s.color} />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight="650"
                fill="var(--ink)"
              >
                {s.percent}%
              </text>
              <text
                x={x + barW / 2}
                y={H - 26}
                textAnchor="middle"
                fontSize="11"
                fontWeight="620"
                fill="var(--ink-2)"
              >
                {s.abbr}
              </text>
              <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize="9.5" fill="var(--ink-4)">
                {s.score}/{EGO_MAX_STATE_SCORE}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="egokey">
        {states.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            <b>{s.abbr}</b> {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// -------------------------------------------------------------------- helpers

function sideColor(side: 'push' | 'pull'): string {
  return side === 'push' ? 'var(--push)' : 'var(--pull)';
}

function bandPill(band: string): string {
  return band === 'High' ? 'pill-accent' : band === 'Moderate' ? 'pill-neutral' : 'pill-plain';
}

function formatDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
