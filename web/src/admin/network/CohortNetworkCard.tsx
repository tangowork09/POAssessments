/**
 * The cohort's live sociometry map — the facilitator's working view of the
 * network as it forms, refreshed while the round is open.
 *
 * Three ways of looking, one dataset:
 *
 *   map     — force-directed: distance is affinity, size is ties received
 *   layers  — a flow reading: most-chosen on top, arrows running between rows
 *   groups  — the same map gathered by function, for reading the seams
 *
 * Clicking a person turns any view into their ego network: everyone else dims,
 * their in- and out-ties stay lit, and the side panel gives their numbers. The
 * lens (which block of the instrument) and the threshold slider decide which
 * edges exist at all; the default is the cohort's own tie threshold on the
 * overall mean, which is the same line every report draws.
 *
 * Node colour is the person's function (first three functions get hues, the
 * rest share grey — three is where the palette stops being tellable-apart on a
 * map). Identity never rides on colour alone: every node wears its name.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BaseEdge,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import { api, ApiError } from '../../lib/api.js';
import type { CohortNetwork, CohortNetworkEdge } from '../../../../src/shared/types.js';
import type { SocioBlockNetwork, SocioMemberResult } from '../../../../src/shared/socio-scoring.js';
import { SOCIO_BLOCKS } from '../../../../src/shared/socio.js';
import {
  circularLayout,
  forceMapLayout,
  groupedLayout,
  layeredLayout,
  nodeRadius,
  type LayoutBox,
  type Positions,
} from './layout.js';
import { EmployeesTable } from './EmployeesTable.js';
import {
  degrees,
  edgePolarity,
  POLARITY_STYLE,
  ROLE_STYLE,
  roles,
  type DegreeCounts,
  type Polarity,
  type Role,
} from './model.js';

// The validated eight-hue categorical order. Every node carries its name as a
// direct label, which is the secondary encoding that lets the fuller palette
// past the all-pairs colour-distance floor (see the data-viz relief rule).
const GROUP_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#4a3aa7',
  '#008300',
  '#e34948',
];
const GROUP_OTHER = '#8D97A6';

const LENSES = [
  { key: 'overall', name: 'Overall', color: '#1A4FD6' },
  ...SOCIO_BLOCKS.map((b) => ({ key: b.key, name: b.short, color: b.color })),
] as const;

type ViewKind = 'map' | 'circle' | 'layers' | 'groups';
const ALL_POLARITIES: Polarity[] = ['positive', 'negative', 'neutral'];

const POLL_MS = 15_000;

interface PersonData extends Record<string, unknown> {
  label: string;
  func: string;
  /** Function colour — the categorical channel. */
  color: string;
  /** What the group made of them — the shape/fill channel. */
  role: Role;
  r: number;
  responded: boolean;
  dimmed: boolean;
  selected: boolean;
  showLabel: boolean;
}

interface RatingData extends Record<string, unknown> {
  mean: number;
  color: string;
  polarity: Polarity;
  dashed: boolean;
  dimmed: boolean;
  /** True when a person is focused and this tie is one of theirs. */
  focused: boolean;
  mutual: boolean;
  /** Curve away from the sibling edge of a mutual pair. */
  bend: number;
  pending: boolean;
}

export function CohortNetworkCard({
  cohortId,
  roundCount,
  fullBleed,
}: {
  cohortId: string;
  roundCount: number;
  /** Overview-tab mode: the graph fills the page and the metrics become a rail. */
  fullBleed?: boolean;
}) {
  const [net, setNet] = useState<CohortNetwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<number | null>(null); // null = current
  const [view, setView] = useState<ViewKind>('map');
  const [lens, setLens] = useState<string>('overall');
  const [threshold, setThreshold] = useState<number | null>(null); // null until data arrives
  const [selectedNo, setSelectedNo] = useState<number | null>(null);
  const [showPending, setShowPending] = useState(false);
  // All three tie types on by default; the faint baseline + hover-focus keep
  // it readable, and the legend chips pare it down per question.
  const [polarities, setPolarities] = useState<Set<Polarity>>(
    new Set(['positive', 'negative', 'neutral']),
  );
  // Hover-to-focus: pointing at a person lights their web and drops everyone
  // else far back, without opening the panel. This is what keeps a dense graph
  // readable — you read it one person at a time.
  const [hoveredNo, setHoveredNo] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnter = useCallback((no: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredNo(no);
  }, []);
  const hoverLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredNo(null), 180);
  }, []);
  /** Where the hover card sits, in canvas coordinates. */
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  // --- the full filter set ---
  const [query, setQuery] = useState('');
  /** Functions currently hidden. Empty = all shown. */
  const [hiddenFuncs, setHiddenFuncs] = useState<Set<string>>(new Set());
  /** Roles currently shown. Empty = all. */
  const [roleFilter, setRoleFilter] = useState<Set<Role>>(new Set());
  const [minInDegree, setMinInDegree] = useState(0);
  const [hideIsolates, setHideIsolates] = useState(false);
  const [respondedOnly, setRespondedOnly] = useState(false);
  const [reciprocalOnly, setReciprocalOnly] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [sizeBy, setSizeBy] = useState<'in' | 'out'>('in');
  const [colorBy, setColorBy] = useState<'function' | 'role'>('function');
  /** For a selected person: which of their ties to draw. */
  const [egoDir, setEgoDir] = useState<'both' | 'in' | 'out'>('both');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [isFull, setIsFull] = useState(false);

  // Full screen is a CSS takeover, so Esc must always be the way back and the
  // page behind must not scroll underneath it.
  useEffect(() => {
    if (!isFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFull(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isFull]);

  const positionsRef = useRef<Positions>(new Map());
  // The layout solves in the canvas's real box, so nodes scatter across
  // whatever width and height the screen actually gives them — no dead
  // margins on a wide monitor, no cramming in full screen.
  // A callback ref, not a mount-once effect: the canvas div does not exist
  // until the data has loaded, so an effect that looked for it at mount found
  // nothing and the layout stayed on a guessed 1100×720 forever — which is why
  // collapsing the rail or resizing never re-spread the points.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<LayoutBox>({ w: 1100, h: 720 });
  const prevBox = useRef<LayoutBox>({ w: 1100, h: 720 });
  useEffect(() => {
    if (!canvasEl) return;
    const measure = () => {
      const r = canvasEl.getBoundingClientRect();
      const w = Math.max(600, Math.round(r.width));
      const h = Math.max(420, Math.round(r.height));
      // Ignore sub-24px jitters so a scrollbar appearing does not relayout.
      setBox((prev) => (Math.abs(prev.w - w) > 24 || Math.abs(prev.h - h) > 24 ? { w, h } : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvasEl);
    return () => ro.disconnect();
  }, [canvasEl]);
  // React Flow's `fitView` prop only frames the FIRST render that has nodes.
  // The data arrives async (0 → 60 nodes), so that first fit caught an empty
  // canvas and the nodes ended up off-screen. Holding the instance lets us
  // re-fit whenever the node set, the view or the round changes.
  const rfRef = useRef<{ fitView: (o?: { padding?: number; duration?: number }) => void } | null>(null);

  const lastPayload = useRef<string>('');
  const load = useCallback(async () => {
    try {
      const q = round ? `?round=${round}` : '';
      const res = await api.get<CohortNetwork>(`/api/admin/cohorts/${cohortId}/network${q}`);
      // A poll that brings back byte-identical data must change nothing on
      // screen — not even a re-render — or the map breathes every 15 seconds.
      const raw = JSON.stringify(res);
      if (raw === lastPayload.current) return;
      lastPayload.current = raw;
      setNet(res);
      setError(null);
      setThreshold((t) => t ?? res.tieThreshold);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the network.');
    }
  }, [cohortId, round]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live while the round is: a response lands, the map gains its edges within
  // the poll interval. A closed round is history and holds still.
  useEffect(() => {
    if (!net || net.roundClosed) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load, net]);

  const cut = threshold ?? net?.tieThreshold ?? 4;

  /** Every rated edge tagged with a polarity under the current lens + threshold. */
  const classified = useMemo(() => {
    if (!net) return [] as { e: CohortNetworkEdge; polarity: Polarity }[];
    const out: { e: CohortNetworkEdge; polarity: Polarity }[] = [];
    for (const e of net.edges) {
      const p = edgePolarity(e, lens, cut);
      if (p) out.push({ e, polarity: p });
    }
    return out;
  }, [cut, lens, net]);

  /** The edges the polarity filter actually draws. */
  const litEdges = useMemo(
    () => classified.filter((c) => polarities.has(c.polarity)),
    [classified, polarities],
  );

  const meanOf = useCallback(
    (e: CohortNetworkEdge): number => (lens === 'overall' ? e.mean : e.blocks[lens]?.mean ?? 0),
    [lens],
  );

  // Degree split by polarity, and the role it gives each person — computed over
  // the shown edges so the star/isolate reading tracks the filter and lens.
  const degreeMap = useMemo(
    () => degrees(net?.nodes.map((n) => n.no) ?? [], litEdges.map((c) => c.e), lens, cut),
    [cut, lens, litEdges, net],
  );
  const roleMap = useMemo(() => roles(degreeMap), [degreeMap]);
  /** What sizes a node: positive ties received, or positive ties given. */
  const sizeVal = useMemo(() => {
    const m = new Map<number, number>();
    for (const [no, d] of degreeMap) m.set(no, sizeBy === 'in' ? d.posIn : d.posOut);
    return m;
  }, [degreeMap, sizeBy]);

  const allFuncs = useMemo(
    () => [...new Set((net?.nodes ?? []).map((n) => n.func.trim() || '—'))].sort(),
    [net],
  );

  /** Which people survive the node filters — the search only dims, never hides. */
  const visibleNos = useMemo(() => {
    const set = new Set<number>();
    for (const n of net?.nodes ?? []) {
      const role = n.responded ? roleMap.get(n.no) ?? 'member' : 'member';
      const func = n.func.trim() || '—';
      if (hiddenFuncs.has(func)) continue;
      if (respondedOnly && !n.responded) continue;
      if (hideIsolates && role === 'isolate') continue;
      if (roleFilter.size > 0 && !roleFilter.has(role)) continue;
      if ((degreeMap.get(n.no)?.posIn ?? 0) < minInDegree) continue;
      set.add(n.no);
    }
    return set;
  }, [degreeMap, hiddenFuncs, hideIsolates, minInDegree, net, respondedOnly, roleFilter, roleMap]);

  const groupColor = useMemo(() => {
    if (!net) return new Map<string, string>();
    const funcs = [...new Set(net.nodes.map((n) => n.func.trim()).filter(Boolean))];
    const m = new Map<string, string>();
    funcs.forEach((f, i) => m.set(f, i < GROUP_COLORS.length ? GROUP_COLORS[i]! : GROUP_OTHER));
    return m;
  }, [net]);

  /** Assignment pairs not yet rated — the live "who is still owed" overlay. */
  const pendingPairs = useMemo(() => {
    if (!net || !showPending) return [];
    const byId = new Map(net.nodes.map((n) => [n.memberId, n.no]));
    const rated = new Set(net.edges.map((e) => `${e.from}>${e.to}`));
    const out: { from: number; to: number }[] = [];
    for (const a of net.assignments) {
      const from = byId.get(a.raterMemberId);
      if (from === undefined) continue;
      for (const t of a.targetMemberIds) {
        const to = byId.get(t);
        if (to === undefined || rated.has(`${from}>${to}`)) continue;
        out.push({ from, to });
      }
    }
    return out;
  }, [net, showPending]);

  // Mutual pairs over the polarity-filtered edges — used for reciprocal-only
  // and for the curved-arc rendering.
  const mutualKeys = useMemo(() => {
    const mutual = new Set<string>();
    const seen = new Set<string>();
    for (const { e } of litEdges) {
      if (seen.has(`${e.to}>${e.from}`)) {
        mutual.add(`${e.to}>${e.from}`);
        mutual.add(`${e.from}>${e.to}`);
      }
      seen.add(`${e.from}>${e.to}`);
    }
    return mutual;
  }, [litEdges]);

  /** Edges actually drawn: visible endpoints, reciprocal + ego-direction filters. */
  const drawEdges = useMemo(() => {
    return litEdges.filter(({ e }) => {
      if (!visibleNos.has(e.from) || !visibleNos.has(e.to)) return false;
      if (reciprocalOnly && !mutualKeys.has(`${e.from}>${e.to}`)) return false;
      if (selectedNo !== null && egoDir !== 'both') {
        if (egoDir === 'in' && e.to !== selectedNo) return false;
        if (egoDir === 'out' && e.from !== selectedNo) return false;
      }
      return true;
    });
  }, [egoDir, litEdges, mutualKeys, reciprocalOnly, selectedNo, visibleNos]);

  const neighboursOf = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const { e } of drawEdges) {
      (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return m;
  }, [drawEdges]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !net) return null;
    return new Set(net.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.no));
  }, [net, query]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !net) return [];
    return net.nodes
      .filter((n) => n.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [net, query]);

  // Layout is computed over the WHOLE network at the cohort's own threshold,
  // and depends only on the data and the chosen view — never on filters,
  // selection or hover. A filter hides people and ties; it does not move
  // anyone. That is what stops the cloud swirling into a new rotation every
  // time a chip is clicked: everyone keeps their seat, some seats go dark.
  const layoutDegree = useMemo(
    () =>
      degrees(
        net?.nodes.map((n) => n.no) ?? [],
        net?.edges ?? [],
        'overall',
        net?.tieThreshold ?? 4,
      ),
    [net],
  );

  const layout = useMemo(() => {
    if (!net) return { positions: new Map<number, { x: number; y: number }>(), maxSize: 0 };
    // A new box stretches the existing seats proportionally first, so the
    // anchored reheat spreads the constellation into the new space instead of
    // pinning it to the old, smaller one.
    if (prevBox.current.w !== box.w || prevBox.current.h !== box.h) {
      const sx = box.w / prevBox.current.w;
      const sy = box.h / prevBox.current.h;
      positionsRef.current = new Map(
        [...positionsRef.current].map(([k, pt]) => [k, { x: pt.x * sx, y: pt.y * sy }]),
      );
      prevBox.current = box;
    }
    const layoutNodes = net.nodes.map((n) => ({
      no: n.no,
      inTies: layoutDegree.get(n.no)?.posIn ?? 0,
      group: n.func.trim() || '—',
    }));
    const layoutEdges = net.edges
      .filter((e) => e.n > 0)
      .map((e) => ({
        from: e.from,
        to: e.to,
        weight: Math.max(0, Math.min(1, (e.mean - 1) / 4)),
      }));
    let positions: Positions;
    if (view === 'layers') positions = layeredLayout(layoutNodes, layoutEdges, box);
    else if (view === 'circle') positions = circularLayout(layoutNodes, layoutEdges, box);
    else if (view === 'groups') positions = groupedLayout(layoutNodes, layoutEdges, positionsRef.current, box).positions;
    else positions = forceMapLayout(layoutNodes, layoutEdges, positionsRef.current, box);
    positionsRef.current = positions;
    return { positions, maxSize: Math.max(0, ...layoutNodes.map((n) => n.inTies)) };
  }, [box, layoutDegree, net, view]);

  const { nodes, edges } = useMemo((): { nodes: Node<PersonData>[]; edges: Edge<RatingData>[] } => {
    if (!net) return { nodes: [], edges: [] };
    const { positions, maxSize } = layout;

    // Focus is hover first, then click. Its neighbourhood stays lit; everyone
    // else drops far back. With nothing focused the graph is a calm overview.
    const focus = hoveredNo ?? selectedNo;
    const ego = focus !== null ? neighboursOf.get(focus) ?? new Set<number>() : null;
    const shown = net.nodes.filter((n) => visibleNos.has(n.no));

    const rfNodes: Node<PersonData>[] = shown.map((n) => {
      const ties = sizeVal.get(n.no) ?? 0;
      const role: Role = n.responded ? roleMap.get(n.no) ?? 'member' : 'member';
      const r = nodeRadius(ties, maxSize);
      const p = positions.get(n.no) ?? { x: 0, y: 0 };
      const dimmed =
        (focus !== null && focus !== n.no && !(ego?.has(n.no) ?? false)) ||
        (matches !== null && !matches.has(n.no));
      const funcColor = groupColor.get(n.func.trim()) ?? GROUP_OTHER;
      const color =
        colorBy === 'role'
          ? role === 'member'
            ? funcColor
            : ROLE_STYLE[role].fill === 'transparent'
              ? funcColor
              : ROLE_STYLE[role].fill
          : funcColor;
      return {
        id: String(n.no),
        type: 'person',
        position: { x: p.x - r, y: p.y - r },
        data: {
          label: n.name,
          func: n.func,
          color,
          role,
          r,
          responded: n.responded ?? false,
          dimmed,
          selected: selectedNo === n.no,
          showLabel:
            (showLabels && focus === null) ||
            focus === n.no ||
            (ego?.has(n.no) ?? false) ||
            selectedNo === n.no ||
            (matches?.has(n.no) ?? false),
        },
        draggable: true,
      };
    });

    const rfEdges: Edge<RatingData>[] = drawEdges.map(({ e, polarity }) => {
      const key = `${e.from}>${e.to}`;
      const isMutual = mutualKeys.has(key);
      const dimmed = focus !== null && e.from !== focus && e.to !== focus;
      const style = POLARITY_STYLE[polarity];
      return {
        id: key,
        source: String(e.from),
        target: String(e.to),
        type: 'rating',
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 11, height: 11 },
        data: {
          mean: meanOf(e),
          color: style.color,
          polarity,
          dashed: style.dashed,
          dimmed,
          focused: focus !== null && !dimmed,
          mutual: isMutual,
          bend: isMutual ? (e.from < e.to ? 0.28 : -0.28) : 0.12,
          pending: false,
        },
      };
    });

    for (const pair of pendingPairs) {
      if (!visibleNos.has(pair.from) || !visibleNos.has(pair.to)) continue;
      const dimmed = focus !== null && pair.from !== focus && pair.to !== focus;
      rfEdges.push({
        id: `p${pair.from}>${pair.to}`,
        source: String(pair.from),
        target: String(pair.to),
        type: 'rating',
        data: {
          mean: 0,
          color: '#B5BDC7',
          polarity: 'neutral',
          dashed: true,
          dimmed,
          focused: false,
          mutual: false,
          bend: 0.05,
          pending: true,
        },
      });
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [
    colorBy,
    drawEdges,
    groupColor,
    hoveredNo,
    layout,
    matches,
    meanOf,
    mutualKeys,
    neighboursOf,
    net,
    pendingPairs,
    roleMap,
    selectedNo,
    showLabels,
    sizeVal,
    visibleNos,
  ]);

  const selectedMember: SocioMemberResult | null = useMemo(() => {
    if (!net?.group || selectedNo === null) return null;
    return net.group.members.find((m) => m.memberNo === selectedNo) ?? null;
  }, [net, selectedNo]);

  const selectedNode = selectedNo === null ? null : net?.nodes.find((n) => n.no === selectedNo) ?? null;

  // Re-frame whenever the shown node set, the layout or the round changes —
  // this is what makes the graph appear at all once data arrives, and keeps it
  // framed after a relayout. A short raf lets the new positions commit first.
  const hasNodes = nodes.length > 0;
  useEffect(() => {
    if (!hasNodes) return;
    const id = requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.05, duration: 300 }));
    return () => cancelAnimationFrame(id);
    // Deliberately NOT keyed on the filtered node count: hiding people must
    // not move the camera. hasNodes only flips once, when data first lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNodes, view, round, net?.cohortId, box]);

  if (error) {
    return (
      <section className="card">
        <div className="card-body">
          <h2>Network</h2>
          <div className="banner is-shown">{error}</div>
        </div>
      </section>
    );
  }
  if (!net) {
    return (
      <section className="card">
        <div className="card-body">
          <h2>Network</h2>
          <p className="hint">Loading the live map…</p>
        </div>
      </section>
    );
  }

  const g = net.group;
  const lensNet = g?.networks.find((n) => n.blockKey === (lens === 'overall' ? 'trust' : lens));
  const filterCount =
    hiddenFuncs.size +
    roleFilter.size +
    (minInDegree > 0 ? 1 : 0) +
    (hideIsolates ? 1 : 0) +
    (respondedOnly ? 1 : 0) +
    (reciprocalOnly ? 1 : 0) +
    (showPending ? 1 : 0) +
    (3 - polarities.size);

  const focusNode = (no: number) => {
    setSelectedNo(no);
    const p = positionsRef.current.get(no);
    if (p) rfRef.current?.fitView({ padding: 0.6, duration: 400, nodes: [{ id: String(no) }] } as never);
  };

  const soloDept =
    allFuncs.length > 1 && hiddenFuncs.size === allFuncs.length - 1
      ? allFuncs.find((f) => !hiddenFuncs.has(f)) ?? ''
      : '';

  const roleCounts = { star: 0, rejected: 0, isolate: 0 };
  for (const r of roleMap.values()) {
    if (r === 'star') roleCounts.star += 1;
    else if (r === 'rejected') roleCounts.rejected += 1;
    else if (r === 'isolate') roleCounts.isolate += 1;
  }

  return (
    <>
    <section className={`net-explorer${fullBleed ? ' is-bleed' : ''}${isFull ? ' is-full' : ''}`}>
      {/* Floating command bar — the primary controls always in reach. */}
      <div className="nx-topbar">
        <div className="nx-title">
          <span className="nx-title-main">Network</span>
          <span className="nx-title-sub">
            {net.respondents}/{net.rosterSize} in · {net.roundName}
            {net.roundClosed ? '' : ' · live'}
          </span>
        </div>

        <div className="nx-seg" role="tablist" aria-label="Diagram">
          <button
            role="tab"
            aria-selected={view !== 'layers'}
            className={`nx-seg-btn${view !== 'layers' ? ' is-on' : ''}`}
            onClick={() => setView('map')}
          >
            Graph
          </button>
          <button
            role="tab"
            aria-selected={view === 'layers'}
            className={`nx-seg-btn${view === 'layers' ? ' is-on' : ''}`}
            onClick={() => setView('layers')}
          >
            Flow chart
          </button>
        </div>

        {view !== 'layers' ? (
          <div className="nx-seg" role="tablist" aria-label="Layout">
            {(
              [
                ['map', 'Force'],
                ['circle', 'Circle'],
                ['groups', 'Groups'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={view === k}
                className={`nx-seg-btn${view === k ? ' is-on' : ''}`}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="nx-search-wrap">
          <div className="nx-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              placeholder="Find a person…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchResults.length > 0) {
                  focusNode(searchResults[0]!.no);
                  setQuery('');
                }
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {query ? (
              <button className="nx-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ×
              </button>
            ) : null}
          </div>
          {query && searchResults.length > 0 ? (
            <ul className="nx-search-menu" role="listbox">
              {searchResults.slice(0, 8).map((r) => (
                <li key={r.no}>
                  <button
                    className="nx-search-item"
                    onClick={() => {
                      focusNode(r.no);
                      setQuery('');
                    }}
                  >
                    <span className="nx-search-swatch" style={{ background: groupColor.get(r.func.trim() || '—') ?? GROUP_OTHER }} />
                    <span className="nx-search-name">{r.name}</span>
                    <span className="nx-search-func">{r.func || '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query ? (
            <ul className="nx-search-menu" role="listbox">
              <li className="nx-search-empty">No one matches “{query.trim()}”.</li>
            </ul>
          ) : null}
        </div>

        <div className="nx-topbar-right">
          {roundCount > 1 ? (
            <select
              className="nx-select"
              value={round ?? net.roundNo}
              onChange={(e) => setRound(Number(e.target.value))}
              aria-label="Round"
            >
              {Array.from({ length: roundCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Round {n}
                </option>
              ))}
            </select>
          ) : null}

          <button
            className={`nx-filter-btn${filtersOpen ? ' is-on' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filters
            {filterCount > 0 ? <span className="nx-filter-badge">{filterCount}</span> : null}
          </button>
        </div>
      </div>

      {/* The stage: canvas + collapsible rail. The filter drawer floats over the canvas. */}
      <div className={`nx-stage${railOpen ? '' : ' rail-closed'}`}>
        <div className="nx-canvas" ref={setCanvasEl}>
          {filtersOpen ? (
            <FilterDrawer
              lens={lens}
              setLens={setLens}
              cut={cut}
              setThreshold={setThreshold}
              polarities={polarities}
              setPolarities={setPolarities}
              allFuncs={allFuncs}
              groupColor={groupColor}
              hiddenFuncs={hiddenFuncs}
              setHiddenFuncs={setHiddenFuncs}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              minInDegree={minInDegree}
              setMinInDegree={setMinInDegree}
              hideIsolates={hideIsolates}
              setHideIsolates={setHideIsolates}
              respondedOnly={respondedOnly}
              setRespondedOnly={setRespondedOnly}
              reciprocalOnly={reciprocalOnly}
              setReciprocalOnly={setReciprocalOnly}
              showLabels={showLabels}
              setShowLabels={setShowLabels}
              sizeBy={sizeBy}
              setSizeBy={setSizeBy}
              colorBy={colorBy}
              setColorBy={setColorBy}
              egoDir={egoDir}
              setEgoDir={setEgoDir}
              soloDept={soloDept}
              onSolo={(f) =>
                setHiddenFuncs(f ? new Set(allFuncs.filter((x) => x !== f)) : new Set())
              }
              hasSelection={selectedNo !== null}
              hasAssignments={net.assignments.length > 0}
              showPending={showPending}
              setShowPending={setShowPending}
              onClose={() => setFiltersOpen(false)}
              onReset={() => {
                setHiddenFuncs(new Set());
                setRoleFilter(new Set());
                setMinInDegree(0);
                setHideIsolates(false);
                setRespondedOnly(false);
                setReciprocalOnly(false);
                setPolarities(new Set(['positive', 'negative']));
                setShowPending(false);
              }}
            />
          ) : null}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onInit={(inst) => {
              rfRef.current = inst;
              inst.fitView({ padding: 0.05 });
            }}
            onNodeClick={(_, node) => setSelectedNo((cur) => (cur === Number(node.id) ? null : Number(node.id)))}
            onNodeMouseEnter={(e, node) => {
              hoverEnter(Number(node.id));
              const r = canvasEl?.getBoundingClientRect();
              if (r) setTipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
            }}
            onNodeMouseMove={(e) => {
              const r = canvasEl?.getBoundingClientRect();
              if (r) setTipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
            }}
            onNodeMouseLeave={() => {
              hoverLeave();
              setTipPos(null);
            }}
            onPaneClick={() => setSelectedNo(null)}
            fitView
            minZoom={0.15}
            maxZoom={2.6}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            edgesFocusable={false}
            onNodeDragStop={(_, node) => {
              const d = node.data as PersonData;
              positionsRef.current.set(Number(node.id), {
                x: node.position.x + d.r,
                y: node.position.y + d.r,
              });
            }}
          >
            <Background gap={26} size={1.4} color="var(--nx-dot)" />
            <Controls showInteractive={false} position="top-left" showFitView={false}>
              <ControlButton
                onClick={() => rfRef.current?.fitView({ padding: 0.16, duration: 400 })}
                title="Re-center — fit the whole graph"
                aria-label="Re-center the graph"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              </ControlButton>
            </Controls>
          </ReactFlow>

          {/* The whole window back to its resting state: every filter, the
              selection, the search, the view and the camera. One button, no
              archaeology through the drawer to find what you toggled. */}
          <div className="nx-corner">
          <button
            className="nx-reset"
            onClick={() => {
              setSelectedNo(null);
              setHoveredNo(null);
              setQuery('');
              setView('map');
              setLens('overall');
              setThreshold(net.tieThreshold);
              setPolarities(new Set(['positive', 'negative', 'neutral']));
              setHiddenFuncs(new Set());
              setRoleFilter(new Set());
              setMinInDegree(0);
              setHideIsolates(false);
              setRespondedOnly(false);
              setReciprocalOnly(false);
              setShowPending(false);
              setShowLabels(true);
              setSizeBy('in');
              setColorBy('function');
              setEgoDir('both');
              setFiltersOpen(false);
              rfRef.current?.fitView({ padding: 0.05, duration: 400 });
            }}
            title="Reset every filter, the selection and the camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            Reset
          </button>
          <button
            className="nx-iconbtn"
            title="Export this view as a PNG"
            aria-label="Export as image"
            onClick={() => {
              if (!canvasEl) return;
              void toPng(canvasEl, {
                pixelRatio: 2,
                backgroundColor: '#FAFBFD',
                filter: (el) => {
                  const c = (el as HTMLElement).classList;
                  return !(
                    c?.contains('nx-corner') ||
                    c?.contains('react-flow__controls') ||
                    c?.contains('nx-drawer') ||
                    c?.contains('nx-tip') ||
                    c?.contains('react-flow__attribution')
                  );
                },
              }).then((url) => {
                const a = document.createElement('a');
                a.href = url;
                a.download = `network-round${net.roundNo}.png`;
                a.click();
              });
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5" />
              <path d="M4 21h16" />
            </svg>
          </button>
          <button
            className="nx-iconbtn"
            onClick={() => setIsFull((v) => !v)}
            title={isFull ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-pressed={isFull}
            aria-label={isFull ? 'Exit full screen' : 'Full screen'}
          >
            {isFull ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            )}
          </button>
          </div>

          {net.respondents === 0 ? (
            <div className="nx-empty">
              <div className="nx-empty-card">
                <b>No responses yet</b>
                <span>The map draws itself as the group answers.</span>
              </div>
            </div>
          ) : null}

          {hoveredNo !== null && tipPos
            ? (() => {
                const n = net.nodes.find((x) => x.no === hoveredNo);
                if (!n) return null;
                const d = degreeMap.get(n.no);
                const role = n.responded ? roleMap.get(n.no) ?? 'member' : 'member';
                const flipX = tipPos.x > box.w - 240;
                const flipY = tipPos.y > box.h - 150;
                return (
                  <div
                    className="nx-tip"
                    style={{
                      left: flipX ? tipPos.x - 232 : tipPos.x + 16,
                      top: flipY ? tipPos.y - 130 : tipPos.y + 14,
                    }}
                  >
                    <div className="nx-tip-head">
                      <span className="nx-tip-dot" style={{ background: groupColor.get(n.func.trim() || '—') ?? GROUP_OTHER }} />
                      <b>{n.name}</b>
                      {role !== 'member' ? (
                        <span className={`emp-role is-${role}`}>{ROLE_STYLE[role].label.split(' (')[0]}</span>
                      ) : null}
                    </div>
                    <div className="nx-tip-sub">
                      {n.func || 'No department'}
                      {n.responded ? '' : ' · not yet responded'}
                    </div>
                    <div className="nx-tip-stats">
                      <span>
                        <b style={{ color: POLARITY_STYLE.positive.color }}>{d?.posIn ?? 0}</b> positive in
                      </span>
                      <span>
                        <b style={{ color: (d?.negIn ?? 0) > 0 ? POLARITY_STYLE.negative.color : undefined }}>{d?.negIn ?? 0}</b> negative in
                      </span>
                      <span>
                        <b>{(d?.posOut ?? 0) + (d?.negOut ?? 0)}</b> given
                      </span>
                    </div>
                    <div className="nx-tip-foot">Click for full profile</div>
                  </div>
                );
              })()
            : null}

          <InteractiveLegend
            allFuncs={allFuncs}
            groupColor={groupColor}
            hiddenFuncs={hiddenFuncs}
            onToggleFunc={(f) =>
              setHiddenFuncs((prev) => {
                const n = new Set(prev);
                if (n.has(f)) n.delete(f);
                else n.add(f);
                return n;
              })
            }
            roleFilter={roleFilter}
            onToggleRole={(r) =>
              setRoleFilter((prev) => {
                const n = new Set(prev);
                if (n.has(r)) n.delete(r);
                else n.add(r);
                return n;
              })
            }
            polarities={polarities}
            onTogglePolarity={(p) =>
              setPolarities((prev) => {
                const n = new Set(prev);
                if (n.has(p)) n.delete(p);
                else n.add(p);
                return n.size === 0 ? prev : n;
              })
            }
          />
        </div>

        {/* Collapsible right rail */}
        <aside className={`nx-rail${railOpen ? '' : ' is-collapsed'}`}>
          <button
            className="nx-rail-toggle"
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? 'Collapse panel' : 'Expand panel'}
            title={railOpen ? 'Collapse' : 'Expand'}
          >
            {railOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16" />
              </svg>
            )}
          </button>
          {railOpen ? (
            <div className="nx-rail-body">
              {selectedNode ? (
                <EgoPanel
                  cohortId={cohortId}
                  roundNo={net.roundNo}
                  roundCount={roundCount}
                  node={selectedNode}
                  member={selectedMember}
                  minRaters={net.minRaters}
                  degree={degreeMap.get(selectedNode.no) ?? null}
                  role={roleMap.get(selectedNode.no) ?? 'member'}
                  onClose={() => setSelectedNo(null)}
                />
              ) : (
                <MetricsPanel
                  net={net}
                  lens={lens}
                  lensNet={lensNet ?? null}
                  roleCounts={roleCounts}
                  groupColor={groupColor}
                  onRole={(r) =>
                    setRoleFilter((prev) => {
                      const n = new Set(prev);
                      if (n.has(r)) n.delete(r);
                      else n.add(r);
                      return n;
                    })
                  }
                  onPick={focusNode}
                />
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </section>

    <EmployeesTable
      net={net}
      cohortId={cohortId}
      roundCount={roundCount}
      degreeMap={degreeMap}
      roleMap={roleMap}
      groupColor={groupColor}
      minRaters={net.minRaters}
      selectedNo={selectedNo}
      onFocus={focusNode}
    />
    </>
  );
}

/** A pill toggle used across the legend and drawer. */
function Chip({
  on,
  onClick,
  children,
  swatch,
  line,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  swatch?: string;
  line?: { color: string; dashed: boolean };
}) {
  return (
    <button className={`nx-chip${on ? ' is-on' : ' is-off'}`} aria-pressed={on} onClick={onClick}>
      {swatch ? <span className="nx-chip-dot" style={{ background: swatch }} aria-hidden="true" /> : null}
      {line ? (
        <span
          className="net-tieline"
          style={{ borderTopColor: line.color, borderTopStyle: line.dashed ? 'dashed' : 'solid' }}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
}

/** The floating legend, every item a live filter toggle. */
function InteractiveLegend({
  allFuncs,
  groupColor,
  hiddenFuncs,
  onToggleFunc,
  roleFilter,
  onToggleRole,
  polarities,
  onTogglePolarity,
}: {
  allFuncs: string[];
  groupColor: Map<string, string>;
  hiddenFuncs: Set<string>;
  onToggleFunc: (f: string) => void;
  roleFilter: Set<Role>;
  onToggleRole: (r: Role) => void;
  polarities: Set<Polarity>;
  onTogglePolarity: (p: Polarity) => void;
}) {
  return (
    <div className="nx-legend" aria-label="Legend and filters">
      <div className="nx-legend-row">
        <span className="nx-legend-head">Groups</span>
        {allFuncs.slice(0, 8).map((f) => (
          <Chip key={f} on={!hiddenFuncs.has(f)} onClick={() => onToggleFunc(f)} swatch={groupColor.get(f) ?? GROUP_OTHER}>
            {f}
          </Chip>
        ))}
      </div>
      <div className="nx-legend-row">
        <span className="nx-legend-head">Roles</span>
        {(['star', 'rejected', 'isolate'] as Role[]).map((r) => (
          <Chip key={r} on={roleFilter.size === 0 || roleFilter.has(r)} onClick={() => onToggleRole(r)} swatch={ROLE_STYLE[r].fill === 'transparent' ? undefined : ROLE_STYLE[r].fill}>
            {r === 'star' ? 'Star' : r === 'rejected' ? 'Rejected' : 'Isolate'}
          </Chip>
        ))}
      </div>
      <div className="nx-legend-row">
        <span className="nx-legend-head">Ties</span>
        {ALL_POLARITIES.map((p) => (
          <Chip key={p} on={polarities.has(p)} onClick={() => onTogglePolarity(p)} line={{ color: POLARITY_STYLE[p].color, dashed: POLARITY_STYLE[p].dashed }}>
            {POLARITY_STYLE[p].label.replace(' tie', '')}
          </Chip>
        ))}
      </div>
    </div>
  );
}


/** The slide-in panel holding every filter and encoding control. */
function FilterDrawer(props: {
  lens: string;
  setLens: (s: string) => void;
  cut: number;
  setThreshold: (n: number) => void;
  polarities: Set<Polarity>;
  setPolarities: React.Dispatch<React.SetStateAction<Set<Polarity>>>;
  allFuncs: string[];
  groupColor: Map<string, string>;
  hiddenFuncs: Set<string>;
  setHiddenFuncs: React.Dispatch<React.SetStateAction<Set<string>>>;
  roleFilter: Set<Role>;
  setRoleFilter: React.Dispatch<React.SetStateAction<Set<Role>>>;
  minInDegree: number;
  setMinInDegree: (n: number) => void;
  hideIsolates: boolean;
  setHideIsolates: (b: boolean) => void;
  respondedOnly: boolean;
  setRespondedOnly: (b: boolean) => void;
  reciprocalOnly: boolean;
  setReciprocalOnly: (b: boolean) => void;
  showLabels: boolean;
  setShowLabels: (b: boolean) => void;
  sizeBy: 'in' | 'out';
  setSizeBy: (s: 'in' | 'out') => void;
  colorBy: 'function' | 'role';
  setColorBy: (s: 'function' | 'role') => void;
  egoDir: 'both' | 'in' | 'out';
  setEgoDir: (s: 'both' | 'in' | 'out') => void;
  soloDept: string;
  onSolo: (f: string) => void;
  hasSelection: boolean;
  hasAssignments: boolean;
  showPending: boolean;
  setShowPending: (b: boolean) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const p = props;
  const toggleSet = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, v: T) =>
    set((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });

  return (
    <div className="nx-drawer" role="dialog" aria-label="Filters">
      <div className="nx-drawer-head">
        <b>Filters</b>
        <div className="nx-drawer-head-actions">
          <button className="nx-link" onClick={p.onReset}>
            Reset
          </button>
          <button className="nx-drawer-close" onClick={p.onClose} aria-label="Close filters">
            ×
          </button>
        </div>
      </div>

      <div className="nx-drawer-body">
        <div className="nx-fgroup">
          <span className="nx-flabel">Lens</span>
          <div className="nx-fchips">
            {LENSES.map((l) => (
              <Chip key={l.key} on={p.lens === l.key} onClick={() => p.setLens(l.key)} swatch={l.color}>
                {l.name}
              </Chip>
            ))}
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">
            Tie strength <b>{p.cut.toFixed(1)}</b>
          </span>
          <input
            className="nx-range"
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={p.cut}
            onChange={(e) => p.setThreshold(Number(e.target.value))}
          />
          <p className="nx-fhelp">
            Ratings are 1–5. At or above this bar a rating counts as a <b>positive tie</b>; 2 or
            below reads <b>negative</b>; in between is <b>neutral</b>. Sizes, roles and densities
            all follow the same bar.
          </p>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Tie types</span>
          <div className="nx-fchips">
            {ALL_POLARITIES.map((pol) => (
              <Chip
                key={pol}
                on={p.polarities.has(pol)}
                onClick={() =>
                  p.setPolarities((prev) => {
                    const n = new Set(prev);
                    if (n.has(pol)) n.delete(pol);
                    else n.add(pol);
                    return n.size === 0 ? prev : n;
                  })
                }
                line={{ color: POLARITY_STYLE[pol].color, dashed: POLARITY_STYLE[pol].dashed }}
              >
                {POLARITY_STYLE[pol].label.replace(' tie', '')}
              </Chip>
            ))}
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Focus one department</span>
          <select className="nx-select" value={p.soloDept} onChange={(e) => p.onSolo(e.target.value)}>
            <option value="">All departments</option>
            {p.allFuncs.map((f) => (
              <option key={f} value={f}>
                {f} only
              </option>
            ))}
          </select>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Groups</span>
          <div className="nx-fchips">
            {p.allFuncs.map((f) => (
              <Chip
                key={f}
                on={!p.hiddenFuncs.has(f)}
                onClick={() => toggleSet(p.setHiddenFuncs, f)}
                swatch={p.groupColor.get(f) ?? GROUP_OTHER}
              >
                {f}
              </Chip>
            ))}
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Roles</span>
          <div className="nx-fchips">
            {(['star', 'rejected', 'isolate', 'member'] as Role[]).map((r) => (
              <Chip
                key={r}
                on={p.roleFilter.size === 0 || p.roleFilter.has(r)}
                onClick={() => toggleSet(p.setRoleFilter, r)}
                swatch={ROLE_STYLE[r].fill === 'transparent' ? undefined : ROLE_STYLE[r].fill}
              >
                {ROLE_STYLE[r].label.split(' (')[0]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">
            Minimum ties received <b>{p.minInDegree}</b>
          </span>
          <input
            className="nx-range"
            type="range"
            min={0}
            max={12}
            step={1}
            value={p.minInDegree}
            onChange={(e) => p.setMinInDegree(Number(e.target.value))}
          />
        </div>

        {p.hasSelection ? (
          <div className="nx-fgroup">
            <span className="nx-flabel">Selected person shows</span>
            <div className="nx-fchips">
              {(
                [
                  ['both', 'Both'],
                  ['in', 'Incoming'],
                  ['out', 'Outgoing'],
                ] as const
              ).map(([k, label]) => (
                <Chip key={k} on={p.egoDir === k} onClick={() => p.setEgoDir(k)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        <div className="nx-fgroup">
          <span className="nx-flabel">Size nodes by</span>
          <div className="nx-fchips">
            <Chip on={p.sizeBy === 'in'} onClick={() => p.setSizeBy('in')}>
              Ties received
            </Chip>
            <Chip on={p.sizeBy === 'out'} onClick={() => p.setSizeBy('out')}>
              Ties given
            </Chip>
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Colour nodes by</span>
          <div className="nx-fchips">
            <Chip on={p.colorBy === 'function'} onClick={() => p.setColorBy('function')}>
              Group
            </Chip>
            <Chip on={p.colorBy === 'role'} onClick={() => p.setColorBy('role')}>
              Role
            </Chip>
          </div>
        </div>

        <div className="nx-fgroup">
          <span className="nx-flabel">Options</span>
          <div className="nx-ftoggles">
            <label className="nx-toggle">
              <input type="checkbox" checked={p.showLabels} onChange={(e) => p.setShowLabels(e.target.checked)} />
              Always show names
            </label>
            <label className="nx-toggle">
              <input type="checkbox" checked={p.hideIsolates} onChange={(e) => p.setHideIsolates(e.target.checked)} />
              Hide isolates
            </label>
            <label className="nx-toggle">
              <input type="checkbox" checked={p.respondedOnly} onChange={(e) => p.setRespondedOnly(e.target.checked)} />
              Responded only
            </label>
            <label className="nx-toggle">
              <input type="checkbox" checked={p.reciprocalOnly} onChange={(e) => p.setReciprocalOnly(e.target.checked)} />
              Mutual ties only
            </label>
            {p.hasAssignments ? (
              <label className="nx-toggle">
                <input type="checkbox" checked={p.showPending} onChange={(e) => p.setShowPending(e.target.checked)} />
                Show unanswered assignments
              </label>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ node/edge

function PersonNode({ data }: NodeProps<Node<PersonData>>) {
  const d = data;
  // Colour is the function; the role decides ring, glow and badge. A star wears
  // an orange glow and a ★ badge, a rejected member a red ring, an isolate a
  // hollow dashed ring — the vocabulary of a Gephi/Kumu sociogram, dressed up.
  const roleClass =
    d.role === 'star'
      ? ' is-star'
      : d.role === 'rejected'
        ? ' is-rejected'
        : d.role === 'isolate'
          ? ' is-isolate'
          : '';
  const fill = d.color;
  return (
    <div
      className={`nxn${d.dimmed ? ' is-dim' : ''}${d.selected ? ' is-picked' : ''}${roleClass}`}
      style={
        {
          width: d.r * 2,
          height: d.r * 2,
          '--nxn-fill': fill,
          opacity: d.responded ? 1 : 0.5,
        } as React.CSSProperties
      }
      title={`${d.label}${d.func ? ` · ${d.func}` : ''}${d.role !== 'member' ? ` · ${ROLE_STYLE[d.role].label}` : ''}`}
    >
      <Handle type="target" position={Position.Top} className="net-handle" />
      <Handle type="source" position={Position.Bottom} className="net-handle" />
      <span className="nxn-body" aria-hidden="true" />
      {d.role === 'star' ? <span className="nxn-badge">★</span> : null}
      {/* Always in the DOM; shown on hover, and pinned open when labels are on,
          the node is selected, or it matched a search. Keeps 60 names from
          stacking into a wall while one is always a hover away. */}
      <span className={`nxn-name${d.showLabel ? ' is-pinned' : ''}`}>{d.label}</span>
    </div>
  );
}

function RatingEdge({ id, source, target, data, markerEnd }: EdgeProps<Edge<RatingData>>) {
  const d = data!;
  // Floating edges: the wire runs centre to centre and is trimmed at each
  // circle's rim, so every arrow leaves the edge of one person and lands on
  // the edge of the next — never stabbing from a node's top or floating in
  // space, which is what handle-anchored edges did to a round node.
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  if (!sn || !tn) return null;

  const sw = sn.measured.width ?? 30;
  const tw = tn.measured.width ?? 30;
  const sx = sn.internals.positionAbsolute.x + sw / 2;
  const sy = sn.internals.positionAbsolute.y + (sn.measured.height ?? 30) / 2;
  const tx = tn.internals.positionAbsolute.x + tw / 2;
  const ty = tn.internals.positionAbsolute.y + (tn.measured.height ?? 30) / 2;

  const ddx = tx - sx;
  const ddy = ty - sy;
  const dist = Math.hypot(ddx, ddy) || 1;
  const ux = ddx / dist;
  const uy = ddy / dist;
  // Perpendicular shift separates a mutual pair into two parallel arcs from
  // the rim itself, not just at the midpoint.
  const px = -uy;
  const py = ux;
  const off = d.mutual ? (d.bend > 0 ? 5 : -5) : 0;

  const startX = sx + ux * (sw / 2) + px * off;
  const startY = sy + uy * (sw / 2) + py * off;
  const endX = tx - ux * (tw / 2 + 5) + px * off;
  const endY = ty - uy * (tw / 2 + 5) + py * off;

  const bend = d.mutual ? d.bend : d.bend * 0.35;
  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;
  const cx = mx - (endY - startY) * bend;
  const cy = my + (endX - startX) * bend;
  const path = `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`;

  const strength =
    d.polarity === 'positive' ? Math.max(0, (d.mean - 1) / 4) : d.polarity === 'negative' ? 0.55 : 0.35;
  const width = d.pending ? 1 : (d.focused ? 1.6 : 1) + strength * 1.9;
  const opacity = d.dimmed
    ? 0.04
    : d.focused
      ? 0.9
      : d.pending
        ? 0.4
        : d.polarity === 'neutral'
          ? 0.16
          : d.polarity === 'negative'
            ? 0.32
            : 0.24;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: d.color,
        strokeWidth: width,
        opacity,
        strokeDasharray: d.pending ? '3 5' : d.dashed ? '5 5' : undefined,
        strokeLinecap: 'round',
      }}
    />
  );
}

const NODE_TYPES = { person: PersonNode };
const EDGE_TYPES = { rating: RatingEdge };

// ---------------------------------------------------------------- side panels

/** A completion ring: how much of the group has spoken. */
function ResponseRing({ pct }: { pct: number }) {
  const R = 26;
  const CIRC = 2 * Math.PI * R;
  const on = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg className="rail-ring" viewBox="0 0 68 68" role="img" aria-label={`${pct}% responded`}>
      <circle cx="34" cy="34" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
      <circle
        cx="34"
        cy="34"
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${on * CIRC} ${CIRC}`}
        transform="rotate(-90 34 34)"
      />
      <text x="34" y="39" textAnchor="middle" className="rail-ring-text">
        {pct}%
      </text>
    </svg>
  );
}

/** One metric with its value made visible: a number and its fill on 0..1. */
function MeterTile({
  label,
  value,
  fill,
  help,
}: {
  label: string;
  value: string;
  /** 0..1 for the little meter; null hides it. */
  fill: number | null;
  help: string;
}) {
  return (
    <div className="rail-tile" title={help}>
      <span className="rail-tile-label">{label}</span>
      <span className="rail-tile-value">{value}</span>
      {fill !== null ? (
        <span className="rail-tile-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

function MetricsPanel({
  net,
  lens,
  lensNet,
  roleCounts,
  groupColor,
  onRole,
  onPick,
}: {
  net: CohortNetwork;
  lens: string;
  lensNet: SocioBlockNetwork | null;
  roleCounts: { star: number; rejected: number; isolate: number };
  groupColor: Map<string, string>;
  onRole: (r: Role) => void;
  onPick: (no: number) => void;
}) {
  const [sig, setSig] = useState(0);
  const g = net.group;
  if (!g) {
    return (
      <div className="net-metrics">
        <div className="rail-head">
          <h3>Group pulse</h3>
        </div>
        <p className="hint">Metrics appear with the first response.</p>
      </div>
    );
  }
  const activeNet = lens === 'overall' ? null : g.networks.find((n) => n.blockKey === lens) ?? null;
  const shown = activeNet ?? lensNet;
  const pct = Math.round(g.responseRate * 100);

  // Department mix, in the same colours the nodes wear.
  const deptCounts = new Map<string, number>();
  for (const n of net.nodes) {
    const f = n.func.trim() || '—';
    deptCounts.set(f, (deptCounts.get(f) ?? 0) + 1);
  }
  const depts = [...deptCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="net-metrics">
      <div className="rail-head">
        <h3>Group pulse</h3>
        {!net.roundClosed ? (
          <span className="rail-live">
            <span className="rail-live-dot" aria-hidden="true" />
            live
          </span>
        ) : (
          <span className="rail-live is-closed">closed</span>
        )}
      </div>

      <div className="rail-hero">
        <ResponseRing pct={pct} />
        <div className="rail-hero-copy">
          <b>
            {net.respondents} of {net.rosterSize}
          </b>
          <span>have responded</span>
        </div>
      </div>

      <div className="rail-tiles">
        <MeterTile
          label="Acquaintance"
          value={g.acquaintance === null ? '—' : `${Math.round(g.acquaintance * 100)}%`}
          fill={g.acquaintance}
          help="How much of the group actually knows itself: the share of possible pairs that were rated at all."
        />
        <MeterTile
          label={activeNet ? 'Density' : 'Density (trust)'}
          value={shown?.density === null || shown?.density === undefined ? '—' : shown.density.toFixed(2)}
          fill={shown?.density ?? null}
          help="Of the pairs that were rated, the share that reached tie strength. Higher = a better-connected group."
        />
        <MeterTile
          label="Reciprocity"
          value={shown?.reciprocity === null || shown?.reciprocity === undefined ? '—' : shown.reciprocity.toFixed(2)}
          fill={shown?.reciprocity ?? null}
          help="Of pairs where both rated each other and at least one drew a tie, the share where BOTH did. Higher = bonds run both ways."
        />
        <MeterTile
          label="Concentration"
          value={shown?.concentration === null || shown?.concentration === undefined ? '—' : shown.concentration.toFixed(2)}
          fill={shown?.concentration ?? null}
          help="How unevenly received ties are spread: 0 = everyone equally chosen, 1 = one person holds every tie."
        />
        <MeterTile
          label="Cohort mean"
          value={g.cohortMean === null ? '—' : g.cohortMean.toFixed(2)}
          fill={g.cohortMean === null ? null : (g.cohortMean - 1) / 4}
          help="The average rating anyone gave anyone, on the 1–5 scale."
        />
      </div>

      <div className="rail-section">
        <h4>Departments</h4>
        <div className="rail-mix" role="img" aria-label="Department mix">
          {depts.map(([f, n]) => (
            <span
              key={f}
              style={{ flex: n, background: groupColor.get(f) ?? GROUP_OTHER }}
              title={`${f}: ${n}`}
            />
          ))}
        </div>
        <div className="rail-mix-key">
          {depts.slice(0, 6).map(([f, n]) => (
            <span key={f}>
              <i style={{ background: groupColor.get(f) ?? GROUP_OTHER }} /> {f} <b>{n}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="rail-section">
        <h4>
          Roles <span>click to filter the graph</span>
        </h4>
        <div className="net-chips">
          <button
            className="net-chip rail-role is-star"
            onClick={() => onRole('star')}
            title="The group's centres: the top ~12% by positive ties received."
          >
            ★ Stars <b>{roleCounts.star}</b>
          </button>
          <button
            className="net-chip rail-role is-rejected"
            onClick={() => onRole('rejected')}
            title="Net-cool: more colleagues rated them low (negative ties) than high (positive)."
          >
            Rejected <b>{roleCounts.rejected}</b>
          </button>
          <button
            className="net-chip rail-role is-isolate"
            onClick={() => onRole('isolate')}
            title="No ties in either direction — the group has no read on them at all."
          >
            Isolates <b>{roleCounts.isolate}</b>
          </button>
        </div>
      </div>

      <SignalsBlock
        signals={[
          {
            label: 'Isolates',
            hint: 'rated, but never at tie strength',
            items: g.isolates.map((i) => ({ no: i.memberNo, name: i.name })),
          },
          {
            label: 'Complied with',
            hint: 'authority ahead of trust — obeyed, not relied on',
            items: g.authorityWithoutTrust.map((i) => ({ no: i.memberNo, name: i.name })),
          },
          {
            label: 'Relied on',
            hint: 'trust ahead of authority — leaned on, without leverage',
            items: g.trustWithoutAuthority.map((i) => ({ no: i.memberNo, name: i.name })),
          },
          {
            label: 'Support gap',
            hint: 'the group wants more from them than it gets',
            items: g.supportGaps.map((i) => ({ no: i.memberNo, name: i.name })),
          },
        ]}
        active={sig}
        onTab={setSig}
        onPick={onPick}
      />
    </div>
  );
}

/**
 * The four findings folded into one fixed-height block: a mini tab per signal
 * with its count, one chip row that swaps — the rail stays scroll-free.
 */
function SignalsBlock({
  signals,
  active,
  onTab,
  onPick,
}: {
  signals: { label: string; hint: string; items: { no: number; name: string }[] }[];
  active: number;
  onTab: (i: number) => void;
  onPick: (no: number) => void;
}) {
  const live = signals.filter((x) => x.items.length > 0);
  if (live.length === 0) return null;
  const idx = Math.min(active, live.length - 1);
  const current = live[idx]!;
  return (
    <div className="rail-section">
      <h4>Signals</h4>
      <div className="rail-sig-tabs" role="tablist">
        {live.map((x, i) => (
          <button
            key={x.label}
            role="tab"
            aria-selected={i === idx}
            className={`rail-sig-tab${i === idx ? ' is-on' : ''}`}
            onClick={() => onTab(i)}
            title={x.hint}
          >
            {x.label} <b>{x.items.length}</b>
          </button>
        ))}
      </div>
      <p className="rail-sig-hint">{current.hint}</p>
      <div className="net-chips">
        {current.items.slice(0, 8).map((i) => (
          <button key={i.no} className="net-chip" onClick={() => onPick(i.no)}>
            {i.name}
          </button>
        ))}
        {current.items.length > 8 ? (
          <span className="net-chip rail-more" title={current.items.slice(8).map((i) => i.name).join(', ')}>
            +{current.items.length - 8}
          </span>
        ) : null}
      </div>
    </div>
  );
}


interface MemberTrendPoint {
  roundNo: number;
  roundName: string;
  positive: number;
  negative: number;
}

function EgoPanel({
  cohortId,
  roundNo,
  roundCount,
  node,
  member,
  minRaters,
  degree,
  role,
  onClose,
}: {
  cohortId: string;
  roundNo: number;
  roundCount: number;
  node: { no: number; name: string; func: string; responded?: boolean };
  member: SocioMemberResult | null;
  minRaters: number;
  degree: DegreeCounts | null;
  role: Role;
  onClose: () => void;
}) {
  const [trend, setTrend] = useState<MemberTrendPoint[] | null>(null);

  useEffect(() => {
    let stop = false;
    setTrend(null);
    void api
      .get<{ points: MemberTrendPoint[] }>(`/api/admin/cohorts/${cohortId}/member/${node.no}/trend`)
      .then((r) => {
        if (!stop) setTrend(r.points);
      })
      .catch(() => {
        if (!stop) setTrend([]);
      });
    return () => {
      stop = true;
    };
  }, [cohortId, node.no, roundNo]);

  return (
    <div className="net-metrics">
      <div className="net-ego-head">
        <h3>{node.name}</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Back
        </button>
      </div>
      <p className="hint">
        {node.func || 'No function recorded'} · {node.responded ? 'has responded' : 'not yet responded'}
        {role !== 'member' ? (
          <>
            {' · '}
            <b style={{ color: ROLE_STYLE[role].fill === 'transparent' ? 'var(--ink-2)' : ROLE_STYLE[role].fill }}>
              {ROLE_STYLE[role].label}
            </b>
          </>
        ) : null}
      </p>

      <dl className="net-kv">
        <div>
          <dt>Positive in</dt>
          <dd style={{ color: POLARITY_STYLE.positive.color }}>{degree?.posIn ?? 0}</dd>
        </div>
        <div>
          <dt>Negative in</dt>
          <dd style={{ color: POLARITY_STYLE.negative.color }}>{degree?.negIn ?? 0}</dd>
        </div>
        <div>
          <dt>Ties given</dt>
          <dd>{(degree?.posOut ?? 0) + (degree?.negOut ?? 0)}</dd>
        </div>
        {member ? (
          <div>
            <dt>Rated by</dt>
            <dd>
              {member.coverage}
              {member.coverage < minRaters ? ' · below floor' : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {member ? (
        <div className="net-list">
          <h4>
            Received profile <span>mean of what colleagues gave</span>
          </h4>
          {member.blocks.map((b) => (
            <BlockBar key={b.blockKey} label={b.short} mean={b.mean} />
          ))}
          {member.supportGap.mean !== null ? (
            <BlockBar label="Support gap" mean={member.supportGap.mean} deficit />
          ) : null}
        </div>
      ) : (
        <p className="hint">No received ratings yet — their profile builds as colleagues answer.</p>
      )}

      {roundCount > 1 ? (
        <div className="net-list">
          <h4>
            Over rounds <span>positive vs negative received</span>
          </h4>
          {trend === null ? (
            <p className="hint">Loading…</p>
          ) : trend.length < 2 ? (
            <p className="hint">A trend appears once this group has been rated more than once.</p>
          ) : (
            <TrendSpark points={trend} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A per-dimension received-mean as a small labelled bar, 1–5 scaled. */
function BlockBar({ label, mean, deficit }: { label: string; mean: number | null; deficit?: boolean }) {
  const pct = mean === null ? 0 : ((mean - 1) / 4) * 100;
  const color = deficit ? POLARITY_STYLE.negative.color : mean !== null && mean >= 4 ? POLARITY_STYLE.positive.color : '#2a78d6';
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

/**
 * Two lines, positive vs negative received, across the group's rounds — the
 * Sophia-Johnson trend read at the level of one person. Inline SVG so it ships
 * with no chart library and reads in both themes off ink/surface tokens.
 */
function TrendSpark({ points }: { points: MemberTrendPoint[] }) {
  const W = 236;
  const H = 96;
  const pad = { l: 4, r: 4, t: 8, b: 18 };
  const max = Math.max(2, ...points.flatMap((p) => [p.positive, p.negative]));
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = (key: 'positive' | 'negative') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  return (
    <svg className="net-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Positive and negative ties over rounds">
      <path d={line('negative')} fill="none" stroke={POLARITY_STYLE.negative.color} strokeWidth={2} />
      <path d={line('positive')} fill="none" stroke={POLARITY_STYLE.positive.color} strokeWidth={2} />
      {points.map((p, i) => (
        <g key={p.roundNo}>
          <circle cx={x(i)} cy={y(p.positive)} r={2.4} fill={POLARITY_STYLE.positive.color} />
          <circle cx={x(i)} cy={y(p.negative)} r={2.4} fill={POLARITY_STYLE.negative.color} />
          <text className="net-spark-x" x={x(i)} y={H - 4} textAnchor="middle">
            {p.roundNo}
          </text>
        </g>
      ))}
    </svg>
  );
}
