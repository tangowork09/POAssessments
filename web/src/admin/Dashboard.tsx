/** Dashboard: real counts, a twelve-week completions trend, cohort averages. */

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Head, Loading, StatusPill } from './ui.js';

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
  cohort: { key: string; name: string; side: string; average: number; n: number }[];
  sendsToday: number;
  dailySendCap: number;
}

const MAX_STYLE_SCORE = 20;

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardData>('/api/admin/dashboard')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="hint">{error}</p>;
  if (!data) return <Loading />;

  const t = data.totals;

  return (
    <>
      <Head
        title="Dashboard"
        sub="Live counts across every assessment. Nothing here is sampled or estimated."
      />

      <div className="tiles">
        <Tile label="Candidates" value={t.candidates} foot="People on the platform" />
        <Tile label="Invited" value={t.invited} foot="Assessment invitations issued" />
        <Tile label="In progress" value={t.in_progress} foot="Started, not yet submitted" />
        <Tile
          label="Completed"
          value={t.completed}
          foot={data.completionRate === null ? 'No starts yet' : `${data.completionRate}% of those started`}
        />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Completions</div>
              <div className="card-sub">Last twelve weeks</div>
            </div>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-swatch" style={{ background: 'var(--accent)' }} />
                Completed
              </span>
            </div>
          </div>
          <div className="card-body">
            <TrendChart points={data.trend} />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Mail</div>
              <div className="card-sub">Today’s sends against the cap</div>
            </div>
          </div>
          <div className="card-body">
            <div className="tile-val num">{data.sendsToday}</div>
            <p className="hint" style={{ marginTop: 4 }}>
              of {data.dailySendCap} allowed today
            </p>
            <div className="progress-strip" style={{ marginTop: 14 }}>
              <i style={{ width: `${Math.min(100, (data.sendsToday / data.dailySendCap) * 100)}%` }} />
            </div>
            <p className="inline-note" style={{ marginTop: 14 }}>
              The cap applies to invitations. Report emails are sent when a candidate finishes and are not
              throttled.
            </p>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Assessments</div>
            <div className="card-sub">Funnel per instrument</div>
          </div>
        </div>
        <div className="table-scroll">
          <table>
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
      </section>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Recent candidates</div>
              <div className="card-sub">Most recent activity first</div>
            </div>
          </div>
          {data.recent.length === 0 ? (
            <div className="empty-state">
              <b>No candidates yet</b>
              Send an invitation, or share an assessment link.
            </div>
          ) : (
            <div className="table-scroll">
              <table>
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
                        {r.first_name} {r.last_name}
                        <span className="cell-sub">{r.email}</span>
                      </td>
                      <td>{r.organisation || '—'}</td>
                      <td>
                        <StatusPill status={r.status} answered={r.answered_count} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Cohort averages</div>
              <div className="card-sub">
                {data.cohort[0]?.n ? `Mean of ${data.cohort[0].n} completed reports` : 'No reports yet'}
              </div>
            </div>
          </div>
          <div className="card-body">
            {data.cohort.map((s) => (
              <div className="cohort-row" key={s.key}>
                <div className="cohort-label">{s.name}</div>
                <div className="cohort-track ct">
                  <div
                    className="cohort-fill"
                    style={{
                      transform: `scaleX(${s.average / MAX_STYLE_SCORE})`,
                      background: s.side === 'push' ? 'var(--push)' : 'var(--pull)',
                    }}
                  />
                </div>
                <div className="cohort-val num">
                  {s.average}
                  <em> /{MAX_STYLE_SCORE}</em>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, foot }: { label: string; value: number; foot: string }) {
  return (
    <div className="card tile">
      <div className="tile-top">
        <span className="tile-label">{label}</span>
      </div>
      <div className="tile-val num">{value}</div>
      <div className="tile-bottom">
        <span className="inline-note">{foot}</span>
      </div>
    </div>
  );
}

/** Inline SVG so the chart carries no charting dependency. */
function TrendChart({ points }: { points: { label: string; n: number }[] }) {
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
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy.at(-1)!.x.toFixed(1)} ${pad.top + innerH} L${xy[0]!.x.toFixed(1)} ${pad.top + innerH} Z`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Completions per week">
        {[0, 0.5, 1].map((f) => {
          const y = pad.top + innerH * (1 - f);
          return (
            <g key={f}>
              <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-4)">
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
            <text
              key={`l${p.label}`}
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink-4)"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
