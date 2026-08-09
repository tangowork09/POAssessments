/**
 * Assessment Link panel.
 *
 * One always-active generic link per assessment. Because tokens are stored as
 * keyed hashes, the plaintext cannot be read back — "show link" issues a fresh
 * one, which is also how a link is rotated after it leaks.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { Head, Loading, StatusPill, Toast, copyToClipboard, formatDate, useToast } from './ui.js';

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

const THEMES = [
  { key: 'enterprise', name: 'Enterprise', note: 'Active', live: true },
  { key: 'editorial', name: 'Editorial', note: 'Coming after client finalisation', live: false },
  { key: 'calm', name: 'Calm', note: 'Coming after client finalisation', live: false },
  { key: 'conversational', name: 'Conversational', note: 'Coming after client finalisation', live: false },
];

export function AssessmentLinks() {
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [activeTheme, setActiveTheme] = useState('enterprise');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    api
      .get<{ links: LinkRow[]; activeTheme: string }>('/api/admin/links')
      .then((r) => {
        setRows(r.links);
        setActiveTheme(r.activeTheme);
      })
      .catch(() => setRows([]));
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
    } finally {
      setBusy(null);
    }
  }

  if (!rows) return <Loading />;

  return (
    <>
      <Head
        title="Assessment Link"
        sub="Each assessment has one open link that anyone can use. It never expires; only the toggle here turns it off."
      />

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Generic links</div>
            <div className="card-sub">
              A visitor enters their details and receives their own personal continuation link
            </div>
          </div>
        </div>

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

                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => issue(row)}
                    disabled={busy === row.assessment_id}
                  >
                    {row.link_id ? 'Issue a new link' : 'Create link'}
                  </button>
                  {row.link_id ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggle(row)}
                      disabled={busy === row.assessment_id}
                    >
                      {row.active === 1 ? 'Disable' : 'Enable'}
                    </button>
                  ) : null}
                </div>
              </div>

              {urls[row.assessment_id] ? (
                <div style={{ flexBasis: '100%' }}>
                  <div className="code-line">{urls[row.assessment_id]}</div>
                  <p className="inline-note" style={{ marginTop: 6 }}>
                    Copy this now — it is shown once. The stored value is a keyed hash, so it cannot be read
                    back later.
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Candidate theme</div>
            <div className="card-sub">
              The candidate experience is token-driven, so alternative skins are a data switch
            </div>
          </div>
        </div>
        <div className="card-body">
          {THEMES.map((t) => (
            <div className="wl-row" key={t.key}>
              <div className="wl-key">
                <b>{t.name}</b>
                <span>{t.key}</span>
              </div>
              <div className="wl-val">
                {t.key === activeTheme ? (
                  <span className="pill pill-ok">Active</span>
                ) : (
                  <span className="pill pill-neutral">{t.note}</span>
                )}
              </div>
            </div>
          ))}
          <p className="inline-note" style={{ marginTop: 12 }}>
            Only Enterprise ships today. The remaining skins wait on client sign-off; the architecture
            already reads its palette from CSS custom properties, so adding one is a token set rather than a
            second frontend.
          </p>
        </div>
      </section>

      <Toast message={toast} />
    </>
  );
}
