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
    <Shell branding={branding} subtitle={session.assessment.name} friendly>
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
  const answered = session.response?.answeredCount ?? 0;
  const minutes = Math.max(5, Math.round(total / 4));

  return (
    <div className="stage">
      <div className="welcome rise">
        <span className="eyebrow">
          {total} statements · about {minutes} minutes
        </span>

        <h1 className="display">
          {resuming ? 'Welcome back — pick up where you left off.' : 'How do you influence people?'}
        </h1>

        <p className="lede">
          {resuming
            ? `You have answered ${answered} of ${total} statements. Everything you did last time is saved, so carry straight on.`
            : 'Rate each statement from 0 to 5 — one at a time, no right or wrong answers. At the end you get a plain-language report on the ten ways you influence others.'}
        </p>

        <div className="badges">
          <span className="badge">
            <span className="dot o" aria-hidden="true" />5 Push styles
          </span>
          <span className="badge">
            <span className="dot t" aria-hidden="true" />5 Pull styles
          </span>
          <span className="badge">
            <span className="dot g" aria-hidden="true" />
            Report emailed as a PDF
          </span>
        </div>

        <div className="cta-row">
          <button className="btn btn-primary btn-lg btn-block" onClick={onStart}>
            {resuming ? 'Continue where I left off' : "Let's begin"}
          </button>
        </div>
        <p className="fineprint">
          Takes about {minutes} minutes. Your answers save themselves as you go.
        </p>

        <div className="rulecard">
          <h3>Three things before you begin</h3>
          <ul className="rulelist">
            <li>
              <span className="tick" aria-hidden="true">
                1
              </span>
              <span>
                There are no right or wrong answers — answer as you are, not as you would like to be.
              </span>
            </li>
            <li>
              <span className="tick" aria-hidden="true">
                2
              </span>
              <span>
                Rate every statement from 0 (never like me) to 5 (always like me). Your first instinct
                is usually the honest one.
              </span>
            </li>
            <li>
              <span className="tick" aria-hidden="true">
                3
              </span>
              <span>
                Stop whenever you like. This link does not expire and it brings you back to exactly
                this spot.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
