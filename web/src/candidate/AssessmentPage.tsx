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
import { Centered, DEFAULT_BRANDING, Shell, useAccent } from './Shell.js';
import { DetailsForm } from './DetailsForm.js';
import { QuestionPage } from './QuestionPage.js';
import { Completion } from './Completion.js';
import type { CandidateDetails, CandidateSession } from '../../../src/shared/types.js';

type Step = 'welcome' | 'details' | 'questions' | 'done';

export function AssessmentPage() {
  const { token = '' } = useParams();
  const [session, setSession] = useState<CandidateSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [responseId, setResponseId] = useState<string>('');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [page, setPage] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reportReady, setReportReady] = useState(false);

  const autosave = useRef<Autosave | null>(null);

  // ------------------------------------------------------------------ load

  useEffect(() => {
    let cancelled = false;
    api
      .get<CandidateSession>(`/api/candidate/session/${encodeURIComponent(token)}`)
      .then((s) => {
        if (cancelled) return;
        setSession(s);

        if (s.response) {
          setResponseId(s.response.responseId);
          setAnswers(s.response.answers);
          setPage(s.response.resumePage);

          if (s.response.status === 'completed') {
            setStep('done');
            setReportReady(s.reportAvailable);
          } else if (s.response.details && s.response.answeredCount > 0) {
            setStep('questions');
          } else if (s.response.details) {
            setStep('welcome');
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'This link could not be opened.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  const perPage = session?.perPage ?? 8;
  const questions = useMemo(() => session?.questions ?? [], [session]);
  const pageCount = Math.max(1, Math.ceil(questions.length / perPage));

  // --------------------------------------------------------------- actions

  const handleAnswer = useCallback((no: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [no]: value }));
    autosave.current?.record(no, value);
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
      <Shell branding={DEFAULT_BRANDING}>
        <p className="hint" style={{ marginTop: 48 }}>
          Loading…
        </p>
      </Shell>
    );
  }

  return (
    <Shell branding={branding} subtitle={session.assessment.name}>
      {step === 'welcome' && (
        <Welcome
          session={session}
          resuming={Boolean(session.response && session.response.answeredCount > 0)}
          onStart={() => setStep(session.response?.details ? 'questions' : 'details')}
        />
      )}

      {step === 'details' && (
        <DetailsForm
          initial={session.response?.details ?? null}
          lockedEmail={session.linkKind === 'personal' ? (session.response?.details?.email ?? null) : null}
          onSubmit={handleDetails}
          onBack={() => setStep('welcome')}
        />
      )}

      {step === 'questions' && (
        <QuestionPage
          questions={questions}
          scaleLabels={session.scaleLabels}
          perPage={perPage}
          page={Math.min(page, pageCount - 1)}
          pageCount={pageCount}
          answers={answers}
          saveState={saveState}
          pendingCount={pendingCount}
          submitting={submitting}
          submitError={submitError}
          onAnswer={handleAnswer}
          onPage={handlePage}
          onSubmit={handleSubmit}
        />
      )}

      {step === 'done' && (
        <Completion
          session={session}
          token={token}
          reportReady={reportReady || session.reportAvailable}
          email={session.response?.details?.email ?? ''}
        />
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- welcome

function Welcome({
  session,
  resuming,
  onStart,
}: {
  session: CandidateSession;
  resuming: boolean;
  onStart: () => void;
}) {
  const total = session.questions.length;
  return (
    <div className="welcome">
      <div className="card welcome-card">
        <p className="eyebrow">{session.assessment.name}</p>
        <h1 className="display">
          {resuming ? 'Welcome back' : 'A short questionnaire about how you influence others'}
        </h1>
        <p className="welcome-lede">
          {resuming
            ? `You have answered ${session.response?.answeredCount ?? 0} of ${total} statements. Pick up exactly where you left off.`
            : `${total} statements, rated on a six-point scale. There are no right or wrong answers — rate how you actually behave at work, not how you feel you ought to.`}
        </p>

        <div className="meta-row">
          <span className="meta-chip">
            <IconList /> {total} statements
          </span>
          <span className="meta-chip">
            <IconClock /> ~10 minutes
          </span>
          <span className="meta-chip">
            <IconShield /> Confidential
          </span>
          <span className="meta-chip">
            <IconMail /> PDF report by email
          </span>
        </div>

        <ul className="expect">
          <li>
            <span className="idx">1</span>
            <p>
              <b>Tell us who you are.</b> A few details so your report can be addressed to you and sent
              to the right inbox.
            </p>
          </li>
          <li>
            <span className="idx">2</span>
            <p>
              <b>Rate each statement from 0 to 5.</b> Eight at a time, with your progress saved as you
              go.
            </p>
          </li>
          <li>
            <span className="idx">3</span>
            <p>
              <b>Receive your report.</b> Your ten influencing styles, your Push/Pull balance and a
              development area.
            </p>
          </li>
        </ul>

        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={onStart}>
            {resuming ? 'Continue where I left off' : 'Begin'}
          </button>
        </div>

        <p className="welcome-note">
          <IconShield />
          <span>
            Your answers are confidential and are used only to produce your report. You can stop at any
            point — this link does not expire, and returning to it brings back your progress.
          </span>
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- icons

const svg = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const;

function IconList() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...svg}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 6.5h5M5.5 9.5h3" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...svg}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...svg}>
      <path d="M8 2.2l4.4 1.8v3.4c0 2.7-1.8 5-4.4 5.9C5.4 12.4 3.6 10.1 3.6 7.4V4z" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...svg}>
      <path d="M2.5 4.5h11v8h-11z" />
      <path d="M2.8 5l5.2 4 5.2-4" />
    </svg>
  );
}
