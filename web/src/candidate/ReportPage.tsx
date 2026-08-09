/**
 * The report as a business document — the same sections, in the same order, as
 * the PDF, rendered from the same payload so the two can never disagree.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { DEFAULT_BRANDING, LogoSlot, Shell, useAccent } from './Shell.js';
import type { ReportPayload } from '../../../src/shared/types.js';

const MAX_STYLE_SCORE = 20;
const MAX_SIDE_SCORE = 100;

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
    api
      .get<ReportPayload>(base)
      .then((r) => !cancelled && setReport(r))
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'This report could not be opened. Please try the link in your email.',
          );
        }
      });
    return () => {
      cancelled = true;
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
          Loading your report…
        </p>
      </Shell>
    );
  }

  const b = report.branding;
  const s = report.scores;
  const pushStyles = s.styles.filter((x) => x.side === 'push');
  const pullStyles = s.styles.filter((x) => x.side === 'pull');
  const total = s.push + s.pull;
  const pushPct = total === 0 ? 50 : (s.push / total) * 100;

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
            <LogoSlot branding={b} size={36} />
            <div className="brand-text">
              <span className="brand-name">{b.companyName}</span>
              <span className="brand-sub">{report.assessmentName}</span>
            </div>
          </div>
          <div className="sheet-doc">
            <b>Confidential report</b>
            Issued {formatDate(report.completedAt)}
            {report.reportToken ? <>
              <br />
              Ref {report.reportToken.slice(0, 10).toUpperCase()}
            </> : null}
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

        {report.narratives[0] ? (
          <section className="headline">
            <div>
              <p className="eyebrow">Dominant style</p>
              <div className="hl-name display">{report.narratives[0].name}</div>
              <div className="hl-blurb">{report.narratives[0].blurb}</div>
            </div>
            <div className="hl-score">
              <span className="v" style={{ color: sideColor(report.narratives[0].side) }}>
                {report.narratives[0].score}
              </span>
              <span className="d"> / {MAX_STYLE_SCORE}</span>
              <div className="b">
                <span className={`pill ${bandPill(report.narratives[0].band)}`}>
                  {report.narratives[0].band} band
                </span>
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

function BarGroup({
  title,
  note,
  styles,
  side,
}: {
  title: string;
  note: string;
  styles: ReportPayload['scores']['styles'];
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
              {/* Band boundaries at 7 and 13 of 20 — Low | Moderate | High. */}
              <span className="bar-band" style={{ left: `${(7 / MAX_STYLE_SCORE) * 100}%` }} />
              <span className="bar-band" style={{ left: `${(13 / MAX_STYLE_SCORE) * 100}%` }} />
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
        <span>10</span>
        <span>{MAX_STYLE_SCORE}</span>
      </div>
    </div>
  );
}

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
