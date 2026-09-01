"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import UiIcon from "./UiIcon";
import { HELP_BOT_STARTER_QUESTIONS } from "@/lib/help-bot/prompt";
import styles from "./HelpBot.module.css";

type ChatMessage = { role: "user" | "assistant"; content: string };

const GREETING =
  "Hi, I'm Ella. Ask me how to use the recruitment portal — creating role requests, screening, interviews, statuses, access, and more. I answer from the portal guide and can't see your records.";

const NOT_CONFIGURED_MESSAGE =
  "Ella is currently being configured and will be available soon.";

export default function HelpBot() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/help-bot", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setEnabled(data?.enabled === true);
        setConfigured(data?.configured === true);
      })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || loading || !configured) return;

      const history = messages.slice(-6);
      setMessages((current) => [...current, { role: "user", content: question }]);
      setInput("");
      setError("");
      setLoading(true);

      try {
        const response = await fetch("/api/help-bot", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history }),
        });
        const data = await response.json();
        if (!response.ok || data?.success !== true) {
          throw new Error(data?.error || "The assistant is temporarily unavailable. Please try again later.");
        }
        setMessages((current) => [...current, { role: "assistant", content: String(data.answer) }]);
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, configured],
  );

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-controls="ella-help-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <UiIcon name={open ? "close" : "help"} size={22} />
        <span className={styles.launcherLabel}>{open ? "Close" : "Ella"}</span>
      </button>

      {open && (
        <section id="ella-help-panel" className={styles.panel} aria-label="Ella assistant">
          <header className={styles.header}>
            <div>
              <strong>Ella</strong>
              <span>Portal guide assistant</span>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close">
              <UiIcon name="close" size={18} />
            </button>
          </header>

          <div className={styles.body} ref={scrollRef}>
            <div className={`${styles.message} ${styles.assistant}`}>{GREETING}</div>

            {!configured && (
              <div className={styles.notice} role="status">{NOT_CONFIGURED_MESSAGE}</div>
            )}

            {configured && messages.length === 0 && (
              <div className={styles.starters}>
                <p>Try asking:</p>
                {HELP_BOT_STARTER_QUESTIONS.map((question) => (
                  <button key={question} type="button" className={styles.starterButton} onClick={() => send(question)}>
                    {question}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}
              >
                {message.content}
              </div>
            ))}

            {loading && (
              <div className={`${styles.message} ${styles.assistant} ${styles.typing}`} aria-live="polite">
                <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
              </div>
            )}

            {error && <div className={styles.error} role="alert">{error}</div>}
          </div>

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className={styles.textarea}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              placeholder={configured ? "Ask about the portal…" : "Ella is being configured…"}
              rows={1}
              maxLength={600}
              aria-label="Your question"
              disabled={!configured || loading}
            />
            <button type="submit" className={styles.sendButton} disabled={!configured || loading || !input.trim()} aria-label="Send">
              <UiIcon name="send" size={18} />
            </button>
          </form>
          <p className={styles.disclaimer}>
            Answers come from the portal guide and may be incomplete. Ella can't see your records or make changes.
          </p>
        </section>
      )}
    </>
  );
}
