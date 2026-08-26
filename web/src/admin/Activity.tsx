/**
 * The activity log.
 *
 * What the console did, newest first, with the state of the thing before it
 * changed. It exists for the evening when a link stops working or a roster is
 * suddenly wrong: the entry says who did it and when, and — for a link that was
 * rotated — carries the previous token, which can be put back from here.
 *
 * Superadmin only, because it names people and holds credentials.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { DataTable, Head, TableSkeleton, Toast, useToast } from './ui.js';

interface Entry {
  id: string;
  at: string;
  admin: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string;
  before: string | null;
  after: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
}

/** The filters worth a click. Anything finer is a search box away. */
const FILTERS: { label: string; action: string }[] = [
  { label: 'Everything', action: '' },
  { label: 'Links', action: 'cohort.link' },
  { label: 'Rounds', action: 'cohort.round' },
  { label: 'Roster', action: 'cohort.member' },
  { label: 'Reports', action: 'cohort.reports' },
];

export function Activity() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ entries: Entry[] }>(
        `/api/admin/activity?limit=200${filter ? `&action=${encodeURIComponent(filter)}` : ''}`,
      );
      setEntries(res.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the log.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(entry: Entry): Promise<void> {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`/api/admin/activity/${entry.id}/restore-link`);
      await navigator.clipboard?.writeText(res.url).catch(() => undefined);
      showToast('The previous link works again, and is on your clipboard.');
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not restore that link.');
    } finally {
      setBusy(false);
    }
  }

  /** A rotation is the one entry the log can undo. */
  function restorable(entry: Entry): boolean {
    if (!/\.(reissue|issue)$/.test(entry.action) && entry.action !== 'links.deactivate') return false;
    return Boolean(entry.before && entry.before.includes('"token"'));
  }

  return (
    <>
      <Head
        title="Activity"
        sub="Every change made in this console, newest first, with what the thing looked like beforehand."
      />

      {error ? <div className="banner is-shown">{error}</div> : null}

      <div className="btn-row">
        {FILTERS.map((f) => (
          <button
            key={f.action}
            className={`btn btn-sm ${filter === f.action ? 'btn-secondary' : 'btn-ghost'}`}
            onClick={() => setFilter(f.action)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          {entries === null ? (
            <TableSkeleton rows={6} cols={4} />
          ) : entries.length === 0 ? (
            <p className="hint">Nothing logged yet.</p>
          ) : (
            <DataTable
              rows={entries}
              rowKey={(e) => e.id}
              pageSize={25}
              minWidth={900}
              columns={[
                {
                  key: 'at',
                  header: 'When',
                  width: '160px',
                  className: 'nowrap',
                  value: (e) => e.at,
                  cell: (e) => e.at,
                },
                {
                  key: 'who',
                  header: 'Who',
                  width: '190px',
                  className: 'nowrap',
                  value: (e) => e.admin ?? '',
                  cell: (e) => e.admin ?? '—',
                },
                {
                  key: 'what',
                  header: 'What',
                  filterHint: 'Summary or action',
                  value: (e) => `${e.summary} ${e.action} ${e.entityId ?? ''}`,
                  cell: (e) => (
                    <>
                      <b>{e.summary || e.action}</b>
                      <div className="cell-sub">
                        <code>{e.action}</code>
                        {e.status && e.status >= 400 ? (
                          <span className="pill pill-warn" style={{ marginLeft: 8 }}>
                            refused {e.status}
                          </span>
                        ) : null}
                      </div>
                      {open === e.id ? (
                        <pre className="audit-json">
                          {`before: ${e.before ?? '—'}\n\nafter:  ${e.after ?? '—'}\n\n${e.method ?? ''} ${e.path ?? ''}`}
                        </pre>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  width: '180px',
                  className: 'row-actions',
                  cell: (e) => (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setOpen(open === e.id ? null : e.id)}
                      >
                        {open === e.id ? 'Hide' : 'Detail'}
                      </button>
                      {restorable(e) ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => void restore(e)}
                        >
                          Restore link
                        </button>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>
      </section>

      <Toast message={toast} />
    </>
  );
}
