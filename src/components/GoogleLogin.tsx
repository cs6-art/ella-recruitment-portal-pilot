"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type GoogleLoginProps = {
  /** Destination preserved from an unauthenticated role-request link. */
  redirectTo?: string;
};

export default function GoogleLogin({ redirectTo = "/dashboard" }: GoogleLoginProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const initialize = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("Google login is not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to .env.local.");
      return;
    }
    if (!window.google || !buttonRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }: GoogleCredentialResponse) => {
        setError("");
        const response = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error || "Sign-in failed.");
          return;
        }
        // Complete login at the role request that originally required auth.
        window.location.href = redirectTo;
      },
    });

    buttonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(buttonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width: 320,
    });
    setReady(true);
  };

  useEffect(() => {
    if (window.google) initialize();
  }, []);

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={initialize} />
      <div className="google-slot" ref={buttonRef} aria-busy={!ready} />
      {error ? <ActionFeedback kind="error">{error}</ActionFeedback> : null}
    </>
  );
}
