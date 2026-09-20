/**
 * The furniture of the insights workspace.
 *
 * Nine questions, one frame. Every question is the same three surfaces in the
 * same three places — the graph centre stage, that insight's charts down the
 * right, the per-person detail band along the bottom — so a reader learns the
 * geography once and spends the rest of the session reading data instead of
 * re-reading the layout. These are the pieces that guarantee that: the one
 * toolbar, the findings rail, the frame, the sidebar's panels, and the one
 * table idiom the bands all use.
 *
 * Nothing here knows what an insight is. It is chrome, and it stays chrome.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TipContent } from './Tooltip.js';

export type PersonProps = (
  no: number,
  content: () => TipContent,
) => {
  onClick: () => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
};

// ------------------------------------------------------------- the tab bar

export interface TabDef {
  id: string;
  /** Two words at most: the bar has nine of these and one line to put them on. */
  name: string;
  /** Which of the three groups it belongs to. */
  group: number;
  /** The question it answers, for the title attribute and the aria label. */
  question: string;
}

export interface TabGroupDef {
  no: number;
  name: string;
}

// -------------------------------------------------------------- the frame

/**
 * One tab's workspace: graph, sidebar, band. The three are given by name
 * rather than by child order so a tab body reads as what it is showing rather
 * than as a stack of divs in a particular sequence.
 */
/**
 * Save picture, with the two decisions that actually matter before a picture
 * leaves the room: how much of the page to take, and whether the people on it
 * are named. Defaults are the safe ones — the picture alone, names off.
 */
/** How much of the map carries a name. */
export type NameMode = 'none' | 'key' | 'all';

const NAME_MODES: readonly (readonly [NameMode, string])[] = [
  ['none', 'None'],
  ['key', 'Key people'],
  ['all', 'Everyone'],
];

const NAME_MODE_NOTE: Record<NameMode, string> = {
  none: 'Nobody is named. The shape of the group without saying whose it is — the version to put on a screen in front of the group itself.',
  key: 'Only the people this question is about. The rest appear on hover, focus or search.',
  all: 'Every name that can be placed without covering somebody else. Where the map is tightest a few still give way — hover or search for those.',
};

function ExportButton({ onExport }: { onExport: (o: ExportOptions) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportOptions['format']>('png');
  const [scope, setScope] = useState<ExportOptions['scope']>('graph');
  const [names, setNames] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="ins-export" ref={boxRef}>
      <button
        type="button"
        className="ins-stage-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Save this as a PNG"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
        </svg>
        Save picture
      </button>
      {open ? (
        <div className="ins-export-pop" role="dialog" aria-label="Save picture">
          <p className="ins-export-head">Format</p>
          <div className="ins-export-formats" role="group" aria-label="Format">
            {(
              [
                ['png', 'Image', 'A picture.'],
                ['pdf', 'PDF', 'Pages, with the table as real text.'],
                ['html', 'Interactive', 'Keeps its hover. Opens in any browser.'],
              ] as const
            ).map(([k, label, note]) => (
              <button
                key={k}
                type="button"
                className={`ins-export-fmt${format === k ? ' is-on' : ''}`}
                onClick={() => setFormat(k)}
                aria-pressed={format === k}
                title={note}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="ins-export-head">What to include</p>
          <label className="ins-export-opt">
            <input type="radio" name="ins-export-scope" checked={scope === 'graph'} onChange={() => setScope('graph')} />
            <span>
              <b>The picture only</b>
              <span>The map and its legend.</span>
            </span>
          </label>
          <label className="ins-export-opt">
            <input type="radio" name="ins-export-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span>
              <b>Picture and readings</b>
              <span>The map, the findings beside it and the table below — the whole record.</span>
            </span>
          </label>
          <p className="ins-export-head">Names on the map</p>
          <label className="ins-export-opt">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
            <span>
              <b>Show every name</b>
              <span>
                Off by default: a named map identifies who was rated how, and that is rarely a
                picture to share with the group itself.
              </span>
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm ins-export-go"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onExport({ format, scope, names })).finally(() => {
                setBusy(false);
                setOpen(false);
              });
            }}
          >
            {busy ? 'Preparing…' : format === 'pdf' ? 'Save PDF' : format === 'html' ? 'Save web page' : 'Save PNG'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface ExportOptions {
  /**
   * PNG is a picture. PDF is a document — the map on one page, the standings
   * as real text on the next, which can be searched and read on a phone. HTML
   * is the only one of the three that stays interactive: the map keeps its
   * hover, in one file that opens in any browser with no login.
   */
  format: 'png' | 'pdf' | 'html';
  /** The picture alone, or the picture with the readings and the table. */
  scope: 'graph' | 'all';
  /** Names on the map. Off makes a picture that can be shown to the group. */
  names: boolean;
}

export function Workspace({
  id,
  title,
  question,
  centre,
  sidebar,
  band,
  bandTitle,
  bandNote,
  bandTall,
  centreAside,
  legend,
  onExport,
  plain = false,
  isFull = false,
  onToggleFull,
  lead,
  finding,
}: {
  id: string;
  title: string;
  question: string;
  centre: React.ReactNode;
  sidebar: React.ReactNode;
  band: React.ReactNode;
  bandTitle: string;
  bandNote?: string;
  /**
   * For a band whose content is genuinely tall — the adjacency grid is the
   * only one — trading some of the graph's height for it. Scrolling a matrix
   * two screens to see a block pattern is not reading a matrix.
   */
  bandTall?: boolean;
  /** A control that belongs over the graph — a lens switch — not in the sidebar. */
  centreAside?: React.ReactNode;
  /**
   * What the marks mean. Floats over the picture's bottom-left corner rather
   * than competing with the title for the header line: a legend is read while
   * looking at the picture, so it lives on the picture.
   */
  legend?: React.ReactNode;
  /**
   * Saves a PNG. The caller is handed what the reader chose to include, since
   * a picture that leaves the room is a different object from one read on
   * screen: a group map with every name on it is not always shareable.
   */
  onExport?: (opts: ExportOptions) => void | Promise<void>;
  /**
   * The centre is not a picture — a form, a table — so it is rendered straight
   * into the stage instead of into the pan/zoom surface. That surface carries a
   * CSS transform and clips its overflow: a transform makes itself the
   * containing block for `position: fixed`, which puts any popover inside it in
   * the wrong place, the clip cuts a long list off, and zoom controls over a
   * table mean nothing.
   */
  plain?: boolean;
  /** Full-screen state and its toggle, for the control beside Save picture. */
  isFull?: boolean;
  onToggleFull?: () => void;
  /** Sits above the readings on every tab — the focused person's card. */
  lead?: React.ReactNode;
  /**
   * The sentence the data produced. It is the headline of the stage — the
   * one line a facilitator reads aloud — with the question as its label.
   */
  finding?: string | null;
}) {
  const zoom = useZoomPane();
  return (
    <div
      className={`ins-ws${bandTall ? ' is-band-tall' : ''}${plain ? ' is-plain-stage' : ''}`}
      role="tabpanel"
      id={`ins-panel-${id}`}
      aria-labelledby={`ins-tab-${id}`}
      tabIndex={-1}
    >
      <section className="ins-stage" aria-label={`${title}: ${question}`}>
        <header className="ins-stage-head">
          <div className="ins-stage-titles">
            <p className="ins-stage-label">
              <b>{title}</b>
              <span aria-hidden="true">·</span>
              {question}
            </p>
            <h3>{finding ?? title}</h3>
          </div>
          <div className="ins-stage-aside">
            {plain ? null : zoom.controls}
            {onExport ? <ExportButton onExport={onExport} /> : null}
            {onToggleFull ? (
              <button
                type="button"
                className={`ins-stage-btn${isFull ? ' is-on' : ''}`}
                onClick={onToggleFull}
                title={isFull ? 'Leave full screen (Esc)' : 'Fill the screen with this picture'}
                aria-pressed={isFull}
              >
                {isFull ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
                  </svg>
                )}
                {isFull ? 'Close' : 'Full screen'}
              </button>
            ) : null}
          </div>
        </header>
        <div className={`ins-stage-body${plain ? ' is-plain' : ''}`}>
          {plain ? (
            centre
          ) : (
            <div {...zoom.paneProps}>
              <div className="ins-zoom-inner" style={zoom.innerStyle}>
                {centre}
              </div>
            </div>
          )}
          {legend ? <div className="ins-legend-float">{legend}</div> : null}
          {centreAside ? <div className="ins-stage-float">{centreAside}</div> : null}
        </div>
      </section>

      <aside className="ins-side" aria-label={`${title}: readings`}>
        {lead}
        {sidebar}
      </aside>

      <section className="ins-band" aria-label={`${title}: ${bandTitle}`}>
        <header className="ins-band-head">
          <h4>{bandTitle}</h4>
          {bandNote ? <span>{bandNote}</span> : null}
        </header>
        <div className="ins-band-body">{band}</div>
      </section>
    </div>
  );
}

/**
 * The sidebar's lead: the sentence the data produced, at the top of the column,
 * on its own surface. It is the one piece of writing on the tab that changes
 * with the cohort, so it gets the weight and everything under it reads as
 * support for it.
 */
export function Finding({ text, caption }: { text?: string | null; caption?: string }) {
  if (!text && !caption) return null;
  return (
    <div className="ins-finding">
      {text ? <p className="ins-finding-lead">{text}</p> : null}
      {caption ? <p className="ins-finding-note">{caption}</p> : null}
    </div>
  );
}

/** A titled block in the sidebar. The only unit the column is built from. */
export function Panel({
  title,
  sub,
  accent,
  action,
  children,
}: {
  title?: string;
  sub?: string;
  /** Colours the title, when the block belongs to one of the two lenses. */
  accent?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ins-panel">
      {title ? (
        <header className="ins-panel-head">
          <span
            className={`ins-panel-title${accent ? ' has-accent' : ''}`}
            style={accent ? ({ ['--panel-accent' as string]: accent } as React.CSSProperties) : undefined}
          >
            {title}
          </span>
          {action}
        </header>
      ) : null}
      {sub ? <p className="ins-panel-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

// ------------------------------------------------------------ the detail band

export interface Column<T> {
  key: string;
  head: string;
  right?: boolean;
  /** Fixed width in px. Left off, the column takes what is left. */
  width?: number;
  /** Supplying this makes the header a sort control. */
  sort?: (a: T, b: T) => number;
  cell: (row: T) => React.ReactNode;
  /** A quiet second line under the header, for a unit. */
  note?: string;
  /**
   * 0..1 per row: draws a data bar behind the value so a column of numbers
   * can be read as a shape as well as a list. Null for "no bar on this row".
   */
  bar?: (row: T) => number | null;
  /** The bar's colour; the accent when left off. */
  barColor?: string;
}

type Dir = 'asc' | 'desc';

/**
 * The detail band's table, once, for all nine tabs.
 *
 * Dense on purpose — this is where a facilitator looks up the person somebody
 * in the room just named — and calm about it: hairlines rather than borders,
 * tabular figures so columns of numbers line up, a sticky header because the
 * band scrolls inside itself rather than growing the page.
 *
 * Sorting is offered only on the columns where an order is a question worth
 * asking. The rows arrive in the order the derivation chose, and that order is
 * always the first thing the reader sees: a table that opened on a different
 * sort than its own finding would be arguing with the graph above it.
 */
export function DetailTable<T>({
  rows,
  columns,
  rowKey,
  personNo,
  activeNo,
  personProps,
  tip,
  empty,
  pageSize = 10,
  wide = false,
  showAll = false,
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  /** Rows per page. Ten fits the band at the heights the frame gives it. */
  pageSize?: number;
  /**
   * More columns than the band can honestly fit. The table keeps its column
   * widths and the band scrolls sideways, rather than squeezing every head
   * until half of them are truncated to three letters.
   */
  wide?: boolean;
  /**
   * Render every row, ignoring the pager. For a capture: a picture of page one
   * of seven is not the record anybody meant to keep.
   */
  showAll?: boolean;
  rowKey: (row: T) => string | number;
  /** Which person a row is about, when it is about one. */
  personNo?: (row: T) => number | null;
  activeNo?: number | null;
  personProps?: PersonProps;
  tip?: (row: T) => TipContent;
  empty: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  /**
   * The fixed column widths are asks, not orders. A band that is narrower
   * than their sum (the stage is a flexible column) would otherwise hand the
   * unsized name column whatever is left — which is nothing — so the asks
   * are scaled down together until the name keeps a readable minimum.
   */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [avail, setAvail] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setAvail(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const colWidths = useMemo(() => {
    const NAME_MIN = 150;
    const fixed = columns.reduce((t, c) => t + (c.width ?? 0), 0);
    const unsized = columns.filter((c) => !c.width).length;
    if (!avail || fixed === 0) return columns.map((c) => c.width);
    const room = Math.max(0, avail - (unsized > 0 ? NAME_MIN * unsized : 0));
    const scale = fixed > room ? room / fixed : 1;
    return columns.map((c) => (c.width ? Math.max(48, Math.floor(c.width * scale)) : undefined));
  }, [avail, columns]);
  const ordered = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const cmp = col.sort;
    return [...rows].sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : cmp(b, a)));
  }, [columns, rows, sort]);
  // Pages, not a scrollbar: a facilitator reads "1–10 of 60" and turns a
  // page; a table that scrolls inside a scrolling page loses its place.
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  useEffect(() => {
    setPage(0);
  }, [rows, sort]);
  const shown = useMemo(
    () => (showAll ? ordered : ordered.slice(cur * pageSize, (cur + 1) * pageSize)),
    [cur, ordered, pageSize, showAll],
  );

  if (rows.length === 0) return <p className="hint">{empty}</p>;

  const click = (key: string) =>
    setSort((cur) =>
      cur?.key === key ? (cur.dir === 'desc' ? { key, dir: 'asc' } : null) : { key, dir: 'desc' },
    );

  return (
    <div className={`ins-grid-wrap${wide ? ' is-wide' : ''}`} ref={wrapRef}>
    <table className={`ins-grid${wide ? ' is-wide' : ''}`}>
      <colgroup>
        {columns.map((c, i) => (
          <col key={c.key} style={colWidths[i] ? { width: colWidths[i] } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => {
            const on = sort?.key === c.key;
            return (
              <th
                key={c.key}
                className={`${c.right ? 'ta-right' : ''}${c.sort ? ' is-sortable' : ''}${on ? ' is-sorted' : ''}`}
                aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sort ? (
                  <button type="button" onClick={() => click(c.key)}>
                    {c.head}
                    <span className="ins-grid-arrow" aria-hidden="true">
                      {on ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                ) : (
                  c.head
                )}
                {c.note ? <span className="ins-grid-note">{c.note}</span> : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => {
          const no = personNo?.(row) ?? null;
          const handlers =
            no !== null && personProps && tip ? personProps(no, () => tip(row)) : null;
          return (
            <tr
              key={rowKey(row)}
              className={`${no !== null && no === activeNo ? 'is-on' : ''}${handlers ? ' is-tappable' : ''}`}
              {...(handlers ?? {})}
            >
              {columns.map((c) => {
                const share = c.bar ? c.bar(row) : null;
                return (
                  <td key={c.key} className={`${c.right ? 'ta-right' : ''}${c.bar ? ' has-bar' : ''}`}>
                    {share !== null && share !== undefined && share > 0 ? (
                      <span className="ins-cell-bar" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`,
                            background: c.barColor ?? 'var(--accent)',
                          }}
                        />
                      </span>
                    ) : null}
                    <span className="ins-cell-val">{c.cell(row)}</span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    {pages > 1 && !showAll ? (
      <div className="ins-grid-foot">
        <span className="ins-grid-range">
          {cur * pageSize + 1}–{Math.min(ordered.length, (cur + 1) * pageSize)} of {ordered.length}
        </span>
        <div className="ins-grid-pages" role="group" aria-label="Pages">
          <button type="button" onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0} aria-label="Previous page">‹</button>
          {pageNumbers(cur, pages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="ins-grid-gap">…</span>
            ) : (
              <button
                key={n}
                type="button"
                className={n === cur ? 'is-on' : undefined}
                aria-current={n === cur ? 'page' : undefined}
                onClick={() => setPage(n)}
              >
                {n + 1}
              </button>
            ),
          )}
          <button type="button" onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1} aria-label="Next page">›</button>
        </div>
      </div>
    ) : null}
    </div>
  );
}

/** 1 … 4 [5] 6 … 12: the ends, the neighbours, and a gap where there is one. */
function pageNumbers(cur: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const set = new Set<number>([0, pages - 1, cur - 1, cur, cur + 1]);
  const list = [...set].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i]! - list[i - 1]! > 1) out.push(null);
    out.push(list[i]!);
  }
  return out;
}

// ------------------------------------------------------------ small marks

/** A name, what they do, a number, and the bar that ranks them against the top. */
export function BarRow({
  name,
  meta,
  value,
  share,
  fill,
  bold,
  active,
  avatar,
  rank,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}: {
  name: string;
  meta: string;
  value: string;
  share: number;
  fill: string;
  bold?: boolean;
  active?: boolean;
  /** The person's department colour: drawn as an initials disc before the name. */
  avatar?: string;
  /** Standing in this list, 1-based. */
  rank?: number;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}) {
  return (
    <button
      type="button"
      className={`insights-bar${active ? ' is-active' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <span className="insights-bar-lead">
        {rank !== undefined ? <span className="insights-bar-rank">{rank}</span> : null}
        {avatar ? <Avatar name={name} color={avatar} size={24} /> : null}
      </span>
      <span className="insights-bar-text">
        <span className={`insights-bar-name${bold ? ' is-both' : ''}`}>{name}</span>
        <span className="insights-bar-meta">{meta}</span>
      </span>
      <span className="insights-bar-val">{value}</span>
      <span className="net-bar-track" aria-hidden="true">
        <span
          className="net-bar-fill"
          style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, background: fill }}
        />
      </span>
    </button>
  );
}

/** One 0..1 measure as a labelled bar with its reading beneath. */
export function MeterLine({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number | null;
  color: string;
  note: string;
}) {
  return (
    <div className="insights-meter-line">
      <span className="insights-meter-label">{label}</span>
      <span className="net-bar-track" aria-hidden="true">
        <span
          className="net-bar-fill"
          style={{ width: `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`, background: color }}
        />
      </span>
      <span className="insights-meter-val">{value === null ? '—' : value.toFixed(2)}</span>
      <span className="insights-meter-note">{note}</span>
    </div>
  );
}

/**
 * A privacy floor, made visible.
 *
 * Nothing here suppresses anything: every floor on this page was already
 * filtering rows out before this existed. The only difference is that a reader
 * can now tell "the group said nothing about these people" apart from "these
 * people are not in the group", which a silently shorter list cannot.
 */
export function Suppressed({
  n,
  unit,
  children,
}: {
  /** The actual floor, as the code applies it. Never a rounded-off version. */
  n: number;
  unit: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="insights-suppressed">
      <span className="insights-suppressed-tag">
        Fewer than {n} {unit} &mdash; not shown
      </span>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** A dot in the colour of something, for a legend line. */
export function Key({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="ins-key">
      <i style={{ background: color }} aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * A legend key.
 *
 * With `onToggle` it is a button that turns its own layer off — the legend is
 * where a reader already looks to ask "what is the orange one?", so it is the
 * obvious place to answer "show me only that". Without one it stays a plain
 * key, which is what the single-lens tabs need.
 */
function LegendKey({
  mark,
  on,
  onToggle,
  children,
}: {
  mark: React.ReactElement;
  on: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  if (!onToggle) {
    return (
      <span className="ins-key">
        {mark}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`ins-key is-toggle${on ? '' : ' is-off'}`}
      onClick={onToggle}
      aria-pressed={on}
      title={on ? 'Hide these' : 'Show these'}
    >
      {mark}
      {children}
    </button>
  );
}

/** A tie colour, for a map drawing more than one lens at once. */
export function LineKey({
  color,
  on = true,
  onToggle,
  children,
}: {
  color: string;
  on?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <LegendKey mark={<i className="is-line" style={{ background: color }} aria-hidden="true" />} on={on} onToggle={onToggle}>
      {children}
    </LegendKey>
  );
}

/** The same, as a ring rather than a disc — a decoration, not a category. */
export function RingKey({
  color,
  on = true,
  onToggle,
  children,
}: {
  color: string;
  on?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <LegendKey mark={<i className="is-ring" style={{ borderColor: color }} aria-hidden="true" />} on={on} onToggle={onToggle}>
      {children}
    </LegendKey>
  );
}


// ----------------------------------------------------------- the findings rail

export interface RailStat {
  value: string;
  /** What the number is, for the title attribute. */
  title?: string;
  tone?: 'accent' | 'warn' | 'ok' | 'muted';
}

/**
 * The nine questions down the left, each with the sentence its data produced.
 *
 * This is the debrief's agenda. A facilitator with twenty minutes reads the
 * nine findings top to bottom without opening anything, then opens the two
 * that matter in the room. The rail is navigation and summary at once, which
 * is why it earns the column: a tab bar could name the questions but not
 * answer them, and it could not fit nine names on one line either.
 *
 * Collapses to a numbered strip when the picture needs the width. Roving tab
 * stops, up/down to move, as a vertical tablist wants.
 */
export function FindingsRail({
  tabs,
  groups,
  active,
  onPick,
  findingOf,
  statOf,
  collapsed,
  onToggle,
}: {
  tabs: readonly TabDef[];
  groups: readonly TabGroupDef[];
  active: string;
  onPick: (id: string) => void;
  /** The finding sentence for a question, or null while there is nothing to say. */
  findingOf: (id: string) => string | null;
  /** One number per question, the one a facilitator would read off first. */
  statOf?: (id: string) => RailStat | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = tabs.findIndex((t) => t.id === active);
      if (i < 0) return;
      const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length]!;
      onPick(next.id);
      refs.current.get(next.id)?.focus();
    },
    [active, onPick, tabs],
  );
  let n = 0;
  return (
    <nav className={`ins-rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Insights">
      <div className="ins-rail-list" role="tablist" aria-orientation="vertical" onKeyDown={onKey}>
        {groups.map((g) => (
          <div className="ins-rail-group" key={g.no} role="presentation">
            <span className="ins-rail-group-name" aria-hidden="true">
              {g.name}
            </span>
            {tabs
              .filter((t) => t.group === g.no)
              .map((t) => {
                n += 1;
                const on = active === t.id;
                const finding = findingOf(t.id);
                const stat = statOf?.(t.id) ?? null;
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      if (el) refs.current.set(t.id, el);
                      else refs.current.delete(t.id);
                    }}
                    role="tab"
                    id={`ins-tab-${t.id}`}
                    aria-selected={on}
                    aria-controls={`ins-panel-${t.id}`}
                    tabIndex={on ? 0 : -1}
                    title={`${t.name} — ${finding ?? t.question}`}
                    className={`ins-rail-item${on ? ' is-on' : ''}`}
                    onClick={() => onPick(t.id)}
                  >
                    <span className="ins-rail-no" aria-hidden="true">
                      {n}
                    </span>
                    <span className="ins-rail-text">
                      <span className="ins-rail-line">
                        <span className="ins-rail-name">{t.name}</span>
                        {stat ? (
                          <span className={`ins-rail-stat is-${stat.tone ?? 'muted'}`} title={stat.title}>
                            {stat.value}
                          </span>
                        ) : null}
                      </span>
                      <span className={`ins-rail-finding${finding ? '' : ' is-empty'}`}>
                        {finding ?? 'Not enough data yet'}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="ins-rail-toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show the findings' : 'Collapse to numbers'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
        </svg>
        {collapsed ? null : <span>Collapse</span>}
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------- the toolbar

export interface ScopeChip {
  key: string;
  label: string;
  count: number;
}

/**
 * The one row above the workspace: scope on the left, the focused person and
 * the reading conditions on the right, present-mode at the end. Everything
 * here is a property of the whole workspace, never of one question.
 */
export function InsightToolbar({
  scope,
  search,
  focus,
  note,
  isFull,
  onToggleFull,
  details,
}: {
  scope: React.ReactNode;
  /** The person search — finds anyone on the picture by name. */
  search?: React.ReactNode;
  focus?: React.ReactNode;
  /** In present mode: the switch for the details panel. */
  details?: React.ReactNode;
  note: React.ReactNode;
  isFull?: boolean;
  onToggleFull?: () => void;
}) {
  return (
    <div className="ins-toolbar">
      {scope}
      {search}
      <div className="ins-toolbar-end">
        {focus}
        <span className="ins-toolbar-note">{note}</span>
        {details}
        {onToggleFull ? (
          <button
            type="button"
            className={`ins-present${isFull ? ' is-on' : ''}`}
            onClick={onToggleFull}
            aria-pressed={!!isFull}
            title={isFull ? 'Leave present mode (Esc)' : 'Present — fill the screen'}
          >
            {isFull ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            )}
            {isFull ? 'Exit' : 'Present'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Who the nine questions are about.
 *
 * One button that states the current scope in words; a popover with the
 * department and tenure chips behind it. The popover is the only place the
 * whole roster's breakdown is listed, so the toolbar stays one calm line
 * however many departments a cohort has. Scope is the opposite of focus:
 * focus emphasises and hides nothing, scope cuts the cohort down and
 * recomputes everything — the button says so with a headcount, so nobody
 * mistakes "Sales" for the whole company.
 */
export function ScopePicker({
  funcs,
  tenures,
  activeFuncs,
  activeTenures,
  onToggleFunc,
  onToggleTenure,
  onClear,
  colorOf,
  shown,
  total,
  compare,
  onToggleCompare,
  nameMode,
  onNameMode,
}: {
  funcs: readonly ScopeChip[];
  tenures: readonly ScopeChip[];
  activeFuncs: ReadonlySet<string>;
  activeTenures: ReadonlySet<string>;
  onToggleFunc: (key: string, only: boolean) => void;
  onToggleTenure: (key: string, only: boolean) => void;
  onClear: () => void;
  colorOf: (funcKey: string) => string;
  shown: number;
  total: number;
  /** Side-by-side reading of the chosen departments. */
  compare: boolean;
  onToggleCompare: (on: boolean) => void;
  /** How much of the map is named. */
  nameMode: NameMode;
  onNameMode: (mode: NameMode) => void;
}) {
  const whole = activeFuncs.size === 0 && activeTenures.size === 0;
  const canCompare = activeFuncs.size >= 2;
  const canScope = funcs.length >= 2 || tenures.length >= 2;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // The stage clips overflow, so the popover is fixed to the viewport and
  // placed from the button's rectangle — re-placed on scroll and resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 6 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const summary = whole
    ? 'Everyone'
    : [...activeFuncs].join(compare && canCompare ? ' vs ' : ' + ') +
      (activeTenures.size ? `${activeFuncs.size ? ' · ' : ''}${[...activeTenures].join(' + ')}` : '');

  return (
    <div className="ins-scope">
      <button
        ref={btnRef}
        type="button"
        className={`ins-scope-btn${whole ? '' : ' is-scoped'}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!canScope}
        title={canScope ? 'Scope the questions to part of the roster' : 'This roster has one department and no tenure bands — nothing to scope by'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        <span className="ins-scope-key">Filters</span>
        <span className="ins-scope-summary">{summary}</span>
        <b>{whole ? total : `${shown} of ${total}`}</b>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {whole ? null : (
        <button type="button" className="ins-scope-clear" onClick={onClear} title="Back to everyone">
          <span aria-hidden="true">×</span>
          <span className="sr-only">Clear scope</span>
        </button>
      )}
      {open && pos ? (
        <div
          ref={popRef}
          className="ins-scope-pop"
          role="dialog"
          aria-label="Scope"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="ins-scope-pop-head">
            <b>{whole ? 'Whole cohort' : `${shown} of ${total} people`}</b>
            <span>{whole ? 'Every question is about everyone.' : 'Only ties among the people shown count.'}</span>
            {whole ? null : (
              <button type="button" className="ins-scope-pop-clear" onClick={onClear}>
                Everyone
              </button>
            )}
          </div>
          {funcs.length >= 2 ? (
            <div className="ins-scope-set" role="group" aria-label="Departments">
              <span className="ins-scope-set-name">Department</span>
              <div className="ins-scope-chips">
                {funcs.map((f) => {
                  const on = activeFuncs.has(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className={`ins-scope-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={(e) => onToggleFunc(f.key, e.altKey || e.metaKey)}
                      title={`${f.count} ${f.count === 1 ? 'person' : 'people'} · click to add or remove, ⌥-click for only this`}
                    >
                      <i style={{ background: colorOf(f.key) }} aria-hidden="true" />
                      {f.label} <b>{f.count}</b>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {tenures.length >= 2 ? (
            <div className="ins-scope-set" role="group" aria-label="Tenure bands">
              <span className="ins-scope-set-name">Tenure</span>
              <div className="ins-scope-chips">
                {tenures.map((t) => {
                  const on = activeTenures.has(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={`ins-scope-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={(e) => onToggleTenure(t.key, e.altKey || e.metaKey)}
                      title={`${t.count} ${t.count === 1 ? 'person' : 'people'}`}
                    >
                      {t.label} <b>{t.count}</b>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {funcs.length >= 2 ? (
            <label className={`ins-scope-switch${canCompare ? '' : ' is-off'}`}>
              <input
                type="checkbox"
                checked={compare && canCompare}
                disabled={!canCompare}
                onChange={(e) => onToggleCompare(e.target.checked)}
              />
              <span className="ins-scope-switch-track" aria-hidden="true" />
              <span className="ins-scope-switch-text">
                <b>Compare departments side by side</b>
                <span>
                  {canCompare
                    ? 'Each department keeps its own territory on the map and its own row above the readings.'
                    : 'Pick two or more departments to compare them.'}
                </span>
              </span>
            </label>
          ) : null}
          {/* Not a filter, but it belongs to the same question — what the map
              is showing — and this is where the reader already is. */}
          <div className="ins-names">
            <p className="ins-names-head">Names on the map</p>
            <div className="ins-names-seg" role="group" aria-label="Names on the map">
              {NAME_MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`ins-names-opt${nameMode === mode ? ' is-on' : ''}`}
                  aria-pressed={nameMode === mode}
                  onClick={() => onNameMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="ins-names-note">{NAME_MODE_NOTE[nameMode]}</p>
          </div>
          <p className="ins-scope-pop-foot">Departments and tenure combine: Sales + 3–7y is the Sales people with three to seven years.</p>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ people

/** Two initials on a disc in the person's department colour. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The same person looks the same everywhere — rail, list, table, tooltip —
 * because the disc is drawn from the same two facts on every surface: their
 * initials and their department's colour.
 */
export function Avatar({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="ins-avatar"
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

// ------------------------------------------------------- the focused person

export interface PersonCell {
  /** The question this reading belongs to; clicking the cell opens it. */
  tab: string;
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  /** 0..1 — a hairline bar under the value, for the counted measures. */
  share?: number | null;
}

/**
 * One person, nine answers. Focus is emphasis on every tab; this card is the
 * one place it is also a reading. Every cell is the standing that tab would
 * give this person, and clicking it opens that tab with the focus kept.
 */
export function PersonCard({
  name,
  color,
  meta,
  cells,
  activeTab,
  onPick,
  onClear,
}: {
  name: string;
  color: string;
  meta: string;
  cells: readonly PersonCell[];
  activeTab: string;
  onPick: (tab: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="ins-person" aria-label={`${name}: standing on every question`}>
      <div className="ins-person-head">
        <Avatar name={name} color={color} size={34} />
        <div className="ins-person-name">
          <b>{name}</b>
          <span>{meta}</span>
        </div>
        <button type="button" className="ins-person-x" onClick={onClear} title="Clear the focus (Esc)">
          <span aria-hidden="true">×</span>
          <span className="sr-only">Clear focus</span>
        </button>
      </div>
      <div className="ins-person-grid">
        {cells.map((c) => (
          <button
            key={c.tab + c.label}
            type="button"
            className={`ins-person-cell${activeTab === c.tab ? ' is-on' : ''}`}
            onClick={() => onPick(c.tab)}
            title={`Open ${c.label.toLowerCase()}`}
          >
            <small>{c.label}</small>
            <b className={c.tone ? `is-${c.tone}` : undefined}>{c.value}</b>
            {c.share !== null && c.share !== undefined ? (
              <i aria-hidden="true">
                <em style={{ width: `${Math.round(Math.max(0, Math.min(1, c.share)) * 100)}%` }} />
              </i>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}


// -------------------------------------------------------------------- zoom

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

/**
 * Pan and zoom for a static picture, the way the explorer's canvas moves. A
 * CSS transform on a wrapper, so the picture knows nothing about it and stays
 * vector-crisp at any scale. Wheel zooms about the cursor, drag pans (after a
 * few pixels, so a click on a person is still a click), two quick clicks or
 * the reset button come home. The controls are rendered by the caller — in
 * the stage header — so they never sit on the picture's own corners.
 */
export function useZoomPane(): {
  paneProps: React.HTMLAttributes<HTMLDivElement> & { ref: React.RefObject<HTMLDivElement | null> };
  innerStyle: React.CSSProperties;
  controls: React.ReactNode;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setT((cur) => {
        const factor = Math.exp(-e.deltaY * 0.0018);
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur.k * factor));
        const ratio = k / cur.k;
        return { k, x: px - (px - cur.x) * ratio, y: py - (py - cur.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = ref.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setT((cur) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur.k * factor));
      const ratio = k / cur.k;
      return { k, x: cx - (cx - cur.x) * ratio, y: cy - (cy - cur.y) * ratio };
    });
  }, []);
  const reset = useCallback(() => setT({ k: 1, x: 0, y: 0 }), []);
  const home = t.k === 1 && t.x === 0 && t.y === 0;

  const paneProps = {
    ref,
    className: `ins-zoom${panning ? ' is-panning' : ''}`,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      drag.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) {
        d.moved = true;
        setPanning(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setT((cur) => ({ ...cur, x: d.ox + dx, y: d.oy + dy }));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      drag.current = null;
      if (d?.moved) {
        setPanning(false);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        return;
      }
      // Two quick taps in one place: home. Detected here rather than from the
      // browser's dblclick, which a re-rendering target can swallow.
      const now = performance.now();
      const prev = lastTap.current;
      if (prev && now - prev.at < 420 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 8) {
        lastTap.current = null;
        reset();
      } else {
        lastTap.current = { at: now, x: e.clientX, y: e.clientY };
      }
    },
    onPointerCancel: () => {
      drag.current = null;
      setPanning(false);
    },
    // A pan must not end as a click on whatever is under the pointer.
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      if (panning) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };

  const controls = (
    <div className="ins-zoom-ctl" role="group" aria-label="Zoom">
      <button type="button" onClick={() => zoomBy(1 / 1.25)} disabled={t.k <= ZOOM_MIN} title="Zoom out" aria-label="Zoom out">−</button>
      <span className="ins-zoom-pct">{Math.round(t.k * 100)}%</span>
      <button type="button" onClick={() => zoomBy(1.25)} disabled={t.k >= ZOOM_MAX} title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" onClick={reset} disabled={home} title="Reset the view (double-click the picture)" aria-label="Reset the view">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9V4h5M20 15v5h-5M20 4l-6 6M4 20l6-6" />
        </svg>
      </button>
    </div>
  );

  return { paneProps, innerStyle: { transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }, controls };
}

// ------------------------------------------------------------ person search

export interface SearchPerson {
  no: number;
  name: string;
  func: string;
  color: string;
}

/**
 * Find a person on the picture by name. Sixty dots and eight labels means most
 * people are unnamed on any one tab; typing three letters and pressing Enter
 * focuses them — ringed, named and never faded on every tab, with their card
 * open on the right. `/` from anywhere on the page lands here.
 */
export function PersonSearch({
  people,
  onPick,
  scopedOut,
  placeholder = 'Find a person…',
}: {
  people: readonly SearchPerson[];
  onPick: (no: number) => void;
  /** True when a scope is on, so "no match" can say why. */
  scopedOut?: boolean;
  /** What the box is for, when it is not the page-wide search. */
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const starts: SearchPerson[] = [];
    const within: SearchPerson[] = [];
    for (const p of people) {
      const name = p.name.toLowerCase();
      if (name.startsWith(needle) || name.split(/\s+/).some((w) => w.startsWith(needle))) starts.push(p);
      else if (name.includes(needle) || p.func.toLowerCase().includes(needle)) within.push(p);
    }
    return [...starts, ...within].slice(0, 8);
  }, [people, q]);

  useEffect(() => setHi(0), [q]);

  // Fixed to the viewport, placed from the input — the stage clips overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 6, width: Math.max(280, r.width) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || inputRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  // "/" anywhere lands in the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pick = (p: SearchPerson) => {
    onPick(p.no);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="ins-search" role="combobox" aria-expanded={open && q.trim() !== ''} aria-haspopup="listbox" aria-owns="ins-search-list">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder={placeholder}
        aria-label="Find a person on the picture"
        aria-autocomplete="list"
        aria-controls="ins-search-list"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            const m = matches[hi];
            if (m) pick(m);
          } else if (e.key === 'Escape') {
            if (q) setQ('');
            else inputRef.current?.blur();
            setOpen(false);
          }
        }}
      />
      <kbd className="ins-search-key" aria-hidden="true">/</kbd>
      {open && q.trim() !== '' && pos ? (
        <div ref={popRef} className="ins-search-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {matches.length === 0 ? (
            <p className="ins-search-empty">
              {scopedOut ? 'Nobody in the current scope matches — widen the scope to find them.' : 'Nobody on the roster matches.'}
            </p>
          ) : (
            <ul id="ins-search-list" role="listbox" className="ins-search-list">
              {matches.map((p, i) => (
                <li
                  key={p.no}
                  role="option"
                  aria-selected={i === hi}
                  className={`ins-search-item${i === hi ? ' is-hi' : ''}`}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                >
                  <Avatar name={p.name} color={p.color} size={22} />
                  <span className="ins-search-name">{p.name}</span>
                  <span className="ins-search-meta">{p.func || '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------ compare departments

export interface DeptRow {
  key: string;
  color: string;
  people: number;
  /** Mean positive trust ties received per member. */
  trustIn: number;
  /** Mean positive power-over ties received per member. */
  powerIn: number;
  /** Of the trust ties this department's members give, the share that stays inside it. */
  within: number | null;
  isolates: number;
  oneWayOut: number;
}

/**
 * The chosen departments, one card each: headcount, the two means as bars a
 * reader compares by length, and the two counts that matter. Cards rather
 * than a wide table because this lives in a 316px column, and a table with
 * six numeric columns there is a table with six ellipses.
 */
export function DeptCompare({
  rows,
  crossTies,
  onPick,
  active,
}: {
  rows: readonly DeptRow[];
  /** Trust ties running between the compared departments, either way. */
  crossTies: number;
  onPick?: (key: string) => void;
  active?: string | null;
}) {
  const max = {
    trustIn: Math.max(0.01, ...rows.map((r) => r.trustIn)),
    powerIn: Math.max(0.01, ...rows.map((r) => r.powerIn)),
  };
  return (
    <section className="ins-compare" aria-label="Departments side by side">
      <header className="ins-compare-head">
        <b>{rows.length} departments</b>
        <span>Per member</span>
      </header>
      <p className={`ins-compare-lead${crossTies === 0 ? ' is-warn' : ''}`}>
        {crossTies === 0
          ? 'No trust crosses between these departments at all — each keeps to itself.'
          : `${crossTies} trust ${crossTies === 1 ? 'tie crosses' : 'ties cross'} between them.`}
      </p>
      <div className="ins-compare-list">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`ins-compare-row${active === r.key ? ' is-on' : ''}`}
            onClick={onPick ? () => onPick(r.key) : undefined}
            title={`${r.key} — ${r.people} people. Click to light them on the map.`}
          >
            <span className="ins-compare-top">
              <i style={{ background: r.color }} aria-hidden="true" />
              <b>{r.key}</b>
              <span className="ins-compare-n">{r.people}</span>
            </span>
            <span className="ins-compare-bars">
              <span className="ins-compare-bar">
                <em>Trust</em>
                <span className="ins-compare-track" aria-hidden="true">
                  <i style={{ width: `${Math.round((r.trustIn / max.trustIn) * 100)}%`, background: '#0F7A63' }} />
                </span>
                <b>{r.trustIn.toFixed(1)}</b>
              </span>
              <span className="ins-compare-bar">
                <em>Power</em>
                <span className="ins-compare-track" aria-hidden="true">
                  <i style={{ width: `${Math.round((r.powerIn / max.powerIn) * 100)}%`, background: '#B54708' }} />
                </span>
                <b>{r.powerIn.toFixed(1)}</b>
              </span>
            </span>
            <span className="ins-compare-foot">
              <span>
                Keeps <b>{r.within === null ? '—' : `${Math.round(r.within * 100)}%`}</b> of its trust inside
              </span>
              {r.isolates > 0 ? <span className="insights-tag is-cool">{r.isolates} alone</span> : null}
            </span>
          </button>
        ))}
      </div>
      <p className="ins-compare-note">
        Click a department to light it on the map. Each one is seated in its own panel, so a tie
        drawn between panels is trust that crosses the boundary.
      </p>
    </section>
  );
}
