/**
 * Every response in an anonymous wave, in full, with nobody's name on it.
 *
 * The tab used to say "responses are anonymous, nobody to list" and show
 * nothing, which reads as the tool hiding something. It is not hiding
 * anything: the answers are all here and worth reading. What does not exist —
 * anywhere, including in the database — is a way to attach them to a person.
 *
 * So the notice says that plainly, once, and then gets out of the way. The
 * numbering is presentational: response 4 is the fourth sheet finished, not
 * the fourth person on a list, because there is no list.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CardHead, DataTable, EmptyState, formatDateTime } from '../ui.js';
import { AnswerSheet } from './PersonAnswers.js';

interface ResponseRow {
  responseId: string;
  label: string;
  status: string;
  answered: number;
  completedAt: string | null;
  facets: Record<string, string>;
}

export function ResponsesPanel({ runId, facetKeys }: { runId: string; facetKeys: string[] }) {
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [params, setParams] = useSearchParams();
  const open = params.get('response');

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('response', id);
    else next.delete('response');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    api
      .get<{ responses: ResponseRow[] }>(`/api/admin/collab-runs/${runId}/responses`)
      .then((r) => setRows(r.responses))
      .catch(() => setRows([]));
  }, [runId]);

  useEffect(load, [load]);

  const finished = rows?.filter((r) => r.status === 'completed').length ?? 0;

  return (
    <section className="card">
      <CardHead
        title="Responses"
        sub={rows ? `${finished} finished of ${rows.length} started` : 'Every answer, with no name attached'}
      />

      <p className="cd-anon-note">
        <b>Anonymous.</b> Every answer is here and can be read in full. What is not here, in this
        console or in the database behind it, is any record of who gave which: responses were stored
        detached from the people who wrote them. The numbering below is just the order they were
        finished in.
      </p>

      <DataTable
        rows={rows ?? []}
        rowKey={(r) => r.responseId}
        pageSize={25}
        minWidth={680}
        empty={
          <EmptyState
            title="Nobody has answered yet"
            body="Share the run's link with the group. Answers appear here as they come in."
          />
        }
        expand={(r) =>
          open === r.responseId ? <AnswerSheet path={`/api/admin/collab-runs/${runId}/responses/${r.responseId}/answers`} /> : null
        }
        columns={[
          {
            key: 'label',
            header: 'Response',
            value: (r) => r.label,
            cell: (r) => (
              <button
                type="button"
                className="cd-linkish"
                onClick={() => setOpen(open === r.responseId ? null : r.responseId)}
                title={r.status === 'completed' ? 'Read this response in full' : 'Not finished yet'}
              >
                {r.label}
              </button>
            ),
          },
          ...facetKeys.map((key) => ({
            key,
            header: key.charAt(0).toUpperCase() + key.slice(1),
            value: (r: ResponseRow) => r.facets[key] ?? '',
            cell: (r: ResponseRow) => r.facets[key] ?? <span className="muted">not recorded</span>,
          })),
          {
            key: 'status',
            header: 'Status',
            value: (r) => (r.status === 'completed' ? 'Finished' : `${r.answered}/24`),
            cell: (r) =>
              r.status === 'completed' ? (
                <span className="pill pill-ok">Finished</span>
              ) : (
                <span className="pill pill-warn">{r.answered}/24</span>
              ),
          },
          {
            key: 'completed',
            header: 'Finished',
            value: (r) => r.completedAt ?? '',
            cell: (r) => <span className="muted">{r.completedAt ? formatDateTime(r.completedAt) : '—'}</span>,
          },
        ]}
      />
    </section>
  );
}
