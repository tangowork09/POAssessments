/**
 * One statement at a time, rated on the instrument's own scale.
 *
 * The scale is not fixed: the Influencing Styles Questionnaire is rated 0–4 on
 * five squares and the Ego States Scale 0–6 on seven, so the control is built
 * from `scale` and the grid column count travels to CSS as a custom property
 * rather than being hard-coded in the stylesheet.
 *
 * Keyboard: the digit keys inside the scale rate the statement and move on,
 * Enter continues, Backspace goes back, arrow keys move between the squares.
 * The scale is a real radiogroup so screen readers announce it as one control.
 *
 * The wire format is unchanged. The server and the autosave engine still think
 * in pages of `perPage` statements, so `resumePage` keeps its meaning and an
 * older response resumes correctly; this component simply walks the statements
 * inside those pages and reports a page boundary when it crosses one. On
 * arrival it skips forward to the first statement that still needs an answer,
 * which makes resume land on the exact question rather than the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SaveState } from '../lib/autosave.js';
import type { Question, ScaleInfo } from '../../../src/shared/types.js';

const AUTO_ADVANCE_MS = 300;

/** The first unanswered statement at or after the resume page, else the last. */
function resolveStart(
  questions: Question[],
  answers: Record<number, number>,
  page: number,
  perPage: number,
): number {
  if (questions.length === 0) return 0;
  const from = Math.min(Math.max(0, page * perPage), questions.length - 1);
  for (let i = from; i < questions.length; i++) {
    if (answers[questions[i]!.no] === undefined) return i;
  }
  for (let i = 0; i < from; i++) {
    if (answers[questions[i]!.no] === undefined) return i;
  }
  return questions.length - 1;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function QuestionPage({
  questions,
  scale,
  perPage,
  page,
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
  scale: ScaleInfo;
  perPage: number;
  page: number;
  answers: Record<number, number>;
  saveState: SaveState;
  pendingCount: number;
  submitting: boolean;
  submitError: string | null;
  onAnswer: (no: number, value: number) => void;
  onPage: (page: number) => void;
  onSubmit: () => void;
}) {
  const [index, setIndex] = useState(() => resolveStart(questions, answers, page, perPage));
  const [nudge, setNudge] = useState(false);
  const [missingNotice, setMissingNotice] = useState(0);

  // Set once the candidate touches anything: until then the position may still
  // be corrected as the server answers and the local snapshot merge in.
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ratingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (touched.current) return;
    setIndex(resolveStart(questions, answers, page, perPage));
  }, [questions, answers, page, perPage]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const total = questions.length;
  const current = questions[Math.min(index, Math.max(0, total - 1))];
  const options = useMemo(
    () => Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i),
    [scale.max, scale.min],
  );
  const value = current ? answers[current.no] : undefined;
  const answeredTotal = questions.filter((q) => answers[q.no] !== undefined).length;
  const isLast = index >= total - 1;
  const pct = total > 0 ? Math.round((answeredTotal / total) * 100) : 0;

  const goTo = useCallback(
    (next: number) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const clamped = Math.min(Math.max(0, next), Math.max(0, total - 1));
      touched.current = true;
      setNudge(false);
      // Only a page boundary is worth telling the server and the autosave
      // engine about — that is the unit `resumePage` is stored in.
      if (Math.floor(clamped / perPage) !== Math.floor(index / perPage)) {
        onPage(Math.floor(clamped / perPage));
      }
      setIndex(clamped);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    },
    [index, onPage, perPage, total],
  );

  const finish = useCallback(() => {
    const missing = questions.filter((q) => answers[q.no] === undefined);
    if (missing.length > 0) {
      setMissingNotice(missing.length);
      goTo(questions.indexOf(missing[0]!));
      return;
    }
    setMissingNotice(0);
    onSubmit();
  }, [answers, goTo, onSubmit, questions]);

  const advance = useCallback(() => {
    if (!current) return;
    if (answers[current.no] === undefined) {
      setNudge(true);
      return;
    }
    if (isLast) finish();
    else goTo(index + 1);
  }, [answers, current, finish, goTo, index, isLast]);

  const pick = useCallback(
    (v: number) => {
      if (!current) return;
      touched.current = true;
      setNudge(false);
      setMissingNotice(0);
      onAnswer(current.no, v);
      if (timer.current) clearTimeout(timer.current);
      // A short beat so the square can be seen filling before the next one
      // arrives. The last statement waits for an explicit submit.
      if (!isLast) {
        timer.current = setTimeout(() => {
          timer.current = null;
          goTo(index + 1);
        }, AUTO_ADVANCE_MS);
      }
    },
    [current, goTo, index, isLast, onAnswer],
  );

  // Whole-document shortcuts: the candidate should never have to find focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      // Only the digits this instrument actually offers: on a 0–4 scale a
      // stray '5' must do nothing rather than silently miss.
      if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
        const v = Number(e.key);
        if (v < scale.min || v > scale.max) return;
        e.preventDefault();
        pick(v);
      } else if (e.key === 'Enter') {
        // A focused square handles its own Enter as a click.
        if (el?.classList?.contains('rate')) return;
        e.preventDefault();
        advance();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        goTo(index - 1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [advance, goTo, index, pick, scale.max, scale.min]);

  function handleRatingKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
      return;
    e.preventDefault();
    const squares = [...(ratingRef.current?.querySelectorAll<HTMLElement>('.rate') ?? [])];
    const at = squares.findIndex((o) => o === document.activeElement);
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const next = at < 0 ? 0 : back ? Math.max(0, at - 1) : Math.min(squares.length - 1, at + 1);
    squares[next]?.focus();
  }

  if (!current) return null;

  const milestone = milestoneFor(answeredTotal, total);

  return (
    <div className="qscreen">
      <div className="qbar">
        <div className="qbar-in">
          <span className="pctchip num">{pct}%</span>
          <div
            className="track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredTotal}
            aria-valuetext={`${answeredTotal} of ${total} answered`}
            aria-label="Your progress"
          >
            <div className="track-fill" style={{ transform: `scaleX(${total ? answeredTotal / total : 0})` }} />
          </div>
        </div>
        <div className="qbar-meta">
          <span className="qcount num">
            Question {index + 1} of {total}
          </span>
          {milestone ? (
            <span className="milestone" role="status" aria-live="polite">
              {milestone}
            </span>
          ) : null}
          <span className="qbar-meta-end">
            <SaveIndicator state={saveState} pending={pendingCount} />
          </span>
        </div>
      </div>

      <div className="qstage">
        {/* `qbanner` marks these as the part of the statement screen that gives:
            an interruption must never push the scale or the way forward off a
            short viewport. The spacing is in the stylesheet for that reason. */}
        {missingNotice > 0 ? (
          <div className="banner is-shown qbanner" role="alert">
            <span>
              {missingNotice === 1
                ? 'One statement still needs a rating — here it is.'
                : `${missingNotice} statements still need a rating — here is the first.`}
            </span>
          </div>
        ) : null}

        {submitError ? (
          <div className="banner is-shown qbanner" role="alert">
            <span>{submitError}</span>
          </div>
        ) : null}

        <div key={current.no} className="qcard rise">
          <div className="qhead">
            <span className="qnum num">{current.no}</span>
            <span className="qtag">Rate how true this is of you</span>
          </div>

          <h2 className="qtext">{current.text}</h2>

          <div className="scale-hint">
            <span>
              {scale.min} — {scale.labels[0]}
            </span>
            <span>
              {scale.max} — {scale.labels[scale.labels.length - 1]}
            </span>
          </div>

          <div
            className={`rating${value !== undefined ? ' has-pick' : ''}${nudge ? ' is-nudged' : ''}`}
            role="radiogroup"
            aria-label={`Rating for statement ${current.no}`}
            ref={ratingRef}
            onKeyDown={handleRatingKey}
            // The column count is data, not design: five squares for a 0–4
            // instrument, seven for a 0–6 one, and the narrow breakpoint wraps
            // anything above five onto two rows.
            style={
              {
                '--scale-n': options.length,
                '--scale-n-sm': options.length <= 5 ? options.length : Math.ceil(options.length / 2),
              } as React.CSSProperties
            }
          >
            {options.map((v, i) => (
              <button
                key={v}
                type="button"
                className={`rate${value === v ? ' is-on' : ''}`}
                role="radio"
                aria-checked={value === v}
                aria-label={`${v} — ${scale.labels[i] ?? String(v)}`}
                // Roving tabindex: one stop for the whole scale.
                tabIndex={value === v || (value === undefined && i === 0) ? 0 : -1}
                onClick={() => pick(v)}
              >
                <span className="v num">{v}</span>
                <span className="k">{scale.shortLabels[i] ?? scale.labels[i]}</span>
              </button>
            ))}
          </div>

          {nudge ? (
            <p className="qnudge" role="alert">
              Pick a number from {scale.min} to {scale.max} to carry on.
            </p>
          ) : null}

          <div className="qfoot">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              Back
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={advance} disabled={submitting}>
              {submitting ? 'Sending…' : isLast ? 'Finish and send' : 'Next'}
            </button>
            <span className="keyhint">
              Press <kbd>{scale.min}</kbd>–<kbd>{scale.max}</kbd> to answer · <kbd>↵</kbd> next ·{' '}
              <kbd>⌫</kbd> back
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small encouragements at the quarter marks — nothing that needs dismissing. */
function milestoneFor(answered: number, total: number): string | null {
  if (total === 0 || answered === 0) return null;
  if (answered >= total) return 'Every statement answered — send it off';
  const share = answered / total;
  if (share >= 0.75) return `Nearly there — ${total - answered} to go`;
  if (share >= 0.5) return 'Halfway there — nice going';
  if (share >= 0.25) return 'Great start, keep going';
  return null;
}

function SaveIndicator({ state, pending }: { state: SaveState; pending: number }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    idle: { text: '', cls: 'pill-plain' },
    saving: { text: 'Saving…', cls: 'pill-plain' },
    saved: { text: 'Saved ✓', cls: 'pill-ok' },
    offline: {
      text: pending > 0 ? `Offline — saved on this device (${pending})` : 'Offline — saved on this device',
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
