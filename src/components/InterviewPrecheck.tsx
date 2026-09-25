"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import UiIcon from "@/components/UiIcon";
import { deviceErrorMessage, INTERVIEW_CONSENT_PARAGRAPHS, INTERVIEW_CONSENT_TITLE, INTERVIEW_CONSENT_VERSION } from "@/lib/live-interview";

import "./live-interview.css";

export type PrecheckResult = { camera: MediaStream; microphone: MediaStream };

type Phase = "consent" | "saving-consent" | "requesting" | "preview" | "saving-check" | "declined";
type PermissionState = "unknown" | "granted" | "denied" | "prompt";

type Props = {
  avatarToken: string;
  onReady: (result: PrecheckResult) => void;
  onCancel: () => void;
};

async function queryPermission(name: "camera" | "microphone"): Promise<PermissionState> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state as PermissionState;
  } catch {
    return "unknown";
  }
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!response.ok || result.success !== true) throw new Error(result.error || "We could not save your response. Please try again.");
  return result;
}

export default function InterviewPrecheck({ avatarToken, onReady, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("consent");
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [microphoneError, setMicrophoneError] = useState("");
  const [cameraPermission, setCameraPermission] = useState<PermissionState>("unknown");
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>("unknown");
  const [cameraLive, setCameraLive] = useState(false);
  const [microphoneLive, setMicrophoneLive] = useState(false);
  const [level, setLevel] = useState(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<{ context: AudioContext; frame: number } | null>(null);
  const handedOffRef = useRef(false);
  const agreeRef = useRef<HTMLButtonElement>(null);

  const stopMeter = useCallback(() => {
    if (!meterRef.current) return;
    window.cancelAnimationFrame(meterRef.current.frame);
    void meterRef.current.context.close().catch(() => {});
    meterRef.current = null;
  }, []);

  const releaseDevices = useCallback(() => {
    stopMeter();
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    cameraRef.current = null;
    microphoneRef.current = null;
  }, [stopMeter]);

  useEffect(() => () => { if (!handedOffRef.current) releaseDevices(); }, [releaseDevices]);

  useEffect(() => {
    if (phase !== "consent") return;
    const frame = window.requestAnimationFrame(() => agreeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") void decline(); };
    document.addEventListener("keydown", onKey);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); };
    // decline is stable enough for this listener's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function watchTrack(track: MediaStreamTrack, kind: "camera" | "microphone") {
    track.addEventListener("ended", () => {
      if (kind === "camera") { setCameraLive(false); setCameraError("Your camera was disconnected. Reconnect it and select \"Try again\"."); }
      else { setMicrophoneLive(false); setMicrophoneError("Your microphone was disconnected. Reconnect it and select \"Try again\"."); }
    });
  }

  function startMeter(stream: MediaStream) {
    stopMeter();
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        setLevel(Math.min(1, peak / 64));
        if (meterRef.current) meterRef.current.frame = window.requestAnimationFrame(tick);
      };
      meterRef.current = { context, frame: window.requestAnimationFrame(tick) };
    } catch {
      // The level meter is a convenience; the device check does not depend on it.
    }
  }

  async function requestDevices() {
    setPhase("requesting");
    setError("");
    setCameraError("");
    setMicrophoneError("");
    releaseDevices();
    setCameraLive(false);
    setMicrophoneLive(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access a camera or microphone. Please use the latest Chrome, Edge, Safari, or Firefox.");
      setPhase("preview");
      return;
    }
    // Request each device separately so the applicant sees exactly which one failed.
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
      const track = camera.getVideoTracks()[0];
      if (!track) throw new DOMException("No camera track.", "NotFoundError");
      watchTrack(track, "camera");
      cameraRef.current = camera;
      setCameraLive(true);
      if (previewRef.current) { previewRef.current.srcObject = camera; void previewRef.current.play().catch(() => {}); }
    } catch (caught) {
      setCameraError(deviceErrorMessage(caught, "camera"));
    }
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const track = microphone.getAudioTracks()[0];
      if (!track) throw new DOMException("No microphone track.", "NotFoundError");
      watchTrack(track, "microphone");
      microphoneRef.current = microphone;
      setMicrophoneLive(true);
      startMeter(microphone);
    } catch (caught) {
      setMicrophoneError(deviceErrorMessage(caught, "microphone"));
    }
    const [cameraState, microphoneState] = await Promise.all([queryPermission("camera"), queryPermission("microphone")]);
    setCameraPermission(cameraRef.current ? "granted" : cameraState);
    setMicrophonePermission(microphoneRef.current ? "granted" : microphoneState);
    setPhase("preview");
  }

  useEffect(() => {
    if (phase === "preview" && previewRef.current && cameraRef.current && previewRef.current.srcObject !== cameraRef.current) {
      previewRef.current.srcObject = cameraRef.current;
      void previewRef.current.play().catch(() => {});
    }
  }, [phase]);

  async function agree() {
    setPhase("saving-consent");
    setError("");
    try {
      await postJson("/api/live-avatar/consent", { avatarToken, agreed: true, consentVersion: INTERVIEW_CONSENT_VERSION, recording: true, camera: true, microphone: true });
      await requestDevices();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your consent. Please try again.");
      setPhase("consent");
    }
  }

  async function decline() {
    releaseDevices();
    // Record the decision; the invitation stays valid if they change their mind.
    await postJson("/api/live-avatar/consent", { avatarToken, agreed: false }).catch(() => {});
    setPhase("declined");
  }

  async function confirmReady() {
    if (!cameraRef.current || !microphoneRef.current || !cameraLive || !microphoneLive) return;
    setPhase("saving-check");
    setError("");
    try {
      await postJson("/api/live-avatar/device-check", { avatarToken, cameraReady: true, microphoneReady: true });
      stopMeter();
      handedOffRef.current = true;
      onReady({ camera: cameraRef.current, microphone: microphoneRef.current });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your device check. Please try again.");
      setPhase("preview");
    }
  }

  const ready = cameraLive && microphoneLive;
  const statusText = (live: boolean, failure: string) => live ? "Detected" : failure ? "Not available" : "Checking…";
  const permissionText = (state: PermissionState, live: boolean) => live || state === "granted" ? "Allowed" : state === "denied" ? "Blocked" : state === "prompt" ? "Not yet allowed" : "Unknown";

  if (phase === "declined") {
    return <div className="live-interview-precheck" role="status">
      <p><strong>You have not started the interview.</strong> No camera, microphone, or recording was used. You can return to this link later, before it expires, if you change your mind — or contact the recruitment team for help.</p>
      <div className="live-interview-actions"><button type="button" className="btn btn-secondary" onClick={() => setPhase("consent")}>Review the notice again</button><button type="button" className="btn btn-secondary" onClick={onCancel}>Close</button></div>
    </div>;
  }

  if (phase === "consent" || phase === "saving-consent") {
    return <div className="confirmation-modal-backdrop" role="presentation">
      <section className="confirmation-modal live-interview-consent" role="dialog" aria-modal="true" aria-labelledby="interview-consent-title" aria-describedby="interview-consent-body">
        <div className="confirmation-modal-header">
          <span className="confirmation-modal-icon" aria-hidden="true"><UiIcon name="info" size={19} /></span>
          <div>
            <h2 id="interview-consent-title">{INTERVIEW_CONSENT_TITLE}</h2>
            <div id="interview-consent-body" className="live-interview-consent-body">
              {INTERVIEW_CONSENT_PARAGRAPHS.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            {error && <p className="error-box" role="alert">{error}</p>}
          </div>
        </div>
        <div className="confirmation-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void decline()} disabled={phase === "saving-consent"}>Cancel / Exit Interview</button>
          <button ref={agreeRef} type="button" className="btn btn-primary" onClick={() => void agree()} disabled={phase === "saving-consent"}>{phase === "saving-consent" ? "Saving…" : "I Agree & Continue"}</button>
        </div>
      </section>
    </div>;
  }

  return <div className="live-interview-precheck" aria-labelledby="device-check-title">
    <div>
      <span className="form-eyebrow">EQUIPMENT CHECK</span>
      <h3 id="device-check-title">Check your camera and microphone</h3>
      <p>Make sure your face is visible and speak a few words to see the microphone level move.</p>
    </div>
    <div className="live-interview-preview">
      <video ref={previewRef} autoPlay playsInline muted aria-label="Your camera preview" />
      {!cameraLive && <div className="live-avatar-stage-overlay">{phase === "requesting" ? "Waiting for camera permission…" : "Camera preview unavailable"}</div>}
    </div>
    <dl className="live-interview-device-status">
      <div><dt>Camera</dt><dd className={cameraLive ? "is-ok" : "is-bad"}>{statusText(cameraLive, cameraError)}</dd></div>
      <div><dt>Camera permission</dt><dd className={cameraLive ? "is-ok" : "is-bad"}>{permissionText(cameraPermission, cameraLive)}</dd></div>
      <div><dt>Microphone</dt><dd className={microphoneLive ? "is-ok" : "is-bad"}>{statusText(microphoneLive, microphoneError)}</dd></div>
      <div><dt>Microphone permission</dt><dd className={microphoneLive ? "is-ok" : "is-bad"}>{permissionText(microphonePermission, microphoneLive)}</dd></div>
    </dl>
    {microphoneLive && <div className="live-interview-meter" aria-label="Microphone level"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>}
    {cameraError && <p className="live-avatar-mic-warning" role="alert">{cameraError}</p>}
    {microphoneError && <p className="live-avatar-mic-warning" role="alert">{microphoneError}</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="live-interview-actions">
      {!ready && phase !== "requesting" && <button type="button" className="btn btn-secondary" onClick={() => void requestDevices()}>Try again</button>}
      <button type="button" className="btn btn-secondary" onClick={() => { releaseDevices(); onCancel(); }}>Exit</button>
      <button type="button" className="btn btn-primary" onClick={() => void confirmReady()} disabled={!ready || phase !== "preview"}>{phase === "saving-check" ? "Starting…" : "Start Interview"}</button>
    </div>
    {!ready && phase === "preview" && <p className="live-avatar-disclosure">Both a working camera and microphone are required before the interview can start.</p>}
  </div>;
}
