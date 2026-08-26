/** Small shared pieces for the console panels. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminRole } from '../../../src/shared/types.js';

/**
 * Page head — the loudest of the three heading levels in the console.
 * Page head (h1) > card head (.card-title) > table head (th).
 */
export function Head({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="admin-head">
      <div className="admin-head-text">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="toolbar-row">{actions}</div> : null}
    </div>
  );
}

/** Card head, used verbatim by every panel so the second level never drifts. */
export function CardHead({ title, sub, aside }: { title: string; sub?: string; aside?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title">{title}</div>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {aside ?? null}
    </div>
  );
}

// ------------------------------------------------------------------- tables

export interface Column<T> {
  key: string;
  header: string;
  /** How the cell is drawn. */
  cell: (row: T) => ReactNode;
  /**
   * The text this column is searched and sorted on. A column without one is
   * inert — an actions column has nothing to search for.
   */
  value?: (row: T) => string | number | null | undefined;
  align?: 'right';
  width?: string;
  className?: string;
  /** Placeholder for the column's filter box. Defaults to the header. */
  filterHint?: string;
}

const PAGE_SIZES = [10, 25, 50, 0] as const;

function textOf(v: string | number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * One table, used by every panel.
 *
 * Three things every list in the console needed and none of them had: a filter
 * per column, a sort, and a page. They belong together — a filter without a
 * page still hands back four hundred rows, and a page without a filter makes
 * you walk them.
 *
 * Filtering is per column rather than one box across the table. A console is
 * read by someone who knows what they are looking for and which column it lives
 * in: "the row whose email contains acme", not "acme somewhere". It is also the
 * only kind of search that can be honest about a column it cannot search — an
 * actions column simply has no box.
 *
 * Everything is client-side, which is right for the sizes here (a roster is
 * fifty people, a cohort list is dozens) and wrong for a candidate table that
 * grows into thousands. When that day comes the props do not change; the page
 * and the filters move to the server behind them.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  pageSize = 10,
  minWidth,
  empty,
  footer,
  toolbar,
  className,
  expand,
  expandLabel,
  onShown,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  minWidth?: number;
  /** Shown when there are no rows at all. A filtered-to-nothing table says so itself. */
  empty?: ReactNode;
  /** Rendered after the last row — the roster's "add a person" line lives here. */
  footer?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
  /**
   * Child rows. Returning null means this parent has none, and its toggle is
   * absent rather than disabled — an arrow that does nothing is a lie about
   * there being something underneath.
   */
  expand?: (row: T) => ReactNode | null;
  /** How many children there are, said on the toggle. */
  expandLabel?: (row: T) => string;
  /**
   * The rows actually on screen, for a caller that needs to act on them — the
   * candidate table's "select all" means "all of these", not "all four hundred
   * behind the filter".
   */
  onShown?: (rows: T[]) => void;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [size, setSize] = useState(pageSize);
  const [page, setPage] = useState(0);
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');

  const filtered = useMemo(() => {
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every(([key, term]) => {
        const col = columns.find((c) => c.key === key);
        if (!col?.value) return true;
        return textOf(col.value(row)).toLowerCase().includes(term.trim().toLowerCase());
      }),
    );
    // `active` is derived from `filters`; listing it would re-run on every keystroke twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, filters, rows]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return filtered;
    // A copy: sorting the array we were handed would reorder the caller's state.
    return [...filtered].sort((a, b) => {
      const x = col.value!(a);
      const y = col.value!(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return textOf(x).localeCompare(textOf(y), undefined, { numeric: true }) * sort.dir;
    });
  }, [columns, filtered, sort]);

  // A filter that removes the page you were on should not leave you staring at
  // an empty table with rows behind you.
  const pageCount = size > 0 ? Math.max(1, Math.ceil(sorted.length / size)) : 1;
  const current = Math.min(page, pageCount - 1);
  const shown = size > 0 ? sorted.slice(current * size, current * size + size) : sorted;

  // The rows on screen, reported by membership rather than identity. The slice
  // above is a fresh array every render, so an identity-keyed effect would fire
  // each render; a caller that stores the rows in state (the candidates grid)
  // then re-renders this table forever — an endless urgent-update stream that
  // starves React Router's navigation transition, freezing every nav click
  // while the table is mounted.
  const shownSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = shown.map(rowKey).join('\u0000');
    if (sig === shownSig.current) return;
    shownSig.current = sig;
    onShown?.(shown);
  });

  function setFilter(key: string, value: string): void {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  function toggleSort(key: string): void {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
    setPage(0);
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  const searchable = columns.some((c) => c.value);

  return (
    <>
      {toolbar ? <div className="dt-toolbar">{toolbar}</div> : null}

      <div className="table-scroll">
        <table className={`table ${className ?? ''}`} style={minWidth ? { minWidth } : undefined}>
          <thead>
            <tr>
              {expand ? <th className="dt-toggle-col" /> : null}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={`${c.align === 'right' ? 'ta-right' : ''} ${c.value ? 'dt-sortable' : ''}`}
                  onClick={c.value ? () => toggleSort(c.key) : undefined}
                  aria-sort={
                    sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined
                  }
                >
                  {c.header}
                  {sort?.key === c.key ? (
                    <span className="dt-arrow" aria-hidden="true">
                      {sort.dir === 1 ? '↑' : '↓'}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
            {searchable ? (
              <tr className="dt-filters">
                {expand ? <th className="dt-toggle-col" /> : null}
                {columns.map((c) => (
                  <th key={c.key}>
                    {c.value ? (
                      <input
                        className="dt-filter"
                        value={filters[c.key] ?? ''}
                        placeholder={c.filterHint ?? c.header}
                        aria-label={`Filter by ${c.header}`}
                        onChange={(e) => setFilter(c.key, e.target.value)}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {shown.map((row) => {
              const key = rowKey(row);
              const children = expand ? expand(row) : null;
              const isOpen = Boolean(opened[key]);
              return (
                <Fragment key={key}>
                  <tr className={children && isOpen ? 'dt-parent is-open' : children ? 'dt-parent' : ''}>
                    {expand ? (
                      <td className="dt-toggle-col">
                        {children ? (
                          <button
                            className="dt-toggle"
                            aria-expanded={isOpen}
                            aria-label={expandLabel ? expandLabel(row) : 'Show the rows underneath'}
                            title={expandLabel ? expandLabel(row) : undefined}
                            onClick={() => setOpened((prev) => ({ ...prev, [key]: !prev[key] }))}
                          >
                            <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${c.className ?? ''} ${c.align === 'right' ? 'ta-right' : ''}`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {children && isOpen ? (
                    <tr className="dt-child">
                      <td colSpan={columns.length + 1}>{children}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (expand ? 1 : 0)} className="dt-none">
                  Nothing matches those filters.{' '}
                  <button className="link-btn" onClick={() => setFilters({})}>
                    Clear them
                  </button>
                </td>
              </tr>
            ) : null}
            {footer}
          </tbody>
        </table>
      </div>

      <div className="dt-foot">
        <span className="dt-count">
          {sorted.length === 0
            ? 'No rows'
            : size > 0
              ? `${current * size + 1}–${Math.min(sorted.length, current * size + size)} of ${sorted.length}`
              : `${sorted.length} of ${sorted.length}`}
          {active.length > 0 ? ` (filtered from ${rows.length})` : ''}
        </span>

        <div className="dt-pager">
          <label className="dt-size">
            Rows
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'All' : n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost btn-sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <span className="dt-page">
            {current + 1} / {pageCount}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The one zero-state in the console. A zero-state that only says "nothing
 * here" wastes the moment — every caller passes the next action too.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; to?: string; onClick?: () => void };
}) {
  return (
    <div className="empty-state">
      <EmptyMark />
      <b>{title}</b>
      <span className="empty-body">{body}</span>
      {action ? (
        <div className="empty-action">
          {action.to ? (
            <Link className="btn btn-secondary btn-sm" to={action.to}>
              {action.label}
            </Link>
          ) : (
            <button className="btn btn-secondary btn-sm" type="button" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EmptyMark() {
  return (
    <svg
      className="empty-mark"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9.5h18M8.5 9.5v10" />
    </svg>
  );
}

/** Failed fetches get their own state — never a zero-state that lies. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <b>That did not load</b>
      <span className="empty-body">{message}</span>
      {onRetry ? (
        <div className="empty-action">
          <button className="btn btn-secondary btn-sm" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Skeleton rows rather than a spinner: the table keeps its shape while it
 * loads, so nothing jumps when the data arrives.
 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <span className="skeleton-cell" key={c} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="hint">{label}</span>
    </div>
  );
}

/**
 * The pill carries the state and nothing else. How far through someone is
 * belongs beside it as quiet detail, not inside a status chip — and the two
 * instruments have different question counts, so a bare fraction in the pill
 * would be unreadable anyway.
 */
export function StatusPill({ status }: { status: string }) {
  if (status === 'completed') return <span className="pill pill-ok">Completed</span>;
  if (status === 'in_progress') return <span className="pill pill-warn">In progress</span>;
  if (status === 'live') return <span className="pill pill-ok">Live</span>;
  if (status === 'planned') return <span className="pill pill-neutral">Planned</span>;
  if (status === 'retired') return <span className="pill pill-plain">Retired</span>;
  return <span className="pill pill-neutral">Invited</span>;
}

/** Which account you are signed in as, said plainly rather than implied. */
export function RolePill({ role }: { role: AdminRole }) {
  return (
    <span className={`pill ${role === 'superadmin' ? 'pill-accent' : 'pill-plain'} pill-xs`}>
      {role === 'superadmin' ? 'Super admin' : 'Admin'}
    </span>
  );
}

export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    // Longer messages need longer on screen; bulk results are the long ones.
    timer.current = setTimeout(() => setMessage(null), next.length > 60 ? 6000 : 3600);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [message, show];
}

/**
 * The live region is always mounted. An aria-live element inserted at the same
 * moment as its text is unreliably announced, so only the text changes.
 */
export function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast${message ? ' is-shown' : ''}`} role="status" aria-live="polite">
      {message ?? ''}
    </div>
  );
}

/** Copies text and reports whether it worked, without throwing at the caller. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function toDate(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
