"use client";

import { useEffect, useRef, useState } from "react";

type WidgetState = "idle" | "starting" | "connecting" | "live" | "ended" | "error";

type Props = {
  roleId: string;
  roleTitle: string;
};

// Minimal typing for the parts of @heygen/liveavatar-web-sdk this widget
// uses. Kept local (rather than importing the package's own types at module
// scope) so the SDK — and the WebRTC/LiveKit code it pulls in — is only ever
// loaded in the browser, on demand, after the candidate opts in.
type LiveAvatarSessionInstance = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  attach: (element: HTMLMediaElement) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
};

/**
 * "Meet Ella now" — an opt-in, in-browser live video interview, powered by
 * LiveAvatar (HeyGen). This is additive to the existing phone-call (Vapi)
 * interview later in the pipeline; nothing here changes that flow.
 *
 * Ella's greeting and screening questions are generated for this specific
 * role: the session-token request (src/app/api/live-avatar/session) sends
 * this role's published title and job description to LiveAvatar as
 * dynamic_variables, which the "McLink AI Interviewer" context substitutes
 * into its ${role_title} / ${job_description} placeholders.
 */
export default function LiveAvatarInterview({ roleId, roleTitle }: Props) {
  const [state, setState] = useState<WidgetState>("idle");
  const [error, setError] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<LiveAvatarSessionInstance | null>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
    };
  }, []);

  async function startInterview() {
    setError("");
    setState("starting");
    try {
      const tokenResponse = await fetch("/api/live-avatar/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const tokenBody = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenBody?.success) {
        throw new Error(tokenBody?.error || "Ella isn't available right now.");
      }

      const { LiveAvatarSession, SessionEvent } = await import("@heygen/liveavatar-web-sdk");
      const session = new LiveAvatarSession(tokenBody.sessionToken, {
        voiceChat: true,
      }) as unknown as LiveAvatarSessionInstance;
      sessionRef.current = session;

      session.on(SessionEvent.SESSION_STATE_CHANGED, (...args: unknown[]) => {
        const nextState = args[0] as string;
        if (nextState === "CONNECTING") setState("connecting");
        if (nextState === "DISCONNECTED") setState((current) => (current === "error" ? current : "ended"));
      });
      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        setState("live");
        if (videoRef.current) session.attach(videoRef.current);
      });

      setState("connecting");
      await session.start();
    } catch (err) {
      console.error("[LiveAvatarInterview] Failed to start session:", err);
      setError(err instanceof Error ? err.message : "Ella isn't available right now.");
      setState("error");
      sessionRef.current = null;
    }
  }

  async function endInterview() {
    try {
      await sessionRef.current?.stop();
    } catch (err) {
      console.error("[LiveAvatarInterview] Failed to stop session:", err);
    } finally {
      sessionRef.current = null;
      setState("ended");
    }
  }

  const isVideoVisible = state === "connecting" || state === "live";

  return (
    <section className="card live-avatar-card">
      <div className="card-header">
        <h2>Meet Ella now</h2>
        {state === "live" && <span className="live-avatar-live-pill">Live</span>}
      </div>
      <div className="live-avatar-body">
        {state === "idle" && (
          <>
            <p>
              Prefer talking instead of waiting for a call back? Ella, McLink&apos;s AI interview
              assistant, can meet you right now over live video for a quick, {roleTitle} focused
              chat — about ten to fifteen minutes.
            </p>
            <p className="live-avatar-disclosure">
              Ella is an AI interviewer, not a person. This is optional and separate from the
              rest of your application.
            </p>
            <button type="button" className="btn btn-primary" onClick={startInterview}>
              Start live interview with Ella
            </button>
          </>
        )}

        {(state === "starting" || isVideoVisible) && (
          <div className="live-avatar-stage">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`live-avatar-video ${state === "live" ? "is-ready" : ""}`}
            />
            {!isVideoVisible && (
              <div className="live-avatar-stage-overlay">Connecting you with Ella…</div>
            )}
            {state === "connecting" && (
              <div className="live-avatar-stage-overlay">Waiting for Ella to join…</div>
            )}
          </div>
        )}

        {isVideoVisible && (
          <button type="button" className="btn btn-secondary" onClick={endInterview}>
            End interview
          </button>
        )}

        {state === "ended" && (
          <>
            <p>Thanks for chatting with Ella. Your application below is unaffected — go ahead and submit it whenever you&apos;re ready.</p>
            <button type="button" className="btn btn-secondary" onClick={startInterview}>
              Talk to Ella again
            </button>
          </>
        )}

        {state === "error" && (
          <>
            <p className="error-box">{error}</p>
            <button type="button" className="btn btn-secondary" onClick={startInterview}>
              Try again
            </button>
          </>
        )}
      </div>
    </section>
  );
}


