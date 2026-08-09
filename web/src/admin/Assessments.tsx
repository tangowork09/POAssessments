/**
 * Assessments panel. The table is driven entirely by the assessments table, so
 * a second instrument appears here the moment its rows are inserted — there is
 * nothing to change in this file.
 */

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Head, Loading, StatusPill } from './ui.js';
import { STYLES } from '../../../src/shared/styles.js';

interface Row {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  question_count: number;
  invited: number;
  started: number;
  completed: number;
}

export function Assessments() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    api.get<{ assessments: Row[] }>('/api/admin/assessments').then((r) => setRows(r.assessments));
  }, []);

  if (!rows) return <Loading />;

  return (
    <>
      <Head
        title="Assessments"
        sub="Every instrument on the platform, with its funnel. Adding one is a data change, not a deploy."
      />

      <section className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Status</th>
                <th className="right">Questions</th>
                <th className="right">Invited</th>
                <th className="right">Started</th>
                <th className="right">Completed</th>
                <th className="right">Completed of started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="name">
                    {a.name}
                    <span className="cell-sub">{a.description}</span>
                  </td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  <td className="right num">{a.question_count}</td>
                  <td className="right num">{a.invited}</td>
                  <td className="right num">{a.started}</td>
                  <td className="right num">{a.completed}</td>
                  <td className="right num">
                    {a.started > 0 ? `${Math.round((a.completed / a.started) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Scoring model — Influencing Style Inventory</div>
            <div className="card-sub">Ten styles, four statements each, covering statements 1–40 once</div>
          </div>
        </div>
        <div className="card-body grid-2">
          <div>
            <p className="side-label" style={{ padding: 0 }}>
              Push
            </p>
            {STYLES.filter((s) => s.side === 'push').map((s) => (
              <div key={s.key} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <b style={{ color: 'var(--ink-2)' }}>{s.name}</b> · items{' '}
                <span className="num">{s.items.join(', ')}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="side-label" style={{ padding: 0 }}>
              Pull
            </p>
            {STYLES.filter((s) => s.side === 'pull').map((s) => (
              <div key={s.key} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <b style={{ color: 'var(--ink-2)' }}>{s.name}</b> · items{' '}
                <span className="num">{s.items.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
