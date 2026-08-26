/**
 * Assessment Link panel.
 *
 * One always-active generic link per assessment. Because tokens are stored as
 * keyed hashes, the plaintext cannot be read back — "show link" issues a fresh
 * one, which is also how a link is rotated after it leaks.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import {
  CardHead,
  DataTable,
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

/** A group's link, listed under the instrument it belongs to. */
interface CohortLinkRow {
  linkId: string;
  assessmentId: string;
  cohortId: string;
  cohortName: string;
  organisation: string;
  cohortStatus: string;
  roundNo: number;
  roundName: string;
  roundClosed: boolean;
  active: boolean;
  token: string | null;
  respondents: number;
  createdAt: string;
  lastSeenAt: string | null;
}

export function AssessmentLinks() {
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [cohortLinks, setCohortLinks] = useState<CohortLinkRow[]>([]);
  const [activeTheme, setActiveTheme] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ links: LinkRow[]; cohortLinks: CohortLinkRow[]; activeTheme: string }>('/api/admin/links')
      .then((r) => {
        setRows(r.links);
        setCohortLinks(r.cohortLinks ?? []);
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
            <DataTable
              rows={rows}
              rowKey={(r) => r.assessment_id}
              minWidth={880}
              pageSize={10}
              expand={(row) => {
                const kids = cohortLinks.filter((k) => k.assessmentId === row.assessment_id);
                if (kids.length === 0) return null;
                return (
                  <div className="dt-childbox">
                    <table>
                      <thead>
                        <tr>
                          <th>Group</th>
                          <th>Round</th>
                          <th>Responses</th>
                          <th>State</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {kids.map((k) => (
                          <tr key={k.linkId}>
                            <td>
                              <b>{k.cohortName}</b>
                              {k.organisation ? <div className="cell-sub">{k.organisation}</div> : null}
                            </td>
                            <td>
                              {k.roundName}
                              <div className="cell-sub">{k.roundClosed ? 'closed' : 'taking responses'}</div>
                            </td>
                            <td>{k.respondents}</td>
                            <td>
                              {k.active ? (
                                <span className="pill pill-ok">Active</span>
                              ) : (
                                <span className="pill pill-warn">Disabled</span>
                              )}
                            </td>
                            <td className="row-actions">
                              {k.token ? (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() =>
                                    void copyToClipboard(`${window.location.origin}/t/${k.token}`).then(
                                      (ok) => showToast(ok ? 'Group link copied' : 'Could not copy that'),
                                    )
                                  }
                                >
                                  Copy
                                </button>
                              ) : null}
                              <Link className="btn btn-ghost btn-sm" to="/admin/cohorts">
                                Manage
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }}
              expandLabel={(row) => {
                const n = cohortLinks.filter((k) => k.assessmentId === row.assessment_id).length;
                return `${n} group link${n === 1 ? '' : 's'}`;
              }}
              columns={[
                {
                  key: 'name',
                  header: 'Assessment',
                  value: (r) => r.name,
                  cell: (r) => {
                    const kids = cohortLinks.filter((k) => k.assessmentId === r.assessment_id).length;
                    return (
                      <>
                        <b>{r.name}</b>
                        <div className="cell-sub">
                          {r.question_count} statements
                          {kids > 0 ? ` · ${kids} group link${kids === 1 ? '' : 's'}` : ''}
                        </div>
                      </>
                    );
                  },
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: '110px',
                  value: (r) => r.status,
                  cell: (r) => <StatusPill status={r.status} />,
                },
                {
                  key: 'link',
                  header: 'Open link',
                  width: '150px',
                  value: (r) => (r.link_id ? (r.active === 1 ? 'active' : 'disabled') : 'none'),
                  cell: (r) => {
                    const kids = cohortLinks.filter((k) => k.assessmentId === r.assessment_id).length;
                    if (r.link_id) {
                      return r.active === 1 ? (
                        <span className="pill pill-ok">Active</span>
                      ) : (
                        <span className="pill pill-warn">Disabled</span>
                      );
                    }
                    return (
                      <span className="inline-note">
                        {kids > 0 ? 'Per group — see the rows below' : 'No link yet'}
                      </span>
                    );
                  },
                },
                {
                  key: 'seen',
                  header: 'Last opened',
                  width: '140px',
                  value: (r) => r.last_seen_at ?? '',
                  cell: (r) => (r.last_seen_at ? formatDate(r.last_seen_at) : '—'),
                },
                {
                  key: 'actions',
                  header: '',
                  width: '210px',
                  cell: (r) => {
                    // A cohort instrument has no instrument-level link: its
                    // links belong to groups. Offering "Create link" here only
                    // leads to a refusal a page later.
                    const perGroup = cohortLinks.some((k) => k.assessmentId === r.assessment_id);
                    if (perGroup && !r.link_id) {
                      return (
                        <Link className="btn btn-ghost btn-sm" to="/admin/cohorts">
                          Manage group links
                        </Link>
                      );
                    }
                    return (
                    <div className="row-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        onClick={() => issue(r)}
                        disabled={busy === r.assessment_id}
                      >
                        {r.link_id ? 'Issue a new link' : 'Create link'}
                      </button>
                      {r.link_id ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => toggle(r)}
                          disabled={busy === r.assessment_id}
                        >
                          {r.active === 1 ? 'Disable' : 'Enable'}
                        </button>
                      ) : null}
                    </div>
                    );
                  },
                },
              ]}
            />

            {Object.entries(urls).map(([id, url]) => (
              <div className="wl-full" key={id}>
                <div className="code-line">{url}</div>
                <p className="inline-note mt-1">
                  Copy this now — it is shown once. The stored value is a keyed hash, so it cannot be
                  read back later.
                </p>
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
