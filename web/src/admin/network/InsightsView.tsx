/**
 * Insights — the debrief workspace.
 *
 * The explorer answers "what does this group look like?"; this answers the nine
 * questions the client actually asked, in their order, in the words they asked
 * them in. It is the first thing a cohort's network opens on, because a
 * facilitator with twenty minutes before a debrief needs findings, not a canvas
 * to pan.
 *
 * It used to be nine cards on one long scroll. It is now nine TABS on one fixed
 * workspace, and the difference is the whole design:
 *
 *   CENTRE   the insight's graph, as large as the room allows. Live: hover for
 *            numbers, click to focus a person across every tab.
 *   RIGHT    that insight's readings — the sentence the data produced as the
 *            column's lead, then the charts, rankings and meters beneath it.
 *   BOTTOM   the same finding per person, as a dense table that scrolls inside
 *            itself. The row a facilitator looks up when somebody in the room
 *            says a name.
 *
 * Four rules hold it together:
 *
 *   1. Every number here is computed at the COHORT'S OWN tie threshold, under
 *      the two fixed lenses (trust, power_over). Nothing here reads the filter
 *      drawer, the lens chips or the threshold slider — so the workspace a
 *      facilitator screenshots is the one the client sees, and two people
 *      looking at the same cohort are looking at the same thing.
 *   2. Every derivation is one of the pure functions in model.ts, shared with
 *      the rail panels. A tab that disagreed with the rail would be a bug in
 *      one of them, and there is only one of them.
 *   3. ONE interaction runs the whole workspace: a focused person. Click
 *      anyone, anywhere — a dot, a bar, a row, a node — and every tab answers
 *      the same question about them. Focus survives a tab change, which is what
 *      makes the tab bar a walk through one person's standing rather than nine
 *      unrelated screens. Focus is emphasis, never a filter: nothing is hidden,
 *      because the reader is mid-sentence in front of a client and a view that
 *      empties out is a view that lost the thread.
 *   4. THE SEATS NEVER MOVE. The constellation is solved once, from the trust
 *      ties, and every map tab is handed those same positions. Tabs re-theme
 *      the picture — sizes, rings, which ties are drawn, which half is faded —
 *      and never re-run the simulation. A client watches one arrangement of
 *      their own people answer seven questions in a row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CohortNetwork } from '../../../../src/shared/types.js';
import {
  betweenness,
  communities,
  subgroupCohesion,
  unreciprocatedTies,
} from '../../../../src/shared/socio-network.js';
import { fitToBox, forceMapLayout, laneBoxes, nodeRadius, separate, type LayoutBox, type Positions } from './layout.js';
import {
  POWER_ACCENT,
  POWER_LENS,
  POWER_TIE,
  TRUST_ACCENT,
  TRUST_LENS,
  TRUST_TIE,
} from './ComparePane.js';
import { FacetBar } from './FacetBar.js';
import { DOCK_W, InsightGraph, type NodeDecor } from './InsightGraph.js';
import { DivergenceChart, QUADRANT_COLOR, QUADRANT_GLOSS, QUADRANT_NAME } from './DivergenceChart.js';
import { MatrixGrid } from './MatrixGrid.js';
import { toPng } from 'html-to-image';
import {
  BarRow,
  DetailTable,
  Finding,
  Avatar,
  FindingsRail,
  DeptCompare,
  PersonCard,
  PersonSearch,
  InsightToolbar,
  Key,
  MeterLine,
  Panel,
  LineKey,
  RingKey,
  HollowKey,
  type NameMode,
  type ExportOptions,
  ScopePicker,
  Suppressed,
  Workspace,
  type Column,
  type PersonCell,
  type PersonProps,
  type RailStat,
  type TabDef,
  type TabGroupDef,
} from './InsightsChrome.js';
import { useTooltip, type TipContent } from './Tooltip.js';
import {
  anchorTable,
  anchors as computeAnchors,
  blockConcentration,
  buildPaneEdges,
  comparePeople,
  DIVERGENCE_FLOOR,
  divergenceColor,
  divergenceShareFinding,
  divergenceShares,
  divergenceWordFor,
  clusterHulls,
  clusterView,
  concentrationReading,
  concentrationTable,
  POWER_KIND_LABEL,
  riskKindFix,
  riskKindOf,
  divergenceMedians,
  divergencePoints,
  divergenceTable,
  facetTable,
  fadeExcept,
  joinNames,
  lensDensity,
  lensPairs,
  MATRIX_CAP,
  MUTED_GREY,
  oneWayPaneEdges,
  orderSilos,
  orderTiesByFocus,
  paneInDegree,
  shortlistVerdict,
  peripheralMembers,
  placeCallouts,
  positiveTies,
  RANK_RING_COLOR,
  relOpenVerdict,
  SILOS_MODE_COLUMN,
  SILOS_MODE_LABEL,
  silosGroups,
  silosLabel,
  silosMemberTable,
  silosModes,
  silosVerdict,
  tieEndpoints,
  tieMatrix,
  topDecile,
  topPaneLabels,
  topBridges,
  watchLists,
  type AnchorRow,
  type ConcentrationTable,
  type FacetRow,
  type QuadrantRow,
  type ShareRow,
  type SilosMemberRow,
  type SilosMode,
  applyScope,
  EMPTY_SCOPE,
  scopeIsWhole,
  scopeOptions,
  scopedConcentration,
  type InsightScope,
} from './model.js';
import { covertPowerVerdict } from '../../../../src/shared/socio-insights.js';
import { influenceMix, signatures } from '../../../../src/shared/socio-scoring.js';
import type { PowerKind, SocioMemberResult } from '../../../../src/shared/socio-scoring.js';
import { SOCIO_BLOCKS, SOCIO_ITEMS } from '../../../../src/shared/socio.js';
import type { DivergenceShare, PaneEdge } from './model.js';
import {
  downloadInsightHtml,
  downloadInsightPdf,
  type DocColumn,
  type DocPanel,
  type DocPayload,
} from './exportDoc.js';
import { HeadToHead } from './HeadToHead.js';

/**
 * Stable per-tab tie opacities.
 *
 * These are passed to a memoised component: an arrow function written inline in
 * JSX is a new value on every render, so the memo never holds and a hover
 * re-renders the entire map. Hoisted, they are the same function for ever.
 */
const FADE = {
  anchors: () => 0.62,
  pair: () => 0.55,
  bridges: () => 0.08,
  facets: () => 0.72,
  divergence: () => 0.18,
} as const;

/** A stable empty list: a fresh [] each render would re-memo the map. */
const EMPTY_EDGES: PaneEdge[] = [];

/**
 * The virtual box every map tab solves and draws in. Node radii come from
 * `nodeRadius`, which returns 14–32 whatever the box is: solve sixty of those
 * in a 500-unit field and they overlap into a single blob. Solving large and
 * scaling the whole picture down to the pane is what gives the constellation
 * room to be read, and everything measured in units — names, tie widths, rings
 * — scales with it.
 */
const MAP_BOX: LayoutBox = { w: 1000, h: 520 };
/**
 * Room the bridges map gives its margin annotations, in the map's own units.
 * Every unit of margin is a unit the constellation does not get, so it is the
 * least that still fits a name and a score at a size somebody can read across
 * a room — and "fits" is measured, not hoped for: at 220 a perfectly ordinary
 * name ran out through the left edge of the viewBox and lost its first letter.
 * `placeCallouts` is given this same number and clamps against it, so the
 * margin is now the width the annotations are actually laid out in.
 */
const CALLOUT_MARGIN = 300;
/** The size those annotations are drawn at. Matches `.insights-callout-text`. */
const CALLOUT_FONT_SIZE = 26;
/** Longest name a callout prints before it starts eliding. */
const CALLOUT_NAME_MAX = 15;
/** How many one-way ties the sidebar list prints. The band's grid prints them all. */
const ONE_WAY_ROWS = 8;
/** How many bridges the ranked list draws. */
const BRIDGE_ROWS = 5;
/** How many names a map prints unprompted, on the tabs that rank by degree. */
const MAP_LABELS = 8;
/**
 * `subgroupCohesion`'s own floor: below this a group's rates are withheld
 * because two people's behaviour with a decimal point on it identifies both of
 * them. Named here so the table can SAY the number rather than print a dash.
 */
const SILOS_FLOOR = 3;
/** The colour a structural finding wears: bridges, rank divergence, hubs. */
const STRUCT_ACCENT = RANK_RING_COLOR;
/** The colour a flag wears — an isolate's ring, and nothing else. */
const FLAG_COLOR = '#B54708';

/** Nobody named. Frozen and shared so it never invalidates a memo. */
const NO_NAMES: ReadonlySet<number> = new Set();

const GROUPS: readonly TabGroupDef[] = [
  { no: 1, name: 'Individual' },
  { no: 2, name: 'Relationships' },
  { no: 3, name: 'Whole network' },
];

/**
 * The covert half of power-over, as the map and the panels address it.
 *
 * A lens, not a block: it reads statements the power-over block has already
 * counted, and exists so the guide's "hidden imbalance no structure chart
 * reveals" can be read apart from open decision rights.
 */
const COVERT_LENS = 'covert_power';
const COVERT_ACCENT = '#7A4DB8';

const TABS: readonly TabDef[] = [
  { id: 'anchors', name: 'Anchors', group: 1, question: 'Who the group leans on' },
  { id: 'divergence', name: 'Divergence', group: 1, question: 'Power and trust are not the same people' },
  { id: 'bridges', name: 'Bridges', group: 1, question: 'Who holds the network together' },
  { id: 'isolates', name: 'Isolates', group: 1, question: 'Low trust and low power received' },
  // Individual, because the unit is the person: everything else in this group
  // ranks the roster, this answers "these two, side by side".
  { id: 'pair', name: 'Head to head', group: 1, question: 'Two people, measure by measure' },
  { id: 'oneway', name: 'One-way trust', group: 2, question: 'Ties that run one way' },
  { id: 'silos', name: 'Silos', group: 2, question: 'Where trust pools instead of flowing' },
  { id: 'spread', name: 'Spread', group: 3, question: 'Is trust held by many hands or a few?' },
  // The stage heading below already IS the client's question, word for word,
  // so the subline says why the tab is worth opening rather than repeating it.
  { id: 'compare', name: 'Trust vs power', group: 3, question: 'The single most telling comparison' },
  { id: 'facets', name: 'Reliability', group: 3, question: 'Two facets of trust, two different interventions' },
];

/** The heading over each tab's graph — the client's own wording. */
const TAB_TITLE: Record<string, string> = {
  anchors: 'Most trusted, most powerful',
  divergence: 'Trust–power divergence',
  bridges: 'Structural bridges',
  isolates: 'Isolates and peripheral members',
  oneway: 'Unreturned trust',
  silos: 'Cliques and silos',
  spread: 'Spread or concentrated',
  compare: 'Who we trust vs who drives decisions',
  pair: 'Head to head',
  facets: 'Reliability vs openness',
};

export function InsightsView({
  net,
  groupColor,
  isFull,
  onToggleFull,
}: {
  net: CohortNetwork;
  /** The function palette the rest of the card uses, so colours agree. */
  groupColor: Map<string, string>;
  /** Present mode — the explorer's full-screen takeover, owned by the card. */
  isFull?: boolean;
  onToggleFull?: () => void;
}) {
  // The cohort's stored threshold, never the slider's. See the file header.
  const cut = net.tieThreshold;

  // ------------------------------------------------------------------ scope
  //
  // The one filter this workspace takes: which part of the roster the nine
  // questions are about. Departments and tenure bands, multi-select, and the
  // cut is an induced subgraph — the people who match and only the ties among
  // them — so every number on every tab reads the same way. Everything below
  // this block sees `nodes` and `edges` as the scoped cohort; only the map's
  // seating (rule 4) reads the whole roster, so a scoped department keeps the
  // places it had on the full constellation.
  const [scope, setScope] = useState<InsightScope>(EMPTY_SCOPE);
  const scoped = useMemo(() => applyScope(net.nodes, net.edges, scope), [net.edges, net.nodes, scope]);
  const nodes = scoped.nodes;
  const edges = scoped.edges;
  const whole = scopeIsWhole(scope);
  /** Two or more departments, read side by side. */
  const compareOn = !!scope.compare && scope.funcs.size >= 2;
  const compareFuncs = useMemo(() => [...scope.funcs], [scope.funcs]);
  const scopeChips = useMemo(() => scopeOptions(net.nodes), [net.nodes]);
  const toggleIn = useCallback((axis: 'funcs' | 'tenures', key: string, only: boolean) => {
    setScope((cur) => {
      const next = new Set(only ? [] : cur[axis]);
      if (only || !next.has(key)) next.add(key);
      else next.delete(key);
      return { ...cur, [axis]: next };
    });
  }, []);
  // A scope that names a department the roster no longer has (a rename
  // between polls) would show an empty workspace with no chip to clear it.
  useEffect(() => {
    const funcs = new Set(scopeChips.funcs.map((f) => f.key));
    const tenures = new Set(scopeChips.tenures.map((t) => t.key));
    setScope((cur) => {
      const f = new Set([...cur.funcs].filter((k) => funcs.has(k)));
      const t = new Set([...cur.tenures].filter((k) => tenures.has(k)));
      return f.size === cur.funcs.size && t.size === cur.tenures.size ? cur : { funcs: f, tenures: t };
    });
  }, [scopeChips]);
  const memberNos = useMemo(() => nodes.map((n) => n.no), [nodes]);
  const nameOf = useMemo(() => {
    const m = new Map(nodes.map((n) => [n.no, n.name]));
    return (no: number) => m.get(no) ?? `#${no}`;
  }, [nodes]);
  const funcOf = useMemo(() => {
    const m = new Map(nodes.map((n) => [n.no, n.func.trim()]));
    return (no: number) => m.get(no) || 'No function recorded';
  }, [nodes]);
  const tenureOf = useMemo(() => {
    const m = new Map(nodes.map((n) => [n.no, (n.tenureBand ?? '').trim()]));
    return (no: number) => m.get(no) || '—';
  }, [nodes]);
  const fillOfFunc = useCallback(
    (no: number) => groupColor.get(funcOf(no)) ?? MUTED_GREY,
    [funcOf, groupColor],
  );

  /**
   * How many colleagues rated each person. Lives on the scored group result,
   * not on the roster nodes, and is absent until the first response lands —
   * which is exactly the case `divergencePoints` falls back to raw counts for.
   */
  const coverageOf = useMemo(() => {
    const m = new Map<number, number>();
    if (whole) {
      for (const r of net.group?.members ?? []) m.set(r.memberNo, r.coverage);
    } else {
      // Under a scope the engine's figure counts raters outside it; the edge
      // list is "every pair with at least one rating", so counting scoped
      // edges in is the same measure over the people shown.
      for (const e of edges) m.set(e.to, (m.get(e.to) ?? 0) + 1);
    }
    return m;
  }, [edges, net.group, whole]);

  // ---------------------------------------------------------------- focus
  //
  // One person, for the whole workspace, across every tab. Hover previews and
  // click commits, so a reader can sweep a list to find someone and then pin
  // them for the walk through the other eight tabs.
  const [focusNo, setFocusNo] = useState<number | null>(null);
  const [hoverNo, setHoverNo] = useState<number | null>(null);
  /**
   * Picking somebody shows their neighbourhood alone, refitted to the frame.
   * Dimming the rest reads well enough on screen and travels badly: a picture
   * of one person still carrying sixty faded names is both unreadable and more
   * than anyone needed handing over.
   */
  const [isolate, setIsolate] = useState(true);
  /** True only while a capture is in flight, so tables render whole. */
  const [capturing, setCapturing] = useState(false);
  /**
   * What the tables and panels treat as "current" — the pointer if it is over
   * something, otherwise the selection.
   *
   * The maps are deliberately NOT given this. Feeding a hover in as the active
   * person made the picture re-light and re-letter itself under a moving
   * cursor; they take `focusNo` and settle until something is clicked.
   */
  const activeNo = hoverNo ?? focusNo;
  const pick = useCallback((no: number) => {
    setFocusNo((cur) => {
      const next = cur === no ? null : no;
      // Picking somebody in full screen is a request to read about them, and
      // the panel that holds their card is folded away there by default.
      // Unfolding it is the answer to the click; folding it back on a second
      // click on the same person would fight the reader.
      if (next !== null) setDetailsOpen(true);
      return next;
    });
  }, []);
  useEffect(() => {
    if (focusNo === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusNo(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusNo]);
  // A focus on someone who leaves the roster between polls is a focus on
  // nobody, and would leave a dismiss chip naming "#41" in the tab bar.
  useEffect(() => {
    if (focusNo !== null && !memberNos.includes(focusNo)) setFocusNo(null);
  }, [focusNo, memberNos]);

  const [tab, setTab] = useState<string>(TABS[0]!.id);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Present mode: the picture takes the screen; the readings become a panel
  // the presenter can fold away and bring back.
  const [detailsOpen, setDetailsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('admin.insights.details') !== 'closed';
    } catch {
      return true;
    }
  });
  /**
   * How much of the map is named. A reading choice the facilitator makes once
   * and keeps, so it is remembered per browser like the rail and the details.
   *
   * Three states rather than two. It used to be a single "show every name"
   * switch, and turning it off still named the notable few — which is what the
   * map wants, but not what the switch appeared to promise. "None" is a real
   * need: a map on a screen in front of the group itself should not be able to
   * say who was rated how.
   */
  const [nameMode, setNameMode] = useState<NameMode>(() => {
    try {
      const saved = localStorage.getItem('admin.insights.names');
      // 'few' is the old off-state, and it meant what 'key' means now.
      return saved === 'all' ? 'all' : saved === 'none' ? 'none' : 'key';
    } catch {
      return 'key';
    }
  });
  const allNames = nameMode === 'all';
  // Which layers the anchors map is drawing. Not persisted: hiding a lens is a
  // thing you do for a moment while reading, not a standing preference.
  const [shownLayers, setShownLayers] = useState({
    trust: true,
    power: true,
    trustedRings: true,
    powerRings: true,
  });
  const toggleLayer = useCallback(
    (k: keyof typeof shownLayers) => setShownLayers((cur) => ({ ...cur, [k]: !cur[k] })),
    [],
  );

  const chooseNameMode = useCallback((mode: NameMode) => {
    setNameMode(mode);
    try {
      localStorage.setItem('admin.insights.names', mode);
    } catch {
      /* private mode */
    }
  }, []);

  // Entering full screen is a request for the picture, so the readings fold
  // away and the graph takes the frame; clicking anybody brings them back.
  // Leaving restores whatever the reader had before.
  const wasDetails = useRef<boolean | null>(null);
  useEffect(() => {
    if (isFull) {
      if (wasDetails.current === null) wasDetails.current = detailsOpen;
      setDetailsOpen(false);
    } else if (wasDetails.current !== null) {
      setDetailsOpen(wasDetails.current);
      wasDetails.current = null;
    }
    // `detailsOpen` is deliberately not a dependency: this runs on entering and
    // leaving, and reading it inside would re-fold the panel the moment a node
    // click opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFull]);

  const toggleDetails = useCallback(() => {
    setDetailsOpen((v) => {
      try {
        localStorage.setItem('admin.insights.details', v ? 'closed' : 'open');
      } catch {
        /* private mode */
      }
      return !v;
    });
  }, []);
  // The findings rail folds to a numbered strip when the picture needs the
  // width; the choice is the reader's and it outlives the session.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('admin.insights.rail') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleRail = useCallback(() => {
    setRailCollapsed((v) => {
      try {
        localStorage.setItem('admin.insights.rail', v ? 'open' : 'collapsed');
      } catch {
        /* private mode: the rail still folds, it just will not remember */
      }
      return !v;
    });
  }, []);

  const tip = useTooltip();
  /** Everything a person-shaped mark needs: click to focus, hover to preview. */
  const personProps: PersonProps = useCallback(
    (no: number, content: () => TipContent) => ({
      onClick: () => pick(no),
      onMouseEnter: (e: React.MouseEvent) => {
        setHoverNo(no);
        tip.show(content(), e);
      },
      onMouseMove: (e: React.MouseEvent) => tip.move(e),
      onMouseLeave: () => {
        setHoverNo(null);
        tip.hide();
      },
    }),
    [pick, tip],
  );
  /**
   * A tie's hover and click. Clicking focuses the person the arrow points at,
   * which is the one the tie is a statement about; hovering names the network
   * the line belongs to, since two are drawn at once.
   */
  const tieProps = useCallback(
    (e: PaneEdge, lenses: { label: string; color: string; mean: number }[]) => ({
      onClick: () => pick(e.to),
      onMouseEnter: (ev: React.MouseEvent) => {
        setHoverNo(e.to);
        tip.show(
          {
            title: `${nameOf(e.from)} → ${nameOf(e.to)}`,
            // A pair that scores on both lenses is the interesting case, so
            // the sub names them together rather than picking one.
            sub: `${lenses.map((l) => l.label).join(' + ')}${e.mutual ? ' · returned' : ' · one way'}`,
            rows: lenses.map((l) => [l.label, l.mean.toFixed(2)] as [string, string]),
          },
          ev,
        );
      },
      onMouseMove: (ev: React.MouseEvent) => tip.move(ev),
      onMouseLeave: () => {
        setHoverNo(null);
        tip.hide();
      },
    }),
    [nameOf, pick, tip],
  );

  /** For marks that carry data but are not a person (silos rows, facet bars). */
  const tipProps = useCallback(
    (content: () => TipContent) => ({
      onMouseEnter: (e: React.MouseEvent) => tip.show(content(), e),
      onMouseMove: (e: React.MouseEvent) => tip.move(e),
      onMouseLeave: () => tip.hide(),
    }),
    [tip],
  );

  // ------------------------------------------------------- the shared map
  const allVisible = useMemo(() => new Set(memberNos), [memberNos]);
  /**
   * Who may carry a standing name. Each tab picks the few worth naming; the
   * Filters switch overrides that with everyone, which is the right default
   * off (sixty names over sixty dots is unreadable) and the right thing to
   * have when a facilitator is looking for one person in the room.
   */
  const namesFor = useCallback(
    (few: ReadonlySet<number>) =>
      nameMode === 'all' ? allVisible : nameMode === 'key' ? few : NO_NAMES,
    [allVisible, nameMode],
  );
  const trustTies = useMemo(() => positiveTies(edges, TRUST_LENS, cut), [cut, edges]);
  const trustEdges = useMemo(
    () => buildPaneEdges(edges, TRUST_LENS, cut, allVisible),
    [allVisible, cut, edges],
  );
  // The power-over ties, for the tabs that claim trust and power are not the
  // same network. Built here beside the trust set so both share the layout.
  const powerEdges = useMemo(
    () => buildPaneEdges(edges, POWER_LENS, cut, allVisible),
    [allVisible, cut, edges],
  );
  const trustIn = useMemo(() => paneInDegree(trustEdges), [trustEdges]);
  const maxTrustIn = useMemo(() => Math.max(0, ...trustIn.values()), [trustIn]);
  const radiusTrust = useCallback(
    (no: number) => nodeRadius(trustIn.get(no) ?? 0, maxTrustIn),
    [maxTrustIn, trustIn],
  );
  /**
   * The one layout, solved once. Keyed only on the roster and the trust ties —
   * not on the tab, not on the pane size, not on the focused person — which is
   * rule 4 in the header made mechanical.
   */
  const wholeTrustTies = useMemo(() => positiveTies(net.edges, TRUST_LENS, cut), [cut, net.edges]);
  const wholeTrustIn = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of wholeTrustTies) m.set(t.to, (m.get(t.to) ?? 0) + 1);
    return m;
  }, [wholeTrustTies]);
  const mapPositions: Positions = useMemo(
    () =>
      forceMapLayout(
        net.nodes.map((n) => ({
          no: n.no,
          inTies: wholeTrustIn.get(n.no) ?? 0,
          group: n.func.trim() || '—',
        })),
        wholeTrustTies.map((t) => ({ from: t.from, to: t.to, weight: 0.6 })),
        new Map(),
        MAP_BOX,
      ),
    [net.nodes, wholeTrustIn, wholeTrustTies],
  );
  /**
   * Under a scope the seats are the same seats, zoomed: the people shown keep
   * the arrangement they had among everyone, scaled up to use the room. A
   * zoom, not a re-solve — still rule 4, just with a closer camera.
   */
  /**
   * People with no positive trust tie in either direction have no place in
   * the constellation, and letting the force layout push them to its rim
   * squeezes everyone else into the middle. They are parked in a lane down
   * the right edge instead — visibly present, visibly unconnected.
   */
  const dockedNos = useMemo(() => {
    const tied = new Set<number>();
    for (const t of wholeTrustTies) {
      tied.add(t.from);
      tied.add(t.to);
    }
    return memberNos.filter((no) => !tied.has(no));
  }, [memberNos, wholeTrustTies]);
  const dock = useMemo(
    () => (dockedNos.length > 0 ? { members: dockedNos, label: 'No trust ties' } : null),
    [dockedNos],
  );
  /**
   * The stage's real proportions, in map units. Pictures are drawn into this
   * box rather than a fixed one, so a wide stage gets a wide picture instead
   * of a letterboxed one. Measured off the stage body; re-measured on resize
   * and whenever a tab swaps the body in.
   */
  const [stageBox, setStageBox] = useState<LayoutBox>(MAP_BOX);
  /** The stage in real pixels, for turning CSS sizes into map units. */
  const [stagePxW, setStagePxW] = useState(1000);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const measure = () => {
      const body = root.querySelector<HTMLElement>('.ins-stage-body');
      if (!body) return;
      const bw = body.clientWidth;
      const bh = body.clientHeight;
      if (bw < 50 || bh < 50) return;
      const h = Math.round(Math.max(360, Math.min(900, (1000 * bh) / bw)) / 10) * 10;
      setStageBox((cur) => (cur.h === h ? cur : { w: 1000, h }));
      setStagePxW((cur) => (Math.abs(cur - bw) < 4 ? cur : bw));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(root);
    const body = root.querySelector<HTMLElement>('.ins-stage-body');
    if (body) ro.observe(body);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [tab]);
  /**
   * Dots are sized for a 1000×520 box; a wider, shorter stage gets them
   * scaled down (never up) so sixty people keep their room, and a touch
   * smaller still because the picture is read at arm's length in a debrief.
   */
  const sizeScale = Math.min(1, Math.max(0.6, stageBox.h / 520)) * 0.82;
  /**
   * The legend floats over the foot of the picture at a fixed pixel height;
   * the lanes are laid out in map units. Converting one to the other keeps
   * the bottom row of lanes clear of it at any stage size.
   */
  const laneInset = Math.round((48 * stageBox.w) / Math.max(200, stagePxW)) + 8;
  const seats: Positions = useMemo(() => {
    const dockedSet = new Set(dockedNos);
    const connected = new Set(memberNos.filter((no) => !dockedSet.has(no)));
    // Comparing departments: seat each one inside its own lane.
    if (compareOn) {
      const boxes = laneBoxes(compareFuncs.length, stageBox, 18, 40, laneInset);
      const out: Positions = new Map();
      compareFuncs.forEach((f, i) => {
        const b = boxes[i]!;
        const keep = new Set(
          nodes.filter((n) => n.func.trim() === f && connected.has(n.no)).map((n) => n.no),
        );
        if (keep.size === 0) return;
        const inner = fitToBox(mapPositions, keep, { w: b.w, h: b.h }, 34);
        const spread = separate(
          inner,
          (no) => nodeRadius(wholeTrustIn.get(no) ?? 0, Math.max(0, ...wholeTrustIn.values())) * sizeScale + 6,
          { w: b.w, h: b.h },
          3,
        );
        for (const [no, p] of spread) out.set(no, { x: b.x + p.x, y: b.y + p.y });
      });
      return out;
    }
    const field: LayoutBox = dock ? { w: stageBox.w - DOCK_W - 12, h: stageBox.h } : stageBox;
    const fitted = fitToBox(mapPositions, connected, field, 48);
    // Spread on the trust-sized radii — the size most tabs draw — with room
    // for a ring: after the fit, nobody sits on anybody.
    const out = separate(fitted, (no) => nodeRadius(wholeTrustIn.get(no) ?? 0, Math.max(0, ...wholeTrustIn.values())) * sizeScale + 8, field, 4);
    const n = dockedNos.length;
    const top = 48;
    const bottom = stageBox.h - 28;
    dockedNos.forEach((no, i) => {
      const y = n === 1 ? (top + bottom) / 2 : top + ((bottom - top) * i) / (n - 1);
      out.set(no, { x: stageBox.w - DOCK_W / 2, y });
    });
    return out;
  }, [compareFuncs, compareOn, dock, dockedNos, laneInset, mapPositions, memberNos, nodes, sizeScale, stageBox, wholeTrustIn]);
  const trustLabels = useMemo(() => topPaneLabels(trustEdges, MAP_LABELS), [trustEdges]);

  /** The map's hover, hoisted and stable so the memoised graph actually skips. */
  const onMapHover = useCallback(
    (no: number, e: React.MouseEvent) => {
      setHoverNo(no);
      tip.show(
        {
          title: nameOf(no),
          sub: funcOf(no),
          rows: [['Trust ties received', String(trustIn.get(no) ?? 0)]],
        },
        e,
      );
    },
    [funcOf, nameOf, tip, trustIn],
  );
  const onMapLeave = useCallback(() => {
    setHoverNo(null);
    tip.hide();
  }, [tip]);

  // ---- 1 anchors
  const anchorLists = useMemo(() => computeAnchors(memberNos, edges, cut, 10), [cut, edges, memberNos]);
  const trustedTop = useMemo(() => new Set(anchorLists.trusted.map((a) => a.no)), [anchorLists]);
  const powerTop = useMemo(() => new Set(anchorLists.influential.map((a) => a.no)), [anchorLists]);
  const anchorRows = useMemo(() => anchorTable(memberNos, edges, cut, 5), [cut, edges, memberNos]);
  const anchorDecor = useCallback(
    (no: number): NodeDecor | null => {
      const rings: string[] = [];
      if (shownLayers.trustedRings && trustedTop.has(no)) rings.push(TRUST_ACCENT);
      if (shownLayers.powerRings && powerTop.has(no)) rings.push(POWER_ACCENT);
      return rings.length > 0 ? { rings } : null;
    },
    [powerTop, shownLayers.powerRings, shownLayers.trustedRings, trustedTop],
  );

  // ---- 2 divergence
  const points = useMemo(
    () => divergencePoints(memberNos, edges, cut, coverageOf.size > 0 ? coverageOf : undefined),
    [coverageOf, cut, edges, memberNos],
  );
  const medians = useMemo(() => divergenceMedians(points), [points]);
  // Unlimited, so the finding sentence can count everyone off the diagonal;
  // the two mini-lists show the top five of each.
  const lists = useMemo(
    () => watchLists(points, medians, Math.max(1, points.length)),
    [medians, points],
  );
  const divergenceRows = useMemo(() => divergenceTable(points, medians), [medians, points]);
  /**
   * The Risk Zone, split the way the guide splits it: by which kind of power
   * carries the person, because a gatekeeper and a capable expert nobody warms
   * to sit in the same corner and need opposite things done about them.
   */
  const watchKinds = useMemo(() => {
    const byKind = new Map<PowerKind, string[]>();
    for (const row of divergenceRows) {
      if (row.quadrant !== 'watch') continue;
      const kind = riskKindOf(row);
      if (kind === null) continue;
      const names = byKind.get(kind);
      if (names) names.push(nameOf(row.no));
      else byKind.set(kind, [nameOf(row.no)]);
    }
    return [...byKind.entries()].map(([kind, names]) => ({ kind, names }));
  }, [divergenceRows, nameOf]);
  const [lifted, setLifted] = useState<'watch' | 'underused' | null>(null);

  // ---- 3 bridges
  // Every bridge, then the five the sidebar draws. The finding sentence counts
  // people, and counting them off a list already cut to five let a group with
  // nine brokers be reported as having five.
  const bridgeScores = useMemo(() => betweenness(memberNos, trustTies), [memberNos, trustTies]);
  const allBridges = useMemo(
    () => topBridges(bridgeScores, Number.MAX_SAFE_INTEGER),
    [bridgeScores],
  );
  const bridges = useMemo(() => allBridges.slice(0, BRIDGE_ROWS), [allBridges]);
  const bridgeSet = useMemo(() => new Set(bridges.map((b) => b.no)), [bridges]);
  const bridgeTop3 = useMemo(() => new Set(bridges.slice(0, 3).map((b) => b.no)), [bridges]);
  /** The ranked bridges, minus the three already named out in the margin. */
  const bridgeLabels = useMemo(
    () => new Set([...bridgeSet].filter((no) => !bridgeTop3.has(no))),
    [bridgeSet, bridgeTop3],
  );
  const radiusBridge = useCallback(
    (no: number) => {
      const max = allBridges[0]?.score ?? 0;
      return nodeRadius(bridgeScores.get(no) ?? 0, max);
    },
    [allBridges, bridgeScores],
  );
  /**
   * The top three bridges, annotated in the margin. Three is the whole list a
   * facilitator reads out; below that the leader lines start pointing into the
   * crowd and the map stops being a picture of the finding.
   */
  const bridgeCallouts = useMemo(
    () =>
      placeCallouts(
        bridges.slice(0, 3).flatMap((b) => {
          const p = seats.get(b.no);
          if (!p) return [];
          const name = nameOf(b.no);
          return [
            {
              no: b.no,
              x: p.x,
              y: p.y,
              r: radiusBridge(b.no),
              text: `${name.length > CALLOUT_NAME_MAX ? `${name.slice(0, CALLOUT_NAME_MAX - 1)}…` : name} · ${b.score.toFixed(2)}`,
            },
          ];
        }),
        stageBox,
        { gap: 50, inset: 16, margin: CALLOUT_MARGIN, fontSize: CALLOUT_FONT_SIZE },
      ),
    [bridges, seats, nameOf, radiusBridge, stageBox],
  );

  // ---- 4 the periphery
  const periphery = useMemo(
    () =>
      peripheralMembers(nodes, edges, cut, {
        coverageOf: coverageOf.size > 0 ? coverageOf : undefined,
        minRaters: net.minRaters,
      }),
    [coverageOf, cut, edges, net.minRaters, nodes],
  );
  const peripheralSet = useMemo(
    () => new Set(periphery.members.map((m) => m.no)),
    [periphery],
  );
  const isolateSet = useMemo(
    () => new Set(periphery.members.filter((m) => m.kind === 'isolate').map((m) => m.no)),
    [periphery],
  );

  // ---- 5 unreturned trust
  const trustPairs = useMemo(() => lensPairs(edges, TRUST_LENS), [edges]);
  const oneWayAll = useMemo(() => unreciprocatedTies(trustPairs, cut), [cut, trustPairs]);
  const oneWay = useMemo(() => oneWayAll.slice(0, ONE_WAY_ROWS), [oneWayAll]);
  const oneWayShown = useMemo(() => orderTiesByFocus(oneWay, focusNo), [focusNo, oneWay]);
  const oneWayEdges = useMemo(() => oneWayPaneEdges(oneWayAll), [oneWayAll]);
  const oneWayFolk = useMemo(() => tieEndpoints(oneWayEdges), [oneWayEdges]);

  // ---- 6 clusters + silos
  // One community pass, three consumers: the legend, the node colours and the
  // hulls. A second `communities()` call could disagree with the first, and a
  // hull drawn around a different partition than the dots inside it is the
  // worst kind of chart bug — the one that still looks right.
  const communityOf = useMemo(() => communities(memberNos, trustTies), [memberNos, trustTies]);
  const clusters = useMemo(() => clusterView(communityOf), [communityOf]);
  const hulls = useMemo(
    // Padded off the rim of each cluster's widest node, not off the centres:
    // nodes run 14 to 32 units and a centre-padded hull tucks in under the very
    // people it claims to enclose.
    () => clusterHulls(communityOf, seats, { radiusOf: radiusTrust }),
    [communityOf, seats, radiusTrust],
  );

  // ---- departments side by side (Filters → compare)
  //
  // Not a territory drawn around people scattered across a shared cloud — on
  // a map seated by ties, a department's members are everywhere, and its hull
  // swallows the picture. Each department gets its own LANE instead: its
  // people re-seated inside their own panel, keeping the arrangement they had
  // among themselves, so a tie that crosses between panels is visibly a tie
  // that crosses between departments.
  const lanes = useMemo(() => {
    if (!compareOn) return undefined;
    const boxes = laneBoxes(compareFuncs.length, stageBox, 18, 40, laneInset);
    return compareFuncs.map((f, i) => {
      const b = boxes[i]!;
      const size = nodes.filter((n) => n.func.trim() === f).length;
      return {
        label: f,
        color: groupColor.get(f) ?? MUTED_GREY,
        note: `${size} ${size === 1 ? 'person' : 'people'}`,
        ...b,
      };
    });
  }, [compareFuncs, compareOn, groupColor, laneInset, nodes, stageBox]);
  const deptRows = useMemo(() => {
    if (!compareOn) return [];
    return compareFuncs.map((f) => {
      const members = nodes.filter((n) => n.func.trim() === f).map((n) => n.no);
      const set = new Set(members);
      const rowsOf = anchorRows.filter((r) => set.has(r.no));
      const n = Math.max(1, members.length);
      let given = 0;
      let kept = 0;
      for (const t of trustTies) {
        if (!set.has(t.from)) continue;
        given += 1;
        if (set.has(t.to)) kept += 1;
      }
      return {
        key: f,
        color: groupColor.get(f) ?? MUTED_GREY,
        people: members.length,
        trustIn: rowsOf.reduce((t, r) => t + r.trustIn, 0) / n,
        powerIn: rowsOf.reduce((t, r) => t + r.powerIn, 0) / n,
        within: given > 0 ? kept / given : null,
        isolates: members.filter((no) => isolateSet.has(no)).length,
        oneWayOut: oneWayAll.filter((t) => set.has(t.a)).length,
      };
    });
  }, [anchorRows, compareFuncs, compareOn, groupColor, isolateSet, nodes, oneWayAll, trustTies]);
  /** Trust ties whose two ends are in different compared departments. */
  const crossTies = useMemo(() => {
    if (!compareOn) return 0;
    const funcOfNo = new Map(nodes.map((n) => [n.no, n.func.trim()]));
    const picked = new Set(compareFuncs);
    return trustTies.filter((t) => {
      const a = funcOfNo.get(t.from);
      const b = funcOfNo.get(t.to);
      return a !== undefined && b !== undefined && picked.has(a) && picked.has(b) && a !== b;
    }).length;
  }, [compareFuncs, compareOn, nodes, trustTies]);
  const [litDept, setLitDept] = useState<string | null>(null);
  const litDeptSet = useMemo(() => {
    if (!litDept) return null;
    return new Set(nodes.filter((n) => n.func.trim() === litDept).map((n) => n.no));
  }, [litDept, nodes]);
  const matrix = useMemo(
    () => tieMatrix(trustPairs, cut, communityOf, MATRIX_CAP),
    [communityOf, cut, trustPairs],
  );
  const clusterColorOf = useCallback(
    (no: number) => clusters.fillByNo.get(no) ?? MUTED_GREY,
    [clusters],
  );
  const silosOptions = useMemo(() => silosModes(nodes), [nodes]);
  const [silosMode, setSilosMode] = useState<SilosMode>('function');
  const activeSilosMode: SilosMode = silosOptions.includes(silosMode) ? silosMode : 'function';
  const silos = useMemo(
    () => orderSilos(subgroupCohesion(silosGroups(nodes, activeSilosMode), trustTies), activeSilosMode),
    [activeSilosMode, nodes, trustTies],
  );
  const silosLabelOf = useMemo(() => silosLabel(nodes, activeSilosMode), [activeSilosMode, nodes]);
  const silosRows = useMemo(
    () => silosMemberTable(nodes, activeSilosMode, trustTies),
    [activeSilosMode, nodes, trustTies],
  );
  /** Who is in each silos row, so hovering a row lights them on the map. */
  const silosMembers = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const g of silosGroups(nodes, activeSilosMode)) {
      if (g.group === null) continue;
      (m.get(g.group) ?? m.set(g.group, new Set()).get(g.group)!).add(g.no);
    }
    return m;
  }, [activeSilosMode, nodes]);
  const [silosHover, setSilosHover] = useState<string | null>(null);

  // ---- 7 spread or concentrated
  const spread = useMemo(
    () =>
      [
        { key: TRUST_LENS, name: 'Trust', color: TRUST_ACCENT },
        { key: POWER_LENS, name: 'Power over', color: POWER_ACCENT },
        // The guide's §5.4 warning is specifically about the covert half:
        // "especially covert power-over ('sets the agenda', 'works behind the
        // scenes')". Concentration across the whole band cannot answer it —
        // a formal veto right is on the org chart and discussable, and
        // pre-meeting agenda-shaping is neither.
        { key: COVERT_LENS, name: 'Hidden power', color: COVERT_ACCENT },
      ].map((l) => ({
        ...l,
        density: lensDensity(edges, l.key, cut),
        // The covert lens has no block of its own in the scored result, so it
        // is always computed from the edges — same formula either way.
        concentration:
          whole && l.key !== COVERT_LENS
            ? blockConcentration(net.group?.networks, l.key)
            : scopedConcentration(memberNos, edges, l.key, cut),
      })),
    [cut, edges, memberNos, net.group, whole],
  );
  const trustShares = useMemo(
    () => concentrationTable(memberNos, edges, TRUST_LENS, cut),
    [cut, edges, memberNos],
  );
  const powerShares = useMemo(
    () => concentrationTable(memberNos, edges, POWER_LENS, cut),
    [cut, edges, memberNos],
  );
  /**
   * Who holds the hidden half, by name. The concentration meter says whether
   * agenda-setting sits in few hands; this says whose. Same table the meter's
   * neighbours read, so a holder's count and rank agree with the person card.
   */
  const covertShares = useMemo(
    () => concentrationTable(memberNos, edges, COVERT_LENS, cut),
    [cut, edges, memberNos],
  );
  /**
   * Ranked by rate — ties over the colleagues who rated them — not raw count,
   * the same normalising the concentration meter uses. A raw count caps
   * anyone in a small or siloed function: rated by eight, they can never
   * out-rank somebody rated by fifty, however unanimous the eight are.
   */
  const covertHolders = useMemo(() => {
    const rate = (no: number, count: number) => {
      const cov = coverageOf.get(no) ?? 0;
      return cov > 0 ? count / cov : 0;
    };
    return covertShares.rows
      .filter((r) => r.count > 0)
      .map((r) => ({ no: r.no, count: r.count, rate: rate(r.no, r.count) }))
      .sort((a, b) => b.rate - a.rate || b.count - a.count || a.no - b.no);
  }, [coverageOf, covertShares]);
  /** Who together hold half of every hidden-power tie, by count. */
  const covertHalf = useMemo(
    () => new Set(covertShares.rows.slice(0, covertShares.halfCount).map((r) => r.no)),
    [covertShares],
  );
  const covertRank = useMemo(
    () => new Map(covertHolders.map((h, i) => [h.no, i + 1])),
    [covertHolders],
  );
  /**
   * The guide's §5.4 sentence, said the same way on screen as in the report:
   * concentration in the informal half of power, read against the formal half
   * rather than against a fixed line, because someone has to set an agenda and
   * the finding is about how few people do it.
   */
  const covertVerdict = useMemo(() => {
    const covert = spread.find((l) => l.key === COVERT_LENS);
    const overt = spread.find((l) => l.key === POWER_LENS);
    return covertPowerVerdict(covert?.density.ties ?? 0, covert?.concentration ?? null, overt?.concentration ?? null);
  }, [spread]);
  const hubs = useMemo(() => topDecile(trustIn, 0.1), [trustIn]);
  /**
   * A contour around "the few hands" — the same hull machinery the clusters
   * use, over one made-up community of one decile. The halo says who; the
   * outline says how much of the map they are, which is the actual finding.
   */
  const hubHull = useMemo(() => {
    if (hubs.size < 3) return [];
    const one = new Map<number, number>();
    for (const no of hubs) one.set(no, 0);
    return clusterHulls(one, seats, { radiusOf: radiusTrust }).map((h) => ({
      ...h,
      label: 'The few hands',
      fill: STRUCT_ACCENT,
    }));
  }, [hubs, seats, radiusTrust]);
  const spreadShares = useMemo(() => {
    const power = new Map(powerShares.rows.map((r) => [r.no, r]));
    return trustShares.rows.map((r) => ({ trust: r, power: power.get(r.no) ?? null }));
  }, [powerShares, trustShares]);


  // ---- the facilitator guide's two group readings
  const mix = useMemo(() => (net.group ? influenceMix(net.group) : null), [net.group]);
  const signaturesFound = useMemo(() => (net.group ? signatures(net.group) : null), [net.group]);

  // ---- 8 trust against power, as shares rather than ranks
  const shareRows = useMemo(
    () => divergenceShares(memberNos, edges, cut, coverageOf),
    [coverageOf, cut, edges, memberNos],
  );
  const shareOf = useMemo(() => new Map(shareRows.map((r) => [r.no, r])), [shareRows]);
  /**
   * The same table in raw numbers: every rating each person received, added
   * up per statement and per block, with the average beside each sum. From the
   * scored group, so it ignores the threshold slider — a sum has no cut.
   */
  const [standingsView, setStandingsView] = useState<'shares' | 'scores'>('shares');
  const scoreRows = useMemo(
    () =>
      (net.group?.members ?? []).filter((m) => memberNos.includes(m.memberNo)),
    [memberNos, net.group],
  );
  const gapOf = useMemo(() => new Map(shareRows.map((r) => [r.no, r.gap])), [shareRows]);
  const divergentRows = useMemo(
    () =>
      shareRows
        .filter((r) => r.gap !== null && Math.abs(r.gap) >= DIVERGENCE_FLOOR)
        .sort((a, b) => Math.abs(b.gap!) - Math.abs(a.gap!)),
    [shareRows],
  );
  /** The ones worth naming on the map: the ones the tab is about. */
  const divergentFolk = useMemo(
    () => new Set(divergentRows.slice(0, 12).map((r) => r.no)),
    [divergentRows],
  );

  // ---- 9 the two facets of trust
  const relDensity = useMemo(() => lensDensity(edges, 'reliability', cut), [cut, edges]);
  const openDensity = useMemo(() => lensDensity(edges, 'openness', cut), [cut, edges]);
  const relOpen = relOpenVerdict(relDensity.density, openDensity.density);
  const facetRows = useMemo(() => facetTable(memberNos, edges, cut), [cut, edges, memberNos]);
  const [facetLens, setFacetLens] = useState<'reliability' | 'openness'>('reliability');
  const facetEdges = useMemo(
    () => buildPaneEdges(edges, facetLens, cut, allVisible),
    [allVisible, cut, edges, facetLens],
  );
  const facetIn = useMemo(() => paneInDegree(facetEdges), [facetEdges]);
  const maxFacetIn = useMemo(() => Math.max(0, ...facetIn.values()), [facetIn]);
  const radiusFacet = useCallback(
    (no: number) => nodeRadius(facetIn.get(no) ?? 0, maxFacetIn),
    [facetIn, maxFacetIn],
  );
  const facetLabels = useMemo(() => topPaneLabels(facetEdges, MAP_LABELS), [facetEdges]);

  // -------------------------------------------------------------- shared bits
  const nameCol = useCallback(
    <T extends { no: number }>(head = 'Name'): Column<T> => ({
      key: 'name',
      head,
      sort: (a, b) => nameOf(a.no).localeCompare(nameOf(b.no)),
      cell: (r) => (
        <span className="ins-grid-person">
          <Avatar name={nameOf(r.no)} color={fillOfFunc(r.no)} size={22} />
          <span className="ins-grid-name">{nameOf(r.no)}</span>
        </span>
      ),
    }),
    [fillOfFunc, nameOf],
  );
  const funcCol = useCallback(
    <T extends { no: number }>(): Column<T> => ({
      key: 'func',
      head: 'Function',
      width: 170,
      sort: (a, b) => funcOf(a.no).localeCompare(funcOf(b.no)),
      cell: (r) => funcOf(r.no),
    }),
    [funcOf],
  );

  const tabDef = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  /** Scales for the in-cell data bars: one per measure, cohort-wide, so a bar
   *  means the same length on every tab that draws it. */
  const colMax = useMemo(
    () => ({
      trustIn: Math.max(1, ...anchorRows.map((r) => r.trustIn)),
      powerIn: Math.max(1, ...anchorRows.map((r) => r.powerIn)),
      within: Math.max(1, ...silosRows.map((r) => Math.max(r.withinTies, r.outTies))),
      share: Math.max(0.01, ...spreadShares.map((r) => Math.max(r.trust.share, r.power?.share ?? 0))),
      facet: Math.max(1, ...facetRows.map((r) => Math.max(r.reliabilityIn, r.opennessIn))),
    }),
    [anchorRows, facetRows, silosRows, spreadShares],
  );

  /** The one number per question the rail shows beside its name. */
  const stats: Record<string, RailStat | null> = {
    anchors: anchorLists.trusted[0]
      ? { value: String(anchorLists.trusted[0].count), title: 'Most trust ties received by one person', tone: 'ok' }
      : null,
    divergence: { value: `${lists.watch.length} · ${lists.underused.length}`, title: 'Watch list · underused', tone: lists.watch.length > 0 ? 'warn' : 'muted' },
    bridges: allBridges[0] ? { value: allBridges[0].score.toFixed(2), title: 'Highest betweenness', tone: 'accent' } : null,
    isolates: { value: String(isolateSet.size), title: 'People with no positive ties at all', tone: isolateSet.size > 0 ? 'warn' : 'ok' },
    oneway: { value: String(oneWayAll.length), title: 'Unreturned trust ties', tone: oneWayAll.length > 0 ? 'warn' : 'ok' },
    silos: { value: silosVerdict(silos) ? 'Pooled' : 'Flows', title: 'Does trust pool inside groups?', tone: silosVerdict(silos) ? 'warn' : 'ok' },
    spread: spread[0]?.concentration !== null && spread[0]?.concentration !== undefined
      ? { value: spread[0].concentration.toFixed(2), title: 'Trust concentration, 0 flat to 1 one person', tone: spread[0].concentration >= 0.5 ? 'warn' : 'ok' }
      : null,
    compare: (() => {
      const t = new Set(anchorLists.trusted.map((a) => a.no));
      const both = anchorLists.influential.filter((a) => t.has(a.no)).length;
      const n = Math.max(anchorLists.trusted.length, anchorLists.influential.length);
      return n > 0 ? { value: `${both}/${n}`, title: 'Top names on both lists', tone: both === n ? 'ok' : 'accent' } : null;
    })(),
    facets:
      relDensity.density !== null && openDensity.density !== null
        ? { value: `${Math.round(relDensity.density * 100)}·${Math.round(openDensity.density * 100)}%`, title: 'Reliability · openness density', tone: Math.abs(relDensity.density - openDensity.density) >= 0.15 ? 'warn' : 'ok' }
        : null,
  };

  // Keys 1–9 walk the questions, unless the reader is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const i = Number(e.key) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= TABS.length) return;
      setTab(TABS[i]!.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /** The stage body — picture and legend — as a PNG, named for the question. */

  // ---- head to head
  // Seeded with the two most trusted, so the tab opens on a real comparison
  // rather than two empty pickers.
  const [pairA, setPairA] = useState<number | null>(null);
  const [pairB, setPairB] = useState<number | null>(null);
  const pair = useMemo(() => {
    const fallback = anchorLists.trusted.map((t) => t.no);
    const a = pairA !== null && memberNos.includes(pairA) ? pairA : (fallback[0] ?? memberNos[0] ?? null);
    const b =
      pairB !== null && memberNos.includes(pairB) && pairB !== a
        ? pairB
        : (fallback.find((n) => n !== a) ?? memberNos.find((n) => n !== a) ?? null);
    return { a, b };
  }, [anchorLists.trusted, memberNos, pairA, pairB]);
  // Ticked in the band below. Two or more take over the panel; fewer and it
  // stays the two-person comparison the tab opens on.
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [rowQuery, setRowQuery] = useState('');
  const togglePicked = useCallback((no: number) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(no)) next.delete(no);
      else next.add(no);
      return next;
    });
  }, []);
  const compareNos = useMemo(() => {
    const ticked = [...picked].filter((no) => memberNos.includes(no));
    if (ticked.length >= 2) return ticked;
    return pair.a !== null && pair.b !== null ? [pair.a, pair.b] : [];
  }, [memberNos, pair.a, pair.b, picked]);

  /** One overlay object, not a fresh literal per render. */
  const powerOverlay = useMemo(
    () => ({ edges: powerEdges, color: POWER_TIE, label: 'Power over' }),
    [powerEdges],
  );

  const compareSet = useMemo(() => new Set(compareNos), [compareNos]);

  /** The two (or more) being compared, ringed on their own map. */
  const compareDecor = useCallback(
    (no: number): NodeDecor | null => (compareSet.has(no) ? { rings: [STRUCT_ACCENT] } : null),
    [compareSet],
  );

  /**
   * On the comparison map the ties that touch the people being compared are
   * the picture; the rest is the shape they sit in, and is drawn faintly.
   */
  const pairFade = useCallback(
    (e: PaneEdge) => (compareSet.has(e.from) || compareSet.has(e.to) ? 0.75 : 0.06),
    [compareSet],
  );


  const pairMetrics = useMemo(
    () => (compareNos.length < 2 ? [] : comparePeople(compareNos, memberNos, edges, cut, coverageOf)),
    [compareNos, coverageOf, cut, edges, memberNos],
  );
  /** Every member on the same measures, transposed into one row each. */
  const metricRows = useMemo(() => {
    const cols = comparePeople(memberNos, memberNos, edges, cut, coverageOf);
    return memberNos.map((no, i) => ({
      no,
      name: nameOf(no),
      func: funcOf(no),
      cells: cols.map((m) => ({
        key: m.key,
        label: m.label,
        short: m.short,
        text: m.texts[i] ?? '—',
        value: m.values[i] ?? null,
      })),
    }));
  }, [coverageOf, cut, edges, funcOf, memberNos, nameOf]);

  /**
   * What a facilitator should actually do about each person being compared.
   *
   * The measures above say where somebody stands; these say what that standing
   * is a symptom of. Only conditions the instrument can actually evidence
   * appear — nothing here is a guess about why.
   */
  const hrNotes = useCallback(
    (no: number): { tone: 'warn' | 'ok' | 'plain'; text: string }[] => {
      const out: { tone: 'warn' | 'ok' | 'plain'; text: string }[] = [];
      const stand = shareOf.get(no);
      const raters = coverageOf.get(no) ?? 0;

      if (raters < net.minRaters) {
        out.push({
          tone: 'plain',
          text: `Only ${raters} colleagues rated them — under the floor of ${net.minRaters}, so read every figure here as provisional.`,
        });
      }
      if (stand?.gap !== null && stand !== undefined && stand.gap <= -DIVERGENCE_FLOOR) {
        out.push({
          tone: 'warn',
          text: 'Relied on well beyond the say they are given — the group leans on them informally while the authority sits elsewhere. A candidate for a formal remit.',
        });
      }
      if (stand?.gap !== null && stand !== undefined && stand.gap >= DIVERGENCE_FLOOR) {
        out.push({
          tone: 'warn',
          text: 'Deferred to more than relied on — compliance without confidence. Worth asking what the deference is buying.',
        });
      }
      const bridgeIx = allBridges.findIndex((x) => x.no === no);
      if (bridgeIx >= 0 && bridgeIx < 3) {
        out.push({
          tone: 'warn',
          text: `#${bridgeIx + 1} bridge in the group: trust between parts of it routes through them. A succession and holiday risk, whatever their title.`,
        });
      }
      const edge = periphery.members.find((m) => m.no === no);
      if (edge) {
        out.push({
          tone: 'warn',
          text:
            edge.kind === 'isolate'
              ? 'Nobody puts them over the line on any question — an isolate. Worth checking whether they are new, remote, or simply unknown to the group.'
              : 'On the periphery: rated, but by few and at low strength. Often a signal about exposure, not ability.',
        });
      }
      const out2 = oneWayAll.filter((t) => t.a === no).length;
      if (out2 >= 3) {
        out.push({
          tone: 'plain',
          text: `Extends trust to ${out2} colleagues who do not return it — generous, and possibly isolated in the reaching.`,
        });
      }
      if (out.length === 0) {
        out.push({ tone: 'ok', text: 'Nothing stands out: their standing on both questions matches the group.' });
      }
      return out;
    },
    [allBridges, coverageOf, net.minRaters, oneWayAll, periphery.members, shareOf],
  );

  /**
   * The band's rows: searched, and with the ticked floated to the top. A
   * selection scattered over seven pages is a selection nobody can check.
   */
  const visibleMetricRows = useMemo(() => {
    const q = rowQuery.trim().toLowerCase();
    const rows = q
      ? metricRows.filter(
          (r) => r.name.toLowerCase().includes(q) || r.func.toLowerCase().includes(q),
        )
      : metricRows;
    return [...rows].sort(
      (a, b) => Number(picked.has(b.no)) - Number(picked.has(a.no)),
    );
  }, [metricRows, picked, rowQuery]);

  const pairSentence = useMemo(
    () =>
      compareNos.length < 2
        ? 'Pick two people to compare.'
        : shortlistVerdict(compareNos.map(nameOf), pairMetrics),
    [compareNos, nameOf, pairMetrics],
  );

  /**
   * The nine findings at once, for the rail. Each is the very expression its
   * tab leads with, so the rail and the open tab can never disagree.
   */
  const silosFinding = silosVerdict(silos)
    ? activeSilosMode === 'tenure'
      ? 'Trust pools inside tenure bands more than it flows between them.'
      : activeSilosMode === 'team'
        ? 'Trust pools inside teams more than it flows between them.'
        : 'Trust pools inside functions more than it flows between them.'
    : clusterFinding(clusters.entries.filter((c) => !c.singleton).length);
  const oneWayFindingText = oneWayFinding(
    oneWayAll.length,
    oneWayAll[0] ? `${nameOf(oneWayAll[0].a)} → ${nameOf(oneWayAll[0].b)}` : null,
  );
  const findings: Record<string, string | null> = {
    anchors: anchorFinding(anchorLists, nameOf),
    divergence: divergenceFinding(lists),
    bridges: bridgeFinding(allBridges, nameOf),
    isolates: peripheryFinding(periphery.members.length, isolateSet.size),
    oneway: oneWayFindingText,
    silos: silosFinding,
    spread: spreadFinding(spread),
    compare: divergenceShareFinding(shareRows, nameOf),
    pair: pairSentence,
    facets: relOpen,
  };

  /** What the current tab would put in a document, as display strings. */
  const docPayload = useCallback((): DocPayload => {
    const root = rootRef.current;
    const table = root?.querySelector('.ins-band table');
    const columns: DocColumn[] = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => ({
      head: (th.textContent ?? '').replace(/[↕↑↓]/g, '').trim(),
      right: th.classList.contains('is-right'),
    }));
    // An avatar disc is two initials of markup inside the cell; reading
    // textContent straight off it yields "PRPriya Rao".
    const cellText = (el: Element): string => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.ins-avatar, [class*="avatar"], .nx-rank, .ins-rank').forEach((n) => n.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
      [...tr.querySelectorAll('td')].map(cellText),
    );
    const panels: DocPanel[] = [...(root?.querySelectorAll('.ins-side .ins-panel') ?? [])]
      .map((panel) => ({
        title: (panel.querySelector('h4, .ins-panel-title')?.textContent ?? '').trim(),
        rows: [...panel.querySelectorAll('.insights-bar, .insights-row')].map((r) => {
          const named = r.querySelector('.insights-bar-name, .insights-row-name');
          const meta = r.querySelector('.insights-bar-meta, .insights-row-meta');
          const valued = r.querySelector('.insights-bar-val, .insights-row-val');
          const label = [named && cellText(named), meta && cellText(meta)].filter(Boolean).join(' · ');
          return [
            (label || cellText(r)).slice(0, 120),
            (valued ? cellText(valued) : '').slice(0, 80),
          ] as [string, string];
        }),
      }))
      .filter((p) => p.title && p.rows.length > 0);
    return {
      round: net.roundName,
      tabTitle: TAB_TITLE[tab] ?? tab,
      question: tabDef.question,
      finding: findings[tab] ?? '',
      columns,
      rows,
      panels,
    };
  }, [findings, net.roundNo, tab, tabDef.question]);

  const exportStage = useCallback(
    (opts: ExportOptions) => {
      if (opts.scope === 'all') setCapturing(true);
      const root = rootRef.current;
      const target = root?.querySelector<HTMLElement>(
        opts.scope === 'all' ? '.ins-ws' : '.ins-stage-body',
      );
      if (!root || !target) return;
      const stem = `insights-${tab}-round${net.roundNo}`;

      // The interactive one takes the live SVG rather than a picture of it:
      // that is the whole point of the format.
      if (opts.format === 'html') {
        if (!opts.names) root.classList.add('is-capture-unnamed');
        // The payload is read out of the live DOM, so the un-paged table has to
        // exist before it is read — the same frame the PNG path waits for.
        const wait = opts.scope === 'all' ? new Promise((r) => setTimeout(r, 120)) : Promise.resolve();
        void wait
          .then(() => {
            const svg = root.querySelector<SVGSVGElement>('.ins-graph');
            const payload = docPayload();
            downloadInsightHtml(
              svg,
              opts.scope === 'all' ? payload : { ...payload, rows: [], panels: [] },
              stem,
              net.roundName,
            );
          })
          .finally(() => {
            root.classList.remove('is-capture-unnamed');
            setCapturing(false);
          });
        return;
      }
      // Names are hidden for the capture only, by class rather than by state:
      // re-solving the label layout would reflow the map under the reader
      // while it is being photographed.
      if (!opts.names) root.classList.add('is-capture-unnamed');
      if (opts.scope === 'all') root.classList.add('is-capture-full');
      // A frame for React to paint the un-paged table before it is photographed.
      const ready = opts.scope === 'all' ? new Promise((r) => setTimeout(r, 120)) : Promise.resolve();
      void ready
        .then(() =>
          toPng(opts.format === 'pdf' ? root.querySelector<HTMLElement>('.ins-stage-body') ?? target : target, {
            pixelRatio: 2,
            backgroundColor: '#FFFFFF',
          }),
        )
        .then(async (url) => {
          if (opts.format === 'pdf') {
            const payload = docPayload();
            await downloadInsightPdf(
              net.cohortId,
              {
                ...payload,
                imageDataUrl: url,
                ...(opts.scope === 'all' ? {} : { rows: [], panels: [] }),
              },
              stem,
            );
            return;
          }
          const a = document.createElement('a');
          a.href = url;
          a.download = `${stem}${opts.scope === 'all' ? '-full' : ''}${opts.names ? '-named' : ''}.png`;
          a.click();
        })
        .finally(() => {
          root.classList.remove('is-capture-unnamed');
          root.classList.remove('is-capture-full');
          setCapturing(false);
        });
    },
    [docPayload, net.cohortId, net.roundName, net.roundNo, tab],
  );

  /** Everyone on the picture, for the search box. */
  const searchPeople = useMemo(
    () => nodes.map((n) => ({ no: n.no, name: n.name, func: n.func.trim(), color: fillOfFunc(n.no) })),
    [fillOfFunc, nodes],
  );

  /** The focused person's standing on all nine questions, for the card. */
  const personCard = useMemo(() => {
    if (focusNo === null) return null;
    const no = focusNo;
    const anchor = anchorRows.find((r) => r.no === no);
    const quad = divergenceRows.find((r) => r.no === no);
    const bridgeIx = allBridges.findIndex((b) => b.no === no);
    const bridge = bridgeIx >= 0 ? allBridges[bridgeIx] : undefined;
    const edge = periphery.members.find((m) => m.no === no);
    const given = oneWayAll.filter((t) => t.a === no).length;
    const got = oneWayAll.filter((t) => t.b === no).length;
    const fill = clusters.fillByNo.get(no);
    const cluster = clusters.entries.find((e) => e.fill === fill && !e.singleton)?.label;
    const share = spreadShares.find((r) => r.trust.no === no)?.trust.share;
    const facet = facetRows.find((r) => r.no === no);
    const standing = shareOf.get(no);
    const hiddenIn = covertShares.rows.find((r) => r.no === no)?.count ?? 0;
    const hiddenRank = covertRank.get(no);
    // The guide's own archetype names, so a card, a panel and the client's
    // deck all say the same word for the same quadrant.
    const quadShort = QUADRANT_NAME;
    const cells: PersonCell[] = [
      { tab: 'anchors', label: 'Trust · power in', value: `${anchor?.trustIn ?? 0} · ${anchor?.powerIn ?? 0}`, share: (anchor?.trustIn ?? 0) / colMax.trustIn },
      { tab: 'divergence', label: 'Quadrant', value: quad ? quadShort[quad.quadrant] ?? QUADRANT_NAME[quad.quadrant] : '—', tone: quad?.quadrant === 'watch' ? 'warn' : quad?.quadrant === 'anchor' ? 'ok' : undefined },
      { tab: 'bridges', label: 'Bridge rank', value: bridge ? `#${bridgeIx + 1} · ${bridge.score.toFixed(2)}` : 'Not a bridge' },
      { tab: 'isolates', label: 'At the edge', value: edge ? (edge.kind === 'isolate' ? 'Isolate' : 'Peripheral') : 'No', tone: edge ? 'warn' : 'ok' },
      { tab: 'oneway', label: 'One-way trust', value: `${given} out · ${got} in`, tone: given + got > 0 ? 'warn' : undefined },
      { tab: 'silos', label: 'Cluster', value: cluster ?? 'Unclustered' },
      { tab: 'spread', label: 'Share of trust', value: share !== undefined ? `${(share * 100).toFixed(1)}%` : '—', share: share !== undefined ? share / colMax.share : null },
      {
        tab: 'compare',
        label: 'Relied on · deferred to',
        value:
          standing === undefined || standing.trust === null
            ? '—'
            : `${Math.round(standing.trust * 100)}% · ${Math.round((standing.power ?? 0) * 100)}%`,
        tone:
          standing !== undefined && standing.gap !== null && Math.abs(standing.gap) >= DIVERGENCE_FLOOR
            ? 'warn'
            : undefined,
      },
      { tab: 'facets', label: 'Reliability − openness', value: facet ? (facet.gap > 0 ? `+${facet.gap}` : String(facet.gap)) : '—' },
      {
        tab: 'spread',
        label: 'Hidden power in',
        value: hiddenRank === undefined
          ? `${hiddenIn} · not a holder`
          : `${hiddenIn} · #${hiddenRank} of ${covertHolders.length} holders`,
        share: covertHolders.length > 0 ? (covertHolders.find((h) => h.no === no)?.rate ?? 0) / covertHolders[0]!.rate : null,
        tone: covertHalf.has(no) ? 'warn' : undefined,
        wide: true,
      },
    ];
    return (
      <PersonCard
        name={nameOf(no)}
        color={fillOfFunc(no)}
        meta={`${funcOf(no)}${tenureOf(no) !== '—' ? ` · ${tenureOf(no)}` : ''} · rated by ${coverageOf.get(no) ?? 0}`}
        cells={cells}
        activeTab={tab}
        onPick={setTab}
        onClear={() => setFocusNo(null)}
      />
    );
  }, [allBridges, anchorRows, clusters, colMax, covertHalf, covertHolders, covertRank, covertShares, coverageOf, divergenceRows, facetRows, fillOfFunc, focusNo, funcOf, nameOf, oneWayAll, periphery.members, shareOf, spreadShares, tab, tenureOf]);

  return (
    <div
      className={`insights${isFull ? ' is-theatre' : ''}${isFull && !detailsOpen ? ' is-details-closed' : ''}`}
      ref={rootRef}
    >
      <InsightToolbar
        scope={
          <ScopePicker
            funcs={scopeChips.funcs}
            tenures={scopeChips.tenures}
            activeFuncs={scope.funcs}
            activeTenures={scope.tenures}
            onToggleFunc={(k, only) => toggleIn('funcs', k, only)}
            onToggleTenure={(k, only) => toggleIn('tenures', k, only)}
            onClear={() => setScope(EMPTY_SCOPE)}
            colorOf={(k) => groupColor.get(k) ?? MUTED_GREY}
            shown={nodes.length}
            total={net.nodes.length}
            compare={!!scope.compare}
            onToggleCompare={(on) => setScope((cur) => ({ ...cur, compare: on }))}
            nameMode={nameMode}
            onNameMode={chooseNameMode}
          />
        }
        search={
          <PersonSearch
            people={searchPeople}
            scopedOut={!whole}
            onPick={(no) => setFocusNo(no)}
          />
        }
        focus={
          focusNo !== null ? (
            <>
            <button
              type="button"
              className={`ins-isolate${isolate ? ' is-on' : ''}`}
              onClick={() => setIsolate((v) => !v)}
              aria-pressed={isolate}
              title={
                isolate
                  ? 'Show the whole group again'
                  : 'Show only this person and whoever they are tied to'
              }
            >
              {isolate ? 'Them alone' : 'Whole group'}
            </button>
            <button
              className="insights-focus-chip"
              onClick={() => setFocusNo(null)}
              title="Clear the focus (Esc)"
            >
              <span
                className="insights-focus-dot"
                style={{ background: fillOfFunc(focusNo) }}
                aria-hidden="true"
              />
              Focused: <b>{nameOf(focusNo)}</b>
              <span className="insights-focus-x" aria-hidden="true">
                ×
              </span>
            </button>
            </>
          ) : null
        }
        note={
          <>
            Tie threshold {cut.toFixed(1)} · {net.roundName}
          </>
        }
        isFull={isFull}
        onToggleFull={onToggleFull}
        details={
          isFull ? (
            <button
              type="button"
              className={`ins-present is-details${detailsOpen ? ' is-on' : ''}`}
              onClick={toggleDetails}
              aria-pressed={detailsOpen}
              title={detailsOpen ? 'Hide the details panel' : 'Show the details panel'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16" />
              </svg>
              Details
            </button>
          ) : null
        }
      />

      <div className="ins-body">
      <FindingsRail
        tabs={TABS}
        groups={GROUPS}
        active={tab}
        onPick={setTab}
        findingOf={(id) => findings[id] ?? null}
        statOf={(id) => stats[id] ?? null}
        collapsed={railCollapsed}
        onToggle={toggleRail}
      />
      {/* Keyed on the tab AND the scope so each panel's bars grow in once, on
          arrival, and a re-scoped band opens on its own order. */}
      <div className="ins-panels" key={`${tab}:${[...scope.funcs, '|', ...scope.tenures].join(',')}`}>
        {/* ---------------------------------------------------- 1 anchors */}
        {tab === 'anchors' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.anchors!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Every member, both standings"
            bandNote={`${anchorRows.length} people`}
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={shownLayers.trust ? trustEdges : EMPTY_EDGES}
                edgeColor={TRUST_TIE}
                edgeLabel="Trust"
                overlay={shownLayers.power ? powerOverlay : null}
                tieProps={tieProps}
                /* Two lenses at once means twice the ink, and the shared 0.24
                   leaves both as grey haze. Lifted so each line keeps its hue;
                   focus still takes a tie to 0.9 above this. */
                edgeFadeOf={FADE.anchors}
                directed
                sizeOf={radiusTrust}
                colorOf={fillOfFunc}
                decorate={anchorDecor}
                labelFor={namesFor(trustLabels)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="Trust ties in green and power-over ties in orange, arrowed towards the person rated, with the five most trusted and the five most powerful ringed"
              />
            }
            legend={
              <div className="ins-legend-row">
                <LineKey color={TRUST_TIE} on={shownLayers.trust} onToggle={() => toggleLayer('trust')}>
                  Trust
                </LineKey>
                <LineKey color={POWER_TIE} on={shownLayers.power} onToggle={() => toggleLayer('power')}>
                  Power over
                </LineKey>
                <RingKey
                  color={TRUST_ACCENT}
                  on={shownLayers.trustedRings}
                  onToggle={() => toggleLayer('trustedRings')}
                >
                  Most trusted
                </RingKey>
                <RingKey
                  color={POWER_ACCENT}
                  on={shownLayers.powerRings}
                  onToggle={() => toggleLayer('powerRings')}
                >
                  Most powerful
                </RingKey>
                <span className="ins-legend-note">Arrow points to the person rated · node size: trust ties received</span>
              </div>
            }
            sidebar={
              <>
                <Finding text={null} />
                <Panel title="Most trusted" accent={TRUST_ACCENT}>
                  <RankList
                    coverageOf={coverageOf}
                    colorOf={fillOfFunc}
                    entries={anchorLists.trusted}
                    bold={anchorLists.both}
                    fill={TRUST_ACCENT}
                    activeNo={activeNo}
                    nameOf={nameOf}
                    funcOf={funcOf}
                    unit="trust ties received"
                    personProps={personProps}
                  />
                </Panel>
                <Panel title="Most powerful" accent={POWER_ACCENT}>
                  <RankList
                    coverageOf={coverageOf}
                    colorOf={fillOfFunc}
                    entries={anchorLists.influential}
                    bold={anchorLists.both}
                    fill={POWER_ACCENT}
                    activeNo={activeNo}
                    nameOf={nameOf}
                    funcOf={funcOf}
                    unit="power-over ties received"
                    personProps={personProps}
                  />
                  <p className="ins-panel-foot">Names in bold appear on both lists.</p>
                </Panel>
              </>
            }
            band={
              <DetailTable<AnchorRow>
                rows={anchorRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: funcOf(r.no),
                  rows: [
                    ['Trust ties received', String(r.trustIn)],
                    ['Power-over ties received', String(r.powerIn)],
                  ],
                })}
                empty="Nobody is on the roster yet."
                columns={[
                  nameCol<AnchorRow>(),
                  funcCol<AnchorRow>(),
                  {
                    key: 'trust',
                    head: 'Trust in',
                    right: true,
                    width: 96,
                    sort: (a, b) => a.trustIn - b.trustIn,
                    cell: (r) => r.trustIn,
                    bar: (r) => r.trustIn / colMax.trustIn,
                    barColor: TRUST_ACCENT,
                  },
                  {
                    key: 'power',
                    head: 'Power in',
                    right: true,
                    width: 116,
                    sort: (a, b) => a.powerIn - b.powerIn,
                    cell: (r) => r.powerIn,
                    bar: (r) => r.powerIn / colMax.powerIn,
                    barColor: POWER_ACCENT,
                  },
                  {
                    key: 'both',
                    head: 'On both lists',
                    right: true,
                    width: 122,
                    sort: (a, b) => Number(a.onBoth) - Number(b.onBoth),
                    cell: (r) =>
                      r.onBoth ? <span className="insights-tag is-tenure">both</span> : <span className="ins-dash">—</span>,
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* ------------------------------------------------- 2 divergence */}
        {tab === 'divergence' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.divergence!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Every member, placed"
            bandNote={points[0]?.normalised ? 'Rates are per colleague who rated them' : 'Raw tie counts'}
            centre={
              <DivergenceChart
                box={stageBox}
                points={points}
                medians={medians}
                activeNo={activeNo}
                lifted={lifted}
                names={nameMode}
                nameOf={nameOf}
                funcOf={funcOf}
                personProps={personProps}
                onClearFocus={() => setFocusNo(null)}
              />
            }
            sidebar={
              <>
                <Finding
                  text={null}
                  caption="Power without goodwill is a friction point and a succession risk; trusted people without power are often overlooked for stretch roles."
                />
                <div onMouseEnter={() => setLifted('watch')} onMouseLeave={() => setLifted(null)}>
                  {mix && mix.share !== null ? (
                  <Panel title="How influence flows" sub="Enabling power against control">
                    <div className="ins-mix">
                      <div className="ins-mix-bar">
                        <span style={{ width: `${Math.round(mix.share * 100)}%` }} />
                      </div>
                      <p className="ins-mix-ends">
                        <b>Enabling {mix.enabling}</b>
                        <b>{mix.controlling} Controlling</b>
                      </p>
                      <p className="ins-panel-foot">{mix.verdict}</p>
                    </div>
                  </Panel>
                ) : null}
                <Panel title={QUADRANT_NAME.watch} sub={QUADRANT_GLOSS.watch} accent={QUADRANT_COLOR.watch}>
                    <QuadrantList
                      colorOf={fillOfFunc}
                      entries={lists.watch.slice(0, 5)}
                      fill={QUADRANT_COLOR.watch}
                      activeNo={activeNo}
                      nameOf={nameOf}
                      funcOf={funcOf}
                      personProps={personProps}
                    />
                    {/* The guide splits this corner in two and prescribes
                        opposite fixes for the halves, so the list alone is a
                        flag with no action attached. Named per person, because
                        a corner can hold one of each. */}
                    {watchKinds.length > 0 ? (
                      <div className="ins-kinds">
                        {watchKinds.map((k) => (
                          <div className="ins-kind-row" key={k.kind}>
                            <p className="ins-kind-head">
                              <span className={k.kind === 'bottleneck' ? 'ins-kind is-control' : 'ins-kind'}>
                                {POWER_KIND_LABEL[k.kind]}
                              </span>
                              <span className="ins-kind-who">{joinNames(k.names)}</span>
                            </p>
                            <p className="ins-panel-foot">{riskKindFix(k.kind)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Panel>
                </div>
                <div onMouseEnter={() => setLifted('underused')} onMouseLeave={() => setLifted(null)}>
                  <Panel
                    title={QUADRANT_NAME.underused}
                    sub={QUADRANT_GLOSS.underused}
                    accent={QUADRANT_COLOR.underused}
                  >
                    <QuadrantList
                      colorOf={fillOfFunc}
                      entries={lists.underused.slice(0, 5)}
                      fill={QUADRANT_COLOR.underused}
                      activeNo={activeNo}
                      nameOf={nameOf}
                      funcOf={funcOf}
                      personProps={personProps}
                    />
                  </Panel>
                </div>
              </>
            }
            band={
              <DetailTable<QuadrantRow>
                rows={divergenceRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: `${funcOf(r.no)} · ${QUADRANT_NAME[r.quadrant]}`,
                  rows: [
                    ['Trust ties received', String(r.trustCount)],
                    ['Power ties received', String(r.powerCount)],
                    ['Enabling · controlling', `${r.enablingCount} · ${r.controllingCount}`],
                  ],
                })}
                empty="Nobody to place yet."
                columns={[
                  nameCol<QuadrantRow>(),
                  funcCol<QuadrantRow>(),
                  {
                    key: 'trust',
                    head: 'Trust',
                    note: r0Note(points),
                    right: true,
                    width: 86,
                    sort: (a, b) => a.trust - b.trust,
                    cell: (r) => (r.normalised ? r.trust.toFixed(2) : r.trustCount),
                  },
                  {
                    key: 'power',
                    head: 'Power',
                    note: r0Note(points),
                    right: true,
                    width: 104,
                    sort: (a, b) => a.power - b.power,
                    cell: (r) => (r.normalised ? r.power.toFixed(2) : r.powerCount),
                  },
                  {
                    key: 'quadrant',
                    head: 'Quadrant',
                    width: 210,
                    sort: (a, b) => QUADRANT_NAME[a.quadrant].localeCompare(QUADRANT_NAME[b.quadrant]),
                    cell: (r) => (
                      <span className="ins-quadtag" style={{ color: QUADRANT_COLOR[r.quadrant] }}>
                        <i style={{ background: QUADRANT_COLOR[r.quadrant] }} aria-hidden="true" />
                        {QUADRANT_NAME[r.quadrant]}
                      </span>
                    ),
                  },
                  {
                    // The guide reads the Risk Zone by kind of power, because
                    // the fix for a gatekeeper is not the fix for an expert
                    // nobody warms to. Shown for everyone: the same split is
                    // worth knowing about an Anchor too.
                    key: 'kind',
                    head: 'Kind of power',
                    note: 'which half carries them',
                    width: 190,
                    sort: (a, b) =>
                      (riskKindOf(a) ? POWER_KIND_LABEL[riskKindOf(a)!] : '').localeCompare(
                        riskKindOf(b) ? POWER_KIND_LABEL[riskKindOf(b)!] : '',
                      ),
                    cell: (r) => {
                      const kind = riskKindOf(r);
                      if (kind === null) return <span className="ins-muted">—</span>;
                      return (
                        <span className={kind === 'bottleneck' ? 'ins-kind is-control' : 'ins-kind'}>
                          {POWER_KIND_LABEL[kind]}
                        </span>
                      );
                    },
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* ---------------------------------------------------- 3 bridges */}
        {tab === 'bridges' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.bridges!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Everyone who sits between others"
            bandNote={`${allBridges.length} of ${nodes.length} people`}
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={trustEdges}
                sizeOf={radiusBridge}
                colorOf={fillOfFunc}
                fadeOf={fadeExcept(bridgeSet, 0.5)}
                edgeFadeOf={(e) =>
                  bridgeSet.has(e.from) || bridgeSet.has(e.to) ? 0.55 : 0.08
                }
                decorate={(no) => (bridgeTop3.has(no) ? { rings: [STRUCT_ACCENT] } : null)}
                labelFor={namesFor(bridgeLabels)}
                denseLabels={allNames}
                callouts={bridgeCallouts}
                margin={CALLOUT_MARGIN}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="The trust network, sized by betweenness, with its top three bridges named in the margin"
              />
            }
            legend={
              <div className="ins-legend-row">
                <RingKey color={STRUCT_ACCENT}>Named in the margin</RingKey>
                <span className="ins-legend-note">Node size: betweenness</span>
              </div>
            }
            sidebar={
              <>
                <Finding
                  text={null}
                  caption="Losing a bridge fragments the team more than losing a star — relevant to succession and retention."
                />
                <Panel title="Most between" sub="Normalised betweenness">
                  {bridges.length === 0 ? (
                    <p className="hint">
                      No one sits between others under the trust lens — this group has no bridges to
                      lose.
                    </p>
                  ) : (
                    bridges.map((b) => (
                      <BarRow
                        key={b.no}
                        name={nameOf(b.no)}
                        avatar={fillOfFunc(b.no)}
                        meta={funcOf(b.no)}
                        value={b.score.toFixed(2)}
                        share={b.share}
                        fill={STRUCT_ACCENT}
                        active={activeNo === b.no}
                        {...personProps(b.no, () => ({
                          title: nameOf(b.no),
                          sub: funcOf(b.no),
                          rows: [
                            ['Betweenness', b.score.toFixed(2)],
                            ['Of the top bridge', `${Math.round(b.share * 100)}%`],
                          ],
                        }))}
                      />
                    ))
                  )}
                </Panel>
              </>
            }
            band={
              <DetailTable<{ no: number; score: number; share: number }>
                rows={allBridges}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: funcOf(r.no),
                  rows: [['Betweenness', r.score.toFixed(3)]],
                })}
                empty="Nobody sits between anybody here — every tie is direct."
                columns={[
                  nameCol<{ no: number; score: number; share: number }>(),
                  funcCol<{ no: number; score: number; share: number }>(),
                  {
                    key: 'score',
                    head: 'Betweenness',
                    right: true,
                    width: 128,
                    sort: (a, b) => a.score - b.score,
                    cell: (r) => r.score.toFixed(3),
                    bar: (r) => r.share,
                    barColor: STRUCT_ACCENT,
                  },
                  {
                    key: 'share',
                    head: 'Of the top bridge',
                    right: true,
                    width: 152,
                    sort: (a, b) => a.share - b.share,
                    cell: (r) => `${Math.round(r.share * 100)}%`,
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* --------------------------------------------------- 4 isolates */}
        {/* ------------------------------------------------ head to head */}
        {tab === 'pair' ? (
          <Workspace
            id={tab}
            plain
            title={compareNos.length > 2 ? 'Shortlist' : TAB_TITLE.pair!}
            question={
              compareNos.length > 2
                ? `${compareNos.length} people, measure by measure`
                : tabDef.question
            }
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={personCard}
            finding={findings[tab] ?? null}
            sidebar={
              <>
                <Finding text={null} />
                {compareNos.map((no) => (
                  <Panel key={no} title={nameOf(no)} sub={funcOf(no)} accent={fillOfFunc(no)}>
                    <ul className="h2h-notes">
                      {hrNotes(no).map((n, i) => (
                        <li key={i} className={`h2h-note is-${n.tone}`}>
                          {n.text}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ))}
                <Panel title="How to read it" accent={STRUCT_ACCENT}>
                  <p className="hint">
                    A row is marked only where leading means something. Bridge score, trust given
                    and coverage describe the group&rsquo;s shape and who answered, not who is
                    better, so they carry no mark.
                  </p>
                </Panel>
              </>
            }
            bandTitle="Everyone, on the same measures"
            bandNote={
              picked.size >= 2
                ? `${picked.size} ticked · comparing them above`
                : `${metricRows.length} people · tick two or more to compare`
            }
            band={
              <>
                <div className="ins-band-tools">
                  <input
                    className="control control-sm"
                    placeholder="Search everyone by name or function…"
                    value={rowQuery}
                    onChange={(e) => setRowQuery(e.target.value)}
                    aria-label="Search the roster"
                  />
                  {picked.size > 0 ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                      Clear {picked.size} ticked
                    </button>
                  ) : null}
                </div>
                <DetailTable
                rows={visibleMetricRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                empty="Nobody to measure yet."
                wide
                columns={[
                  {
                    key: 'pick',
                    head: '',
                    width: 34,
                    cell: (r) => (
                      <input
                        type="checkbox"
                        checked={picked.has(r.no)}
                        onChange={() => togglePicked(r.no)}
                        aria-label={`Compare ${r.name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ),
                  },
                  {
                    key: 'name',
                    head: 'Person',
                    cell: (r) => r.name,
                    sort: (a, b) => a.name.localeCompare(b.name),
                    width: 150,
                  },
                  {
                    key: 'func',
                    head: 'Function',
                    cell: (r) => r.func,
                    sort: (a, b) => a.func.localeCompare(b.func),
                    width: 110,
                  },
                  ...(metricRows[0]?.cells ?? []).map((c, i) => ({
                    key: c.key,
                    head: c.short,
                    cell: (r: (typeof metricRows)[number]) => r.cells[i]?.text ?? '—',
                    sort: (x: (typeof metricRows)[number], y: (typeof metricRows)[number]) =>
                      (x.cells[i]?.value ?? -1) - (y.cells[i]?.value ?? -1),
                    width: 104,
                  })),
                ]}
                />
              </>
            }
            centre={
              pair.a === null || pair.b === null ? (
                <p className="hint">This cohort needs two people before anything can be compared.</p>
              ) : (
                <div className="h2h-stage">
                  {picked.size >= 2 ? (
                    <p className="h2h-picked">
                      Comparing {picked.size} people ticked below.{' '}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                        Clear the selection
                      </button>
                    </p>
                  ) : null}
                  <div className={`h2h-pickers${picked.size >= 2 ? ' is-hidden' : ''}`}>
                    <PersonSearch
                      people={searchPeople.filter((p) => p.no !== pair.b)}
                      placeholder={`Left — ${nameOf(pair.a)}`}
                      onPick={(no) => setPairA(no)}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm h2h-swap"
                      onClick={() => {
                        setPairA(pair.b);
                        setPairB(pair.a);
                      }}
                      title="Swap sides"
                    >
                      Swap
                    </button>
                    <PersonSearch
                      people={searchPeople.filter((p) => p.no !== pair.a)}
                      placeholder={`Right — ${nameOf(pair.b)}`}
                      onPick={(no) => setPairB(no)}
                    />
                  </div>
                  <HeadToHead
                    sides={compareNos.map((no) => ({
                      no,
                      name: nameOf(no),
                      func: funcOf(no),
                      color: fillOfFunc(no),
                    }))}
                    metrics={pairMetrics}
                    onPick={setFocusNo}
                  />
                  <figure className="h2h-map">
                    <InsightGraph
                      nodes={nodes}
                      positions={seats}
                      dock={dock}
                      sizeScale={sizeScale}
                      lanes={lanes}
                      /* Not isolated: when the two are hubs their neighbourhood
                         is most of the group, so cutting to it buys nothing.
                         The ties that touch them carry instead, and they are
                         ringed and named. */
                      decorate={compareDecor}
                      box={stageBox}
                      edges={trustEdges}
                      edgeColor={TRUST_TIE}
                      edgeLabel="Trust"
                      overlay={powerOverlay}
                      edgeFadeOf={pairFade}
                      directed
                      sizeOf={radiusTrust}
                      colorOf={fillOfFunc}
                      labelFor={compareSet}
                      activeNo={focusNo}
                      isolate={isolate}
                      onPick={pick}
                      onHover={onMapHover}
                      onLeave={onMapLeave}
                      label="The people being compared and everyone they are tied to"
                    />
                    <figcaption>
                      Ringed: {compareNos.length === 2 ? 'the two' : `the ${compareNos.length}`} being
                      compared. Their ties are drawn in full — green trust, orange power over — and
                      the rest of the group is left faint behind them.
                    </figcaption>
                  </figure>
                </div>
              )
            }
          />
        ) : null}

        {tab === 'isolates' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.isolates!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="At the edge of both lenses"
            bandNote={`${periphery.members.length} of ${nodes.length} people`}
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={trustEdges}
                sizeOf={radiusTrust}
                colorOf={fillOfFunc}
                fadeOf={fadeExcept(peripheralSet, 0.25)}
                edgeFadeOf={FADE.bridges}
                decorate={(no) => (isolateSet.has(no) ? { warn: FLAG_COLOR } : null)}
                labelFor={namesFor(peripheralSet)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="The trust network with its peripheral members at full colour and everyone else pushed back"
              />
            }
            legend={
              <div className="ins-legend-row">
                <RingKey color={FLAG_COLOR}>No ties at all</RingKey>
                <span className="ins-legend-note">Everyone else is faded, never hidden</span>
              </div>
            }
            sidebar={
              <>
                <Finding
                  text={null}
                  caption="A newer hire or a support function can sit here by role; anyone else may be an inclusion problem worth a conversation."
                />
                {signaturesFound ? (
                  <Panel title="Where collaboration is not happening" sub="Three patterns of absence">
                    {(
                      [
                        ['dominating', 'Depended on, not trusted', 'Top third on power-over, bottom half on trust, and colleagues asking for more.'],
                        ['unreliable', 'Quietly unreliable', 'Low on time, on keeping their word and on ease. A trust problem, not a power one.'],
                        ['disconnected', 'Outside the network', 'Too few had a basis to judge. Connect, do not correct.'],
                      ] as const
                    ).map(([kind, title, note]) =>
                      signaturesFound[kind].length === 0 ? null : (
                        <div key={kind} className="ins-signature">
                          <b>{title}</b>
                          <span>{note}</span>
                          <div className="insights-rows">
                            {signaturesFound[kind].slice(0, 6).map((m) => (
                              <button
                                key={m.memberNo}
                                type="button"
                                className={`insights-row is-tappable is-stack${activeNo === m.memberNo ? ' is-active' : ''}`}
                                {...personProps(m.memberNo, () => ({
                                  title: m.name,
                                  sub: m.func,
                                  rows: [['Why', m.why]],
                                }))}
                              >
                                <span className="insights-row-name">{m.name}</span>
                                <span className="insights-row-meta">{m.why}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </Panel>
                ) : null}
                {periphery.members.length === 0 ? (
                  <Panel title="At the edge">
                    <p className="hint">
                      Nobody sits at the edge of both lenses — every rated person carries some
                      standing.
                    </p>
                  </Panel>
                ) : (
                  <Panel title="At the edge" sub="Isolates first, then the bottom band on both lenses">
                    <div className="insights-rows">
                      {periphery.members.map((m) => (
                        <button
                          key={m.no}
                          type="button"
                          className={`insights-row is-tappable is-stack${activeNo === m.no ? ' is-active' : ''}`}
                          {...personProps(m.no, () => ({
                            title: nameOf(m.no),
                            sub: funcOf(m.no),
                            rows: [
                              ['Trust ties received', String(m.trustIn)],
                              ['Power-over ties received', String(m.powerIn)],
                            ],
                          }))}
                        >
                          <span className="insights-row-name">{nameOf(m.no)}</span>
                          <span className="insights-row-meta">{funcOf(m.no)}</span>
                          {m.kind === 'isolate' ? (
                            <span className="insights-tag is-isolate">no ties at all</span>
                          ) : null}
                          {m.newerHire ? <span className="insights-tag is-tenure">newer hire</span> : null}
                          <span className="insights-row-val">
                            {m.trustIn} trust · {m.powerIn} power
                          </span>
                        </button>
                      ))}
                    </div>
                  </Panel>
                )}
                {periphery.thinlyRated.length > 0 ? (
                  <Panel title="Too thinly rated to call">
                    {/* The floor that removed these people from the reading
                        above, stated where the reading is — a silent exclusion
                        would let the tab be read as a complete list of the
                        group's edge. */}
                    <Suppressed n={net.minRaters} unit="responses">
                      {periphery.thinlyRated.length === 1
                        ? 'One person is'
                        : `${periphery.thinlyRated.length} people are`}{' '}
                      rated by too few colleagues for the group to have said where they sit:{' '}
                      {joinNames(periphery.thinlyRated.map((t) => `${nameOf(t.no)} (${t.coverage})`))}.
                    </Suppressed>
                  </Panel>
                ) : null}
              </>
            }
            band={
              <DetailTable<(typeof periphery.members)[number]>
                rows={periphery.members}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: funcOf(r.no),
                  rows: [
                    ['Trust ties received', String(r.trustIn)],
                    ['Power-over ties received', String(r.powerIn)],
                  ],
                })}
                empty="Nobody sits at the edge of both lenses."
                columns={[
                  nameCol<(typeof periphery.members)[number]>(),
                  funcCol<(typeof periphery.members)[number]>(),
                  {
                    key: 'tenure',
                    head: 'Tenure',
                    width: 130,
                    sort: (a, b) => tenureOf(a.no).localeCompare(tenureOf(b.no)),
                    cell: (r) => (
                      <>
                        {tenureOf(r.no)}
                        {r.newerHire ? <span className="insights-tag is-tenure">newer</span> : null}
                      </>
                    ),
                  },
                  {
                    key: 'trust',
                    head: 'Trust in',
                    right: true,
                    width: 96,
                    sort: (a, b) => a.trustIn - b.trustIn,
                    cell: (r) => r.trustIn,
                    bar: (r) => r.trustIn / colMax.trustIn,
                    barColor: TRUST_ACCENT,
                  },
                  {
                    key: 'power',
                    head: 'Power in',
                    right: true,
                    width: 116,
                    sort: (a, b) => a.powerIn - b.powerIn,
                    cell: (r) => r.powerIn,
                    bar: (r) => r.powerIn / colMax.powerIn,
                    barColor: POWER_ACCENT,
                  },
                  {
                    key: 'coverage',
                    head: 'Rated by',
                    right: true,
                    width: 106,
                    sort: (a, b) => (coverageOf.get(a.no) ?? 0) - (coverageOf.get(b.no) ?? 0),
                    cell: (r) =>
                      coverageOf.has(r.no) ? coverageOf.get(r.no) : <span className="ins-dash">—</span>,
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* ----------------------------------------------- 5 one-way trust */}
        {tab === 'oneway' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.oneway!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTall
            bandTitle="The whole grid"
            bandNote={
              matrix.capped
                ? `The ${matrix.limit} people with the most one-way ties, of ${matrix.total}`
                : 'Rows give trust, columns receive it'
            }
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={oneWayEdges}
                sizeOf={radiusTrust}
                colorOf={fillOfFunc}
                fadeOf={fadeExcept(oneWayFolk, 0.18)}
                edgeFadeOf={FADE.facets}
                labelFor={namesFor(oneWayFolk)}
                denseLabels={allNames}
                directed
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="Only the trust ties that run one way, drawn as arrows from the giver to the person who did not return it"
              />
            }
            legend={
              <div className="ins-legend-row">
                <span className="ins-legend-note">
                  Every arrow is a reach that was not returned. Everything else is ghosted.
                </span>
              </div>
            }
            sidebar={
              <>
                <Finding
                  text={null}
                  caption="A trusts B; B does not say the same. One-way ties often predict friction before it surfaces."
                />
                <Panel
                  title="Widest one-way ties"
                  sub={
                    oneWayAll.length > oneWay.length
                      ? `The ${oneWay.length} widest of ${oneWayAll.length} — the grid below draws them all`
                      : undefined
                  }
                >
                  {oneWayShown.length === 0 ? (
                    <p className="hint">Every trust tie in this group is returned.</p>
                  ) : (
                    <div className="insights-rows">
                      {oneWayShown.map((t) => {
                        const on = activeNo === t.a || activeNo === t.b;
                        return (
                          <button
                            key={`${t.a}>${t.b}`}
                            type="button"
                            className={`insights-row is-tappable is-oneway${on ? ' is-active' : ''}`}
                            {...personProps(t.a, () => ({
                              title: `${nameOf(t.a)} → ${nameOf(t.b)}`,
                              sub:
                                t.kind === 'not_returned'
                                  ? 'Rated back, but below the tie line'
                                  : 'Never rated back — usually distance or seniority, not rejection',
                              rows: [
                                [`${nameOf(t.a)} on ${nameOf(t.b)}`, t.aToB.toFixed(2)],
                                [`${nameOf(t.b)} back`, t.bToA === null ? 'no rating' : t.bToA.toFixed(2)],
                              ],
                            }))}
                          >
                            <span className="insights-row-name">
                              {nameOf(t.a)} <span className="insights-arrow">→</span> {nameOf(t.b)}
                            </span>
                            <span
                              className={`insights-tag ${t.kind === 'not_returned' ? 'is-cool' : 'is-quiet'}`}
                            >
                              {t.kind === 'not_returned' ? 'not returned' : 'no basis'}
                            </span>
                            <span className="insights-row-val">
                              {t.aToB.toFixed(1)} · {t.bToA === null ? '—' : t.bToA.toFixed(1)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Panel>
              </>
            }
            band={
              <MatrixGrid
                matrix={matrix}
                activeNo={activeNo}
                nameOf={nameOf}
                funcOf={funcOf}
                personProps={personProps}
              />
            }
          />
        ) : null}

        {/* ------------------------------------------------------ 6 silos */}
        {tab === 'silos' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.silos!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle={`Members by ${SILOS_MODE_COLUMN[activeSilosMode].toLowerCase()}`}
            bandNote={`${silosRows.length} people grouped`}
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                box={stageBox}
                edges={trustEdges}
                sizeOf={radiusTrust}
                colorOf={compareOn ? fillOfFunc : clusterColorOf}
                lanes={lanes}
                hulls={compareOn ? undefined : hulls}
                highlight={litDeptSet ?? (silosHover === null ? null : silosMembers.get(silosHover) ?? null)}
                labelFor={namesFor(trustLabels)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="The trust network, coloured and enclosed by the clusters the group actually formed"
              />
            }
            legend={
              <div className="ins-legend-row">
                {clusters.entries.map((c) => (
                  <Key key={c.label} color={c.fill}>
                    {c.label} <b>{c.size}</b>
                  </Key>
                ))}
                {clusters.entries.length === 0 ? (
                  <span className="ins-legend-note">No clusters yet.</span>
                ) : null}
              </div>
            }
            sidebar={
              <>
                <Finding text={null} />
                <Panel
                  title="Cohesion"
                  sub="Point at a row to light that group on the map"
                  action={
                    silosOptions.length > 1 ? (
                      <div className="nx-seg nx-seg-sm" role="tablist" aria-label="Group by">
                        {silosOptions.map((m) => (
                          <button
                            key={m}
                            role="tab"
                            aria-selected={activeSilosMode === m}
                            className={`nx-seg-btn${activeSilosMode === m ? ' is-on' : ''}`}
                            onClick={() => setSilosMode(m)}
                          >
                            {SILOS_MODE_LABEL[m]}
                          </button>
                        ))}
                      </div>
                    ) : null
                  }
                >
                  {silos.length === 0 ? (
                    <p className="hint">
                      {activeSilosMode === 'tenure'
                        ? 'No tenure band has been recorded for this roster.'
                        : activeSilosMode === 'team'
                          ? 'No reporting line has been recorded for this roster.'
                          : 'No function has been recorded for this roster.'}
                    </p>
                  ) : (
                    <table className="insights-table">
                      <thead>
                        <tr>
                          <th>{SILOS_MODE_COLUMN[activeSilosMode]}</th>
                          <th className="ta-right">Size</th>
                          <th className="ta-right">Within</th>
                          <th className="ta-right">Outward</th>
                        </tr>
                      </thead>
                      <tbody onMouseLeave={() => setSilosHover(null)}>
                        {silos.map((s) => {
                          const rowTip = tipProps(() => ({
                            title: silosLabelOf(s.key),
                            sub: s.suppressed
                              ? `${s.size} people — too small to report rates without identifying individuals`
                              : `${s.size} people`,
                            rows: [
                              ['Within', `${s.withinTies} of ${s.withinPossible} possible pairs`],
                              ['Outward', `${s.outTies} of ${s.outPossible} possible pairs`],
                            ],
                          }));
                          return (
                            <tr
                              key={s.key}
                              className={silosHover === s.key ? 'is-on' : undefined}
                              {...rowTip}
                              onMouseEnter={(e) => {
                                setSilosHover(s.key);
                                rowTip.onMouseEnter(e);
                              }}
                            >
                              {/* The column ellipsises a long function name so
                                  the three numeric columns keep their width;
                                  the title carries the name in full. */}
                              <td title={silosLabelOf(s.key)}>{silosLabelOf(s.key)}</td>
                              <td className="ta-right">{s.size}</td>
                              {/* A suppressed group used to print two
                                  em-dashes, which reads as "no ties" rather
                                  than as "withheld". The row now says which. */}
                              {s.suppressed ? (
                                <td colSpan={2} className="insights-cell-suppressed">
                                  Fewer than {SILOS_FLOOR} people — not shown
                                </td>
                              ) : (
                                <>
                                  <td className="ta-right">
                                    {s.withinRate === null ? '—' : `${Math.round(s.withinRate * 100)}%`}
                                  </td>
                                  <td className="ta-right">
                                    {s.outRate === null ? '—' : `${Math.round(s.outRate * 100)}%`}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  <p className="ins-panel-foot">
                    The tinted regions are the clusters the group formed, whatever the org chart says;
                    a cluster of two is listed but not enclosed, because a two-person outline reads as
                    a mistake.
                  </p>
                </Panel>
              </>
            }
            band={
              <DetailTable<SilosMemberRow>
                rows={silosRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: silosLabelOf(r.group),
                  rows: [
                    ['Ties inside the group', String(r.withinTies)],
                    ['Ties outside it', String(r.outTies)],
                  ],
                })}
                empty="Nobody on this roster carries the grouping this table needs."
                columns={[
                  nameCol<SilosMemberRow>(),
                  {
                    key: 'group',
                    head: SILOS_MODE_COLUMN[activeSilosMode],
                    width: 210,
                    sort: (a, b) => silosLabelOf(a.group).localeCompare(silosLabelOf(b.group)),
                    cell: (r) => silosLabelOf(r.group),
                  },
                  {
                    key: 'within',
                    head: 'Within-group ties',
                    right: true,
                    width: 152,
                    sort: (a, b) => a.withinTies - b.withinTies,
                    cell: (r) => r.withinTies,
                    bar: (r) => r.withinTies / colMax.within,
                    barColor: TRUST_ACCENT,
                  },
                  {
                    key: 'out',
                    head: 'Ties outside',
                    right: true,
                    width: 128,
                    sort: (a, b) => a.outTies - b.outTies,
                    cell: (r) => r.outTies,
                    bar: (r) => r.outTies / colMax.within,
                    barColor: STRUCT_ACCENT,
                  },
                  {
                    key: 'mix',
                    head: 'Outward share',
                    right: true,
                    width: 134,
                    sort: (a, b) => outwardShare(a) - outwardShare(b),
                    cell: (r) =>
                      r.withinTies + r.outTies === 0 ? (
                        <span className="ins-dash">—</span>
                      ) : (
                        `${Math.round(outwardShare(r) * 100)}%`
                      ),
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* ----------------------------------------------------- 7 spread */}
        {tab === 'spread' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.spread!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Share of every tie received"
            bandNote={
              trustShares.halfCount > 0
                ? `${trustShares.halfCount} of ${nodes.length} people hold half the trust ties`
                : 'No trust ties received yet'
            }
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={trustEdges}
                sizeOf={radiusTrust}
                colorOf={fillOfFunc}
                hulls={compareOn ? undefined : hubHull}
                fadeOf={(no) => (hubs.has(no) ? 1 : (trustIn.get(no) ?? 0) > 0 ? 0.78 : 0.42)}
                decorate={(no) => (hubs.has(no) ? { rings: [STRUCT_ACCENT] } : null)}
                labelFor={namesFor(hubs)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={onMapHover}
                onLeave={onMapLeave}
                label="The trust network sized by ties received, with the top tenth of the group ringed"
              />
            }
            legend={
              <div className="ins-legend-row">
                <RingKey color={STRUCT_ACCENT}>The few hands — top tenth</RingKey>
                <span className="ins-legend-note">Faded: nobody has chosen them yet</span>
              </div>
            }
            sidebar={
              <>
                <Finding text={null} />
                {spread.map((l) => (
                  <Panel key={l.key} title={l.name} accent={l.color}>
                    <div className="insights-meter-bars">
                      <div
                        {...tipProps(() => ({
                          title: `${l.name} density`,
                          sub: 'Of the pairs rated under this lens, the share that reached the tie line',
                          rows: [['Ties', `${l.density.ties} of ${l.density.ratedPairs} rated pairs`]],
                        }))}
                      >
                        <MeterLine
                          label="Density"
                          value={l.density.density}
                          color={l.color}
                          note={`${l.density.ties} of ${l.density.ratedPairs} rated pairs`}
                        />
                      </div>
                      <div
                        {...tipProps(() => ({
                          title: `${l.name} concentration`,
                          sub: '0 = everyone equally chosen, 1 = one person holds every tie',
                          rows: [
                            ['Reading', concentrationReading(l.concentration) ?? 'not scored for this lens yet'],
                          ],
                        }))}
                      >
                        <MeterLine
                          label="Concentration"
                          value={l.concentration}
                          color={l.color}
                          note={concentrationReading(l.concentration) ?? 'not scored for this lens yet'}
                        />
                      </div>
                    </div>
                    {l.key === COVERT_LENS ? <p className="ins-panel-foot">{covertVerdict}</p> : null}
                  </Panel>
                ))}
                <Panel
                  title="Who holds hidden power"
                  sub="Put over the line on shaping issues before they reach the room"
                  accent={COVERT_ACCENT}
                >
                  <RankList
                    coverageOf={coverageOf}
                    colorOf={fillOfFunc}
                    entries={covertHolders.slice(0, 8)}
                    bold={covertHalf}
                    fill={COVERT_ACCENT}
                    activeNo={activeNo}
                    nameOf={nameOf}
                    funcOf={funcOf}
                    unit="hidden-power ties received"
                    personProps={personProps}
                  />
                  <p className="ins-panel-foot">Ranked by share of the colleagues who rated them, so a small team can rank as high as a large one.</p>
                  {covertShares.halfCount > 0 ? (
                    <p className="ins-panel-foot">
                      Names in bold hold half of all hidden-power ties
                      {covertHolders.length > 8 ? ` · ${covertHolders.length} holders in all` : ''}.
                    </p>
                  ) : null}
                </Panel>
                <Panel title="How few hold half">
                  <p className="ins-panel-body">
                    {halfSentence('trust', trustShares, nodes.length)}{' '}
                    {halfSentence('power-over', powerShares, nodes.length)}
                  </p>
                </Panel>
              </>
            }
            band={
              <DetailTable<{ trust: ShareRow; power: ShareRow | null }>
                rows={spreadShares}
                rowKey={(r) => r.trust.no}
                personNo={(r) => r.trust.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.trust.no),
                  sub: funcOf(r.trust.no),
                  rows: [
                    ['Trust ties received', String(r.trust.count)],
                    ['Share of all trust ties', `${(r.trust.share * 100).toFixed(1)}%`],
                    ['Running total', `${Math.round(r.trust.cumulative * 100)}%`],
                  ],
                })}
                empty="No ties have been received yet."
                columns={[
                  {
                    key: 'name',
                    head: 'Name',
                    sort: (a, b) => nameOf(a.trust.no).localeCompare(nameOf(b.trust.no)),
                    cell: (r) => <span className="ins-grid-name">{nameOf(r.trust.no)}</span>,
                  },
                  {
                    key: 'func',
                    head: 'Function',
                    width: 160,
                    sort: (a, b) => funcOf(a.trust.no).localeCompare(funcOf(b.trust.no)),
                    cell: (r) => funcOf(r.trust.no),
                  },
                  {
                    key: 'trust',
                    head: 'Trust share',
                    right: true,
                    width: 118,
                    sort: (a, b) => a.trust.share - b.trust.share,
                    cell: (r) => `${(r.trust.share * 100).toFixed(1)}%`,
                    bar: (r) => r.trust.share / colMax.share,
                    barColor: TRUST_ACCENT,
                  },
                  {
                    key: 'cum',
                    head: 'Running total',
                    note: 'trust',
                    right: true,
                    width: 138,
                    sort: (a, b) => a.trust.cumulative - b.trust.cumulative,
                    cell: (r) => (
                      <span className={r.trust.cumulative <= 0.5 && r.trust.count > 0 ? 'ins-half' : undefined}>
                        {Math.round(r.trust.cumulative * 100)}%
                      </span>
                    ),
                  },
                  {
                    key: 'power',
                    head: 'Power share',
                    right: true,
                    width: 124,
                    bar: (r) => (r.power ? r.power.share / colMax.share : null),
                    barColor: POWER_ACCENT,
                    sort: (a, b) => (a.power?.share ?? 0) - (b.power?.share ?? 0),
                    cell: (r) =>
                      r.power === null ? <span className="ins-dash">—</span> : `${(r.power.share * 100).toFixed(1)}%`,
                  },
                ]}
              />
            }
          />
        ) : null}

        {/* --------------------------------------------- 8 trust vs power */}
        {tab === 'compare' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.compare!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Both standings, per person"
            bandNote={
              standingsView === 'shares'
                ? 'Share of the colleagues who rated them'
                : 'Every rating received, added up · average beneath'
            }
            bandActions={
              <div className="nx-seg nx-seg-sm" role="tablist" aria-label="Table view">
                {(
                  [
                    ['shares', 'Shares'],
                    ['scores', 'Sums & averages'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={standingsView === k}
                    className={`nx-seg-btn${standingsView === k ? ' is-on' : ''}`}
                    onClick={() => setStandingsView(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={trustEdges}
                edgeColor={TRUST_TIE}
                edgeLabel="Trust"
                edgeFadeOf={FADE.divergence}
                sizeOf={radiusTrust}
                colorOf={(no) => divergenceColor(gapOf.get(no) ?? null)}
                // Grey was carrying two different findings: "their two
                // standings agree" and "nobody rated them at all". The second
                // is not a position on the scale, so it is drawn off it.
                hollowOf={(no) => (gapOf.get(no) ?? null) === null}
                labelFor={namesFor(divergentFolk)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={(no, e) => {
                  setHoverNo(no);
                  const row = shareOf.get(no);
                  tip.show(
                    {
                      title: nameOf(no),
                      sub: `${funcOf(no)} · ${divergenceWordFor(row?.gap ?? null)}`,
                      rows: [
                        ['Relied on', row?.trust === null || row === undefined ? '—' : `${Math.round(row.trust * 100)}% of raters`],
                        ['Deferred to', row?.power === null || row === undefined ? '—' : `${Math.round(row.power * 100)}% of raters`],
                      ],
                    },
                    e,
                  );
                }}
                onLeave={onMapLeave}
                label="Every member on the trust network, coloured by how far their two standings differ"
              />
            }
            legend={
              <div className="ins-legend-row">
                <Key color={divergenceColor(-0.5)}>Relied on, little say</Key>
                <Key color={divergenceColor(null)}>The two agree</Key>
                <Key color={divergenceColor(0.5)}>Deferred to, less relied on</Key>
                <HollowKey color={divergenceColor(null)}>Nobody rated them</HollowKey>
                <span className="ins-legend-note">Ties: trust · node size: trust ties received</span>
              </div>
            }
            sidebar={
              <>
                <Finding text={null} />
                <Panel title="Furthest apart" sub="Widest gap between the two standings">
                  {divergentRows.length === 0 ? (
                    <p className="hint">
                      Nobody&rsquo;s two standings differ by more than {Math.round(DIVERGENCE_FLOOR * 100)}
                      {' '}points — the group trusts the people it lets decide.
                    </p>
                  ) : (
                    <div className="insights-rows">
                      {divergentRows.slice(0, 8).map((d) => (
                        <button
                          key={d.no}
                          type="button"
                          className={`insights-row is-tappable is-stack${activeNo === d.no ? ' is-active' : ''}`}
                          {...personProps(d.no, () => ({
                            title: nameOf(d.no),
                            sub: funcOf(d.no),
                            rows: [
                              ['Relied on', `${Math.round((d.trust ?? 0) * 100)}%`],
                              ['Deferred to', `${Math.round((d.power ?? 0) * 100)}%`],
                            ],
                          }))}
                        >
                          <span className="insights-row-name">{nameOf(d.no)}</span>
                          <span className="insights-row-meta">{divergenceWordFor(d.gap)}</span>
                          <span className="insights-row-val" style={{ color: divergenceColor(d.gap) }}>
                            {d.gap! > 0 ? '+' : ''}
                            {Math.round(d.gap! * 100)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
                <Panel title="Reading the map">
                  <p className="ins-panel-foot">
                    Both standings are a share of the colleagues who actually rated that person, so
                    somebody judged by four is comparable with somebody judged by forty. A gap under
                    {' '}{Math.round(DIVERGENCE_FLOOR * 100)} points is drawn as level: in a group this
                    size it is one rater changing their mind, not a finding.
                  </p>
                </Panel>
              </>
            }
            band={
              standingsView === 'scores' ? (
                <ScoresTable
                  rows={scoreRows}
                  activeNo={activeNo}
                  personProps={personProps}
                  showAll={capturing}
                  nameOf={nameOf}
                  funcOf={funcOf}
                />
              ) : (
              <DetailTable<DivergenceShare>
                rows={shareRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                empty="Nobody is on the roster yet."
                columns={[
                  {
                    key: 'name',
                    head: 'Person',
                    width: 170,
                    sort: (a, b) => nameOf(a.no).localeCompare(nameOf(b.no)),
                    cell: (r) => nameOf(r.no),
                  },
                  {
                    key: 'func',
                    head: 'Function',
                    width: 130,
                    sort: (a, b) => funcOf(a.no).localeCompare(funcOf(b.no)),
                    cell: (r) => funcOf(r.no),
                  },
                  {
                    key: 'trust',
                    head: 'Relied on',
                    note: 'share of raters',
                    right: true,
                    width: 128,
                    sort: (a, b) => (b.trust ?? -1) - (a.trust ?? -1),
                    cell: (r) => (r.trust === null ? <span className="ins-dash">—</span> : `${Math.round(r.trust * 100)}%`),
                  },
                  {
                    key: 'power',
                    head: 'Deferred to',
                    note: 'share of raters',
                    right: true,
                    width: 128,
                    sort: (a, b) => (b.power ?? -1) - (a.power ?? -1),
                    cell: (r) => (r.power === null ? <span className="ins-dash">—</span> : `${Math.round(r.power * 100)}%`),
                  },
                  {
                    key: 'gap',
                    head: 'Apart',
                    note: 'points',
                    right: true,
                    width: 104,
                    sort: (a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0),
                    cell: (r) =>
                      r.gap === null || Math.abs(r.gap) < DIVERGENCE_FLOOR ? (
                        <span className="ins-dash">level</span>
                      ) : (
                        <span style={{ color: divergenceColor(r.gap), fontWeight: 650 }}>
                          {r.gap > 0 ? '+' : ''}
                          {Math.round(r.gap * 100)}
                        </span>
                      ),
                  },
                ]}
              />
              )
            }
          />
        ) : null}

        {/* ------------------------------------------------ 9 reliability */}
        {tab === 'facets' ? (
          <Workspace
            id={tab}
            title={TAB_TITLE.facets!}
            question={tabDef.question}
            onExport={exportStage}
            isFull={!!isFull}
            onToggleFull={onToggleFull}
            lead={
              <>
                {compareOn && deptRows.length > 0 ? (
                  <DeptCompare
                    rows={deptRows}
                    crossTies={crossTies}
                    active={litDept}
                    onPick={(k) => setLitDept((cur) => (cur === k ? null : k))}
                  />
                ) : null}
                {personCard}
              </>
            }
            finding={findings[tab] ?? null}
            bandTitle="Both facets, per person"
            bandNote="Widest gap first"
            centre={
              <InsightGraph
                nodes={nodes}
                positions={seats}
                dock={dock}
                sizeScale={sizeScale}
                lanes={lanes}
                highlight={litDeptSet}
                box={stageBox}
                edges={facetEdges}
                sizeOf={radiusFacet}
                colorOf={fillOfFunc}
                labelFor={namesFor(facetLabels)}
                denseLabels={allNames}
                activeNo={focusNo}
                isolate={isolate}
                onPick={pick}
                onHover={(no, e) => {
                  setHoverNo(no);
                  tip.show(
                    {
                      title: nameOf(no),
                      sub: funcOf(no),
                      rows: [
                        [
                          facetLens === 'reliability'
                            ? 'Delivers as promised — ties received'
                            : 'Safe to be open — ties received',
                          String(facetIn.get(no) ?? 0),
                        ],
                      ],
                    },
                    e,
                  );
                }}
                onLeave={onMapLeave}
                label={
                  facetLens === 'reliability'
                    ? 'The network of "delivers as promised" ties'
                    : 'The network of "safe to be open" ties'
                }
              />
            }
            centreAside={
              <div className="nx-seg nx-seg-sm ins-lens-seg" role="tablist" aria-label="Edge lens">
                {(['reliability', 'openness'] as const).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={facetLens === f}
                    className={`nx-seg-btn${facetLens === f ? ' is-on' : ''}`}
                    onClick={() => setFacetLens(f)}
                  >
                    {f === 'reliability' ? 'Delivers as promised' : 'Safe to be open'}
                  </button>
                ))}
              </div>
            }
            sidebar={
              <>
                <Finding
                  text={null}
                  caption="The two facets need different interventions: openness is a psychological-safety conversation, reliability is an accountability one."
                />
                {relDensity.density === null && openDensity.density === null ? (
                  <Panel title="The two facets">
                    <p className="hint">Not enough rated pairs under these two lenses yet.</p>
                  </Panel>
                ) : (
                  <Panel title="The two facets" sub="Density over the pairs each was rated on">
                    <div className="ins-facets">
                      <div
                        {...tipProps(() => ({
                          title: 'Delivers as promised',
                          sub: 'The reliability item, read as its own lens',
                          rows: [['Ties', `${relDensity.ties} of ${relDensity.ratedPairs} rated pairs`]],
                        }))}
                      >
                        <FacetBar label="Delivers as promised" stat={relDensity} color="#0F7A63" />
                      </div>
                      <div
                        {...tipProps(() => ({
                          title: 'Safe to be open',
                          sub: 'The openness item, read as its own lens',
                          rows: [['Ties', `${openDensity.ties} of ${openDensity.ratedPairs} rated pairs`]],
                        }))}
                      >
                        <FacetBar label="Safe to be open" stat={openDensity} color="#3FA08A" />
                      </div>
                    </div>
                  </Panel>
                )}
                <Panel title="Widest gaps" sub="Signed: the direction is the conversation">
                  {facetRows.filter((r) => r.gap !== 0).length === 0 ? (
                    <p className="hint">Nobody is read differently on the two facets.</p>
                  ) : (
                    facetRows
                      .filter((r) => r.gap !== 0)
                      .slice(0, 5)
                      .map((r) => (
                        <BarRow
                          key={r.no}
                          name={nameOf(r.no)}
                          avatar={fillOfFunc(r.no)}
                          meta={r.gap > 0 ? 'Depended on, less confided in' : 'Confided in, less depended on'}
                          value={`${r.gap > 0 ? '+' : ''}${r.gap}`}
                          share={Math.abs(r.gap) / Math.max(1, Math.abs(facetRows[0]?.gap ?? 1))}
                          fill={r.gap > 0 ? '#0F7A63' : '#3FA08A'}
                          active={activeNo === r.no}
                          {...personProps(r.no, () => ({
                            title: nameOf(r.no),
                            sub: funcOf(r.no),
                            rows: [
                              ['Delivers as promised', String(r.reliabilityIn)],
                              ['Safe to be open', String(r.opennessIn)],
                            ],
                          }))}
                        />
                      ))
                  )}
                </Panel>
              </>
            }
            band={
              <DetailTable<FacetRow>
                rows={facetRows}
                rowKey={(r) => r.no}
                personNo={(r) => r.no}
                activeNo={activeNo}
                personProps={personProps}
                showAll={capturing}
                tip={(r) => ({
                  title: nameOf(r.no),
                  sub: funcOf(r.no),
                  rows: [
                    ['Delivers as promised', String(r.reliabilityIn)],
                    ['Safe to be open', String(r.opennessIn)],
                  ],
                })}
                empty="Nobody is on the roster yet."
                columns={[
                  nameCol<FacetRow>(),
                  funcCol<FacetRow>(),
                  {
                    key: 'rel',
                    head: 'Delivers',
                    note: 'ties in',
                    right: true,
                    width: 110,
                    sort: (a, b) => a.reliabilityIn - b.reliabilityIn,
                    cell: (r) => r.reliabilityIn,
                    bar: (r) => r.reliabilityIn / colMax.facet,
                    barColor: '#0F7A63',
                  },
                  {
                    key: 'open',
                    head: 'Safe to be open',
                    note: 'ties in',
                    right: true,
                    width: 150,
                    sort: (a, b) => a.opennessIn - b.opennessIn,
                    cell: (r) => r.opennessIn,
                    bar: (r) => r.opennessIn / colMax.facet,
                    barColor: '#3FA08A',
                  },
                  {
                    key: 'gap',
                    head: 'Gap',
                    right: true,
                    width: 96,
                    sort: (a, b) => Math.abs(a.gap) - Math.abs(b.gap),
                    cell: (r) =>
                      r.gap === 0 ? (
                        <span className="ins-dash">level</span>
                      ) : (
                        <span className="ins-delta">{r.gap > 0 ? `+${r.gap}` : r.gap}</span>
                      ),
                  },
                ]}
              />
            }
          />
        ) : null}
      </div>
      </div>

      {tip.layer}
    </div>
  );
}

// ------------------------------------------------------------ the two panes


// ------------------------------------------------------------- small lists

/**
 * Why this person is on the list, not merely that they are: the count against
 * the colleagues who actually rated them. Sixteen ties from twenty raters and
 * sixteen from fifty are not the same standing, and the bare count hides it.
 */
function shareText(
  no: number,
  count: number,
  coverageOf?: ReadonlyMap<number, number>,
): string {
  const raters = coverageOf?.get(no) ?? 0;
  return raters > 0 ? `${Math.round((count / raters) * 100)}% of ${raters}` : '—';
}

function shareMeta(
  no: number,
  count: number,
  funcOf: (no: number) => string,
  coverageOf?: ReadonlyMap<number, number>,
): string {
  const raters = coverageOf?.get(no) ?? 0;
  const f = funcOf(no);
  return raters > 0 ? `${f} · ${Math.round((count / raters) * 100)}% of ${raters} raters` : f;
}

/**
 * Guide §5.1 in its own terms: the ratings each person received, added up —
 * per block first (the scores the guide names), then statement by statement —
 * with the average under every sum. Averages equal the sums over the ratings
 * behind them, which is also what the map's block means are.
 */
function ScoresTable({
  rows,
  activeNo,
  personProps,
  showAll,
  nameOf,
  funcOf,
}: {
  rows: readonly SocioMemberResult[];
  activeNo: number | null;
  personProps: PersonProps;
  showAll: boolean;
  nameOf: (no: number) => string;
  funcOf: (no: number) => string;
}) {
  const sumCell = (sum: number, count: number, block = false) =>
    count === 0 ? (
      <span className="ins-dash">—</span>
    ) : (
      <span className={`ins-sum${block ? ' is-block' : ''}`}>
        <b>{sum}</b>
        <small>{(sum / count).toFixed(2)}</small>
      </span>
    );
  const blockCol = (key: string, head: string, note: string): Column<SocioMemberResult> => ({
    key: `b-${key}`,
    head,
    note,
    right: true,
    width: 96,
    sort: (a, b) =>
      (b.blocks.find((x) => x.blockKey === key)?.ratingSum ?? -1) -
      (a.blocks.find((x) => x.blockKey === key)?.ratingSum ?? -1),
    cell: (r) => {
      const b = r.blocks.find((x) => x.blockKey === key);
      return b ? sumCell(b.ratingSum ?? 0, b.ratingCount ?? 0, true) : <span className="ins-dash">—</span>;
    },
  });
  const itemCol = (no: number): Column<SocioMemberResult> => {
    const info = SOCIO_ITEMS.find((i) => i.no === no)!;
    return {
      key: `i-${no}`,
      head: `${no}. ${info.short}`,
      note: SOCIO_BLOCKS.find((b) => b.key === info.blockKey)?.short ?? 'Support gap',
      right: true,
      width: 104,
      sort: (a, b) =>
        (b.items.find((x) => x.itemNo === no)?.sum ?? -1) - (a.items.find((x) => x.itemNo === no)?.sum ?? -1),
      cell: (r) => {
        const it = r.items.find((x) => x.itemNo === no);
        return it ? sumCell(it.sum ?? 0, it.n) : <span className="ins-dash">—</span>;
      },
    };
  };
  return (
    <DetailTable<SocioMemberResult>
      rows={rows}
      rowKey={(r) => r.memberNo}
      personNo={(r) => r.memberNo}
      activeNo={activeNo}
      personProps={personProps}
      showAll={showAll}
      wide
      empty="Scores appear once enough colleagues have responded."
      tip={(r) => ({
        title: nameOf(r.memberNo),
        sub: funcOf(r.memberNo),
        rows: [
          ['Rated by', String(r.coverage)],
          ...r.blocks.map(
            (b) =>
              [b.short, b.ratingCount ? `${b.ratingSum} over ${b.ratingCount} ratings · avg ${(b.ratingSum / b.ratingCount).toFixed(2)}` : '—'] as [string, string],
          ),
        ],
      })}
      columns={[
        {
          key: 'name',
          head: 'Person',
          width: 170,
          sort: (a, b) => nameOf(a.memberNo).localeCompare(nameOf(b.memberNo)),
          cell: (r) => nameOf(r.memberNo),
        },
        {
          key: 'func',
          head: 'Function',
          width: 120,
          sort: (a, b) => funcOf(a.memberNo).localeCompare(funcOf(b.memberNo)),
          cell: (r) => funcOf(r.memberNo),
        },
        {
          key: 'cov',
          head: 'Rated by',
          note: 'colleagues',
          right: true,
          width: 84,
          sort: (a, b) => b.coverage - a.coverage,
          cell: (r) => r.coverage,
        },
        blockCol('power_to', 'Power to/with', 'items 1–4'),
        blockCol('power_over', 'Power over', 'items 5–7'),
        blockCol('trust', 'Trust', 'items 8–10'),
        blockCol('ease', 'Ease', 'item 11'),
        ...SOCIO_ITEMS.map((i) => itemCol(i.no)),
      ]}
    />
  );
}

function RankList({
  entries,
  bold,
  fill,
  activeNo,
  nameOf,
  funcOf,
  colorOf,
  unit,
  personProps,
  coverageOf,
}: {
  entries: { no: number; count: number }[];
  bold: ReadonlySet<number>;
  fill: string;
  activeNo: number | null;
  nameOf: (no: number) => string;
  funcOf: (no: number) => string;
  colorOf: (no: number) => string;
  unit: string;
  personProps: PersonProps;
  /** Raters per person, so a count can be said as a share of who judged them. */
  coverageOf?: ReadonlyMap<number, number>;
}) {
  if (entries.length === 0) return <p className="hint">Nobody has reached the tie line here yet.</p>;
  // Not entries[0]: a list ranked by rate can open on a smaller count.
  const max = Math.max(...entries.map((e) => e.count));
  return (
    <>
      {entries.map((e, i) => (
        <BarRow
          key={e.no}
          rank={i + 1}
          avatar={colorOf(e.no)}
          name={nameOf(e.no)}
          meta={shareMeta(e.no, e.count, funcOf, coverageOf)}
          value={String(e.count)}
          share={max > 0 ? e.count / max : 0}
          fill={fill}
          bold={bold.has(e.no)}
          active={activeNo === e.no}
          {...personProps(e.no, () => ({
            title: nameOf(e.no),
            sub: funcOf(e.no),
            rows: [
              [capitalise(unit), String(e.count)],
              ['Of those who rated them', shareText(e.no, e.count, coverageOf)],
            ],
          }))}
        />
      ))}
    </>
  );
}

interface QuadEntry {
  no: number;
  trustCount: number;
  powerCount: number;
  gap: number;
}

function QuadrantList({
  entries,
  fill,
  activeNo,
  nameOf,
  funcOf,
  colorOf,
  personProps,
}: {
  entries: QuadEntry[];
  fill: string;
  activeNo: number | null;
  nameOf: (no: number) => string;
  funcOf: (no: number) => string;
  colorOf: (no: number) => string;
  personProps: PersonProps;
}) {
  if (entries.length === 0) return <p className="hint">Nobody sits in this quadrant.</p>;
  const max = entries[0]!.gap || 1;
  return (
    <>
      {entries.map((e) => (
        <BarRow
          key={e.no}
          avatar={colorOf(e.no)}
          name={nameOf(e.no)}
          meta={funcOf(e.no)}
          value={`${e.trustCount} · ${e.powerCount}`}
          share={e.gap / max}
          fill={fill}
          active={activeNo === e.no}
          {...personProps(e.no, () => ({
            title: nameOf(e.no),
            sub: funcOf(e.no),
            rows: [
              ['Trust ties received', String(e.trustCount)],
              ['Power-over ties received', String(e.powerCount)],
            ],
          }))}
        />
      ))}
    </>
  );
}

// ------------------------------------------------------------ small helpers

function outwardShare(r: SilosMemberRow): number {
  const total = r.withinTies + r.outTies;
  return total === 0 ? 0 : r.outTies / total;
}

/** The unit under a divergence column header — the axes change with coverage. */
function r0Note(points: readonly { normalised: boolean }[]): string {
  return points[0]?.normalised ? 'per rater' : 'ties';
}

function halfSentence(lens: string, t: ConcentrationTable, roster: number): string {
  if (t.total === 0 || t.halfCount === 0) return `No ${lens} ties have been received yet.`;
  const pct = Math.round((t.halfCount / Math.max(1, roster)) * 100);
  return `${t.halfCount} of ${roster} people — ${pct}% of the group — hold half of all ${lens} ties received.`;
}

// ------------------------------------------------------- the finding lines
//
// One sentence per tab, written from the numbers rather than about them. They
// are deliberately flat: the caption under each carries the interpretation, and
// a finding that editorialised twice would be an opinion wearing a bar chart.

function anchorFinding(
  a: { trusted: { no: number; count: number }[]; influential: { no: number; count: number }[]; both: Set<number> },
  nameOf: (no: number) => string,
): string | null {
  const t = a.trusted[0];
  const i = a.influential[0];
  if (!t && !i) return null;
  // The common case worth saying once rather than twice: the same person tops
  // both lists.
  if (t && i && t.no === i.no) {
    return `${nameOf(t.no)} tops both lists — ${t.count} trust ${
      t.count === 1 ? 'tie' : 'ties'
    } received and ${i.count} on power over.`;
  }
  const parts: string[] = [];
  if (t) parts.push(`the group leans on ${nameOf(t.no)} most (${t.count} trust ${t.count === 1 ? 'tie' : 'ties'})`);
  if (i) parts.push(`${nameOf(i.no)} carries the most weight in decisions (${i.count})`);
  const overlap =
    a.both.size > 0
      ? ` ${joinNames([...a.both].map(nameOf))} ${a.both.size === 1 ? 'holds' : 'hold'} both.`
      : ' Nobody holds both.';
  return `${capitalise(parts.join('; '))}.${overlap}`;
}

function divergenceFinding(lists: { watch: unknown[]; underused: unknown[] }): string {
  const w = lists.watch.length;
  const u = lists.underused.length;
  if (w === 0 && u === 0) return 'Trust and power sit with the same people here — nobody falls off the diagonal.';
  return `${w} ${w === 1 ? 'person holds' : 'people hold'} power ahead of trust; ${u} ${
    u === 1 ? 'is trusted' : 'are trusted'
  } ahead of their power.`;
}

function bridgeFinding(bridges: { no: number; score: number }[], nameOf: (no: number) => string): string | null {
  const top = bridges[0];
  if (!top) return null;
  return `${nameOf(top.no)} carries more of the group's connection than anyone else; ${
    bridges.length === 1 ? 'no one else routes traffic at all' : `${bridges.length - 1} others also sit between people`
  }.`;
}

function peripheryFinding(total: number, isolates: number): string | null {
  if (total === 0) return null;
  return `${total} ${total === 1 ? 'person sits' : 'people sit'} at the edge of both lenses${
    isolates > 0 ? `, ${isolates} of them with no positive ties at all` : ''
  }.`;
}

function oneWayFinding(count: number, widest: string | null): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? 'tie runs' : 'ties run'} one way${widest ? `; the widest is ${widest}` : ''}.`;
}

function clusterFinding(clusters: number): string {
  if (clusters === 0) return 'Trust has not pooled into any cluster yet.';
  if (clusters === 1) return 'Trust holds together as one cluster rather than pooling into pockets.';
  return `Trust has pooled into ${clusters} distinct clusters.`;
}

function spreadFinding(spread: { name: string; concentration: number | null }[]): string | null {
  const read = spread
    .map((l) => ({ name: l.name.toLowerCase(), reading: concentrationReading(l.concentration) }))
    .filter((l): l is { name: string; reading: string } => l.reading !== null);
  if (read.length === 0) return null;
  // Both lenses landing on the same reading is one sentence, not two.
  if (read.length > 1 && read.every((l) => l.reading === read[0]!.reading)) {
    return `${capitalise(joinNames(read.map((l) => l.name)))} are both ${read[0]!.reading}.`;
  }
  return `${capitalise(read.map((l) => `${l.name} is ${l.reading}`).join('; '))}.`;
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
