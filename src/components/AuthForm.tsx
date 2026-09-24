"use client";

import { useState, type FormEvent } from "react";

import ActionFeedback from "@/components/ActionFeedback";

type AuthFormProps = {
  /** Destination preserved from an unauthenticated role-request link. */
  redirectTo?: string;
  /** Password-reset token from an emailed link; opens the "choose a new password" form. */
  resetToken?: string;
};

type Mode = "login" | "register" | "forgot" | "reset";

export default function AuthForm({ redirectTo = "/dashboard", resetToken = "" }: AuthFormProps) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setInfo("");
    setNeedsVerification(false);
  };

  async function post(url: string, body: Record<string, string>) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok, result };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    setNeedsVerification(false);
    try {
      if (mode === "login") {
        const { ok, result } = await post("/api/auth/login", { email, password });
        if (!ok) {
          setError(result.error || "Sign-in failed.");
          setNeedsVerification(Boolean(result.needsVerification));
          return;
        }
        // Complete login at the role request that originally required auth.
        window.location.href = redirectTo;
        return;
      }
      if (mode === "forgot") {
        const { result } = await post("/api/auth/forgot", { email });
        setInfo(result.message || result.error || "");
        return;
      }
      if (mode === "reset") {
        const { ok, result } = await post("/api/auth/reset", { token: resetToken, password });
        if (!ok) {
          setError(result.error || "Could not reset the password.");
          return;
        }
        setInfo(result.message || "Password updated.");
        setPassword("");
        setMode("login");
        window.history.replaceState(null, "", "/");
        return;
      }
      const { ok, result } = await post("/api/auth/register", { fullName, email, password });
      if (!ok) {
        setError(result.error || "Registration failed.");
        return;
      }
      setInfo(result.message || "Check your email for a verification link.");
      setPassword("");
      setMode("login");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    try {
      const { result } = await post("/api/auth/resend", { email });
      setError("");
      setInfo(result.message || result.error || "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === "forgot" || mode === "reset" ? <h3>{mode === "forgot" ? "Reset your password" : "Choose a new password"}</h3> : (
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Log in</button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Register</button>
      </div>)}
      {mode === "register" ? (
        <label>Full name<input type="text" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
      ) : null}
      {mode !== "reset" ? <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label> : null}
      {mode !== "forgot" ? <label>{mode === "reset" ? "New password" : "Password"}<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" || mode === "reset" ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /></label> : null}
      {mode === "register" || mode === "reset" ? <small>At least 10 characters. Registration is limited to participating organizations.</small> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Please wait…" : { login: "Log in", register: "Create account", forgot: "Send reset link", reset: "Update password" }[mode]}</button>
      {mode === "login" ? <button type="button" className="auth-link" onClick={() => switchMode("forgot")}>Forgot your password?</button> : null}
      {mode === "forgot" ? <button type="button" className="auth-link" onClick={() => switchMode("login")}>Back to log in</button> : null}
      {needsVerification ? <button type="button" className="btn btn-secondary" disabled={busy || !email} onClick={resend}>Resend verification email</button> : null}
      {error ? <ActionFeedback kind="error">{error}</ActionFeedback> : null}
      {info ? <ActionFeedback kind="success" dismissAfterMs={null}>{info}</ActionFeedback> : null}
    </form>
  );
}
