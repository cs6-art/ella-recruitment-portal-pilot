"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Mascot } from "page-mascot";

import UiIcon from "./UiIcon";
import { useSmileGuide, type GuideSay } from "./useSmileGuide";
import { HELP_BOT_STARTER_QUESTIONS } from "@/lib/help-bot/prompt";
import { DEFAULT_SUPPORT_EMAIL, DEFAULT_SUPPORT_NAME, FEEDBACK_MESSAGE_MAX_LENGTH, FEEDBACK_TOPICS, feedbackMailto, type SupportContact } from "@/lib/support-contact";
import { BUBBLE_HEADROOM, bubbleAlign, bubbleDuration, IDLE_AWAY_MS, pageIntroFor, placeBeside, type BubbleAlign, type Placement } from "@/lib/smile-tips";
import styles from "./HelpBot.module.css";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Tab = "ask" | "help";
const STARTER_RETURN_DELAY_MS = 4_000;
// Preferences (per browser). "off" turns the behaviour off.
const ROAM_PREF_KEY = "smile-bot:roam";
const TIPS_PREF_KEY = "smile-bot:tips";
const INTRO_SEEN_PREFIX = "smile-bot:intro:";
const MASCOT_SIZE = 96;
const MASCOT_SIZE_SMALL = 76;
const WALK_SPEED_PX_PER_S = 300;
const AWAY_SPEED_PX_PER_S = 180;
// Share of the robot tucked off the screen edge while it is out of the way.
const AWAY_HIDDEN_SHARE = 0.55;

type Spot = { x: number; y: number };
type Bubble = { text: string; align: BubbleAlign; below: boolean; guiding: boolean };

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

function HelpAndFeedback({ support, roam, onRoamChange, tips, onTipsChange }: { support: SupportContact; roam: boolean; onRoamChange: (value: boolean) => void; tips: boolean; onTipsChange: (value: boolean) => void }) {
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

    <div className={styles.roamGroup}>
      <strong>Smile on the page</strong>
      <label className={styles.roamToggle}>
        <input type="checkbox" checked={tips} onChange={(event) => onTipsChange(event.target.checked)} />
        <span>Show Smile&apos;s tips as I use the portal</span>
      </label>
      <label className={styles.roamToggle}>
        <input type="checkbox" checked={roam} onChange={(event) => onRoamChange(event.target.checked)} />
        <span>Let Smile move around (it steps aside when I&apos;m idle)</span>
      </label>
    </div>
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
  const pathname = usePathname();
  // Smile stands at `pos` (offset from its corner: x left, y up). When the user
  // is idle, or the pointer leaves the window, it steps out of the way; when the
  // pointer is back it returns to its `anchor` (the corner, or beside the last
  // control it spoke about).
  const [roam, setRoam] = useState(true);
  const [tips, setTips] = useState(true);
  const [pos, setPos] = useState<Spot>({ x: 0, y: 0 });
  const [walkMs, setWalkMs] = useState(0);
  const [walking, setWalking] = useState(false);
  const [small, setSmall] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const posRef = useRef<Spot>({ x: 0, y: 0 });
  const anchorRef = useRef<Spot>({ x: 0, y: 0 });
  const anchorScrollRef = useRef(0);
  const awayRef = useRef(false);
  const hoverRef = useRef(false);
  const bubbleRef = useRef<Bubble | null>(null);
  const openRef = useRef(false);
  const roamRef = useRef(true);
  const smallRef = useRef(false);
  const roamerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => { openRef.current = open; roamRef.current = roam; smallRef.current = small; bubbleRef.current = bubble; });

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ROAM_PREF_KEY) === "off") setRoam(false);
      if (window.localStorage.getItem(TIPS_PREF_KEY) === "off") setTips(false);
    } catch { /* storage blocked */ }
    const query = window.matchMedia("(max-width: 520px)");
    const sync = () => setSmall(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const remember = useCallback((key: string, value: boolean) => {
    try { window.localStorage.setItem(key, value ? "on" : "off"); } catch { /* storage blocked */ }
  }, []);
  const changeRoam = useCallback((value: boolean) => { setRoam(value); remember(ROAM_PREF_KEY, value); }, [remember]);
  const changeTips = useCallback((value: boolean) => { setTips(value); remember(TIPS_PREF_KEY, value); }, [remember]);

  const mascotSize = () => (smallRef.current ? MASCOT_SIZE_SMALL : MASCOT_SIZE);
  const homeBox = () => launcherRef.current?.getBoundingClientRect() ?? null;
  const robotBox = () => roamerRef.current?.getBoundingClientRect() ?? null;

  /** Walk to `next` (offsets from the corner). Returns the walk time in ms; 0 means it did not move. */
  const moveTo = useCallback((next: Spot, speed: number) => {
    if (!roamRef.current || prefersReducedMotion()) return 0;
    const distance = Math.hypot(next.x - posRef.current.x, next.y - posRef.current.y);
    if (distance < 3) return 0;
    const duration = Math.round((distance / speed) * 1000);
    posRef.current = next;
    setWalkMs(duration);
    setWalking(true);
    setPos(next);
    return duration;
  }, []);

  const toSpot = useCallback((left: number, top: number): Spot | null => {
    const home = homeBox();
    return home ? { x: Math.round(home.left - left), y: Math.round(home.top - top) } : null;
  }, []);

  // Stop where it stands (mid-walk) so a moving robot is never hard to click.
  const freezeWalk = useCallback(() => {
    const robot = robotBox();
    const spot = robot ? toSpot(robot.left, robot.top) : null;
    if (!spot) return;
    posRef.current = spot;
    setWalkMs(0);
    setWalking(false);
    setPos(spot);
  }, [toSpot]);

  const hideBubble = useCallback(() => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    if (sayTimer.current) clearTimeout(sayTimer.current);
    bubbleTimer.current = null;
    sayTimer.current = null;
    setBubble(null);
  }, []);

  const showBubble = useCallback((text: string, left: number, top: number, side: Placement["side"] | "home", guiding: boolean) => {
    const align = bubbleAlign(left, mascotSize(), window.innerWidth, side);
    const next: Bubble = { text, align, below: top < BUBBLE_HEADROOM - 4, guiding };
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(next);
    bubbleTimer.current = setTimeout(() => { bubbleTimer.current = null; setBubble(null); }, bubbleDuration(text));
  }, []);

  // Smile speaks: walk beside the control (when movement is on), then say it.
  const say = useCallback(({ text, rect }: GuideSay) => {
    if (openRef.current) return;
    hideBubble();
    let left = 0, top = 0, side: Placement["side"] | "home" = "home", wait = 0;
    const here = robotBox();
    if (here) { left = here.left; top = here.top; }
    if (rect && roamRef.current && !prefersReducedMotion()) {
      const size = mascotSize();
      const place = placeBeside({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, { width: window.innerWidth, height: window.innerHeight }, size);
      const spot = toSpot(place.left, place.top);
      if (spot) {
        awayRef.current = false;
        anchorRef.current = spot;
        anchorScrollRef.current = window.scrollY;
        wait = moveTo(spot, WALK_SPEED_PX_PER_S);
        left = place.left; top = place.top; side = place.side;
      }
    }
    sayTimer.current = setTimeout(() => { sayTimer.current = null; showBubble(text, left, top, side, true); }, wait + 40);
  }, [hideBubble, moveTo, showBubble, toSpot]);

  const pathRef = useRef(pathname || "");
  useSmileGuide({ enabled: enabled === true && tips && !open, path: pathname || "", onSay: say });

  // Step out of the way when idle (or the pointer leaves the window) and come
  // back to the anchor the moment the pointer is detected or moves again.
  useEffect(() => {
    if (!enabled || !roam || prefersReducedMotion()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastActivity = 0;

    const stepAway = () => {
      if (openRef.current || hoverRef.current || bubbleRef.current || awayRef.current || document.hidden) {
        if (!awayRef.current && !document.hidden && !openRef.current) schedule();
        return;
      }
      const home = homeBox();
      if (!home) return;
      awayRef.current = true;
      // Tuck most of the robot off the right edge of the screen, at the bottom.
      const tuckedLeft = window.innerWidth - mascotSize() * (1 - AWAY_HIDDEN_SHARE);
      moveTo({ x: Math.round(home.left - tuckedLeft), y: 0 }, AWAY_SPEED_PX_PER_S);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(stepAway, IDLE_AWAY_MS);
    };
    const comeBack = () => {
      if (!awayRef.current) return;
      awayRef.current = false;
      // Beside a control that has since scrolled away makes no sense: use the corner.
      if (Math.abs(window.scrollY - anchorScrollRef.current) > 160) anchorRef.current = { x: 0, y: 0 };
      moveTo(anchorRef.current, 260);
    };
    const active = () => {
      const now = Date.now();
      if (now - lastActivity < 150) return;
      lastActivity = now;
      comeBack();
      schedule();
    };
    const leave = () => {
      if (timer) clearTimeout(timer);
      // Cannot be seen: step aside right away.
      timer = setTimeout(stepAway, 400);
    };
    const onScroll = () => {
      if (!awayRef.current && (anchorRef.current.x !== 0 || anchorRef.current.y !== 0) && Math.abs(window.scrollY - anchorScrollRef.current) > 160) {
        anchorRef.current = { x: 0, y: 0 };
        moveTo({ x: 0, y: 0 }, 260);
      }
    };
    const onMouseOut = (event: MouseEvent) => { if (!event.relatedTarget) leave(); };

    schedule();
    window.addEventListener("pointermove", active, { passive: true });
    window.addEventListener("pointerdown", active, { passive: true });
    window.addEventListener("keydown", active);
    window.addEventListener("wheel", active, { passive: true });
    window.addEventListener("touchstart", active, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("blur", leave);
    window.addEventListener("focus", active);
    document.addEventListener("mouseout", onMouseOut);
    document.documentElement.addEventListener("mouseleave", leave);
    document.documentElement.addEventListener("mouseenter", active);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", active);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("wheel", active);
      window.removeEventListener("touchstart", active);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", active);
      document.removeEventListener("mouseout", onMouseOut);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.documentElement.removeEventListener("mouseenter", active);
    };
  }, [enabled, roam, moveTo]);

  // Turning movement off: go back to the corner and stay.
  useEffect(() => {
    if (roam) return;
    awayRef.current = false;
    anchorRef.current = { x: 0, y: 0 };
    posRef.current = { x: 0, y: 0 };
    setWalkMs(0); setWalking(false); setPos({ x: 0, y: 0 });
  }, [roam]);

  // Opening Smile: bring it back if it was away, and keep it off the panel.
  useEffect(() => {
    if (!open) return;
    hideBubble();
    if (awayRef.current) { awayRef.current = false; moveTo(anchorRef.current, 260); }
    const robot = robotBox();
    if (!robot || window.innerWidth <= 520) return;
    const panel = { left: window.innerWidth - 440, top: window.innerHeight - 118 - 560, bottom: window.innerHeight - 104 };
    if (robot.right > panel.left && robot.bottom > panel.top && robot.top < panel.bottom) {
      const spot = toSpot(panel.left - mascotSize() - 8, robot.top);
      if (spot) { anchorRef.current = spot; moveTo(spot, 300); }
    }
  }, [open, hideBubble, moveTo, toSpot]);

  // New page: drop back to the corner and introduce the page once per session.
  useEffect(() => {
    if (!enabled || !pathname || pathRef.current === pathname) { pathRef.current = pathname || ""; if (!enabled) return; }
    const intro = tips ? pageIntroFor(pathname || "") : null;
    anchorRef.current = { x: 0, y: 0 };
    if (!awayRef.current) moveTo({ x: 0, y: 0 }, 400);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (intro) {
      let seen = false;
      try { seen = window.sessionStorage.getItem(INTRO_SEEN_PREFIX + intro.key) === "1"; } catch { /* storage blocked */ }
      if (!seen) {
        try { window.sessionStorage.setItem(INTRO_SEEN_PREFIX + intro.key, "1"); } catch { /* storage blocked */ }
        timer = setTimeout(() => { if (!openRef.current && !awayRef.current) say({ text: intro.text, key: intro.key, rect: null }); }, 1_500);
      }
    }
    return () => { if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pathname]);

  useEffect(() => () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); if (sayTimer.current) clearTimeout(sayTimer.current); }, []);

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
        data-smile-ignore
        className={`${styles.mascotLauncher} ${open ? styles.mascotOpen : ""}`}
        // The mascot's own click plays its reaction (and a hop); the click then
        // bubbles here and toggles the panel, so there is a single launcher.
        onClick={() => { hideBubble(); setOpen((current) => !current); }}
        onMouseEnter={() => {
          hoverRef.current = true;
          freezeWalk();
          if (!open && !bubbleRef.current) { const box = robotBox(); if (box) showBubble("Hi! Need help?", box.left, box.top, "home", false); }
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          // Pointed at it mid-walk? Put it back where it belongs.
          if (!awayRef.current && (posRef.current.x !== anchorRef.current.x || posRef.current.y !== anchorRef.current.y)) moveTo(anchorRef.current, 240);
        }}
        onFocus={() => { hoverRef.current = true; freezeWalk(); }}
        onBlur={() => { hoverRef.current = false; }}
        style={{ width: small ? MASCOT_SIZE_SMALL : MASCOT_SIZE, height: small ? MASCOT_SIZE_SMALL : MASCOT_SIZE }}
      >
        <span
          ref={roamerRef}
          className={`${styles.roamer} ${bubble?.guiding ? styles.roamerGuiding : ""}`}
          style={{ transform: `translate(${-pos.x}px, ${-pos.y}px)`, transitionDuration: `${walkMs}ms` }}
          onTransitionEnd={(event) => { if (event.target === event.currentTarget) setWalking(false); }}
        >
          {bubble && !open && (
            <span className={`${styles.greetingBubble} ${bubble.align === "start" ? styles.bubbleStart : bubble.align === "end" ? styles.bubbleEnd : ""} ${bubble.below ? styles.bubbleBelow : ""}`} role="status">{bubble.text}</span>
          )}
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
              <div className={styles.body} ref={scrollRef}><HelpAndFeedback support={support} roam={roam} onRoamChange={changeRoam} tips={tips} onTipsChange={changeTips} /></div>
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
