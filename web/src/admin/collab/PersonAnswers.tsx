/**
 * What one named respondent answered, next to what the group answered.
 *
 * The only place in the diagnostic where an individual's answers are readable,
 * and it is here because the facilitation team runs the debrief: a facilitator
 * who can see that one leader marked Trust two points below everyone else can
 * go and have that conversation.
 *
 * An anonymous run reaches the same table by a different door: its responses
 * are all readable too, and only the identity is missing — because none was
 * ever stored. What changes is the heading, not the access.
 *
 * Every open is written to the activity log. A facilitator is allowed to look;
 * nobody should be able to look without it being visible that they did, so the
 * panel says that out loud rather than logging quietly.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { Loading } from '../ui.js';

interface Answer {
  no: number;
  text: string;
  section: string;
  direction: 'direct' | 'reverse';
  chose: number | null;
  converted: number | null;
  group: number | null;
}

interface Detail {
  email?: string;
  status: string;
  wave?: number;
  groupN?: number;
  total?: number;
  perItem?: number;
  sections?: { key: string; short: string; mean: number }[];
  answers: Answer[] | null;
}

const SCALE = ['Strongly disagree', 'Disagree', 'Neither', 'Agree', 'Strongly agree'];

export function PersonAnswers({ runId, linkId }: { runId: string; linkId: string }) {
  return <AnswerSheet path={`/api/admin/collab-runs/${runId}/participants/${linkId}/answers`} />;
}

/**
 * One completed sheet, against the group.
 *
 * Takes a path rather than an identity, because it serves both readings: a
 * named person opened from the roster, and an anonymous response opened from
 * the responses list. The table is the same; what differs is whether anything
 * upstream knows whose it is.
 */
export function AnswerSheet({ path }: { path: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<Detail>(path)
      .then((d) => live && setDetail(d))
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof ApiError ? err.message : 'Could not load those answers.');
      });
    return () => {
      live = false;
    };
  }, [path]);

  if (error) {
    return (
      <div className="cd-answers">
        <p className="hint">{error}</p>
      </div>
    );
  }
  if (!detail) return <Loading label="Loading answers…" />;

  if (!detail.answers) {
    return (
      <div className="cd-answers">
        <p className="hint">
          {detail.status === 'completed'
            ? 'This sheet is not complete enough to read.'
            : 'They have not finished yet, so there is nothing to read.'}
        </p>
      </div>
    );
  }

  return (
    <div className="cd-answers">
      <p className="cd-answers-note">
        {detail.email ? 'Their own answers' : 'This response'}, against the group (
        {detail.groupN ?? 0} people). Opening this is recorded in the activity log.
      </p>

      {detail.sections && (
        <div className="cd-answers-sections">
          {detail.sections.map((s) => (
            <span key={s.key}>
              {s.short} <b className="num">{s.mean.toFixed(2)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="cd-matrix">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Statement</th>
              <th>They chose</th>
              <th>Counts as</th>
              <th>Group</th>
            </tr>
          </thead>
          <tbody>
            {detail.answers.map((a) => {
              const apart =
                a.converted !== null && a.group !== null ? Math.abs(a.converted - a.group) : 0;
              return (
                <tr key={a.no} className={apart >= 1.5 ? 'cd-apart' : undefined}>
                  <td className="num">{a.no}</td>
                  <td>
                    {a.text}
                    <em className="cd-answer-meta">
                      {a.section}
                      {a.direction === 'reverse' ? ' · reverse scored' : ''}
                    </em>
                  </td>
                  <td>
                    {a.chose === null ? '—' : `${a.chose} · ${SCALE[a.chose - 1] ?? ''}`}
                  </td>
                  <td className="num">{a.converted ?? '—'}</td>
                  <td className="num">{a.group === null ? '—' : a.group.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint cd-answers-note">
        &ldquo;They chose&rdquo; is what they ticked. &ldquo;Counts as&rdquo; is after conversion, so a
        5 always means healthy whichever way the statement was worded. Rows they read very differently
        from the group are marked.
      </p>
    </div>
  );
}
