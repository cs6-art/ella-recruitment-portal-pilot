"use client";

import { useEffect, useRef, useState } from "react";

import type { LiveAvatarEvaluation, LiveAvatarPreparation } from "@/lib/live-avatar-screening";

type WidgetState = "idle" | "starting" | "connecting" | "live" | "ending" | "evaluating" | "ended" | "error" | "results";

type Props = {
  roleId: string;
  roleTitle: string;
  candidateName: string;
  preparation: LiveAvatarPreparation;
};

type LiveAvatarSessionInstance = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  attach: (element: HTMLMediaElement) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
};

function eventText(args: unknown[]) {
  const value = args[0];
  if (!value || typeof value !== "object") return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

export default function LiveAvatarInterview({ roleId, roleTitle, candidateName, preparation }: Props) {
  const [state, setState] = useState<WidgetState>("idle");
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<LiveAvatarEvaluation | null>(null);
  const [lastResponse, setLastResponse] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<LiveAvatarSessionInstance | null>(null);
  const sessionIdRef = useRef("");
  const endingRef = useRef(false);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
      sessionRef.current = null;
    };
  }, []);

  async function startInterview() {
    setError("");
    setEvaluation(null);
    setLastResponse("");
    endingRef.current = false;
    setState("starting");
    try {
      const tokenResponse = await fetch("/api/live-avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, candidateName, resumeSummary: preparation.resumeSummary, screeningQuestion: preparation.screeningQuestion }),
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenBody?.success) throw new Error(tokenBody?.error || "Ella isn't available right now.");

      const { LiveAvatarSession, SessionEvent, AgentEventsEnum } = await import("@heygen/liveavatar-web-sdk");
      const session = new LiveAvatarSession(tokenBody.sessionToken, { voiceChat: true }) as unknown as LiveAvatarSessionInstance;
      sessionRef.current = session;
      sessionIdRef.current = typeof tokenBody.sessionId === "string" ? tokenBody.sessionId : "";

      const stateChanged = (...args: unknown[]) => {
        const nextState = String(args[0] || "");
        if (nextState === "CONNECTING") setState("connecting");
        if (nextState === "DISCONNECTED" && !endingRef.current) setState((current) => current === "error" ? current : "ended");
      };
      const streamReady = () => {
        setState("live");
        if (videoRef.current) session.attach(videoRef.current);
      };
      const userTranscription = (...args: unknown[]) => {
        const text = eventText(args);
        if (text) setLastResponse(text);
      };
      session.on(SessionEvent.SESSION_STATE_CHANGED, stateChanged);
      session.on(SessionEvent.SESSION_STREAM_READY, streamReady);
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, userTranscription);

      setState("connecting");
      await session.start();
    } catch (caught) {
      console.error("[LiveAvatarInterview] Failed to start session:", caught);
      setError(caught instanceof Error ? caught.message : "Ella isn't available right now.");
      setState("error");
      sessionRef.current = null;
    }
  }

  async function processResponse() {
    const sessionId = sessionIdRef.current;
    endingRef.current = true;
    setState("ending");
    try {
      await sessionRef.current?.stop();
      if (!sessionId) throw new Error("The interview session did not return an id.");
      setState("evaluating");
      let response: Response | null = null;
      let result: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch("/api/live-avatar/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, roleId, screeningQuestion: preparation.screeningQuestion }),
        });
        result = await response.json().catch(() => ({}));
        if (response.ok && result.success === true) break;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
      if (!response?.ok || result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "Ella could not process the response yet.");
      setEvaluation(result.evaluation as LiveAvatarEvaluation);
      setState("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to process the interview response.");
      setState("error");
    } finally {
      sessionRef.current = null;
    }
  }

  const active = state === "connecting" || state === "live";

  return (
    <section className="card live-avatar-card" aria-labelledby="live-avatar-title">
      <div className="card-header">
        <div>
          <span className="form-eyebrow">STEP 2 · LIVE SCREENING</span>
          <h2 id="live-avatar-title">Meet Ella for one focused question</h2>
        </div>
        {state === "live" && <span className="live-avatar-live-pill">Live</span>}
      </div>
      <div className="live-avatar-body">
        {state === "idle" && (
          <>
            <p>Ella has reviewed the candidate's resume for the <strong>{roleTitle}</strong> role and prepared a question about the experience most relevant to it.</p>
            <div className="live-avatar-question"><span>Ella will ask</span><strong>{preparation.screeningQuestion}</strong></div>
            <p className="live-avatar-disclosure">This is an AI interview aid. The candidate's response will be transcribed and summarized for the recruitment team. You can stop at any time.</p>
            <button type="button" className="btn btn-primary" onClick={() => void startInterview()}>Start with Ella</button>
          </>
        )}

        {(state === "starting" || active) && (
          <div className="live-avatar-stage">
            <video ref={videoRef} autoPlay playsInline className={`live-avatar-video ${state === "live" ? "is-ready" : ""}`} />
            {state === "starting" && <div className="live-avatar-stage-overlay">Preparing your private interview…</div>}
            {state === "connecting" && <div className="live-avatar-stage-overlay">Waiting for Ella to join…</div>}
          </div>
        )}

        {lastResponse && active && <div className="live-avatar-transcript"><span>Candidate's latest response</span><p>{lastResponse}</p></div>}
        {active && <button type="button" className="btn btn-secondary" onClick={() => void processResponse()}>Finish and see results</button>}
        {(state === "ending" || state === "evaluating") && <p className="live-avatar-status" aria-live="polite">{state === "ending" ? "Closing the session…" : "Processing your response…"}</p>}

        {state === "results" && evaluation && (
          <div className="live-avatar-results" aria-live="polite">
            <div className="live-avatar-score"><span>Response signal</span><strong>{evaluation.score}%</strong></div>
            <div><strong>{evaluation.recommendation}</strong><p>{evaluation.summary}</p></div>
            {evaluation.strengths.length > 0 && <div><span className="live-avatar-result-label">What came through</span><ul>{evaluation.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            <div><span className="live-avatar-result-label">Useful follow-up</span><ul>{evaluation.focusAreas.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <p className="live-avatar-disclosure">This is an interview aid, not an automated hiring decision. The recruitment team reviews the full application.</p>
            <button type="button" className="btn btn-secondary" onClick={() => { setState("idle"); setEvaluation(null); }}>Run again</button>
          </div>
        )}

        {state === "ended" && <><p>Ella has ended the session. You can try the question again or return to the screening record.</p><button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button></>}
        {state === "error" && <><p className="error-box">{error}</p><button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button></>}
      </div>
    </section>
  );
}
