/**
 * Collaboration Diagnostic runs, on the dashboard.
 *
 * What a facilitator wants on the way past: which runs are open, and how many
 * people still owe them an answer. Anything they would otherwise find by
 * opening the tab and reading the list.
 *
 * It draws nothing when there are no runs. A panel that says "0" about a
 * feature this console's owner may never use is furniture.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CardHead } from '../ui.js';
import type { RunListItem } from './types.js';

export function CollabTile() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ runs: RunListItem[] }>('/api/admin/collab-runs')
      .then((r) => live && setRuns(r.runs))
      .catch(() => live && setRuns([]));
    return () => {
      live = false;
    };
  }, []);

  if (!runs || runs.length === 0) return null;

  const open = runs.filter((r) => r.status === 'open');
  const answered = open.reduce((total, r) => total + r.completed, 0);

  return (
    <section className="card mt-4">
      <CardHead
        title="Collaboration Tests"
        sub={
          open.length === 0
            ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, none open`
            : `${open.length} open · ${answered} answered`
        }
        aside={
          <Link className="btn btn-secondary btn-sm" to="/admin/collaboration-tests">
            Open
          </Link>
        }
      />
      <div className="cd-tile">
        {(open.length > 0 ? open : runs).slice(0, 4).map((run) => (
          <Link className="cd-tile-run" key={run.id} to={`/admin/collaboration-tests/${run.id}`}>
            <span className="cd-tile-name">
              {run.name}
              <em>{run.organisation || 'No organisation'}</em>
            </span>
            <span className="cd-tile-count num">
              {run.completed}
              <em>answered</em>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
