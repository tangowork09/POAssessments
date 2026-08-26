/**
 * The roster as a sortable, filterable table under the graph, and the rich
 * per-person dossier a row opens: a donut of how the group rates them, their
 * received profile as bars, and their positive/negative trend across rounds.
 *
 * The table shares the graph's computed degrees and roles, so a row and a node
 * always tell the same story. Clicking a row focuses that person in the graph
 * and opens their dossier.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { DataTable } from '../ui.js';
import type { CohortNetwork } from '../../../../src/shared/types.js';
import type { SocioMemberResult } from '../../../../src/shared/socio-scoring.js';
import { POLARITY_STYLE, ROLE_STYLE, type DegreeCounts, type Role } from './model.js';

const GROUP_OTHER = '#8D97A6';

interface Row {
  no: number;
  name: string;
  func: string;
  responded: boolean;
  role: Role;
  posIn: number;
  negIn: number;
  given: number;
  coverage: number | null;
  suppressed: boolean;
}

export function EmployeesTable({
  net,
  cohortId,
  roundCount,
  degreeMap,
  roleMap,
  groupColor,
  minRaters,
  selectedNo,
  onFocus,
}: {
  net: CohortNetwork;
  cohortId: string;
  roundCount: number;
  degreeMap: Map<number, DegreeCounts>;
  roleMap: Map<number, Role>;
  groupColor: Map<string, string>;
  minRaters: number;
  selectedNo: number | null;
  onFocus: (no: number) => void;
}) {
  const [dossierNo, setDossierNo] = useState<number | null>(null);

  const memberByNo = useMemo(
    () => new Map((net.group?.members ?? []).map((m) => [m.memberNo, m])),
    [net.group],
  );

  const rows: Row[] = useMemo(
    () =>
      net.nodes.map((n) => {
        const d = degreeMap.get(n.no);
        const m = memberByNo.get(n.no);
        return {
          no: n.no,
          name: n.name,
          func: n.func || '—',
          responded: n.responded ?? false,
          role: n.responded ? roleMap.get(n.no) ?? 'member' : 'member',
          posIn: d?.posIn ?? 0,
          negIn: d?.negIn ?? 0,
          given: (d?.posOut ?? 0) + (d?.negOut ?? 0),
          coverage: m ? m.coverage : null,
          suppressed: m?.suppressed ?? false,
        };
      }),
    [degreeMap, memberByNo, net.nodes, roleMap],
  );

  const open = (no: number) => {
    setDossierNo(no);
    onFocus(no);
  };

  const dossierMember = dossierNo !== null ? memberByNo.get(dossierNo) ?? null : null;
  const dossierNode = dossierNo !== null ? net.nodes.find((n) => n.no === dossierNo) ?? null : null;

  return (
    <section className="card emp-card">
      <div className="card-body">
        <div className="emp-head">
          <div>
            <h2>People</h2>
            <p className="hint">
              Every person in the group. Click anyone for their full profile — how the group rates
              them, and how it moves over time.
            </p>
          </div>
        </div>

        <DataTable
          rows={rows}
          rowKey={(r) => String(r.no)}
          pageSize={10}
          minWidth={720}
          columns={[
            {
              key: 'name',
              header: 'Person',
              value: (r) => `${r.name} ${r.func}`,
              cell: (r) => (
                <button className="emp-name" onClick={() => open(r.no)}>
                  <span className="emp-dot" style={{ background: groupColor.get(r.func) ?? GROUP_OTHER }} />
                  <span>
                    <b>{r.name}</b>
                    {!r.responded ? <span className="emp-sub">not yet responded</span> : null}
                  </span>
                </button>
              ),
            },
            { key: 'func', header: 'Department', value: (r) => r.func, cell: (r) => r.func },
            {
              key: 'role',
              header: 'Role',
              width: '110px',
              value: (r) => r.role,
              cell: (r) =>
                r.role === 'member' ? (
                  <span className="emp-role-plain">Member</span>
                ) : (
                  <span className={`emp-role is-${r.role}`}>{ROLE_STYLE[r.role].label.split(' (')[0]}</span>
                ),
            },
            {
              key: 'posIn',
              header: 'Positive in',
              width: '96px',
              align: 'right',
              value: (r) => r.posIn,
              cell: (r) => <b style={{ color: POLARITY_STYLE.positive.color }}>{r.posIn}</b>,
            },
            {
              key: 'negIn',
              header: 'Negative in',
              width: '96px',
              align: 'right',
              value: (r) => r.negIn,
              cell: (r) => <span style={{ color: r.negIn ? POLARITY_STYLE.negative.color : 'var(--ink-4)' }}>{r.negIn}</span>,
            },
            {
              key: 'given',
              header: 'Given',
              width: '72px',
              align: 'right',
              value: (r) => r.given,
              cell: (r) => r.given,
            },
            {
              key: 'coverage',
              header: 'Rated by',
              width: '96px',
              align: 'right',
              value: (r) => r.coverage ?? -1,
              cell: (r) =>
                r.coverage === null ? (
                  <span className="cell-sub">—</span>
                ) : (
                  <span style={{ color: r.coverage < minRaters ? 'var(--danger)' : undefined }}>{r.coverage}</span>
                ),
            },
            {
              key: 'open',
              header: '',
              width: '84px',
              cell: (r) => (
                <button className="btn btn-secondary btn-sm" onClick={() => open(r.no)}>
                  Profile
                </button>
              ),
            },
          ]}
        />
      </div>

      {dossierNode ? (
        <PersonDossier
          cohortId={cohortId}
          roundCount={roundCount}
          node={dossierNode}
          member={dossierMember}
          degree={degreeMap.get(dossierNode.no) ?? null}
          role={dossierNode.responded ? roleMap.get(dossierNode.no) ?? 'member' : 'member'}
          minRaters={minRaters}
          color={groupColor.get(dossierNode.func || '—') ?? GROUP_OTHER}
          onClose={() => setDossierNo(null)}
          isSelected={selectedNo === dossierNode.no}
        />
      ) : null}
    </section>
  );
}

interface TrendPoint {
  roundNo: number;
  roundName: string;
  positive: number;
  negative: number;
}

/** The full-width per-person dossier: pie, bars, trend, headline numbers. */
function PersonDossier({
  cohortId,
  roundCount,
  node,
  member,
  degree,
  role,
  minRaters,
  color,
  onClose,
}: {
  cohortId: string;
  roundCount: number;
  node: { no: number; name: string; func: string; responded?: boolean };
  member: SocioMemberResult | null;
  degree: DegreeCounts | null;
  role: Role;
  minRaters: number;
  color: string;
  onClose: () => void;
  isSelected: boolean;
}) {
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  useEffect(() => {
    let stop = false;
    setTrend(null);
    void api
      .get<{ points: TrendPoint[] }>(`/api/admin/cohorts/${cohortId}/member/${node.no}/trend`)
      .then((r) => !stop && setTrend(r.points))
      .catch(() => !stop && setTrend([]));
    return () => {
      stop = true;
    };
  }, [cohortId, node.no]);

  const pie = [
    { label: 'Positive', value: degree?.posIn ?? 0, color: POLARITY_STYLE.positive.color },
    { label: 'Neutral', value: degree?.neuIn ?? 0, color: '#B5BDC7' },
    { label: 'Negative', value: degree?.negIn ?? 0, color: POLARITY_STYLE.negative.color },
  ];
  const pieTotal = pie.reduce((s, p) => s + p.value, 0);

  return (
    <div className="dossier">
      <div className="dossier-head">
        <div className="dossier-id">
          <span className="dossier-avatar" style={{ background: color }}>
            {node.name.charAt(0)}
          </span>
          <div>
            <h3>{node.name}</h3>
            <p>
              {node.func || 'No department'}
              {role !== 'member' ? (
                <>
                  {' · '}
                  <b style={{ color: ROLE_STYLE[role].fill === 'transparent' ? 'var(--ink-2)' : ROLE_STYLE[role].fill }}>
                    {ROLE_STYLE[role].label.split(' (')[0]}
                  </b>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="dossier-grid">
        {/* Headline numbers */}
        <div className="dossier-stats">
          <Stat label="Ties received" value={degree ? degree.posIn + degree.negIn + degree.neuIn : 0} />
          <Stat label="Positive in" value={degree?.posIn ?? 0} tone={POLARITY_STYLE.positive.color} />
          <Stat label="Negative in" value={degree?.negIn ?? 0} tone={degree?.negIn ? POLARITY_STYLE.negative.color : undefined} />
          <Stat label="Ties given" value={(degree?.posOut ?? 0) + (degree?.negOut ?? 0)} />
          <Stat
            label="Rated by"
            value={member?.coverage ?? 0}
            sub={member && member.coverage < minRaters ? 'below floor' : undefined}
          />
        </div>

        {/* Pie: composition of ties received */}
        <div className="dossier-card">
          <h4>How the group rates them</h4>
          {pieTotal === 0 ? (
            <p className="hint">No ties received yet.</p>
          ) : (
            <div className="dossier-pie">
              <Donut segments={pie} />
              <ul className="dossier-legend">
                {pie.map((p) => (
                  <li key={p.label}>
                    <span className="dossier-legend-dot" style={{ background: p.color }} />
                    {p.label}
                    <b>{p.value}</b>
                    <span className="dossier-legend-pct">
                      {pieTotal ? Math.round((p.value / pieTotal) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Received profile bars */}
        <div className="dossier-card">
          <h4>Received profile</h4>
          {member ? (
            <div className="dossier-bars">
              {member.blocks.map((b) => (
                <Bar key={b.blockKey} label={b.short} mean={b.mean} />
              ))}
              {member.supportGap.mean !== null ? (
                <Bar label="Support gap" mean={member.supportGap.mean} deficit />
              ) : null}
            </div>
          ) : (
            <p className="hint">Their profile builds as colleagues answer.</p>
          )}
        </div>

        {/* Trend */}
        <div className="dossier-card dossier-wide">
          <h4>
            Over rounds <span>positive vs negative received</span>
          </h4>
          {roundCount < 2 ? (
            <p className="hint">A trend appears once this group has been rated more than once.</p>
          ) : trend === null ? (
            <p className="hint">Loading…</p>
          ) : (
            <TrendChart points={trend} />
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone?: string; sub?: string }) {
  return (
    <div className="dossier-stat">
      <span className="dossier-stat-label">{label}</span>
      <span className="dossier-stat-value" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      {sub ? <span className="dossier-stat-sub">{sub}</span> : null}
    </div>
  );
}

function Bar({ label, mean, deficit }: { label: string; mean: number | null; deficit?: boolean }) {
  const pct = mean === null ? 0 : ((mean - 1) / 4) * 100;
  const color = deficit
    ? POLARITY_STYLE.negative.color
    : mean !== null && mean >= 4
      ? POLARITY_STYLE.positive.color
      : '#2a78d6';
  return (
    <div className="net-bar">
      <span className="net-bar-label">{label}</span>
      <span className="net-bar-track" aria-hidden="true">
        <span className="net-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="net-bar-val">{mean === null ? '—' : mean.toFixed(1)}</span>
    </div>
  );
}

/** A donut split into coloured arcs, hover a slice for its share. */
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg className="donut" viewBox="0 0 128 128" role="img" aria-label="Tie composition">
      <g transform="translate(64,64) rotate(-90)">
        {total === 0 ? <circle r={R} fill="none" stroke="var(--surface-3)" strokeWidth={20} /> : null}
        {segments.map((seg) => {
          if (seg.value === 0) return null;
          const len = (seg.value / total) * CIRC;
          const el = (
            <circle
              key={seg.label}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={20}
              strokeDasharray={`${len} ${CIRC - len}`}
              strokeDashoffset={-offset}
            >
              <title>
                {seg.label}: {seg.value} ({Math.round((seg.value / total) * 100)}%)
              </title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </g>
      <text className="donut-total" x="64" y="60" textAnchor="middle">
        {total}
      </text>
      <text className="donut-cap" x="64" y="76" textAnchor="middle">
        ties in
      </text>
    </svg>
  );
}

/** Two-line positive/negative trend with gridlines and round labels. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640;
  const H = 200;
  const pad = { l: 30, r: 16, t: 14, b: 26 };
  const max = Math.max(3, ...points.flatMap((p) => [p.positive, p.negative]));
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = (k: 'positive' | 'negative') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  const ticks = 4;
  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Positive and negative over rounds" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        return (
          <g key={i}>
            <line className="trend-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="trend-axis" x={pad.l - 6} y={y(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <path d={line('negative')} fill="none" stroke={POLARITY_STYLE.negative.color} strokeWidth={2.5} />
      <path d={line('positive')} fill="none" stroke={POLARITY_STYLE.positive.color} strokeWidth={2.5} />
      {points.map((p, i) => (
        <g key={p.roundNo}>
          <circle cx={x(i)} cy={y(p.positive)} r={3.2} fill={POLARITY_STYLE.positive.color} />
          <circle cx={x(i)} cy={y(p.negative)} r={3.2} fill={POLARITY_STYLE.negative.color} />
          <text className="trend-axis" x={x(i)} y={H - 8} textAnchor="middle">
            {p.roundName.length > 8 ? `R${p.roundNo}` : p.roundName}
          </text>
        </g>
      ))}
    </svg>
  );
}
