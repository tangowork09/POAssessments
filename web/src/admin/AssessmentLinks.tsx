/**
 * Assessment Link panel.
 *
 * One always-active generic link per assessment. Because tokens are stored as
 * keyed hashes, the plaintext cannot be read back — "show link" issues a fresh
 * one, which is also how a link is rotated after it leaks.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import {
  CardHead,
  EmptyState,
  ErrorState,
  Head,
  Loading,
  StatusPill,
  Toast,
  copyToClipboard,
  formatDate,
  useToast,
} from './ui.js';

interface LinkRow {
  assessment_id: string;
  name: string;
  slug: string;
  status: string;
  question_count: number;
  link_id: string | null;
  active: number | null;
  created_at: string | null;
  last_seen_at: string | null;
}

export function AssessmentLinks() {
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [activeTheme, setActiveTheme] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ links: LinkRow[]; activeTheme: string }>('/api/admin/links')
      .then((r) => {
        setRows(r.links);
        setActiveTheme(r.activeTheme);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function issue(row: LinkRow): Promise<void> {
    setBusy(row.assessment_id);
    try {
      const res = await api.post<{ url: string; rotated: boolean }>(
        `/api/admin/links/generic/${row.assessment_id}`,
      );
      setUrls((prev) => ({ ...prev, [row.assessment_id]: res.url }));
      const copied = await copyToClipboard(res.url);
      showToast(
        copied
          ? res.rotated
            ? 'New link copied — the previous one has stopped working'
            : 'Link copied to the clipboard'
          : 'Link ready below',
      );
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not issue a link');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(row: LinkRow): Promise<void> {
    if (!row.link_id) return;
    setBusy(row.assessment_id);
    try {
      const next = !(row.active === 1);
      await api.post(`/api/admin/links/${row.link_id}/active`, { active: next });
      showToast(next ? 'Link enabled' : 'Link disabled');
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change that link');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Head
        title="Assessment Link"
        sub="Each assessment has one open link that anyone can use. It never expires; only the toggle here turns it off."
      />

      <section className="card">
        <CardHead
          title="Generic links"
          sub="A visitor enters their details and receives their own personal continuation link"
        />

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows ? (
          <Loading label="Loading links…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No assessments to link to"
            body="An open link belongs to an assessment. Once an instrument is seeded, its link can be created here."
            action={{ label: 'View assessments', to: '/admin/assessments' }}
          />
        ) : (
          <div className="card-body">
            {rows.map((row) => (
              <div className="wl-row" key={row.assessment_id}>
                <div className="wl-key">
                  <b>{row.name}</b>
                  <span>
                    {row.question_count} statements ·{' '}
                    {row.link_id
                      ? row.active === 1
                        ? `active since ${formatDate(row.created_at)}`
                        : 'disabled'
                      : 'no link yet'}
                  </span>
                </div>
                <div className="wl-val">
                  <StatusPill status={row.status} />
                  {row.link_id ? (
                    row.active === 1 ? (
                      <span className="pill pill-ok">Active</span>
                    ) : (
                      <span className="pill pill-warn">Disabled</span>
                    )
                  ) : null}
                  {row.last_seen_at ? (
                    <span className="inline-note">last opened {formatDate(row.last_seen_at)}</span>
                  ) : null}

                  <div className="wl-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => issue(row)}
                      disabled={busy === row.assessment_id}
                    >
                      {row.link_id ? 'Issue a new link' : 'Create link'}
                    </button>
                    {row.link_id ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => toggle(row)}
                        disabled={busy === row.assessment_id}
                      >
                        {row.active === 1 ? 'Disable' : 'Enable'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {urls[row.assessment_id] ? (
                  <div className="wl-full">
                    <div className="code-line">{urls[row.assessment_id]}</div>
                    <p className="inline-note mt-1">
                      Copy this now — it is shown once. The stored value is a keyed hash, so it cannot be read
                      back later.
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-4">
        <CardHead
          title="Candidate theme"
          sub="Which skin the candidate experience is currently served with"
        />
        <div className="card-body">
          {activeTheme ? (
            <div className="wl-row">
              <div className="wl-key">
                <b>{titleCase(activeTheme)}</b>
                <span>{activeTheme}</span>
              </div>
              <div className="wl-val">
                <span className="pill pill-ok">Active</span>
              </div>
            </div>
          ) : (
            <p className="inline-note">No theme is recorded in settings; the built-in default is in use.</p>
          )}
          <p className="inline-note mt-3">
            The candidate experience reads its palette from CSS custom properties, so a further skin is a
            token set rather than a second frontend. Only the theme above is installed today.
          </p>
        </div>
      </section>

      <Toast message={toast} />
    </>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
