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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setInfo("");
    setNeedsVerification(false);
    setShowPassword(false);
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
        const { ok, result } = await post("/api/auth/forgot", { email });
        if (!ok) {
          setError(result.error || "Could not send the reset link.");
          return;
        }
        setInfo(result.message || "");
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
        setNeedsVerification(Boolean(result.needsVerification));
        if (result.needsVerification) setMode("login");
        return;
      }
      setInfo(result.message || "Check your email for a verification link.");
      setPassword("");
      setNeedsVerification(Boolean(result.needsVerification || result.emailSent));
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
      {mode !== "forgot" ? <label>{mode === "reset" ? "New password" : "Password"}<span className="auth-password-field"><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" || mode === "reset" ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} title={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={showPassword ? "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 8.6 4.8 9.8 7a16.7 16.7 0 0 1-3.1 3.9M6.2 6.2C4.3 7.5 3 9.4 2.2 11c1.2 2.2 4.6 7 9.8 7 1 0 2-.2 2.9-.5" : "M2.2 12C3.4 9.8 6.8 5 12 5s8.6 4.8 9.8 7c-1.2 2.2-4.6 7-9.8 7S3.4 14.2 2.2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"} /></svg></button></span></label> : null}
      {mode === "register" || mode === "reset" ? <small>Use at least 10 characters.</small> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Please wait…" : { login: "Log in", register: "Create account", forgot: "Send reset link", reset: "Update password" }[mode]}</button>
      {mode === "login" ? <button type="button" className="auth-link" onClick={() => switchMode("forgot")}>Forgot your password?</button> : null}
      {mode === "forgot" ? <button type="button" className="auth-link" onClick={() => switchMode("login")}>Back to log in</button> : null}
      {needsVerification ? <button type="button" className="btn btn-secondary" disabled={busy || !email} onClick={resend}>Resend verification email</button> : null}
      {error ? <ActionFeedback kind="error">{error}</ActionFeedback> : null}
      {info ? <ActionFeedback kind="success" dismissAfterMs={null}>{info}</ActionFeedback> : null}
    </form>
  );
}
