/**
 * The quadrant plot: everyone placed by trust received against influence
 * received, split on the two medians.
 *
 * The one insight whose graph is not the network map, and rightly so — the
 * finding is a POSITION on a plane, not a place in a structure, and putting it
 * on the constellation would bury it. Position carries the finding and colour
 * repeats it, so the four corners read without a legend and without relying on
 * hue alone.
 *
 * Lifted out of the insights page unchanged when the page became a workspace;
 * it is the centre of its own tab now rather than the middle of a card.
 */

import { useMemo } from 'react';
import { POWER_ACCENT } from './ComparePane.js';
import type { PersonProps } from './InsightsChrome.js';
import type { LayoutBox } from './layout.js';
import {
  cullLabels,
  outerLabels,
  POLARITY_STYLE,
  quadrantOf,
  rankByDivergence,
  textBox,
  type DivergencePoint,
  type LabelBox,
  type Medians,
  type Quadrant,
} from './model.js';

/** The four quadrants, in the colours their corner labels wear. */
export const QUADRANT_COLOR: Record<Quadrant, string> = {
  watch: POWER_ACCENT,
  underused: '#0B6FB4',
  anchor: POLARITY_STYLE.positive.color,
  peripheral: '#5A6678',
};

export const QUADRANT_NAME: Record<Quadrant, string> = {
  watch: 'Influence without trust',
  underused: 'Trusted, little influence',
  anchor: 'Trusted and influential',
  peripheral: 'Peripheral',
};

const CHART = { w: 1000, h: 580, l: 92, r: 26, t: 44, b: 72 };
/** Font size of a plotted name, in chart units. */
const NAME_SIZE = 19;
/**
 * Where a name may sit relative to its dot's centre, in preference order:
 * above it, below it, then out to its right. Three seats rather than one
 * roughly doubles how many names survive the cull on a crowded plot, and none
 * of them detaches the name from the mark it belongs to.
 */
const NAME_SEATS = [
  { dx: 0, dy: -19, anchor: 'middle' as const },
  { dx: 0, dy: 31, anchor: 'middle' as const },
  { dx: 18, dy: 6, anchor: 'start' as const },
];

export function DivergenceChart({
  box,
  points,
  medians,
  activeNo,
  lifted,
  nameOf,
  funcOf,
  personProps,
  onClearFocus,
}: {
  /** The stage's proportions, in chart units; the chart draws to fill them. */
  box?: LayoutBox;
  points: DivergencePoint[];
  medians: Medians;
  activeNo: number | null;
  /** A quadrant the reader is pointing at in the sidebar — its band lifts. */
  lifted: Quadrant | null;
  nameOf: (no: number) => string;
  funcOf: (no: number) => string;
  personProps: PersonProps;
  onClearFocus: () => void;
}) {
  const W = box?.w ?? CHART.w;
  const H = box?.h ?? CHART.h;
  const left = CHART.l;
  const right = W - CHART.r;
  const top = CHART.t;
  const bottom = H - CHART.b;
  const normalised = points[0]?.normalised ?? false;

  const plot = useMemo(() => {
    if (points.length === 0) return null;
    const maxX = Math.max(...points.map((p) => p.trust), medians.trust, 1e-6) * 1.1;
    const maxY = Math.max(...points.map((p) => p.power), medians.power, 1e-6) * 1.1;
    // Inset by more than a dot's radius so someone on zero sits fully inside
    // the plot rather than half-hidden behind the axis.
    const DOT_INSET = 20;
    const x = (v: number) => left + DOT_INSET + (v / maxX) * (right - left - DOT_INSET * 2);
    const y = (v: number) => bottom - DOT_INSET - (v / maxY) * (bottom - top - DOT_INSET * 2);
    const mx = x(medians.trust);
    const my = y(medians.power);

    // The fixed furniture lives OUTSIDE the plot, by construction: quadrant
    // captions along the top and bottom edges, the medians as tick labels on
    // the axes. Nothing drawn for the reader's orientation can ever cover a
    // dot or a name, so nothing inside needs reserving.
    const corners: { q: Quadrant; text: string; cx: number; cy: number; anchor: 'start' | 'end' }[] = [
      { q: 'watch', text: `${QUADRANT_NAME.watch} — watch list`, cx: left, cy: top - 14, anchor: 'start' },
      { q: 'anchor', text: QUADRANT_NAME.anchor, cx: right, cy: top - 14, anchor: 'end' },
      { q: 'peripheral', text: QUADRANT_NAME.peripheral, cx: left, cy: bottom + 24, anchor: 'start' },
      { q: 'underused', text: `${QUADRANT_NAME.underused} — underused assets`, cx: right, cy: bottom + 24, anchor: 'end' },
    ];
    const cornerPills = corners.map((c) => ({ ...c, box: textBox(c.text, c.cx, c.cy, 19.5, c.anchor, { x: 0, y: 0 }) }));
    // "median" under the vertical median on the x axis, beside the horizontal
    // one on the y axis. The x one dodges the bottom captions: if it would
    // land on either, it goes to the top edge instead.
    const overlaps = (a: LabelBox, b: LabelBox) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const medianSeats = [
      { cx: mx, cy: bottom + 24, anchor: 'middle' as const },
      { cx: mx, cy: top - 14, anchor: 'middle' as const },
    ];
    const medianX =
      medianSeats.find((seat) => {
        const b = textBox('median', seat.cx, seat.cy, 15, seat.anchor, { x: 4, y: 0 });
        return !cornerPills.some((c) => overlaps(b, c.box));
      }) ?? medianSeats[0]!;
    const guides = [
      { text: 'median', cx: medianX.cx, cy: medianX.cy, anchor: medianX.anchor, tick: { x1: mx, y1: medianX.cy > my ? bottom : top, x2: mx, y2: medianX.cy > my ? bottom + 8 : top - 8 } },
      { text: 'median', cx: left - 10, cy: my + 5, anchor: 'end' as const, tick: { x1: left - 8, y1: my, x2: left, y2: my } },
    ];
    const reserved: LabelBox[] = [];

    // Names, most notable first, each offered a seat above its dot and then
    // below it, and kept only if one of the two clears everything already
    // standing. Greedy and order-dependent by design: the outliers are the
    // reason the chart exists, so they get first refusal on the space.
    const eligible = outerLabels(points, medians, 0.6);
    // A seat is only offered if the whole label lands inside the plot: a name
    // hanging off the axis reads as a rendering fault, not as data.
    const inside = (b: LabelBox) =>
      b.x >= left + 2 && b.x + b.w <= right - 2 && b.y >= top + 2 && b.y + b.h <= bottom - 2;
    const candidates = rankByDivergence(points, medians)
      .filter((p) => eligible.has(p.no))
      .map((p) => ({
        id: p.no,
        // Seats keep their index: an illegal one is nulled, never removed, so
        // the index cullLabels returns still addresses NAME_SEATS.
        boxes: NAME_SEATS.map((seat) => {
          const b = textBox(nameOf(p.no), x(p.trust) + seat.dx, y(p.power) + seat.dy, NAME_SIZE, seat.anchor);
          return inside(b) ? b : null;
        }),
      }));
    return {
      x,
      y,
      mx,
      my,
      cornerPills,
      guides,
      named: cullLabels(candidates, reserved, 3),
    };
  }, [bottom, left, medians, nameOf, points, right, top]);

  if (!plot) {
    return <p className="hint">Nobody to plot yet — the chart draws itself as the group answers.</p>;
  }
  const { x, y, mx, my, cornerPills, guides, named } = plot;
  const quadRect: Record<Quadrant, { x: number; y: number; w: number; h: number }> = {
    watch: { x: left, y: top, w: mx - left, h: my - top },
    anchor: { x: mx, y: top, w: right - mx, h: my - top },
    peripheral: { x: left, y: my, w: mx - left, h: bottom - my },
    underused: { x: mx, y: my, w: right - mx, h: bottom - my },
  };
  const activePoint = activeNo === null ? null : points.find((p) => p.no === activeNo) ?? null;

  return (
    <svg
      className="insights-quad"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Trust received against influence received, split on the group's medians"
    >
      {(Object.keys(quadRect) as Quadrant[]).map((q) => (
        <rect
          key={q}
          className="insights-quad-tint"
          x={quadRect[q].x}
          y={quadRect[q].y}
          width={Math.max(0, quadRect[q].w)}
          height={Math.max(0, quadRect[q].h)}
          fill={QUADRANT_COLOR[q]}
          opacity={lifted === q ? 0.13 : 0.05}
          onClick={onClearFocus}
        />
      ))}

      <line x1={left} y1={bottom} x2={right} y2={bottom} className="insights-quad-axis" />
      <line x1={left} y1={top} x2={left} y2={bottom} className="insights-quad-axis" />
      <line x1={mx} y1={top} x2={mx} y2={bottom} className="insights-quad-median" />
      <line x1={left} y1={my} x2={right} y2={my} className="insights-quad-median" />

      <text x={(left + right) / 2} y={H - 14} textAnchor="middle" className="insights-quad-axis-label">
        Trust received{normalised ? ' — per colleague who rated them' : ' — ties'}
      </text>
      <text
        x={-(top + bottom) / 2}
        y={22}
        textAnchor="middle"
        transform="rotate(-90)"
        className="insights-quad-axis-label"
      >
        Influence received{normalised ? ' — per rater' : ' — ties'}
      </text>

      {/* Dots below the furniture: a name must never be printed over. */}
      {points.map((p) => {
        const q = quadrantOf(p, medians);
        const on = p.no === activeNo;
        const dim = activeNo !== null && !on;
        return (
          <g
            key={p.no}
            className={`insights-dot${on ? ' is-active' : ''}`}
            role="img"
            aria-label={`${nameOf(p.no)}, ${funcOf(p.no)}, ${QUADRANT_NAME[q].toLowerCase()}, ${p.trustCount} trust and ${p.powerCount} power-over ties received`}
            {...personProps(p.no, () => ({
              title: nameOf(p.no),
              sub: `${funcOf(p.no)} · ${QUADRANT_NAME[q]}`,
              rows: [
                ['Trust received', normalised ? `${p.trust.toFixed(2)} per rater` : String(p.trustCount)],
                ['Influence received', normalised ? `${p.power.toFixed(2)} per rater` : String(p.powerCount)],
              ],
            }))}
          >
            {on ? (
              <circle cx={x(p.trust)} cy={y(p.power)} r={22} fill={QUADRANT_COLOR[q]} opacity={0.18} />
            ) : null}
            <circle
              cx={x(p.trust)}
              cy={y(p.power)}
              r={on ? 13.5 : 11}
              fill={QUADRANT_COLOR[q]}
              stroke={on ? 'var(--ink)' : '#fff'}
              strokeWidth={on ? 2.5 : 1.6}
              opacity={dim ? 0.42 : 0.94}
            />
          </g>
        );
      })}

      {/* Orientation, outside the plot: never over a dot. */}
      {guides.map((g, i) => (
        <g key={i} className="insights-quad-guide">
          <line x1={g.tick.x1} y1={g.tick.y1} x2={g.tick.x2} y2={g.tick.y2} />
          <text x={g.cx} y={g.cy} textAnchor={g.anchor} className="insights-quad-tick">
            {g.text}
          </text>
        </g>
      ))}
      {cornerPills.map((c) => (
        <text
          key={c.q}
          x={c.cx}
          y={c.cy}
          textAnchor={c.anchor}
          className={`insights-quad-corner${lifted === c.q ? ' is-lifted' : ''}`}
          style={{ fill: QUADRANT_COLOR[c.q] }}
        >
          {c.text}
        </text>
      ))}

      {points.map((p) => {
        const i = named.get(p.no);
        if (i === undefined || p.no === activeNo) return null;
        const seat = NAME_SEATS[i]!;
        return (
          <text
            key={p.no}
            x={x(p.trust) + seat.dx}
            y={y(p.power) + seat.dy}
            textAnchor={seat.anchor}
            className="insights-quad-name"
            opacity={activeNo === null ? 1 : 0.45}
          >
            {nameOf(p.no)}
          </text>
        );
      })}

      {/* The focused person is named last, over everything, on their own pill. */}
      {activePoint ? (
        <g className="insights-quad-pill is-active">
          {(() => {
            const b = textBox(nameOf(activePoint.no), x(activePoint.trust), y(activePoint.power) - 16, NAME_SIZE, 'middle', { x: 7, y: 4 });
            return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} />;
          })()}
          <text
            x={x(activePoint.trust)}
            y={y(activePoint.power) - 16}
            textAnchor="middle"
            className="insights-quad-name is-active"
          >
            {nameOf(activePoint.no)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
