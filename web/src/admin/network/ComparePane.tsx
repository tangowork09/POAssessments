/**
 * "Trust vs Power": the same people, in the same seats, drawn twice — once
 * with the ties of trust and once with the ties of formal pull. Everything else
 * about the view exists to protect that one comparison, above all the single
 * shared layout: a person who is a hub on the left and a leaf on the right is
 * the finding, and it is only legible if they did not move.
 *
 * Lifted out of the explorer card so the Insights page can embed the identical
 * pair of panes rather than growing a second, subtly different drawing of the
 * same claim. Behaviour is unchanged: same props, same maths, same SVG.
 */

import { useMemo } from 'react';
import type { CohortNetwork, CohortNetworkEdge } from '../../../../src/shared/types.js';
import { nodeRadius, type LayoutBox, type Positions } from './layout.js';
import {
  buildPaneEdges,
  cullLabels,
  paneInDegree,
  paneNeighbours,
  POLARITY_STYLE,
  RANK_RING_COLOR,
  tieOpacity,
  tiePath,
  textBox,
  tieWidth,
  topPaneLabels,
  type PaneEdge,
} from './model.js';

/** Nobody, shared — a fresh empty Set every render would break memoisation. */
const NO_ONE: ReadonlySet<number> = new Set<number>();

/**
 * How many names one pane prints unprompted. A sixty-person constellation
 * labelled exhaustively is unreadable exactly where it is densest, which is
 * where the ties are; the people the pane is about are the ones being chosen,
 * so the most-chosen keep their names and everyone else keeps a tooltip.
 */
const PANE_LABELS = 8;

/** What the hovered node means in the pane it was hovered in. */
export interface PaneHoverContext {
  /** 'trust' or 'power' — which side of the comparison. */
  pane: string;
  /** That pane's own ties received for this person. */
  inDegree: number;
}

/** The lens the "who drives decisions" side of the compare view reads. */
export const POWER_LENS = 'power_over';
/** The lens the "who we trust" side reads. */
export const TRUST_LENS = 'trust';

/** The accent each side wears, matching the block colours used elsewhere. */
export const TRUST_ACCENT = POLARITY_STYLE.positive.color;
export const POWER_ACCENT = '#B4530E';

/**
 * The same two hues, brightened, for ties drawn as lines.
 *
 * A ring sits on white at full strength and reads at the accent's own depth. A
 * tie is a two-pixel line at partial opacity crossing a map of coloured dots,
 * and the accents go grey there. These are lifted in value and saturation so
 * the line keeps its hue at the opacity a map full of ties has to be drawn at —
 * still plainly the green and the orange the rings use, which is what the
 * legend depends on.
 */
export const TRUST_TIE = '#10A372';
export const POWER_TIE = '#E5760C';

export function CompareView({
  nodes,
  edges,
  visible,
  positions,
  paneBox,
  stacked,
  cut,
  fillOf,
  focus,
  selectedNo,
  matches,
  showLabels,
  onSelect,
  onHover,
  onLeave,
  labelSize,
  ringed,
}: {
  nodes: CohortNetwork['nodes'];
  edges: CohortNetworkEdge[];
  visible: Set<number>;
  positions: Positions;
  paneBox: LayoutBox;
  stacked: boolean;
  cut: number;
  fillOf: (n: { no: number; func: string; responded?: boolean }) => string;
  focus: number | null;
  selectedNo: number | null;
  matches: Set<number> | null;
  showLabels: boolean;
  onSelect: (no: number) => void;
  onHover: (no: number, e: React.MouseEvent, ctx: PaneHoverContext) => void;
  onLeave: () => void;
  /**
   * Name size in the pane's own user units. The explorer lays its panes out in
   * screen pixels, so the default is a pixel size; the Insights page lays them
   * out in a much larger virtual box (which is what keeps sixty nodes from
   * colliding) and scales the names up to match.
   */
  labelSize?: number;
  /**
   * The people whose standing differs most between the two lenses. Ringed and
   * always named in BOTH panes: the finding is that one seat reads differently
   * on the two sides, and a ring on one side alone would be a claim about one
   * side.
   */
  ringed?: ReadonlySet<number>;
}) {
  const trustEdges = useMemo(
    () => buildPaneEdges(edges, TRUST_LENS, cut, visible),
    [cut, edges, visible],
  );
  const powerEdges = useMemo(
    () => buildPaneEdges(edges, POWER_LENS, cut, visible),
    [cut, edges, visible],
  );

  const shared = { nodes, positions, box: paneBox, fillOf, focus, selectedNo, matches, showLabels, onSelect, onHover, onLeave, labelSize, ringed };
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: stacked ? '1fr' : '1fr 1fr',
        gridAutoRows: stacked ? '1fr 1fr' : undefined,
        gap: 10,
        padding: 10,
        minHeight: 0,
      }}
    >
      <ComparePane
        id="trust"
        title="Who we trust"
        subtitle="positive trust ties"
        accent={TRUST_ACCENT}
        paneEdges={trustEdges}
        {...shared}
      />
      <ComparePane
        id="power"
        title="Who drives decisions"
        subtitle="positive power-over ties"
        accent={POWER_ACCENT}
        paneEdges={powerEdges}
        {...shared}
      />
    </div>
  );
}

/** One side of the compare view. Plain SVG — the two panes are read, not panned. */
export function ComparePane({
  id,
  title,
  subtitle,
  accent,
  nodes,
  paneEdges,
  positions,
  box,
  fillOf,
  focus,
  selectedNo,
  matches,
  showLabels,
  onSelect,
  onHover,
  onLeave,
  labelSize = 11,
  ringed = NO_ONE,
}: {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  nodes: CohortNetwork['nodes'];
  paneEdges: PaneEdge[];
  positions: Positions;
  box: LayoutBox;
  fillOf: (n: { no: number; func: string; responded?: boolean }) => string;
  focus: number | null;
  selectedNo: number | null;
  matches: Set<number> | null;
  showLabels: boolean;
  onSelect: (no: number) => void;
  onHover: (no: number, e: React.MouseEvent, ctx: PaneHoverContext) => void;
  onLeave: () => void;
  labelSize?: number;
  ringed?: ReadonlySet<number>;
}) {
  const inDeg = paneInDegree(paneEdges);
  const maxIn = Math.max(0, ...inDeg.values());
  const ego = focus !== null ? paneNeighbours(paneEdges, focus) : null;
  const radiusOf = (no: number) => nodeRadius(inDeg.get(no) ?? 0, maxIn);
  // The ringed people join the label set rather than replacing it: a ring the
  // reader cannot put a name to is a decoration, not a finding.
  const named = topPaneLabels(paneEdges, PANE_LABELS);
  for (const no of ringed) named.add(no);
  // Everything drawn in user units has to scale with the box, or a pane laid
  // out in a large virtual space renders hairline ties and micro-type.
  const k = labelSize / 11;

  // Eight names is few enough to read and still too many to print blind: in the
  // dense middle two of them land on each other. Same greedy placement the
  // scatter uses — below the node first, then above, then nothing.
  const seats = [1, -1];
  const placed = useMemo(() => {
    // Ringed first: greedy placement gives the space to whoever asks first, and
    // these three are the ones the card promised to name.
    const wanted = [...named].sort(
      (a, b) =>
        Number(ringed.has(b)) - Number(ringed.has(a)) ||
        (inDeg.get(b) ?? 0) - (inDeg.get(a) ?? 0) ||
        a - b,
    );
    const nameOf = new Map(nodes.map((n) => [n.no, n.name]));
    return cullLabels(
      wanted.map((no) => {
        const p = positions.get(no);
        const r = radiusOf(no);
        return {
          id: no,
          boxes: p
            ? seats.map((dir) =>
                textBox(
                  nameOf.get(no) ?? '',
                  p.x,
                  p.y + dir * (r + labelSize * 1.2) + (dir < 0 ? -labelSize * 0.2 : 0),
                  labelSize,
                  'middle',
                ),
              )
            : [],
        };
      }),
      [],
      labelSize * 0.25,
    );
    // radiusOf and named derive from paneEdges; nodes and positions are the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelSize, named, nodes, paneEdges, positions, ringed]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '7px 11px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} aria-hidden="true" />
        <b style={{ fontSize: 12.5, color: 'var(--ink)' }}>{title}</b>
        <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{subtitle}</span>
      </div>
      <svg
        viewBox={`0 0 ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ flex: 1, minHeight: 0, width: '100%' }}
        role="img"
        aria-label={`${title}: ${nodes.length} people, ${paneEdges.length} ties`}
      >
        <defs>
          <marker id={`nxc-arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={POLARITY_STYLE.positive.color} />
          </marker>
        </defs>
        {paneEdges.map((e) => {
          const s = positions.get(e.from);
          const t = positions.get(e.to);
          if (!s || !t) return null;
          const dimmed = focus !== null && e.from !== focus && e.to !== focus;
          const focused = focus !== null && !dimmed;
          return (
            <path
              key={e.key}
              d={tiePath({
                sx: s.x,
                sy: s.y,
                sr: radiusOf(e.from),
                tx: t.x,
                ty: t.y,
                tr: radiusOf(e.to),
                mutual: e.mutual,
                bend: e.bend,
              })}
              fill="none"
              stroke={POLARITY_STYLE.positive.color}
              strokeWidth={tieWidth('positive', e.mean, focused) * k}
              strokeLinecap="round"
              opacity={tieOpacity('positive', { dimmed, focused })}
              markerEnd={`url(#nxc-arrow-${id})`}
            />
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.no);
          if (!p) return null;
          const r = radiusOf(n.no);
          const dimmed =
            (focus !== null && focus !== n.no && !(ego?.has(n.no) ?? false)) ||
            (matches !== null && !matches.has(n.no));
          const ctx = { pane: id, inDegree: inDeg.get(n.no) ?? 0 };
          return (
            <g
              key={n.no}
              className={`nxc-node${selectedNo === n.no ? ' is-active' : ''}`}
              opacity={dimmed ? 0.16 : n.responded ? 1 : 0.55}
              style={{ cursor: 'pointer' }}
              role="img"
              aria-label={`${n.name}${n.func ? `, ${n.func}` : ''}, ${ctx.inDegree} ties received here`}
              onClick={() => onSelect(n.no)}
              onMouseEnter={(e) => onHover(n.no, e, ctx)}
              onMouseMove={(e) => onHover(n.no, e, ctx)}
              onMouseLeave={onLeave}
            >
              {selectedNo === n.no ? (
                <circle cx={p.x} cy={p.y} r={r + labelSize * 0.8} fill="var(--ink)" opacity={0.2} />
              ) : null}
              {ringed.has(n.no) ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + labelSize * 0.62}
                  fill="none"
                  stroke={RANK_RING_COLOR}
                  strokeWidth={labelSize * 0.22}
                  strokeDasharray={`${labelSize * 0.5} ${labelSize * 0.42}`}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={fillOf(n)}
                stroke={selectedNo === n.no ? 'var(--ink)' : '#fff'}
                strokeWidth={selectedNo === n.no ? labelSize * 0.4 : labelSize * 0.18}
              />
            </g>
          );
        })}
        {/* Names last, in one pass. Drawn inside the node loop, the very next
            node's circle paints over the name just written — which is what
            left half the labels in this view reading "gh" and "n Bose". */}
        {nodes.map((n) => {
          const p = positions.get(n.no);
          if (!p) return null;
          const dimmed =
            (focus !== null && focus !== n.no && !(ego?.has(n.no) ?? false)) ||
            (matches !== null && !matches.has(n.no));
          const picked = focus === n.no || selectedNo === n.no || (matches?.has(n.no) ?? false);
          const seat = placed.get(n.no);
          const ring = ringed.has(n.no);
          // Singled out by the reader: always named, wherever it lands. A ringed
          // person is named even if the cull took every seat — the ring is the
          // card's promise that this person is worth pointing at by name.
          const label =
            picked ||
            (ego?.has(n.no) ?? false) ||
            (showLabels && focus === null && (seat !== undefined || ring));
          if (!label) return null;
          const dir = seats[seat ?? 0] ?? 1;
          const r = radiusOf(n.no);
          return (
            <text
              key={n.no}
              x={p.x}
              y={p.y + dir * (r + labelSize * 1.2) + (dir < 0 ? -labelSize * 0.2 : 0)}
              textAnchor="middle"
              className="insights-map-name"
              opacity={dimmed ? 0.2 : 1}
              style={{
                fontSize: labelSize,
                fontWeight: picked || ring ? 750 : 600,
                strokeWidth: labelSize * 0.3,
                fill: ring && !picked ? RANK_RING_COLOR : undefined,
              }}
            >
              {n.name}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
