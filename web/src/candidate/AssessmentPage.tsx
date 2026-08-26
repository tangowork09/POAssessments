/**
 * The assessment itself: welcome → details → paged statements → completion.
 *
 * Resume is the default rather than a feature. On load the session is fetched
 * from the server, merged with any local snapshot, and the candidate is placed
 * back on the page they left — including their in-flight answers if they went
 * offline mid-page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { Autosave, type SaveState } from '../lib/autosave.js';
import { Centered, DEFAULT_BRANDING, LogoSlot, Shell, useAccent } from './Shell.js';
import { ScreenSkeleton } from './Skeleton.js';
import { DetailsForm } from './DetailsForm.js';
import { IdentityForm } from './IdentityForm.js';
import { QuestionPage } from './QuestionPage.js';
import { MatrixPage } from './MatrixPage.js';
import { Completion } from './Completion.js';
import { SOCIO_ITEM_COUNT } from '../../../src/shared/socio.js';
import type { CandidateCohort, CandidateDetails, CandidateSession } from '../../../src/shared/types.js';

/**
 * 'begin' is the instrument's own begin-test screen: its title, its logo and
 * its rating instructions, verbatim. It sits before the details form so the
 * candidate knows what the numbers mean before they are asked for anything.
 */
type Step = 'begin' | 'details' | 'questions' | 'done';

export function AssessmentPage() {
  const { token = '' } = useParams();
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('begin');
  const [responseId, setResponseId] = useState<string>('');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [page, setPage] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reportReady, setReportReady] = useState(false);
  /**
   * Held here rather than read straight off the session, because identifying
   * yourself sets it mid-session — and the matrix cannot be drawn until it is
   * known, since the respondent's own row has to be absent from the list.
   */
  const [cohort, setCohort] = useState<CandidateCohort | null>(null);

  const autosave = useRef<Autosave | null>(null);
  // Read by the watch below. Held in refs so that a change to either does not
  // tear the interval down and start a fresh minute.
  const sessionRef = useRef<CandidateSession | null>(null);
  const errorRef = useRef<string | null>(null);
  sessionRef.current = session;
  errorRef.current = loadError;

  // ------------------------------------------------------------------ load

  /**
   * Take a session from the server and put the screen where it belongs.
   *
   * Shared by the first load and by the watch below, so a page that recovers —
   * the facilitator opens the cohort after someone arrived early — lands in the
   * same place it would have on a fresh visit rather than in a half-state.
   */
  const applySession = useCallback((s: CandidateSession) => {
    setSession(s);
    setCohort(s.cohort);
    setLoadError(null);

    if (s.response) {
      setResponseId(s.response.responseId);
      setAnswers(s.response.answers);
      setPage(s.response.resumePage);

      if (s.response.status === 'completed') {
        setStep('done');
        setReportReady(s.reportAvailable);
      } else if (s.cohort) {
        // Without a rater position the matrix cannot exclude the respondent's
        // own row, so identity always comes first.
        if (s.response.raterMemberId && s.response.answeredCount > 0) setStep('questions');
        else setStep('begin');
      } else if (s.response.details && s.response.answeredCount > 0) {
        setStep('questions');
      } else if (s.response.details) {
        setStep('begin');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CandidateSession>(`/api/candidate/session/${encodeURIComponent(token)}`)
      .then((s) => {
        if (!cancelled) applySession(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'This link could not be opened.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applySession, token]);

  /**
   * Keep an open tab honest about the exercise still being open.
   *
   * The page loads its session once and then lives for as long as the tab does
   * — which for a group exercise is often all afternoon. If the facilitator
   * closes the cohort, re-issues the link, or deactivates it in the meantime,
   * nothing here notices: the respondent carries on rating and finds out only
   * when the submit is refused, and the only way to see the real state is to
   * reload a page nobody thinks to reload.
   *
   * So the session is re-fetched quietly: once a minute while the tab is
   * visible, and immediately when it becomes visible again or the network comes
   * back. Only a verdict from the server acts — 403 (closed, not yet open,
   * deactivated), 404 (link no longer recognised) or 410. A network failure is
   * ignored outright, because "offline for ten seconds" must never look like
   * "this exercise has closed"; the autosave engine already handles being
   * offline and holds the answers until it can flush them.
   *
   * A finished response stops the watch: there is nothing left to protect.
   */
  useEffect(() => {
    if (step === 'done') return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check(): Promise<void> {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        // The cheap endpoint, not the whole session: this runs every minute for
        // as long as the tab is open, and the session carries the questions,
        // the intro and the roster with it.
        const state = await api.get<{ ok: true; roundNo?: number; responded?: string[] }>(
          `/api/candidate/session/${encodeURIComponent(token)}/state`,
        );
        if (stopped) return;

        // Recovering: someone arrived before the facilitator opened the cohort,
        // and it has just opened. The full session is worth fetching now,
        // because the screen is about to become the exercise.
        if (errorRef.current || !sessionRef.current) {
          applySession(
            await api.get<CandidateSession>(`/api/candidate/session/${encodeURIComponent(token)}`),
          );
          return;
        }

        // Who has already responded changes while the roster list is on screen,
        // and that list is only read before someone claims their own row.
        if (state.responded) {
          const taken = new Set(state.responded);
          setCohort((prev) =>
            prev
              ? {
                  ...prev,
                  roster: prev.roster.map((m) => ({ ...m, responded: taken.has(m.memberId) })),
                }
              : prev,
          );
        }
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && [403, 404, 410].includes(err.status)) {
          // Came here via a remembered personal link that has since been
          // rotated? Forget it and fall back to the door we were given.
          try {
            const from = sessionStorage.getItem('ap:plink-from');
            if (from && localStorage.getItem(`ap:plink:${from}`) === token) {
              localStorage.removeItem(`ap:plink:${from}`);
              sessionStorage.removeItem('ap:plink-from');
              window.location.replace(`/t/${from}`);
              return;
            }
          } catch {
            /* fall through to the plain error */
          }
          setLoadError(err.message);
        }
        // Anything else — offline, a blip, a 500 — is not a verdict.
      }
    }

    function onVisible(): void {
      if (document.visibilityState === 'visible') void check();
    }

    timer = setInterval(() => void check(), 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [applySession, step, token]);

  // Bring the autosave engine up once a response exists, and merge anything the
  // browser still holds from a previous, possibly offline, visit.
  useEffect(() => {
    if (!responseId) return;
    const engine = new Autosave(token, responseId);
    autosave.current = engine;

    const local = engine.restore();
    engine.hydrate(answers, page);
    if (local) {
      setAnswers((prev) => ({ ...prev, ...local.answers }));
      setPage((prev) => Math.max(prev, local.page));
    }

    const off = engine.onChange((state, pending) => {
      setSaveState(state);
      setPendingCount(pending);
    });
    engine.start();
    void engine.flush();

    return () => {
      off();
      engine.stop();
      autosave.current = null;
    };
    // Intentionally keyed on the response only: re-running on every answer
    // would tear the engine down mid-flush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseId, token]);

  const branding = session?.branding ?? DEFAULT_BRANDING;
  useAccent(branding);

  // Colleagues with a complete row. Derived from the answers rather than
  // counted as they are given, so a resumed session shows the true figure.
  const ratedTargets = useMemo(() => {
    if (!cohort) return 0;
    const filled = new Map<number, number>();
    for (const key of Object.keys(answers)) {
      const memberNo = Math.floor((Number(key) - 1) / SOCIO_ITEM_COUNT) + 1;
      filled.set(memberNo, (filled.get(memberNo) ?? 0) + 1);
    }
    return [...filled.values()].filter((n) => n === SOCIO_ITEM_COUNT).length;
  }, [answers, cohort]);

  const perPage = session?.perPage ?? 8;
  const questions = useMemo(() => session?.questions ?? [], [session]);
  const pageCount = Math.max(1, Math.ceil(questions.length / perPage));

  // --------------------------------------------------------------- actions

  const handleAnswer = useCallback((no: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [no]: value }));
    autosave.current?.record(no, value);
  }, []);

  /**
   * Clears every rating given about one colleague. The server is the authority
   * — a row blanked only in the browser would still be scored — so local state
   * follows the request rather than leading it.
   */
  const handleSkip = useCallback(async (memberNo: number): Promise<boolean> => {
    const engine = autosave.current;
    if (!engine) return false;
    const ok = await engine.clear([memberNo], SOCIO_ITEM_COUNT);
    if (!ok) return false;
    setAnswers((prev) => {
      const next = { ...prev };
      for (let item = 1; item <= SOCIO_ITEM_COUNT; item++) {
        delete next[(memberNo - 1) * SOCIO_ITEM_COUNT + item];
      }
      return next;
    });
    return true;
  }, []);

  const handlePage = useCallback((next: number) => {
    setPage(next);
    autosave.current?.setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleDetails = useCallback(
    async (details: CandidateDetails) => {
      const res = await api.post<{
        responseId: string;
        personalToken: string | null;
        state: CandidateSession['response'];
      }>(`/api/candidate/start/${encodeURIComponent(token)}`, details);

      setResponseId(res.responseId);
      autosave.current?.setResponseId(res.responseId);
      if (res.state) {
        setAnswers((prev) => ({ ...res.state!.answers, ...prev }));
        setPage((prev) => Math.max(prev, res.state!.resumePage));
      }
      // A generic link hands back a personal continuation link. Swapping the
      // address bar over means closing the tab and returning still resumes.
      if (res.personalToken) {
        try {
          localStorage.setItem(`ap:plink:${token}`, res.personalToken);
        } catch {
          /* fine — reload just asks for the email again */
        }
        window.history.replaceState(null, '', `/t/${res.personalToken}`);
      }
      setStep('questions');
    },
    [token],
  );

  // A generic link opened after identifying earlier: this browser remembers the
  // personal link that was minted, so a reload resumes instead of starting
  // over at the begin screen. Stored per generic token, cleared if the personal
  // link has since been rotated dead.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`ap:plink:${token}`);
      if (stored && stored !== token) {
        sessionStorage.setItem('ap:plink-from', token);
        window.location.replace(`/t/${stored}`);
      }
    } catch {
      /* private mode: simply no resume shortcut */
    }
  }, [token]);

  const handleIdentity = useCallback(
    async (identity: { email: string; otp?: string }) => {
      const res = await api.post<{
        responseId: string;
        personalToken: string | null;
        selfMemberId: string;
        roster: CandidateCohort['roster'];
        allowedTargetIds: string[] | null;
        state: CandidateSession['response'];
        completed?: boolean;
      }>(`/api/candidate/start/${encodeURIComponent(token)}`, identity);

      // This email has already finished this round. The server returns no
      // answers and no new link — the exercise is closed for them — so the
      // screen says so rather than reopening a completed matrix.
      if (res.completed) {
        setStep('done');
        return;
      }

      setResponseId(res.responseId);
      autosave.current?.setResponseId(res.responseId);
      // The roster arrives only now — the server withholds names until the
      // email proves this person is on the list, and hands back just their
      // slice of the group.
      setCohort((prev) =>
        prev
          ? {
              ...prev,
              selfMemberId: res.selfMemberId,
              roster: res.roster,
              allowedTargetIds: res.allowedTargetIds,
            }
          : prev,
      );
      if (res.state) {
        setAnswers((prev) => ({ ...res.state!.answers, ...prev }));
        setPage((prev) => Math.max(prev, res.state!.resumePage));
      }
      if (res.personalToken) {
        try {
          localStorage.setItem(`ap:plink:${token}`, res.personalToken);
        } catch {
          /* fine — reload just asks for the email again */
        }
        window.history.replaceState(null, '', `/t/${res.personalToken}`);
      }
      setStep('questions');
    },
    [token],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await autosave.current?.flush();
      const res = await api.post<{ completed: boolean; reportToken?: string }>(
        `/api/candidate/submit/${encodeURIComponent(token)}`,
        { responseId },
      );
      autosave.current?.clearLocal();
      setReportReady(Boolean(res.reportToken));
      setStep('done');
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray((err.details as unknown as number[] | undefined))) {
        setSubmitError(err.message);
      } else {
        setSubmitError(
          err instanceof ApiError ? err.message : 'We could not submit your answers. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [responseId, token]);

  // ------------------------------------------------------------------ views

  if (loadError) {
    return (
      <Shell branding={DEFAULT_BRANDING}>
        <Centered>
          <p className="eyebrow">Link unavailable</p>
          <h1 className="display" style={{ fontSize: 24, marginTop: 10 }}>
            {loadError}
          </h1>
          <p className="hint" style={{ marginTop: 14 }}>
            If you believe this is a mistake, contact whoever invited you and ask them to check the link.
          </p>
        </Centered>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell branding={DEFAULT_BRANDING} friendly>
        <ScreenSkeleton />
      </Shell>
    );
  }

  return (
    <Shell branding={branding} subtitle={session.assessment.name} friendly>
      {step === 'begin' && (
        <BeginTest
          session={session}
          resuming={Boolean(session.response && session.response.answeredCount > 0)}
          onStart={() =>
            setStep(
              (cohort ? Boolean(cohort.selfMemberId) : Boolean(session.response?.details))
                ? 'questions'
                : 'details',
            )
          }
        />
      )}

      {step === 'details' &&
        (cohort ? (
          <IdentityForm
            cohort={cohort}
            initialEmail={session.response?.details?.email ?? ''}
            onSubmit={handleIdentity}
            onRequestCode={(email) =>
              api.post<{ sent: boolean; minutes: number }>(
                `/api/candidate/otp/${encodeURIComponent(token)}`,
                { email },
              )
            }
            onBack={() => setStep('begin')}
          />
        ) : (
          <DetailsForm
            initial={session.response?.details ?? null}
            lockedEmail={session.linkKind === 'personal' ? (session.response?.details?.email ?? null) : null}
            onSubmit={handleDetails}
            onBack={() => setStep('begin')}
          />
        ))}

      {step === 'questions' &&
        (cohort ? (
          <MatrixPage
            cohort={cohort}
            scale={session.scale}
            answers={answers}
            page={page}
            saveState={saveState}
            pendingCount={pendingCount}
            submitting={submitting}
            submitError={submitError}
            onAnswer={handleAnswer}
            onSkip={handleSkip}
            onPage={handlePage}
            onSubmit={handleSubmit}
          />
        ) : (
          <QuestionPage
            questions={questions}
            scale={session.scale}
            perPage={perPage}
            page={Math.min(page, pageCount - 1)}
            answers={answers}
            saveState={saveState}
            pendingCount={pendingCount}
            submitting={submitting}
            submitError={submitError}
            onAnswer={handleAnswer}
            onPage={handlePage}
            onSubmit={handleSubmit}
          />
        ))}

      {step === 'done' && (
        <Completion
          session={session}
          token={token}
          reportReady={reportReady || session.reportAvailable}
          email={session.response?.details?.email ?? ''}
          cohort={cohort}
          ratedCount={ratedTargets}
        />
      )}
    </Shell>
  );
}

// ------------------------------------------------------------- begin test

/**
 * The begin-test screen. Everything on it comes from the instrument's own
 * registry entry (`session.intro`) rather than being written into the
 * component, so the Influencing Styles Questionnaire and the Ego States Scale
 * present their own titles and their own rating instructions verbatim.
 *
 * Zero-scroll: the `.stage-scroll` region is the only thing that gives on a
 * short screen, and the primary button stays pinned in `.stage-pin`.
 */
function BeginTest({
  session,
  resuming,
  onStart,
}: {
  session: CandidateSession;
  resuming: boolean;
  onStart: () => void;
}) {
  const intro = session.intro;
  const total = session.questions.length;
  const answered = session.response?.answeredCount ?? 0;

  /**
   * A cohort instrument's twelve statements are asked once per colleague, not
   * once in total, so counting statements the way the self-rating instruments
   * do ("12 statements") understates it by a factor of the roster. What the
   * respondent actually faces is a number of colleagues.
   */
  const cohort = session.cohort;
  const targets = cohort
    ? cohort.allowedTargetIds
      ? cohort.allowedTargetIds.length
      : Math.max(0, (cohort.roster.length > 0 ? cohort.roster.length : cohort.rosterSize) - 1)
    : 0;
  const scopeLine = cohort
    ? `${targets} ${targets === 1 ? 'colleague' : 'colleagues'} to rate, ${total} statements about each`
    : `${total} statements`;

  return (
    <div className="stage">
      <div className="welcome rise">
        <div className="stage-scroll">
          {/* Two boxes, not seven: from 900px wide the orientation and the
              instruction card sit side by side, and a single wrapper is what
              keeps the left-hand column one grid cell. */}
          <div className="intro-copy">
            <div className="intro-mark">
              <LogoSlot branding={session.branding} size={54} />
            </div>

            <span className="eyebrow">{intro.eyebrow}</span>

            <h1 className="display">{resuming ? 'Welcome back' : intro.title}</h1>

            <p className="lede">
              {resuming
                ? cohort
                  ? 'Everything you entered last time is saved, so carry straight on from the colleague you left off at.'
                  : `You have answered ${answered} of ${total} statements. Everything from last time is saved, so carry straight on.`
                : intro.lede}
            </p>
          </div>

          <div className="rulecard">
            <h3>{intro.instructionsTitle}</h3>
            <ul className="rulelist">
              {intro.instructions.map((line, i) => (
                <li key={line}>
                  <span className="tick" aria-hidden="true">
                    {intro.instructionBadges?.[i] ?? i + 1}
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {intro.emphasis ? <p className="ruleemph">{intro.emphasis}</p> : null}
          </div>
        </div>

        <div className="stage-pin">
          <div className="cta-row">
            <button className="btn btn-primary btn-lg btn-block" onClick={onStart}>
              {resuming ? intro.ctaResume : intro.cta}
            </button>
          </div>
          <p className="fineprint">
            {scopeLine} · your answers save themselves as you go, and this link never expires.
          </p>
        </div>
      </div>
    </div>
  );
}
