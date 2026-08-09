/** Small shared pieces for the console panels. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
