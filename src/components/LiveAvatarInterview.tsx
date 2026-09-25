"use client";

import { useEffect, useRef, useState } from "react";

import InterviewPrecheck, { type PrecheckResult } from "@/components/InterviewPrecheck";
import { InterviewRecorder, type RecorderStatus } from "@/lib/interview-recorder";
import type { LiveAvatarEvaluation, LiveAvatarPreparation } from "@/lib/live-avatar-screening";

type WidgetState = "idle" | "precheck" | "starting" | "connecting" | "live" | "ending" | "evaluating" | "ended" | "error" | "results";

type CapturedTurn = { speaker: "ai_interviewer" | "applicant"; text: string; at: string };
type IntegrityEvent = { type: string; at: string; detail?: string };

const PROGRESS_INTERVAL_MS = 15_000;

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

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

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
  const [browserVoiceMode, setBrowserVoiceMode] = useState(false);
  const [browserVoiceActive, setBrowserVoiceActive] = useState(false);
  const [sessionIssued, setSessionIssued] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<LiveAvatarSessionInstance | null>(null);
  const sessionIdRef = useRef("");
  const endingRef = useRef(false);
  const audioBlockedRef = useRef(false);
  const browserVoiceModeRef = useRef(false);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  // Invitation (applicant) flow only: devices from the pre-interview check,
  // the consented recording, and the transcript/integrity checkpoints.
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const devicesRef = useRef<PrecheckResult | null>(null);
  const recorderRef = useRef<InterviewRecorder | null>(null);
  const capturedTurnsRef = useRef<CapturedTurn[]>([]);
  const integrityEventsRef = useRef<IntegrityEvent[]>([]);
  const finishingRef = useRef(false);
  const [recordingStatus, setRecordingStatus] = useState<RecorderStatus>("idle");
  const [submitNotice, setSubmitNotice] = useState("");

  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
      speechRecognitionRef.current?.stop();
      sessionRef.current = null;
      releaseDevices();
    };
  }, []);

  function releaseDevices() {
    devicesRef.current?.camera.getTracks().forEach((track) => track.stop());
    devicesRef.current?.microphone.getTracks().forEach((track) => track.stop());
    devicesRef.current = null;
  }

  function captureTurn(speaker: CapturedTurn["speaker"], text: string) {
    if (!accessToken || !text.trim()) return;
    capturedTurnsRef.current = [...capturedTurnsRef.current, { speaker, text: text.trim(), at: new Date().toISOString() }].slice(-400);
  }

  function logIntegrityEvent(type: string, detail = "") {
    if (!accessToken) return;
    integrityEventsRef.current = [...integrityEventsRef.current, { type, at: new Date().toISOString(), detail }].slice(-100);
  }

  async function postInterview(path: string, body: Record<string, unknown>, keepalive = false) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarToken: accessToken, ...body }), keepalive });
    const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
    if (!response.ok || result.success !== true) throw new Error(result.error || "The interview could not be saved.");
    return result;
  }

  async function checkpoint() {
    if (!accessToken) return;
    const integrityEvents = integrityEventsRef.current;
    integrityEventsRef.current = [];
    try {
      await postInterview("/api/live-avatar/progress", { transcript: capturedTurnsRef.current, integrityEvents });
    } catch {
      // Keep the events for the next checkpoint or the final submission.
      integrityEventsRef.current = [...integrityEvents, ...integrityEventsRef.current].slice(-100);
    }
  }

  const liveForCheckpoints = state === "live" || state === "connecting";
  useEffect(() => {
    if (!accessToken || !liveForCheckpoints) return;
    const timer = window.setInterval(() => void checkpoint(), PROGRESS_INTERVAL_MS);
    const onVisibility = () => logIntegrityEvent(document.visibilityState === "hidden" ? "tab_hidden" : "tab_visible");
    const onBlur = () => logIntegrityEvent("window_blur");
    const onOffline = () => logIntegrityEvent("network_offline");
    const onOnline = () => logIntegrityEvent("network_online");
    const onPageHide = () => {
      if (finishingRef.current) return;
      // A reload or closed tab ends the one-time session; save what exists.
      logIntegrityEvent("page_unloaded");
      const transcript = capturedTurnsRef.current.slice(-80);
      void postInterview("/api/live-avatar/complete", { sessionId: sessionIdRef.current, transcript, integrityEvents: integrityEventsRef.current, interrupted: true }, true).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
    };
    // Handlers read refs only; re-binding on each render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, liveForCheckpoints]);

  useEffect(() => {
    const view = selfViewRef.current;
    const camera = devicesRef.current?.camera;
    if (view && camera && view.srcObject !== camera) {
      view.srcObject = camera;
      void view.play().catch(() => {});
    }
  });

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
      recorderRef.current?.addAvatarAudio(source);
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
      if (voiceChat.state === "ACTIVE") {
        browserVoiceModeRef.current = false;
        setBrowserVoiceMode(false);
        setMicrophoneWarning("");
      }
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

  function sendResponseText(value: string) {
    const text = value.trim();
    const session = sessionRef.current;
    if (!text || !session?.message) return;
    try {
      session.message(text);
      captureTurn("applicant", text);
      setLastResponse(text);
      setTypedResponse("");
    } catch (caught) {
      setMicrophoneWarning(caught instanceof Error ? caught.message : "Smile could not receive that response yet.");
    }
  }

  function submitTypedResponse() {
    sendResponseText(typedResponse);
  }

  function startBrowserVoice() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMicrophoneWarning("Browser voice input is unavailable here. Type your response below instead.");
      return;
    }
    speechRecognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      sendResponseText(transcript);
    };
    recognition.onerror = (event) => {
      setBrowserVoiceActive(false);
      setMicrophoneWarning(event.error === "not-allowed"
        ? "Chrome did not allow browser voice input. Type your response below instead."
        : "Browser voice input was unavailable. Type your response below instead.");
    };
    recognition.onend = () => setBrowserVoiceActive(false);
    speechRecognitionRef.current = recognition;
    setBrowserVoiceActive(true);
    try {
      recognition.start();
    } catch {
      setBrowserVoiceActive(false);
      setMicrophoneWarning("Browser voice input could not start. Type your response below instead.");
    }
  }

  async function startInterview() {
    setError("");
    setEvaluation(null);
    setLastResponse("");
    setAvatarTranscript("");
    audioBlockedRef.current = false;
    setAudioBlocked(false);
    setMicrophoneWarning("");
    browserVoiceModeRef.current = false;
    setBrowserVoiceMode(false);
    setBrowserVoiceActive(false);
    speechRecognitionRef.current?.stop();
    setTypedResponse("");
    setSessionIssued(false);
    endingRef.current = false;
    setState("starting");
    try {
      // Resolve the actual input device while this direct click still carries
      // browser permission activation, before consuming the one-time invite.
      let microphoneDeviceId = "";
      try {
        microphoneDeviceId = await requestMicrophoneDevice();
      } catch {
        browserVoiceModeRef.current = true;
        setBrowserVoiceMode(true);
        setMicrophoneWarning("Chrome microphone capture is unavailable. Browser voice input and typed responses are enabled instead.");
        logIntegrityEvent("microphone_fallback");
      }
      const tokenResponse = await fetch("/api/live-avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, candidateName, resumeSummary: preparation.resumeSummary, screeningQuestion: preparation.screeningQuestion, avatarToken: accessToken || undefined }),
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenBody?.success) throw new Error(tokenBody?.error || "Smile isn't available right now.");
      setSessionIssued(true);
      sessionIdRef.current = typeof tokenBody.sessionId === "string" ? tokenBody.sessionId : "";
      if (accessToken && tokenBody.recordingEnabled === true && devicesRef.current) {
        // Consented recording of the applicant camera + both audio sides.
        const recorder = new InterviewRecorder(accessToken, (status) => setRecordingStatus(status));
        recorderRef.current = recorder;
        recorder.start(devicesRef.current.camera, devicesRef.current.microphone);
      }

      const { LiveAvatarSession, SessionEvent, AgentEventsEnum } = await import("@heygen/liveavatar-web-sdk");
      const session = new LiveAvatarSession(tokenBody.sessionToken, {
        autoKeepAlive: true,
        voiceChat: { defaultMuted: !microphoneDeviceId, deviceId: microphoneDeviceId || undefined },
      }) as unknown as LiveAvatarSessionInstance;
      if (!microphoneDeviceId) {
        // Start the avatar in text-only mode when direct capture is unavailable.
        // This keeps the session alive and leaves voiceChat.start available for
        // the Retry microphone button if the browser permission is repaired.
        setMicrophoneWarning("Chrome microphone capture is unavailable. Browser voice input and typed responses are enabled instead.");
      }
      sessionRef.current = session;
      sessionIdRef.current = typeof tokenBody.sessionId === "string" ? tokenBody.sessionId : "";

      const stateChanged = (...args: unknown[]) => {
        const nextState = String(args[0] || "");
        if (nextState === "CONNECTING") setState("connecting");
        if (nextState === "DISCONNECTED" && !endingRef.current) {
          if (accessToken) {
            // The avatar ended the session (time limit, agent finished, or a
            // dropped connection): save the interview instead of losing it.
            logIntegrityEvent("avatar_disconnected");
            void finishInterview(false);
            return;
          }
          setState((current) => current === "error" ? current : "ended");
        }
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
        captureTurn("applicant", text);
      };
      const avatarTranscription = (...args: unknown[]) => {
        const text = eventText(args);
        if (!text) return;
        setAvatarTranscript(text);
        captureTurn("ai_interviewer", text);
        if (browserVoiceModeRef.current || audioBlockedRef.current) speakWithBrowserVoice(text);
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
        browserVoiceModeRef.current = true;
        setBrowserVoiceMode(true);
        logIntegrityEvent("microphone_fallback");
        setMicrophoneWarning("Smile is connected, but the microphone is not active yet. Check the input device and retry microphone access below.");
      }
    } catch (caught) {
      console.error("[LiveAvatarInterview] Failed to start session:", caught);
      setError(caught instanceof Error ? caught.message : "Smile isn't available right now.");
      setState("error");
      sessionRef.current = null;
      if (recorderRef.current) void recorderRef.current.finish(5_000);
    }
  }

  /**
   * Invitation flow: save the finished interview first, then let the server
   * fetch the transcript and prepare the HR review in the background. The
   * applicant never sees the analysis.
   */
  async function finishInterview(interrupted: boolean) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    endingRef.current = true;
    setState("ending");
    speechRecognitionRef.current?.stop();
    await sessionRef.current?.stop().catch(() => {});
    sessionRef.current = null;
    setState("evaluating");
    const recordingDone = recorderRef.current ? recorderRef.current.finish() : Promise.resolve("idle" as RecorderStatus);
    let saved = false;
    for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
      try {
        await postInterview("/api/live-avatar/complete", { sessionId: sessionIdRef.current, transcript: capturedTurnsRef.current, integrityEvents: integrityEventsRef.current, interrupted });
        integrityEventsRef.current = [];
        saved = true;
      } catch {
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    const finalRecording = await recordingDone;
    releaseDevices();
    setSubmitNotice(saved
      ? finalRecording === "failed" ? "Your interview was submitted. The video recording could not be saved, and the recruitment team has been informed." : "Your interview was submitted successfully."
      : "We could not confirm the submission because of a connection problem. Your interview session is stored securely and will be passed to the recruitment team automatically.");
    setState("results");
  }

  async function processResponse() {
    if (accessToken) {
      await finishInterview(false);
      return;
    }
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
          accessToken ? <>
            <p className="live-avatar-disclosure">Before the interview begins you will review a recording and consent notice, then check your camera and microphone. Nothing is recorded until you agree.</p>
            <button type="button" className="btn btn-primary" onClick={() => setState("precheck")}>Start Interview</button>
          </> : <>
            <p className="live-avatar-disclosure">This is an AI interview aid. The candidate's response will be transcribed and summarized for the recruitment team. You can stop at any time.</p>
            <button type="button" className="btn btn-primary" onClick={() => void startInterview()}>Start with Smile</button>
          </>
        )}

        {state === "precheck" && accessToken && (
          <InterviewPrecheck
            avatarToken={accessToken}
            onReady={(devices) => { devicesRef.current = devices; void startInterview(); }}
            onCancel={() => setState("idle")}
          />
        )}

        {(state === "starting" || active) && (
          <div className="live-avatar-stage">
            <video ref={videoRef} autoPlay playsInline className={`live-avatar-video ${state === "live" ? "is-ready" : ""}`} />
            <audio ref={audioRef} autoPlay />
            {state === "starting" && <div className="live-avatar-stage-overlay">Preparing your private interview…</div>}
            {state === "connecting" && <div className="live-avatar-stage-overlay">Waiting for Smile to join…</div>}
            {audioBlocked && <button type="button" className="live-avatar-audio-retry" onClick={() => void playAvatarAudio()}>Enable sound</button>}
            {accessToken && devicesRef.current && <video ref={selfViewRef} autoPlay playsInline muted className="live-interview-self-view" aria-label="Your camera" />}
            {accessToken && recordingStatus === "recording" && <span className="live-interview-recording-pill" role="status">Recording</span>}
          </div>
        )}

        {microphoneWarning && active && <div className="live-avatar-mic-warning" role="status"><span>{microphoneWarning}</span><button type="button" className="btn btn-secondary" onClick={() => void retryMicrophone()}>Retry microphone</button></div>}
        {active && browserVoiceMode && <div className="live-avatar-browser-voice" role="status">
          <p>Browser voice fallback is active. Click the button, speak, and Smile will receive the transcript.</p>
          <button type="button" className="btn btn-secondary" onClick={startBrowserVoice} disabled={browserVoiceActive}>{browserVoiceActive ? "Listening…" : "Talk to Smile"}</button>
          {avatarTranscript && <button type="button" className="btn btn-secondary" onClick={() => speakWithBrowserVoice(avatarTranscript)}>Read Smile's reply aloud</button>}
        </div>}
        {avatarTranscript && active && <div className="live-avatar-transcript" aria-live="polite"><span>Smile</span><p>{avatarTranscript}</p>{audioBlocked && <button type="button" className="btn btn-secondary" onClick={() => speakWithBrowserVoice(avatarTranscript)}>Use browser voice</button>}</div>}
        {lastResponse && active && <div className="live-avatar-transcript"><span>Candidate's latest response</span><p>{lastResponse}</p></div>}
        {active && microphoneWarning && <div className="live-avatar-text-fallback">
          <label htmlFor="live-avatar-typed-response">Type your response if microphone access is unavailable</label>
          <textarea id="live-avatar-typed-response" value={typedResponse} onChange={(event) => setTypedResponse(event.target.value)} onPaste={() => logIntegrityEvent("text_pasted")} rows={3} placeholder="Type your answer here…" />
          <button type="button" className="btn btn-secondary" onClick={submitTypedResponse} disabled={!typedResponse.trim()}>Send response to Smile</button>
        </div>}
        {active && <button type="button" className="btn btn-secondary" onClick={() => void processResponse()}>{accessToken ? "Finish interview" : "Finish and see results"}</button>}
        {(state === "ending" || state === "evaluating") && <p className="live-avatar-status" aria-live="polite">{state === "ending" ? "Closing the session…" : accessToken ? "Saving your interview… please keep this page open." : "Processing your response…"}</p>}

        {state === "results" && accessToken && (
          <div className="live-avatar-results" aria-live="polite">
            <div><strong>Interview completed</strong><p>{submitNotice}</p></div>
            <p>Thank you for taking the time to speak with Smile. The recruitment team will review your interview and contact you about the next steps. You can now close this page.</p>
            <p className="live-avatar-disclosure">Your interview is reviewed by people. It is not an automated hiring decision.</p>
          </div>
        )}

        {state === "results" && !accessToken && evaluation && (
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
          {accessToken && sessionIssued ? <p>This secure invitation can only be used once. Please contact the recruitment team if you need help.</p> : <button type="button" className="btn btn-secondary" onClick={() => void startInterview()}>Try again</button>}
        </>}
      </div>
    </section>
  );
}
