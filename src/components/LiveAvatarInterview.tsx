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
  message?: (message: string) => string;
  voiceChat?: {
    state?: string;
    isMuted?: boolean;
    start?: (config?: { defaultMuted?: boolean; deviceId?: string }) => Promise<void>;
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
  const [avatarTranscript, setAvatarTranscript] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [microphoneWarning, setMicrophoneWarning] = useState("");
  const [typedResponse, setTypedResponse] = useState("");
  const [microphoneFallbackAvailable, setMicrophoneFallbackAvailable] = useState(false);
  const [sessionIssued, setSessionIssued] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<LiveAvatarSessionInstance | null>(null);
  const sessionIdRef = useRef("");
  const endingRef = useRef(false);
  const audioBlockedRef = useRef(false);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
      sessionRef.current = null;
    };
  }, []);

  async function playAvatarAudio() {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    video.autoplay = true;
    video.playsInline = true;
    const source = video.srcObject;
    if (source instanceof MediaStream && source.getAudioTracks().length > 0) {
      const current = audio.srcObject;
      const sourceTrack = source.getAudioTracks()[0];
      const currentTrack = current instanceof MediaStream ? current.getAudioTracks()[0] : null;
      if (currentTrack?.id !== sourceTrack.id) audio.srcObject = new MediaStream([sourceTrack]);
      // Keep the visual element silent and route Smile through a dedicated
      // audio element. Chrome otherwise may mute the combined WebRTC element
      // while continuing to show its video track.
      video.muted = true;
    }
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = 1;
    try {
      await video.play();
      await audio.play();
      audioBlockedRef.current = false;
      setAudioBlocked(false);
    } catch {
      // Chrome may reject playback after the session API/WebRTC awaits. Keep
      // the session alive and give the candidate a direct user-gesture retry.
      audioBlockedRef.current = true;
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

  async function requestMicrophoneDevice() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone capture.");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new DOMException("No microphone track was returned.", "NotFoundError");
      return track.getSettings().deviceId || "";
    } catch (caught) {
      throw new Error(microphoneErrorMessage(caught));
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function retryMicrophone() {
    const voiceChat = sessionRef.current?.voiceChat;
    if (!voiceChat?.start) return;
    try {
      const deviceId = await requestMicrophoneDevice();
      await voiceChat.start({ defaultMuted: false, deviceId: deviceId || undefined });
      if (voiceChat.state === "ACTIVE") setMicrophoneWarning("");
    } catch (caught) {
      setMicrophoneWarning(caught instanceof Error ? caught.message : microphoneErrorMessage(caught));
    }
  }

  function speakWithBrowserVoice(text: string) {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  function submitTypedResponse() {
    const text = typedResponse.trim();
    const session = sessionRef.current;
    if (!text || !session?.message) return;
    try {
      session.message(text);
      setLastResponse(text);
      setTypedResponse("");
    } catch (caught) {
      setMicrophoneWarning(caught instanceof Error ? caught.message : "Smile could not receive that response yet.");
    }
  }

  async function startInterview(allowWithoutMicrophone = false) {
    setError("");
    setEvaluation(null);
    setLastResponse("");
    setAvatarTranscript("");
    audioBlockedRef.current = false;
    setAudioBlocked(false);
    setMicrophoneWarning("");
    setMicrophoneFallbackAvailable(false);
    setTypedResponse("");
    setSessionIssued(false);
    endingRef.current = false;
    setState("starting");
    try {
      // Resolve the actual input device while this direct click still carries
      // browser permission activation, before consuming the one-time invite.
      let microphoneDeviceId = "";
      if (!allowWithoutMicrophone) {
        try {
          microphoneDeviceId = await requestMicrophoneDevice();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "The microphone could not be connected.");
          setMicrophoneFallbackAvailable(true);
          setState("error");
          return;
        }
      }
      const tokenResponse = await fetch("/api/live-avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, candidateName, resumeSummary: preparation.resumeSummary, screeningQuestion: preparation.screeningQuestion, avatarToken: accessToken || undefined }),
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenBody?.success) throw new Error(tokenBody?.error || "Smile isn't available right now.");
      setSessionIssued(true);

      const { LiveAvatarSession, SessionEvent, AgentEventsEnum } = await import("@heygen/liveavatar-web-sdk");
      const session = new LiveAvatarSession(tokenBody.sessionToken, {
        autoKeepAlive: true,
        voiceChat: { defaultMuted: false, deviceId: microphoneDeviceId || undefined },
      }) as unknown as LiveAvatarSessionInstance;
      if (!microphoneDeviceId && session.voiceChat?.start) {
        // SDK 0.0.19 attempts microphone capture whenever voiceChat is
        // configured. For the text fallback, keep the WebRTC avatar session
        // alive without publishing a local track.
        session.voiceChat.start = async () => {};
        setMicrophoneWarning("Microphone access is unavailable. Type your response below and Smile will still reply.");
      }
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
      const avatarTranscription = (...args: unknown[]) => {
        const text = eventText(args);
        if (!text) return;
        setAvatarTranscript(text);
        if (audioBlockedRef.current) speakWithBrowserVoice(text);
      };
      const avatarSpeakStarted = () => {
        // A fresh speech turn can arrive after Chrome has suspended playback;
        // reassert the dedicated audio output each time Smile starts talking.
        void playAvatarAudio();
      };
      session.on(SessionEvent.SESSION_STATE_CHANGED, stateChanged);
      session.on(SessionEvent.SESSION_STREAM_READY, streamReady);
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, userTranscription);
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, avatarTranscription);
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, avatarSpeakStarted);

      setState("connecting");
      await session.start();
      if (microphoneDeviceId && session.voiceChat?.state !== "ACTIVE") {
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
            <audio ref={audioRef} autoPlay />
            {state === "starting" && <div className="live-avatar-stage-overlay">Preparing your private interview…</div>}
            {state === "connecting" && <div className="live-avatar-stage-overlay">Waiting for Smile to join…</div>}
            {audioBlocked && <button type="button" className="live-avatar-audio-retry" onClick={() => void playAvatarAudio()}>Enable sound</button>}
          </div>
        )}

        {microphoneWarning && active && <div className="live-avatar-mic-warning" role="status"><span>{microphoneWarning}</span><button type="button" className="btn btn-secondary" onClick={() => void retryMicrophone()}>Retry microphone</button></div>}
        {avatarTranscript && active && <div className="live-avatar-transcript" aria-live="polite"><span>Smile</span><p>{avatarTranscript}</p>{audioBlocked && <button type="button" className="btn btn-secondary" onClick={() => speakWithBrowserVoice(avatarTranscript)}>Use browser voice</button>}</div>}
        {lastResponse && active && <div className="live-avatar-transcript"><span>Candidate's latest response</span><p>{lastResponse}</p></div>}
        {active && microphoneWarning && <div className="live-avatar-text-fallback">
          <label htmlFor="live-avatar-typed-response">Type your response if microphone access is unavailable</label>
          <textarea id="live-avatar-typed-response" value={typedResponse} onChange={(event) => setTypedResponse(event.target.value)} rows={3} placeholder="Type your answer here…" />
          <button type="button" className="btn btn-secondary" onClick={submitTypedResponse} disabled={!typedResponse.trim()}>Send response to Smile</button>
        </div>}
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
        {state === "error" && <>
          <p className="error-box">{error}</p>
          {microphoneFallbackAvailable && <button type="button" className="btn btn-primary" onClick={() => void startInterview(true)}>Continue without microphone</button>}
          {accessToken && sessionIssued ? <p>This secure invitation can only be used once. Please contact the recruitment team if you need help.</p> : <button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button>}
        </>}
      </div>
    </section>
  );
}
