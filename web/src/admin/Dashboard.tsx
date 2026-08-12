/** Dashboard: real counts, a twelve-week completions trend, cohort averages. */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { CardHead, EmptyState, ErrorState, Head, Loading, StatusPill } from './ui.js';
import { MAX_STYLE_SCORE } from '../../../src/shared/scoring.js';

interface DashboardData {
  totals: { candidates: number; invited: number; in_progress: number; completed: number; started: number };
  completionRate: number | null;
  trend: { week: string; label: string; n: number }[];
  assessments: {
    id: string;
    name: string;
    description: string;
    status: string;
    question_count: number;
    invited: number;
    started: number;
    completed: number;
  }[];
  recent: {
    id: string;
    status: string;
    answered_count: number;
    completed_at: string | null;
    invited_at: string;
    first_name: string;
    last_name: string;
    email: string;
    organisation: string;
    assessment_name: string;
  }[];
  /** Influencing Style Inventory only — the two instruments share no scale. */
  cohort: { key: string; name: string; side: string; average: number; n: number }[];
  /** Ego States Scale, one entry per state, in ego-gram order. */
  egoCohort: { key: string; name: string; abbr: string; color: string; average: number; percent: number; n: number }[];
  maxStyleScore: number;
  maxSideScore: number;
  maxEgoStateScore: number;
  sendsToday: number;
  dailySendCap: number;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<DashboardData>('/api/admin/dashboard')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <Head title="Dashboard" />
        <section className="card">
          <ErrorState message={error} onRetry={load} />
        </section>
      </>
    );
  }
  if (!data) return <Loading label="Loading the dashboard…" />;

  const t = data.totals;
  const trendTotal = data.trend.reduce((sum, p) => sum + p.n, 0);
  const capUsed = data.dailySendCap > 0 ? Math.min(1, data.sendsToday / data.dailySendCap) : 0;

  // The API owns the scales. The shared constants are only a floor for a
  // response served before this field existed.
  const maxStyle = data.maxStyleScore || MAX_STYLE_SCORE;
  const maxEgoState = data.maxEgoStateScore || 0;
  const isiSamples = data.cohort[0]?.n ?? 0;
  const egoCohort = data.egoCohort ?? [];
  const egoSamples = egoCohort[0]?.n ?? 0;

  return (
    <>
      <Head
        title="Dashboard"
        sub="Live counts across every assessment. Nothing here is sampled or estimated."
      />

      <div className="tiles">
        <Tile
          label="Candidates"
          value={t.candidates}
          foot="People on the platform"
          linkTo="/admin/candidates"
          empty={{ foot: 'Nobody has been invited yet', to: '/admin/invites', label: 'Send an invite' }}
        />
        <Tile
          label="Invited"
          value={t.invited}
          foot="Assessment invitations issued"
          linkTo="/admin/candidates"
          empty={{ foot: 'No invitations issued yet', to: '/admin/invites', label: 'Send an invite' }}
        />
        <Tile
          label="In progress"
          value={t.in_progress}
          foot="Started, not yet submitted"
          linkTo="/admin/candidates?status=in_progress"
          empty={{ foot: 'Nobody is mid-assessment right now' }}
        />
        <Tile
          label="Completed"
          value={t.completed}
          foot={data.completionRate === null ? 'No starts yet' : `${data.completionRate}% of those started`}
          linkTo="/admin/candidates?status=completed"
          empty={{ foot: 'No assessment has been submitted yet' }}
        />
      </div>

      <div className="grid-2 mt-4">
        <section className="card">
          <CardHead
            title="Completions"
            sub="Last twelve weeks"
            aside={
              trendTotal > 0 ? (
                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="legend-swatch swatch-accent" />
                    Completed
                  </span>
                </div>
              ) : undefined
            }
          />
          {trendTotal === 0 ? (
            <EmptyState
              title="No completions in the last twelve weeks"
              body="The trend line draws itself as soon as the first candidate submits an assessment."
              action={{ label: 'View candidates', to: '/admin/candidates' }}
            />
          ) : (
            <div className="card-body">
              <TrendChart points={data.trend} />
            </div>
          )}
        </section>

        <section className="card">
          <CardHead title="Mail" sub="Today’s sends against the cap" />
          <div className="card-body">
            <div className="tile-val num">{data.sendsToday}</div>
            <p className="hint mt-1">of {data.dailySendCap} allowed today</p>
            <div
              className="progress-strip mt-3"
              role="progressbar"
              aria-label="Daily send cap used"
              aria-valuenow={data.sendsToday}
              aria-valuemin={0}
              aria-valuemax={data.dailySendCap}
            >
              <i style={{ transform: `scaleX(${capUsed})` }} />
            </div>
            <p className="inline-note mt-3">
              The cap applies to invitations. Report emails are sent when a candidate finishes and are not
              throttled.
            </p>
          </div>
        </section>
      </div>

      <section className="card mt-4">
        <CardHead title="Assessments" sub="Funnel per instrument" />
        {data.assessments.length === 0 ? (
          <EmptyState
            title="No assessments configured"
            body="Instruments are seeded as data. Once one exists it appears here with its full funnel."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-funnel">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Status</th>
                  <th className="right">Questions</th>
                  <th className="right">Invited</th>
                  <th className="right">Started</th>
                  <th className="right">Completed</th>
                  <th className="right">Completed of started</th>
                </tr>
              </thead>
              <tbody>
                {data.assessments.map((a) => (
                  <tr key={a.id}>
                    <td className="name">
                      {a.name}
                      <span className="cell-sub">{a.description}</span>
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="right num">{a.question_count}</td>
                    <td className="right num">{a.invited}</td>
                    <td className="right num">{a.started}</td>
                    <td className="right num">{a.completed}</td>
                    <td className="right num">
                      {a.started > 0 ? `${Math.round((a.completed / a.started) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2 mt-4">
        <section className="card">
          <CardHead title="Recent candidates" sub="Most recent activity first" />
          {data.recent.length === 0 ? (
            <EmptyState
              title="No candidates yet"
              body="Send your first invite, or share the open assessment link, and activity will show up here."
              action={{ label: 'Send your first invite', to: '/admin/invites' }}
            />
          ) : (
            <div className="table-scroll">
              <table className="table-recent">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Organisation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="name">
                        {`${r.first_name} ${r.last_name}`.trim() || r.email}
                        <span className="cell-sub">{r.email}</span>
                      </td>
                      <td className="cell-truncate">{r.organisation || <span className="muted">—</span>}</td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <CardHead
            title="Cohort averages"
            sub="Each instrument on its own scale — the two are not comparable"
          />
          <div className="card-body cohort-groups">
            <div>
              <p className="group-label">
                Influencing Style Inventory
                {isiSamples > 0 ? (
                  <span className="group-count">
                    {isiSamples} {isiSamples === 1 ? 'report' : 'reports'}
                  </span>
                ) : null}
              </p>
              {isiSamples === 0 ? (
                <p className="inline-note">
                  No completed Influencing Style reports yet. The ten style averages appear here as soon as
                  the first one lands.
                </p>
              ) : (
                data.cohort.map((s) => (
                  <div className="cohort-row" key={s.key}>
                    <div className="cohort-label">{s.name}</div>
                    <div className="cohort-track ct">
                      <div
                        className={`cohort-fill fill-${s.side === 'push' ? 'push' : 'pull'}`}
                        style={{ transform: `scaleX(${maxStyle ? s.average / maxStyle : 0})` }}
                      />
                    </div>
                    <div className="cohort-val num">
                      {s.average}
                      <em> /{maxStyle}</em>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <p className="group-label">
                Ego States Scale
                {egoSamples > 0 ? (
                  <span className="group-count">
                    {egoSamples} {egoSamples === 1 ? 'report' : 'reports'}
                  </span>
                ) : null}
              </p>
              {egoSamples === 0 ? (
                <p className="inline-note">
                  No completed Ego States reports yet. The six-state ego-gram average appears here as soon as
                  the first one lands.
                </p>
              ) : (
                egoCohort.map((s) => (
                  <div className="cohort-row" key={s.key}>
                    <div className="cohort-label" title={s.name}>
                      {s.name}
                    </div>
                    <div className="cohort-track ct">
                      {/* The state's own colour, as the report and PDF use it. */}
                      <div
                        className="cohort-fill"
                        style={{
                          transform: `scaleX(${maxEgoState ? s.average / maxEgoState : 0})`,
                          background: s.color,
                        }}
                      />
                    </div>
                    <div className="cohort-val num">
                      {s.average}
                      <em> /{maxEgoState}</em>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  foot,
  linkTo,
  empty,
}: {
  label: string;
  value: number;
  foot: string;
  /** Where the whole card goes when it has something to show. */
  linkTo?: string;
  empty?: { foot: string; to?: string; label?: string };
}) {
  const isZero = value === 0 && empty !== undefined;
  // A zero tile's own CTA ("Send an invite") takes priority over the generic
  // filtered view — there's nothing to filter to yet. Either way the whole
  // card is one target, never a link nested inside another.
  const href = isZero ? empty.to : linkTo;
  const className = `card tile${isZero ? ' is-zero' : ''}${href ? ' tile-link' : ''}`;
  const content = (
    <>
      <div className="tile-top">
        <span className="tile-label">{label}</span>
      </div>
      <div className="tile-val num">{value}</div>
      <div className="tile-bottom">
        {isZero ? (
          <span className="inline-note">
            {empty.foot}
            {empty.label ? (
              <>
                {' '}
                · <b>{empty.label}</b>
              </>
            ) : null}
          </span>
        ) : (
          <span className="inline-note">{foot}</span>
        )}
      </div>
    </>
  );
  return href ? (
    <Link to={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Inline SVG so the chart carries no charting dependency. */
function TrendChart({ points }: { points: { label: string; n: number }[] }): ReactNode {
  const W = 560;
  const H = 180;
  const pad = { top: 12, right: 8, bottom: 26, left: 30 };
  const max = Math.max(4, ...points.map((p) => p.n));
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const xy = points.map((p, i) => ({
    x: pad.left + i * step,
    y: pad.top + innerH - (p.n / max) * innerH,
    ...p,
  }));
  const first = xy[0];
  const last = xy.at(-1);
  if (!first || !last) return null;

  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${last.x.toFixed(1)} ${pad.top + innerH} L${first.x.toFixed(1)} ${pad.top + innerH} Z`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Completions per week">
        {[0, 0.5, 1].map((f) => {
          const y = pad.top + innerH * (1 - f);
          return (
            <g key={f}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
                {Math.round(max * f)}
              </text>
            </g>
          );
        })}
        <path d={area} fill="var(--accent-soft)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {xy.map((p) => (
          <circle key={p.label} cx={p.x} cy={p.y} r="2.8" fill="var(--accent)">
            <title>{`${p.label}: ${p.n}`}</title>
          </circle>
        ))}
        {xy.map((p, i) =>
          i % 3 === 0 ? (
            <text key={`l${p.label}`} x={p.x} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
