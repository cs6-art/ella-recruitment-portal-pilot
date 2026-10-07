"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mascot } from "page-mascot";

import UiIcon from "./UiIcon";
import { HELP_BOT_STARTER_QUESTIONS } from "@/lib/help-bot/prompt";
import { DEFAULT_SUPPORT_EMAIL, DEFAULT_SUPPORT_NAME, FEEDBACK_MESSAGE_MAX_LENGTH, FEEDBACK_TOPICS, feedbackMailto, type SupportContact } from "@/lib/support-contact";
import styles from "./HelpBot.module.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Tab = "ask" | "help";
const STARTER_RETURN_DELAY_MS = 4_000;
const GREETING_SEEN_KEY = "smile-bot:greeting-seen";
const GREETING_VISIBLE_MS = 6_000;
const ROAM_PREF_KEY = "smile-bot:roam";
const MASCOT_SIZE = 96;
const MASCOT_SIZE_SMALL = 76;
// How far Smile may wander left of its corner, and how often it moves.
const ROAM_MAX_DISTANCE = 420;
const ROAM_MIN_WAIT_MS = 9_000;
const ROAM_MAX_WAIT_MS = 22_000;
const WALK_SPEED_PX_PER_S = 70;
const ARRIVAL_LINES = ["Any questions? Feel free to ask me!", "Need help? I'm here.", "Hi! Need help?"];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type HelpBotConfig = { enabled: boolean; configured: boolean; support: SupportContact };
let helpBotConfigPromise: Promise<HelpBotConfig> | null = null;

function loadHelpBotConfig() {
  if (!helpBotConfigPromise) {
    helpBotConfigPromise = fetch("/api/help-bot", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        return {
          enabled: data?.enabled === true,
          configured: data?.configured === true,
          support: {
            email: typeof data?.support?.email === "string" && data.support.email ? data.support.email : DEFAULT_SUPPORT_EMAIL,
            name: typeof data?.support?.name === "string" && data.support.name ? data.support.name : DEFAULT_SUPPORT_NAME,
          },
        };
      })
      .catch(() => ({ enabled: false, configured: false, support: { email: DEFAULT_SUPPORT_EMAIL, name: DEFAULT_SUPPORT_NAME } }));
  }
  return helpBotConfigPromise;
}

const GREETING =
  "Hi, I'm Smile. Ask me how to use the recruitment portal — creating role requests, screening, interviews, statuses, access, and more. I answer from the portal guide and can't see candidate records or make changes.";

const NOT_CONFIGURED_MESSAGE =
  "Smile is currently being configured and will be available soon. You can still reach the support team from the Help & Feedback tab.";

/** Copy text, falling back to a hidden textarea where the Clipboard API is blocked. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function HelpAndFeedback({ support, roam, onRoamChange }: { support: SupportContact; roam: boolean; onRoamChange: (value: boolean) => void }) {
  const [topic, setTopic] = useState<string>(FEEDBACK_TOPICS[0]);
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const mailto = feedbackMailto({ to: support.email, topic, message, page: typeof window === "undefined" ? "" : window.location.pathname });

  return <div className={styles.helpTab}>
    <div className={styles.helpCard}>
      <strong>Need help or found an issue?</strong>
      <p>Contact our support team. Tell us what you were trying to do and on which page, and we&apos;ll get back to you.</p>
      <div className={styles.supportRow}>
        <span className={styles.supportLabel}>{support.name}</span>
        <a className={styles.supportEmail} href={`mailto:${support.email}`}>{support.email}</a>
      </div>
      <div className={styles.helpActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={async () => setCopyState((await copyText(support.email)) ? "copied" : "failed")}
        >
          {copyState === "copied" ? "Email copied" : "Copy email"}
        </button>
        <a className={styles.secondaryButton} href={`mailto:${support.email}`}>Open email app</a>
      </div>
      <span className={styles.srStatus} role="status" aria-live="polite">{copyState === "copied" ? "Support email copied." : copyState === "failed" ? "Copy failed. Select the email address to copy it." : ""}</span>
    </div>

    <form
      className={styles.feedbackForm}
      onSubmit={(event) => {
        event.preventDefault();
        window.location.href = mailto;
      }}
    >
      <strong>Send feedback</strong>
      <label className={styles.feedbackField}>
        <span>Topic</span>
        <select value={topic} onChange={(event) => setTopic(event.target.value)}>
          {FEEDBACK_TOPICS.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label className={styles.feedbackField}>
        <span>Your message</span>
        <textarea
          value={message}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          rows={4}
          placeholder="Describe your question, the issue you saw, or your idea."
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <button type="submit" className={styles.primaryButton} disabled={!message.trim()}>Continue in email</button>
      <p className={styles.feedbackNote}>This opens your email app with your message filled in. Nothing is sent until you press Send there.</p>
    </form>

    <label className={styles.roamToggle}>
      <input type="checkbox" checked={roam} onChange={(event) => onRoamChange(event.target.checked)} />
      <span>Let Smile walk around the page</span>
    </label>
  </div>;
}

export default function HelpBot() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(false);
  const [support, setSupport] = useState<SupportContact>({ email: DEFAULT_SUPPORT_EMAIL, name: DEFAULT_SUPPORT_NAME });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ask");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showStarters, setShowStarters] = useState(true);
  const [greeting, setGreeting] = useState(false);
  const [greetingText, setGreetingText] = useState(ARRIVAL_LINES[2]);
  // Roaming: Smile occasionally walks along the bottom edge. `offset` is how far
  // left of its corner it stands; `walkMs` is the current walk duration.
  const [roam, setRoam] = useState(true);
  const [offset, setOffset] = useState(0);
  const [walkMs, setWalkMs] = useState(0);
  const [walking, setWalking] = useState(false);
  const [small, setSmall] = useState(false);
  const [hovering, setHovering] = useState(false);
  const offsetRef = useRef(0);
  const roamerRef = useRef<HTMLSpanElement | null>(null);
  const moveCount = useRef(0);

  const launcherRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const starterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (starterTimerRef.current) clearTimeout(starterTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    loadHelpBotConfig().then((data) => {
        if (!active) return;
        setEnabled(data.enabled);
        setConfigured(data.configured);
        setSupport(data.support);
        // Without AI answers the help tab is the useful one.
        if (!data.configured) setTab("help");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try { if (window.localStorage.getItem(ROAM_PREF_KEY) === "off") setRoam(false); } catch { /* storage blocked */ }
    const query = window.matchMedia("(max-width: 520px)");
    const sync = () => setSmall(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const changeRoam = useCallback((value: boolean) => {
    setRoam(value);
    try { window.localStorage.setItem(ROAM_PREF_KEY, value ? "on" : "off"); } catch { /* storage blocked */ }
  }, []);

  // Stop where it stands (mid-walk) so a moving robot is never hard to click.
  const freezeWalk = useCallback(() => {
    const launcher = launcherRef.current;
    const roamer = roamerRef.current;
    if (!launcher || !roamer) return;
    const current = Math.max(0, Math.round(launcher.getBoundingClientRect().left - roamer.getBoundingClientRect().left));
    offsetRef.current = current;
    setWalkMs(0);
    setWalking(false);
    setOffset(current);
  }, []);

  const walkTo = useCallback((target: number, speed = WALK_SPEED_PX_PER_S) => {
    const distance = Math.abs(target - offsetRef.current);
    if (distance < 4) return;
    offsetRef.current = target;
    setWalkMs(Math.round((distance / speed) * 1000));
    setWalking(true);
    setOffset(target);
  }, []);

  // Wander: wait, pick a new spot along the bottom edge, walk there, and
  // sometimes say hello. Paused while Smile is open, hovered, focused or the
  // tab is hidden; never runs with reduced motion or when the user turned it off.
  useEffect(() => {
    if (!enabled) return;
    if (open || hovering || !roam || prefersReducedMotion()) {
      // Go home (the corner) so the panel and the robot line up.
      if (open || !roam || prefersReducedMotion()) walkTo(0, 220);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (document.hidden) { schedule(); return; }
        const size = small ? MASCOT_SIZE_SMALL : MASCOT_SIZE;
        const rightGap = small ? 10 : 24;
        // Keep the whole robot, and its greeting bubble, on screen.
        const room = Math.max(0, window.innerWidth - rightGap - size - 90);
        const limit = Math.min(ROAM_MAX_DISTANCE, room);
        if (limit < 40) { schedule(); return; }
        let target = Math.round(Math.random() * limit);
        if (Math.abs(target - offsetRef.current) < 80) target = offsetRef.current > limit / 2 ? 0 : limit;
        walkTo(target);
        moveCount.current += 1;
      }, ROAM_MIN_WAIT_MS + Math.random() * (ROAM_MAX_WAIT_MS - ROAM_MIN_WAIT_MS));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled, open, hovering, roam, small, walkTo, offset]);

  // A one-time "Hi! Need help?" bubble per browser session, then only on hover/focus.
  useEffect(() => {
    if (!enabled) return;
    let seen = false;
    try { seen = window.sessionStorage.getItem(GREETING_SEEN_KEY) === "1"; } catch { /* storage blocked */ }
    if (seen) return;
    try { window.sessionStorage.setItem(GREETING_SEEN_KEY, "1"); } catch { /* storage blocked */ }
    const show = window.setTimeout(() => setGreeting(true), 1_200);
    const hide = window.setTimeout(() => setGreeting(false), 1_200 + GREETING_VISIBLE_MS);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [enabled]);

  // page-mascot renders its own button labelled "Boop the …". It is the one
  // launcher, so give it the Smile Bot name and disclosure state instead.
  useEffect(() => {
    const button = launcherRef.current?.querySelector("button");
    if (!button) return;
    button.setAttribute("aria-label", open ? "Close Smile help assistant" : "Open Smile help assistant");
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-controls", "smile-help-panel");
  }, [open, enabled]);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open, tab]);

  useEffect(() => {
    if (open && tab === "ask") inputRef.current?.focus();
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.querySelector("button")?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || loading || !configured) return;

      const history = messages.slice(-6);
      setShowStarters(false);
      if (starterTimerRef.current) clearTimeout(starterTimerRef.current);
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
        starterTimerRef.current = setTimeout(() => {
          setShowStarters(true);
          starterTimerRef.current = null;
        }, STARTER_RETURN_DELAY_MS);
      }
    },
    [loading, messages, configured],
  );

  if (!enabled) return null;

  return (
    <>
      <div
        ref={launcherRef}
        className={`${styles.mascotLauncher} ${open ? styles.mascotOpen : ""}`}
        // The mascot's own click plays its reaction (and a hop); the click then
        // bubbles here and toggles the panel, so there is a single launcher.
        onClick={() => { setGreeting(false); setOpen((current) => !current); }}
        onMouseEnter={() => { freezeWalk(); setHovering(true); if (!open) { setGreetingText(ARRIVAL_LINES[2]); setGreeting(true); } }}
        onMouseLeave={() => { setHovering(false); setGreeting(false); }}
        onFocus={() => { freezeWalk(); setHovering(true); if (!open) { setGreetingText(ARRIVAL_LINES[2]); setGreeting(true); } }}
        onBlur={() => { setHovering(false); setGreeting(false); }}
        style={{ width: small ? MASCOT_SIZE_SMALL : MASCOT_SIZE, height: small ? MASCOT_SIZE_SMALL : MASCOT_SIZE }}
      >
        <span
          ref={roamerRef}
          className={styles.roamer}
          style={{ transform: `translateX(${-offset}px)`, transitionDuration: `${walkMs}ms` }}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setWalking(false);
            // Say something on arrival every few stops.
            if (!open && moveCount.current % 3 === 0 && offsetRef.current > 0) {
              setGreetingText(ARRIVAL_LINES[moveCount.current % ARRIVAL_LINES.length]);
              setGreeting(true);
              window.setTimeout(() => setGreeting(false), 3_500);
            }
          }}
        >
          {greeting && !open && <span className={styles.greetingBubble} aria-hidden="true">{greetingText}</span>}
          <span className={`${styles.mascotFloat} ${walking ? styles.mascotWalking : ""}`}>
            <Mascot directions="/mascot/smile-directions.webp" reactions="/mascot/smile-reactions.webp" size={small ? MASCOT_SIZE_SMALL : MASCOT_SIZE} label="Smile help assistant" className={styles.mascotButton} />
          </span>
        </span>
      </div>

      {open && (
        <section id="smile-help-panel" className={styles.panel} aria-label="Smile assistant">
          <header className={styles.header}>
            <div>
              <strong>Smile</strong>
              <span>Portal guide assistant</span>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close">
              <UiIcon name="close" size={18} />
            </button>
          </header>

          <div className={styles.tabs} role="tablist" aria-label="Smile assistant sections">
            <button type="button" role="tab" id="smile-tab-ask" aria-selected={tab === "ask"} aria-controls="smile-tabpanel" className={styles.tab} onClick={() => setTab("ask")}>Ask Smile</button>
            <button type="button" role="tab" id="smile-tab-help" aria-selected={tab === "help"} aria-controls="smile-tabpanel" className={styles.tab} onClick={() => setTab("help")}>Help &amp; Feedback</button>
          </div>

          <div id="smile-tabpanel" role="tabpanel" aria-labelledby={tab === "ask" ? "smile-tab-ask" : "smile-tab-help"} className={styles.tabPanel}>
            {tab === "help" ? (
              <div className={styles.body} ref={scrollRef}><HelpAndFeedback support={support} roam={roam} onRoamChange={changeRoam} /></div>
            ) : (
              <>
                <div className={styles.body} ref={scrollRef}>
                  <div className={`${styles.message} ${styles.assistant}`}>{GREETING}</div>

                  {!configured && (
                    <div className={styles.notice} role="status">{NOT_CONFIGURED_MESSAGE}</div>
                  )}

                  {configured && showStarters && (
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

                  {error && <div className={styles.error} role="alert">{error} <button type="button" className={styles.inlineLink} onClick={() => setTab("help")}>Contact support</button></div>}
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
                    placeholder={configured ? "Ask about the portal…" : "Smile is being configured…"}
                    rows={1}
                    maxLength={600}
                    aria-label="Your question"
                    disabled={!configured || loading}
                  />
                  <button type="submit" className={styles.sendButton} disabled={!configured || loading || !input.trim()} aria-label="Send">
                    <UiIcon name="send" size={18} />
                  </button>
                </form>
              </>
            )}
          </div>
          <p className={styles.disclaimer}>
            {tab === "ask"
              ? "Answers come from the portal guide and your signed-in access context. Smile can't see candidate records or make changes."
              : `Support: ${support.name} · ${support.email}`}
          </p>
        </section>
      )}
    </>
  );
}
