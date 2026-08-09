/** Small shared pieces for the console panels. */

import { useCallback, useState } from 'react';

export function Head({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="admin-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="toolbar-row">{actions}</div> : null}
    </div>
  );
}

export function Loading() {
  return (
    <p className="hint" style={{ marginTop: 24 }}>
      Loading…
    </p>
  );
}

/** Candidate progress reads as a state, not a number, until it is one. */
export function StatusPill({ status, answered }: { status: string; answered?: number }) {
  if (status === 'completed') return <span className="pill pill-ok">Completed</span>;
  if (status === 'in_progress') {
    return <span className="pill pill-warn">{answered ? `In progress ${answered}/40` : 'In progress'}</span>;
  }
  if (status === 'live') return <span className="pill pill-ok">Live</span>;
  if (status === 'planned') return <span className="pill pill-neutral">Planned</span>;
  if (status === 'retired') return <span className="pill pill-plain">Retired</span>;
  return <span className="pill pill-neutral">Invited</span>;
}

export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((next: string) => {
    setMessage(next);
    setTimeout(() => setMessage(null), 3200);
  }, []);
  return [message, show];
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast is-shown" role="status" aria-live="polite">
      {message}
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

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
