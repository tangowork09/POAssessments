/**
 * Eight statements per page, each rated 0–5 on a segmented control.
 *
 * Keyboard: 0–5 rate the focused statement and advance to the next one, arrow
 * keys move within a row, Enter or → continues when the page is complete. The
 * scale is a real radiogroup so screen readers announce it as one.
 */

import { useEffect, useRef, useState } from 'react';
import type { SaveState } from '../lib/autosave.js';
import { Stepper } from './DetailsForm.js';
import type { Question } from '../../../src/shared/types.js';

export function QuestionPage({
  questions,
  scaleLabels,
  perPage,
  page,
  pageCount,
  answers,
  saveState,
  pendingCount,
  submitting,
  submitError,
  onAnswer,
  onPage,
  onSubmit,
}: {
  questions: Question[];
  scaleLabels: readonly string[];
  perPage: number;
  page: number;
  pageCount: number;
  answers: Record<number, number>;
  saveState: SaveState;
  pendingCount: number;
  submitting: boolean;
  submitError: string | null;
  onAnswer: (no: number, value: number) => void;
  onPage: (page: number) => void;
  onSubmit: () => void;
}) {
  const [showMissing, setShowMissing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const start = page * perPage;
  const pageQuestions = questions.slice(start, start + perPage);
  const missing = pageQuestions.filter((q) => answers[q.no] === undefined);
  const answeredTotal = questions.filter((q) => answers[q.no] !== undefined).length;
  const isLastPage = page >= pageCount - 1;

  useEffect(() => {
    setShowMissing(false);
  }, [page]);

  function advance(): void {
    if (missing.length > 0) {
      setShowMissing(true);
      const first = listRef.current?.querySelector('.q-row.has-error');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (isLastPage) onSubmit();
    else onPage(page + 1);
  }

  /** Moves focus to the first option of the next unanswered row on this page. */
  function focusNextRow(fromIndex: number): void {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('.q-row');
    if (!rows) return;
    for (let i = fromIndex + 1; i < rows.length; i++) {
      const no = Number(rows[i]!.dataset.no);
      if (answers[no] === undefined) {
        rows[i]!.querySelector<HTMLElement>('.q-opt')?.focus();
        return;
      }
    }
    rows[Math.min(fromIndex + 1, rows.length - 1)]?.querySelector<HTMLElement>('.q-opt')?.focus();
  }

  return (
    <div className="q-shell">
      <Stepper current={2} />

      <div className="q-sticky">
        <div className="q-sticky-row">
          <div className="q-counter">
            Answered <span className="num">{answeredTotal}</span> <em>of {questions.length}</em>
          </div>
          <SaveIndicator state={saveState} pending={pendingCount} />
          <div className="q-pages" aria-hidden="true">
            {Array.from({ length: pageCount }, (_, i) => (
              <span
                key={i}
                className={`q-page-pip${i === page ? ' is-current' : i < page ? ' is-done' : ''}`}
              />
            ))}
          </div>
        </div>
        <div className="progress">
          <div
            className="progress-fill"
            style={{ width: `${(answeredTotal / Math.max(questions.length, 1)) * 100}%` }}
          />
        </div>
        <div className="q-legend" aria-hidden="true">
          {scaleLabels.map((label, v) => (
            <div key={label}>
              <b>{v}</b>
              {label}
            </div>
          ))}
        </div>
      </div>

      {showMissing && missing.length > 0 ? (
        <div className="banner is-shown" role="alert">
          <IconAlert />
          <span>
            {missing.length === 1
              ? '1 statement on this page still needs a rating.'
              : `${missing.length} statements on this page still need a rating.`}
          </span>
        </div>
      ) : null}

      {submitError ? (
        <div className="banner is-shown" role="alert">
          <IconAlert />
          <span>{submitError}</span>
        </div>
      ) : null}

      <div className="q-page is-active">
        <div className="q-list" ref={listRef}>
          {pageQuestions.map((q, i) => (
            <Row
              key={q.no}
              index={i}
              question={q}
              value={answers[q.no]}
              scaleLabels={scaleLabels}
              showError={showMissing && answers[q.no] === undefined}
              onAnswer={(value) => {
                onAnswer(q.no, value);
                focusNextRow(i);
              }}
            />
          ))}
        </div>
      </div>

      <div className="q-foot">
        <button
          className="btn btn-secondary"
          disabled={page === 0}
          onClick={() => onPage(Math.max(0, page - 1))}
        >
          Back
        </button>

        <div className="kbd-hints">
          <span>
            <span className="kbd">0</span>–<span className="kbd">5</span> rate
          </span>
          <span>
            <span className="kbd">←</span>
            <span className="kbd">→</span> move
          </span>
          <span>
            <span className="kbd">Enter</span> continue
          </span>
        </div>

        <button className="btn btn-primary" onClick={advance} disabled={submitting}>
          {submitting ? 'Submitting…' : isLastPage ? 'Submit my answers' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

function Row({
  index,
  question,
  value,
  scaleLabels,
  showError,
  onAnswer,
}: {
  index: number;
  question: Question;
  value: number | undefined;
  scaleLabels: readonly string[];
  showError: boolean;
  onAnswer: (value: number) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const answered = value !== undefined;

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    const key = e.key;
    if (/^[0-5]$/.test(key)) {
      e.preventDefault();
      onAnswer(Number(key));
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const options = [...(groupRef.current?.querySelectorAll<HTMLElement>('.q-opt') ?? [])];
      const current = options.findIndex((o) => o === document.activeElement);
      const next = key === 'ArrowLeft' ? Math.max(0, current - 1) : Math.min(options.length - 1, current + 1);
      options[next]?.focus();
    }
  }

  return (
    <div
      className={`q-row${answered ? ' is-answered' : ''}${showError ? ' has-error' : ''}`}
      data-no={question.no}
      data-index={index}
    >
      <div className="q-head">
        <span className="q-num num">{String(question.no).padStart(2, '0')}</span>
        <p className="q-text">{question.text}</p>
      </div>

      <div
        className="q-scale"
        role="radiogroup"
        aria-label={`Rating for statement ${question.no}`}
        ref={groupRef}
        onKeyDown={handleKey}
      >
        {scaleLabels.map((label, v) => (
          <button
            key={v}
            type="button"
            className="q-opt"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} — ${label}`}
            // Roving tabindex: one stop per row, so Tab walks statements.
            tabIndex={value === v || (value === undefined && v === 0) ? 0 : -1}
            title={`${v} — ${label}`}
            onClick={() => onAnswer(v)}
          >
            <span className="num">{v}</span>
            <span className="lab">{label}</span>
          </button>
        ))}
      </div>

      <div className="q-err">Rate this statement to continue.</div>
    </div>
  );
}

function SaveIndicator({ state, pending }: { state: SaveState; pending: number }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    idle: { text: '', cls: 'pill-plain' },
    saving: { text: 'Saving…', cls: 'pill-plain' },
    saved: { text: 'Saved ✓', cls: 'pill-ok' },
    offline: {
      text: pending > 0 ? `Offline — saving locally (${pending})` : 'Offline — saving locally',
      cls: 'pill-warn',
    },
    error: { text: 'Retrying…', cls: 'pill-warn' },
  };
  const { text, cls } = map[state];
  if (!text) return null;
  return (
    <span className={`pill ${cls}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}

function IconAlert() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ flex: 'none', marginTop: 1 }}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.4M8 10.6v.6" strokeLinecap="round" />
    </svg>
  );
}
