"use client";

import { useEffect, useRef, useState } from "react";

import type { LiveAvatarEvaluation, LiveAvatarPreparation } from "@/lib/live-avatar-screening";

type WidgetState = "idle" | "starting" | "connecting" | "live" | "ending" | "evaluating" | "ended" | "error" | "results";

type Props = {
  roleId: string;
  roleTitle: string;
  candidateName: string;
  preparation: LiveAvatarPreparation;
  accessToken?: string;
};

type LiveAvatarSessionInstance = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  attach: (element: HTMLMediaElement) => void;
  voiceChat?: {
    state?: string;
    isMuted?: boolean;
    start?: () => Promise<void>;
  };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
};

function eventText(args: unknown[]) {
  const value = args[0];
  if (!value || typeof value !== "object") return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

export default function LiveAvatarInterview({ roleId, candidateName, preparation, accessToken = "" }: Props) {
  const [state, setState] = useState<WidgetState>("idle");
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<LiveAvatarEvaluation | null>(null);
  const [lastResponse, setLastResponse] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [microphoneWarning, setMicrophoneWarning] = useState("");
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

  async function playAvatarAudio() {
    const video = videoRef.current;
    if (!video) return;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.volume = 1;
    try {
      await video.play();
      setAudioBlocked(false);
    } catch {
      // Chrome may reject playback after the session API/WebRTC awaits. Keep
      // the session alive and give the candidate a direct user-gesture retry.
      setAudioBlocked(true);
    }
  }

  function microphoneErrorMessage(caught: unknown) {
    const name = caught instanceof DOMException ? caught.name : "";
    if (name === "NotFoundError") return "No microphone input device was found. Connect or select a microphone, then retry.";
    if (name === "NotReadableError") return "Your microphone is busy or unavailable to the browser. Close other apps using it, then retry.";
    if (name === "NotAllowedError" || name === "SecurityError") return "Chrome is still blocking microphone capture for this site. Reset the site permission, reload, and allow the microphone again.";
    return "The microphone could not be connected. Check the selected input device and browser permission, then retry.";
  }

  async function retryMicrophone() {
    const voiceChat = sessionRef.current?.voiceChat;
    if (!voiceChat?.start) return;
    try {
      await voiceChat.start();
      if (voiceChat.state === "ACTIVE") setMicrophoneWarning("");
    } catch (caught) {
      setMicrophoneWarning(microphoneErrorMessage(caught));
    }
  }

  async function startInterview() {
    setError("");
    setEvaluation(null);
    setLastResponse("");
    setAudioBlocked(false);
    setMicrophoneWarning("");
    endingRef.current = false;
    setState("starting");
    try {
      const tokenResponse = await fetch("/api/live-avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, candidateName, resumeSummary: preparation.resumeSummary, screeningQuestion: preparation.screeningQuestion, avatarToken: accessToken || undefined }),
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenBody?.success) throw new Error(tokenBody?.error || "Smile isn't available right now.");

      const { LiveAvatarSession, SessionEvent, AgentEventsEnum, SessionInteractivityMode } = await import("@heygen/liveavatar-web-sdk");
      const session = new LiveAvatarSession(tokenBody.sessionToken, {
        voiceChat: { defaultMuted: false, mode: SessionInteractivityMode.CONVERSATIONAL },
      }) as unknown as LiveAvatarSessionInstance;
      sessionRef.current = session;
      sessionIdRef.current = typeof tokenBody.sessionId === "string" ? tokenBody.sessionId : "";

      const stateChanged = (...args: unknown[]) => {
        const nextState = String(args[0] || "");
        if (nextState === "CONNECTING") setState("connecting");
        if (nextState === "DISCONNECTED" && !endingRef.current) setState((current) => current === "error" ? current : "ended");
      };
      const streamReady = () => {
        setState("live");
        if (videoRef.current) {
          videoRef.current.muted = false;
          videoRef.current.volume = 1;
          session.attach(videoRef.current);
        }
        void playAvatarAudio();
        // LiveKit may mute a combined audio/video element when its first
        // autoplay attempt races the remote track attachment. Retry after the
        // track has settled so the candidate can hear Smile without needing a
        // second browser permission flow.
        window.setTimeout(() => void playAvatarAudio(), 300);
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
      if (session.voiceChat?.state !== "ACTIVE") {
        setMicrophoneWarning("Smile is connected, but the microphone is not active yet. Check the input device and retry microphone access below.");
      }
    } catch (caught) {
      console.error("[LiveAvatarInterview] Failed to start session:", caught);
      setError(caught instanceof Error ? caught.message : "Smile isn't available right now.");
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
          body: JSON.stringify({ sessionId, roleId, screeningQuestion: preparation.screeningQuestion, avatarToken: accessToken || undefined }),
        });
        result = await response.json().catch(() => ({}));
        if (response.ok && result.success === true) break;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
      if (!response?.ok || result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "Smile could not process the response yet.");
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
          <h2 id="live-avatar-title">Meet Smile for one focused question</h2>
        </div>
        {state === "live" && <span className="live-avatar-live-pill">Live</span>}
      </div>
      <div className="live-avatar-body">
        {state === "idle" && (
          <>
            <p className="live-avatar-disclosure">This is an AI interview aid. The candidate's response will be transcribed and summarized for the recruitment team. You can stop at any time.</p>
            <button type="button" className="btn btn-primary" onClick={() => void startInterview()}>Start with Smile</button>
          </>
        )}

        {(state === "starting" || active) && (
          <div className="live-avatar-stage">
            <video ref={videoRef} autoPlay playsInline className={`live-avatar-video ${state === "live" ? "is-ready" : ""}`} />
            {state === "starting" && <div className="live-avatar-stage-overlay">Preparing your private interview…</div>}
            {state === "connecting" && <div className="live-avatar-stage-overlay">Waiting for Smile to join…</div>}
            {audioBlocked && <button type="button" className="live-avatar-audio-retry" onClick={() => void playAvatarAudio()}>Enable sound</button>}
          </div>
        )}

        {microphoneWarning && active && <div className="live-avatar-mic-warning" role="status"><span>{microphoneWarning}</span><button type="button" className="btn btn-secondary" onClick={() => void retryMicrophone()}>Retry microphone</button></div>}
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
            {!accessToken && <button type="button" className="btn btn-secondary" onClick={() => { setState("idle"); setEvaluation(null); }}>Run again</button>}
          </div>
        )}

        {state === "ended" && <><p>Smile has ended the session. {accessToken ? "This one-time invitation is now closed." : "You can try the question again or return to the screening record."}</p>{!accessToken && <button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button>}</>}
        {state === "error" && <><p className="error-box">{error}</p>{accessToken ? <p>This secure invitation can only be used once. Please contact the recruitment team if you need help.</p> : <button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button>}</>}
      </div>
    </section>
  );
}
