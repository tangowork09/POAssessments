/**
 * The rating matrix: one colleague at a time, one statement at a time, with the
 * instrument's four sections behind a chooser.
 *
 * The workbook is a spreadsheet — fifty rows by twelve columns, filled in any
 * order. That grid does not survive contact with a phone, and it hides the
 * thing that matters most about this instrument: you are answering about one
 * named person at a time, and it should feel like it.
 *
 * A statement at a time is the same shape the other two instruments use, so a
 * respondent who has taken one of those meets a screen they already know. What
 * this one adds is the second axis — which colleague, and which section — and
 * both live in the info panel at the top rather than in a side rail, so the
 * layout is the same object on a phone as on a desktop.
 *
 * A whole person can be left out — the workbook's own "if you have no real
 * basis to judge someone, leave those cells blank" — and "We don't really work
 * together" is the fast way to say it. But a person who is rated at all must be
 * rated on every statement: the review step refuses a part-rated row, because a
 * block average built from half its statements is a different number wearing
 * the same name, and the group report ranks those numbers against each other.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SaveState } from '../lib/autosave.js';
import {
  SOCIO_BLOCKS,
  SOCIO_ITEMS,
  SOCIO_ITEM_BY_NO,
  SOCIO_ITEM_COUNT,
  cellNo,
} from '../../../src/shared/socio.js';
import type { CandidateCohort, CohortRosterMember, ScaleInfo } from '../../../src/shared/types.js';

const AUTO_ADVANCE_MS = 260;

/** A colleague's row: how many of the twelve statements carry a rating. */
type RowState = 'untouched' | 'partial' | 'complete';

function rowState(answers: Record<number, number>, memberNo: number): RowState {
  let filled = 0;
  for (const item of SOCIO_ITEMS) {
    if (answers[cellNo(memberNo, item.no)] !== undefined) filled += 1;
  }
  if (filled === 0) return 'untouched';
  return filled === SOCIO_ITEM_COUNT ? 'complete' : 'partial';
}

interface Section {
  key: string;
  name: string;
  gloss: string;
  items: number[];
}

/**
 * The four blocks, with the one deficit-polarity statement folded into the last
 * of them. Built from the instrument definition rather than written out, so a
 * change to the blocks changes the screen.
 */
const SECTIONS: Section[] = (() => {
  const deficit = SOCIO_ITEMS.filter((i) => i.polarity === 'deficit').map((i) => i.no);
  return SOCIO_BLOCKS.map((b, i) => ({
    key: b.key,
    name: b.name,
    gloss: b.gloss,
    items: i === SOCIO_BLOCKS.length - 1 ? [...b.items, ...deficit] : [...b.items],
  }));
})();

/** Every statement in the order they are asked, flattened across the sections. */
const ITEM_ORDER: number[] = SECTIONS.flatMap((s) => s.items);
/** Which section each position in that order belongs to. */
const SECTION_OF: number[] = SECTIONS.flatMap((s, i) => s.items.map(() => i));
/** Where each section starts in the flattened order. */
const SECTION_START: number[] = SECTIONS.map((_, i) => SECTION_OF.indexOf(i));

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function MatrixPage({
  cohort,
  scale,
  answers,
  page,
  saveState,
  pendingCount,
  submitting,
  submitError,
  onAnswer,
  onSkip,
  onPage,
  onSubmit,
}: {
  cohort: CandidateCohort;
  scale: ScaleInfo;
  answers: Record<number, number>;
  page: number;
  saveState: SaveState;
  pendingCount: number;
  submitting: boolean;
  submitError: string | null;
  onAnswer: (no: number, value: number) => void;
  onSkip: (memberNo: number) => Promise<boolean>;
  onPage: (page: number) => void;
  onSubmit: () => void;
}) {
  // Everyone but the respondent. Their own row is not hidden by CSS — it is
  // absent from the list the component walks, so there is no state in which it
  // can be reached. An assigned rater's list is narrower still: only the
  // colleagues mapped to them, so a sixty-person cohort can ask each person
  // for ten ratings instead of fifty-nine.
  const targets = useMemo(() => {
    const allowed = cohort.allowedTargetIds ? new Set(cohort.allowedTargetIds) : null;
    return cohort.roster.filter(
      (m) => m.memberId !== cohort.selfMemberId && (!allowed || allowed.has(m.memberId)),
    );
  }, [cohort.allowedTargetIds, cohort.roster, cohort.selfMemberId]);

  const [index, setIndex] = useState(() => Math.min(Math.max(0, page), Math.max(0, targets.length - 1)));
  const [pos, setPos] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by `firstGap`, which several callbacks call. Holding the answers in a
  // ref keeps those callbacks stable across every keystroke of the exercise.
  const answersRef = useRef(answers);
  answersRef.current = answers;

  /**
   * Where to open a colleague: the first statement about them that carries no
   * rating, or the top if they are finished.
   *
   * Coming back to someone is nearly always coming back to a gap — a statement
   * passed over the first time round, or a row left half done when the tab was
   * closed. Landing on statement one and pressing Next past the answers already
   * given is work the screen can do instead. Moving forward statement by
   * statement is untouched: `advance` still goes to the next one in order,
   * answered or not, so nothing jumps around under an answer.
   */
  const firstGap = useCallback((memberNo: number): number => {
    const at = ITEM_ORDER.findIndex((no) => answersRef.current[cellNo(memberNo, no)] === undefined);
    return at === -1 ? 0 : at;
  }, []);

  useEffect(() => {
    if (touched.current) return;
    const next = Math.min(Math.max(0, page), Math.max(0, targets.length - 1));
    setIndex(next);
    // Resuming from the server's saved position lands on the same first gap a
    // leader picked by hand does — the two are the same act from the outside.
    const member = targets[next];
    if (member) setPos(firstGap(member.no));
  }, [firstGap, page, targets]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const current = targets[Math.min(index, Math.max(0, targets.length - 1))];
  const itemNo = ITEM_ORDER[Math.min(pos, ITEM_ORDER.length - 1)]!;
  const item = SOCIO_ITEM_BY_NO[itemNo]!;
  const sectionIdx = SECTION_OF[Math.min(pos, SECTION_OF.length - 1)]!;
  const section = SECTIONS[sectionIdx]!;
  const posInSection = pos - SECTION_START[sectionIdx]!;

  const value = current ? answers[cellNo(current.no, itemNo)] : undefined;

  const options = useMemo(
    () => Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i),
    [scale.max, scale.min],
  );

  const states = useMemo(() => targets.map((m) => rowState(answers, m.no)), [answers, targets]);
  /** How many of the twelve statements each colleague carries a rating for. */
  const answeredPerTarget = useMemo(
    () => targets.map((m) => ITEM_ORDER.filter((no) => answers[cellNo(m.no, no)] !== undefined).length),
    [answers, targets],
  );
  /** Anyone carrying at least one rating counts: a partial row is a real answer. */
  const ratedCount = states.filter((s) => s !== 'untouched').length;

  /** How many statements carry a rating in each section, for this colleague. */
  const answeredPerSection = useMemo(
    () =>
      SECTIONS.map((sec) =>
        current ? sec.items.filter((no) => answers[cellNo(current.no, no)] !== undefined).length : 0,
      ),
    [answers, current],
  );

  const answeredHere = useMemo(
    () =>
      current ? ITEM_ORDER.filter((no) => answers[cellNo(current.no, no)] !== undefined).length : 0,
    [answers, current],
  );

  /**
   * Which leader, and how far through each of them. "Skipped" is not among the
   * states on purpose: pressing "we don't really work together" clears the row,
   * which leaves it identical to a row nobody has reached yet. Claiming to tell
   * them apart would be inventing a distinction the data does not hold.
   */
  const leaderOptions: PickerOption[] = useMemo(
    () =>
      targets.map((m, i) => {
        const state = states[i]!;
        return {
          key: m.memberId,
          name: m.name,
          // One meaning per column: this is always the state, never the
          // function. Mixing the two made the same slot mean two things.
          note: state === 'complete' ? 'rated' : state === 'partial' ? 'in progress' : 'not rated',
          done: answeredPerTarget[i] ?? 0,
          total: SOCIO_ITEM_COUNT,
        };
      }),
    [answeredPerTarget, states, targets],
  );

  const sectionOptions: PickerOption[] = useMemo(
    () =>
      SECTIONS.map((sec, i) => {
        const n = answeredPerSection[i] ?? 0;
        return {
          key: sec.key,
          name: sec.name,
          note: n === 0 ? 'not started' : n === sec.items.length ? 'all answered' : `${n} of ${sec.items.length}`,
          done: n,
          total: sec.items.length,
        };
      }),
    [answeredPerSection],
  );

  /**
   * The bar is about the leader on screen, not the whole cohort.
   *
   * A cohort-wide bar barely moved — one statement of sixty is under two per
   * cent — so it read as broken. Twelve statements is a length someone can feel
   * themselves getting through, and how far along the roster you are is already
   * stated in words above it and in the leader chooser below.
   */
  const progress = answeredHere / SOCIO_ITEM_COUNT;

  const goTo = useCallback(
    (nextIndex: number, nextPos: number) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const clampedIndex = Math.min(Math.max(0, nextIndex), Math.max(0, targets.length - 1));
      touched.current = true;
      setSkipError(null);
      setIndex(clampedIndex);
      setPos(Math.min(Math.max(0, nextPos), ITEM_ORDER.length - 1));
      // The server stores resume position per colleague, which is the unit it
      // can act on; the statement is a detail of this screen.
      onPage(clampedIndex);
    },
    [onPage, targets.length],
  );

  const advance = useCallback(() => {
    if (pos < ITEM_ORDER.length - 1) goTo(index, pos + 1);
    else if (index >= targets.length - 1) setReviewing(true);
    else goTo(index + 1, firstGap(targets[index + 1]!.no));
  }, [firstGap, goTo, index, pos, targets]);

  const goBack = useCallback(() => {
    if (pos > 0) goTo(index, pos - 1);
    else if (index > 0) goTo(index - 1, ITEM_ORDER.length - 1);
  }, [goTo, index, pos]);

  const pick = useCallback(
    (v: number) => {
      if (!current) return;
      onAnswer(cellNo(current.no, itemNo), v);
      if (timer.current) clearTimeout(timer.current);
      // A short beat so the choice registers before the next statement replaces
      // it. Skipped entirely when the reader has asked for less motion.
      timer.current = setTimeout(advance, prefersReducedMotion() ? 0 : AUTO_ADVANCE_MS);
    },
    [advance, current, itemNo, onAnswer],
  );

  const handleSkip = useCallback(async () => {
    if (!current) return;
    setSkipping(true);
    setSkipError(null);
    const ok = await onSkip(current.no);
    setSkipping(false);
    if (!ok) {
      setSkipError('We could not clear that just now. Check your connection and try again.');
      return;
    }
    if (index >= targets.length - 1) setReviewing(true);
    else goTo(index + 1, firstGap(targets[index + 1]!.no));
  }, [current, firstGap, goTo, index, onSkip, targets]);

  // Digits rate the statement; arrows and Enter move.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const n = Number(e.key);
      if (e.key.length === 1 && !Number.isNaN(n) && n >= scale.min && n <= scale.max) {
        e.preventDefault();
        pick(n);
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        goBack();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [advance, goBack, pick, scale.max, scale.min]);

  if (targets.length === 0) {
    return (
      <div className="stage">
        <div className="card rise">
          <div className="card-body">
            <h2 className="display">Nobody to rate</h2>
            <p className="lede">
              You are the only person on this group’s list, so there is nobody for you to rate. Your
              facilitator will need to add the rest of the group before this exercise can be completed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (reviewing) {
    return (
      <ReviewPanel
        targets={targets}
        states={states}
        minRatedTargets={cohort.minRatedTargets}
        ratedCount={ratedCount}
        submitting={submitting}
        submitError={submitError}
        onOpen={(i) => {
          setReviewing(false);
          // Straight to what is missing: the review screen exists to send
          // someone back to an unfinished row.
          goTo(i, firstGap(targets[i]!.no));
        }}
        onBack={() => setReviewing(false)}
        onSubmit={onSubmit}
      />
    );
  }

  const isLast = pos >= ITEM_ORDER.length - 1;

  return (
    <div className="matrix-screen">
      <div className="matrix-panel">
        <div className="matrix-info">
          <header className="matrix-head">
            <div className="matrix-who">
              <span className="eyebrow">Rating</span>
              <h2 className="matrix-who-name">{current!.name}</h2>
              <p className="matrix-who-func">
                {current!.func ? `${current!.func} · ` : ''}
                Colleague {index + 1} of {targets.length} · {ratedCount} rated
              </p>
            </div>
            <SaveBadge state={saveState} pending={pendingCount} />
          </header>

          <div className="matrix-progress">
            <div
              className="matrix-rail"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={SOCIO_ITEM_COUNT}
              aria-valuenow={answeredHere}
              aria-valuetext={`${answeredHere} of ${SOCIO_ITEM_COUNT} statements answered about ${current!.name}`}
            >
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="matrix-progress-label">
              Statement {pos + 1} of {SOCIO_ITEM_COUNT} · {answeredHere} answered
            </span>
          </div>

          {/* Both axes on one row where the width allows it: they are the same
              kind of control doing the same kind of job, and stacked they cost
              a second row of height the statement could have had. */}
          <div className="matrix-pickers">
          <div className="matrix-picker">
            <span className="matrix-picker-label" id="matrix-leader-label">
              Leader
            </span>
            <Picker
              id="matrix-leader"
              options={leaderOptions}
              value={index}
              onPick={(i) => goTo(i, firstGap(targets[i]!.no))}
            />
            <span className="matrix-counter">
              {index + 1} of {targets.length}
            </span>
          </div>

          <div className="matrix-picker">
            <span className="matrix-picker-label" id="matrix-section-label">
              Section
            </span>
            <Picker
              id="matrix-section"
              options={sectionOptions}
              value={sectionIdx}
              onPick={(i) => goTo(index, SECTION_START[i]!)}
            />
            <span className="matrix-counter">
              {posInSection + 1} of {section.items.length}
            </span>
          </div>
          </div>

          {/*
            The statements of the section as numbered steps, so the section
            chooser is not the only way to move: a respondent who wants to
            revisit the third statement about this person can go straight to it
            rather than pressing Back three times. A filled step is one that
            carries a rating — the same green the leader chooser uses for a
            finished row, so the two mean one thing across the screen.
          */}
          <div className="matrix-steps" role="group" aria-label={`Statements in ${section.name}`}>
            {section.items.map((no, i) => {
              const done = current ? answers[cellNo(current.no, no)] !== undefined : false;
              const here = i === posInSection;
              return (
                <button
                  key={no}
                  type="button"
                  className={`matrix-step${done ? ' is-done' : ''}${here ? ' is-now' : ''}`}
                  aria-current={here ? 'step' : undefined}
                  aria-label={`Statement ${i + 1} of ${section.items.length}${
                    done ? ', answered' : ', not answered'
                  }`}
                  onClick={() => goTo(index, SECTION_START[sectionIdx]! + i)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>

        <div className="matrix-question" key={`${current!.memberId}-${itemNo}`}>
          {/*
            The workbook's own column header for this statement, kept as a
            label above it. On the spreadsheet the header is what a facilitator
            reads across the top — "Trusted judgment", "Unlocks resources" — and
            it names in two words what the sentence below spells out. It also
            gives the section a visible grain: four statements under "Power — to
            & with" are four different things, and the label says which.
          */}
          <div className="matrix-tags">
            <span className="matrix-tag">{item.short}</span>
            {item.polarity === 'deficit' ? (
              <span className="matrix-tag is-gap">A request, not a score</span>
            ) : null}
          </div>

          <h1 className="matrix-statement">{item.text}</h1>

          <div
            className={`rating${value !== undefined ? ' has-pick' : ''}`}
            role="radiogroup"
            aria-label={item.text}
            // `--scale-n-sm` is what the shell's narrow breakpoint reads. Without
            // it the rule falls back to three columns and a five-point scale
            // wraps onto two rows on a phone.
            style={{
              ['--scale-n' as string]: String(options.length),
              ['--scale-n-sm' as string]: String(options.length),
            }}
          >
            {options.map((option, i) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={value === option}
                aria-label={`${option} — ${scale.labels[i] ?? option}`}
                className={`rate${value === option ? ' is-on' : ''}`}
                onClick={() => pick(option)}
              >
                <span className="v">{option}</span>
                <span className="k">{scale.shortLabels[i] ?? ''}</span>
              </button>
            ))}
          </div>

          {/* The anchor words are dropped from the squares on a narrow phone,
              where "MODERATELY" is wider than a fifth of the screen. The legend
              keeps the numbers meaning something once they go. */}
          <p className="matrix-legend" aria-hidden="true">
            <span>
              {scale.min} — {scale.labels[0]}
            </span>
            <span>
              {scale.max} — {scale.labels[scale.labels.length - 1]}
            </span>
          </p>

          <p className="matrix-optional">
            No view on this one? Leave it blank and carry on — a blank is a valid answer here.
          </p>

          {skipError ? (
            <div className="banner is-shown" style={{ marginTop: 4 }}>
              <span>{skipError}</span>
            </div>
          ) : null}
        </div>

        <footer className="matrix-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={goBack}
            disabled={index === 0 && pos === 0}
          >
            Back
          </button>

          {/* The same keyboard hint the other two instruments carry, and the
              same keys: this screen has answered them since it was built, but
              nothing said so. Hidden where there is no keyboard to press. */}
          <span className="keyhint">
            <kbd>{scale.min}</kbd>–<kbd>{scale.max}</kbd> rate · <kbd>↵</kbd> next · <kbd>⌫</kbd> back
          </span>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleSkip()}
            disabled={skipping}
          >
            {skipping ? 'Clearing…' : 'We don’t really work together'}
          </button>

          <button type="button" className="btn btn-primary" onClick={advance}>
            {!isLast ? (value === undefined ? 'Skip' : 'Next') : index >= targets.length - 1 ? 'Review and finish' : 'Next colleague'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

export interface PickerOption {
  key: string;
  name: string;
  /** The state or progress shown beside the name. */
  note: string;
  /** How many of this option's statements carry a rating, and how many there are. */
  done: number;
  total: number;
}

/**
 * The chooser used for both axes of this screen — which leader, and which
 * section.
 *
 * Not a native `<select>`: its popup is drawn by the operating system, so the
 * option rows cannot carry the colour or the per-option progress that make the
 * list worth opening, and on a desktop it renders as a grey system menu that
 * sits at odds with everything around it.
 *
 * A dropdown rather than a tab strip because a roster runs to fifty people. Four
 * sections would fit as tabs; fifty leaders never will, and having the two
 * choosers behave differently would be worse than either.
 */
function Picker({
  id,
  options,
  value,
  onPick,
}: {
  id: string;
  options: PickerOption[];
  value: number;
  onPick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const selected = options[value]!;

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent): void {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function choose(i: number): void {
    onPick(i);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(value);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) choose(active);
      else {
        setOpen(true);
        setActive(value);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`matrix-select${open ? ' is-open' : ''}`} ref={boxRef}>
      <button
        type="button"
        ref={btnRef}
        className="matrix-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        onClick={() => {
          setOpen((o) => !o);
          setActive(value);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="matrix-select-name">{selected.name}</span>
        <span className="matrix-select-note">{selected.note}</span>
        <Meter done={selected.done} total={selected.total} />
      </button>

      {open ? (
        <ul className="matrix-select-list" role="listbox" aria-labelledby={`${id}-label`}>
          {options.map((opt, i) => (
            <li
              key={opt.key}
              role="option"
              aria-selected={i === value}
              className={`matrix-select-opt${i === active ? ' is-active' : ''}${
                i === value ? ' is-picked' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="matrix-select-name">{opt.name}</span>
              <span className="matrix-select-note">{opt.note}</span>
              <Meter done={opt.done} total={opt.total} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * How far through an option you are, as a bar rather than a colour.
 *
 * The rows used to carry a coloured leading edge — the section's own hue on one
 * chooser, the row's state on the other. Two saturated bars a foot apart saying
 * two unrelated things is noise, and neither said the thing a respondent
 * actually wants when they open the list: how much of this one is left. The bar
 * does, in one glance down the column, and it is monochrome until an option is
 * finished — the one state worth a colour.
 *
 * `aria-hidden`: the note beside the name already says it in words.
 */
function Meter({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className={`matrix-meter${done >= total && total > 0 ? ' is-full' : ''}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function ReviewPanel({
  targets,
  states,
  minRatedTargets,
  ratedCount,
  submitting,
  submitError,
  onOpen,
  onBack,
  onSubmit,
}: {
  targets: CohortRosterMember[];
  states: RowState[];
  minRatedTargets: number;
  ratedCount: number;
  submitting: boolean;
  submitError: string | null;
  onOpen: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  /*
   * A part-rated colleague blocks submission. Every statement about a person
   * is mandatory once that person is rated at all: a block score is the
   * average of its statements, and two people rated on different subsets are
   * not comparable numbers, however alike the report makes them look. The way
   * out is stated on the row itself — finish them, or clear them with "no
   * basis to judge" — so the rule never traps anyone.
   */
  const partialCount = states.filter((s) => s === 'partial').length;
  const blocked = ratedCount < minRatedTargets || partialCount > 0;

  return (
    <div className="matrix-screen">
      <div className="matrix-panel">
        <div className="matrix-review">
          <span className="eyebrow">Last step</span>
          <h2 className="display">Before you finish</h2>
          <p className="lede">
            You gave ratings for {ratedCount} of {targets.length} colleagues. Anyone you left
            completely blank is fine — that says you had no real basis to judge them, which is useful
            in itself. A colleague you started must be finished: every statement about them, or none.
          </p>

          {partialCount > 0 ? (
            <div className="banner is-shown" style={{ marginTop: 16 }}>
              <span>
                {partialCount === 1
                  ? 'One colleague is partly rated. Open them below and answer the remaining statements, or use “no basis to judge” to clear them.'
                  : `${partialCount} colleagues are partly rated. Open each below and answer the remaining statements, or use “no basis to judge” to clear them.`}
              </span>
            </div>
          ) : null}

          {ratedCount < minRatedTargets ? (
            <div className="banner is-shown" style={{ marginTop: 16 }}>
              <span>
                Please rate at least {minRatedTargets}{' '}
                {minRatedTargets === 1 ? 'colleague' : 'colleagues'} before submitting.
              </span>
            </div>
          ) : null}

          <ul className="review-list">
            {targets.map((m, i) => (
              <li key={m.memberId}>
                <button type="button" className="review-row" onClick={() => onOpen(i)}>
                  <span className="review-name">{m.name}</span>
                  <span className={`review-state is-${states[i]}`}>
                    {states[i] === 'complete'
                      ? 'Rated'
                      : states[i] === 'partial'
                        ? 'Partly rated — finish or clear'
                        : 'Left blank'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {submitError ? (
            <div className="banner is-shown" style={{ marginTop: 16 }}>
              <span>{submitError}</span>
            </div>
          ) : null}
        </div>

        <footer className="matrix-foot">
          {/* Not "Keep rating": next to "Submit my ratings" that reads as
              "keep the ratings I have", which is what the other button does. */}
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Go back and edit
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={submitting || blocked}
          >
            {submitting ? 'Submitting…' : 'Submit my ratings'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SaveBadge({ state, pending }: { state: SaveState; pending: number }) {
  const text =
    state === 'saving'
      ? 'Saving…'
      : state === 'offline'
        ? `Offline — ${pending} saved`
        : state === 'error'
          ? 'Retrying…'
          : 'Saved';
  return (
    <span className={`save-badge is-${state}`} role="status">
      {text}
    </span>
  );
}
