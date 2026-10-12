"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { panelScrollTarget, pickActiveSection, sectionScrollTop } from "@/lib/manual-scrollspy";
import styles from "./ManualViewer.module.css";

export type ManualViewerSection = { id: string; title: string; searchText: string; content: ReactNode };

type ManualViewerProps = {
  /** Tutorial video, rendered on the server. */
  video: ReactNode;
  /** The manual's introduction (what it describes, version). */
  intro: ReactNode;
  sections: ManualViewerSection[];
};

// After a click or Back/Forward, ignore scroll-based updates until the page
// arrives at the section (or this safety limit passes), so the highlight does
// not flick through every section on the way. Long smooth scrolls can take
// well over a second, so arrival, not time, ends the lock.
const PROGRAMMATIC_SCROLL_LOCK_MS = 4_000;
const URL_SYNC_DELAY_MS = 300;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Bottom edge of the portal's sticky header(s) (desktop top bar, mobile header). */
function stickyOffset() {
  let bottom = 0;
  document.querySelectorAll<HTMLElement>("[data-sticky-offset]").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.top <= 1 && rect.bottom > 0 && getComputedStyle(element).position === "sticky") bottom = Math.max(bottom, rect.bottom);
  });
  return bottom;
}

function hashId() {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * Topic list + search + the manual itself. The text is rendered on the server
 * and passed in, so this component only handles filtering and navigation.
 * The topic being read is highlighted automatically as the page scrolls.
 */
export default function ManualViewer({ video, intro, sections }: ManualViewerProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => (normalized ? sections.filter((section) => section.searchText.includes(normalized)) : sections), [normalized, sections]);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const [stickyTop, setStickyTop] = useState(16);
  const navRef = useRef<HTMLElement | null>(null);
  const mobileRef = useRef<HTMLDetailsElement | null>(null);
  const visibleRef = useRef(visible);
  const lockUntil = useRef(0);
  const lockTarget = useRef<number | null>(null);
  const userScrolled = useRef(false);
  // True once the reader scrolls with the wheel, touch or keyboard, so a late layout correction never fights them.
  const userTookOver = useRef(false);
  const frame = useRef(0);

  useEffect(() => { visibleRef.current = visible; }, [visible]);

  const measure = useCallback(() => {
    if (lockUntil.current) {
      const arrived = lockTarget.current !== null && Math.abs(window.scrollY - lockTarget.current) <= 2;
      if (!arrived && Date.now() < lockUntil.current) return;
      lockUntil.current = 0;
      lockTarget.current = null;
    }
    const offset = stickyOffset();
    const boxes = visibleRef.current
      .map((section) => {
        const element = document.getElementById(section.id);
        return element ? { id: section.id, top: element.getBoundingClientRect().top } : null;
      })
      .filter((box): box is { id: string; top: number } => box !== null);
    const scroller = document.scrollingElement || document.documentElement;
    const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= scroller.scrollHeight - 4;
    const next = pickActiveSection(boxes, { line: offset + Math.min(140, window.innerHeight * 0.25), atBottom, viewportHeight: window.innerHeight });
    if (next) setActiveId(next);
  }, []);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  /** Scroll to a section, highlight it at once, and optionally add a history entry. */
  const goTo = useCallback((id: string, history: "push" | "none", smooth: boolean) => {
    const element = document.getElementById(id);
    if (!element) return false;
    setActiveId(id);
    lockUntil.current = Date.now() + PROGRAMMATIC_SCROLL_LOCK_MS;
    const top = sectionScrollTop({ sectionTop: element.getBoundingClientRect().top, scrollY: window.scrollY, stickyOffset: stickyOffset() });
    // The page may be too short to bring the section to the top: aim for the furthest reachable point.
    const scroller = document.scrollingElement || document.documentElement;
    lockTarget.current = Math.min(top, Math.max(0, scroller.scrollHeight - window.innerHeight));
    window.scrollTo({ top, behavior: smooth && !prefersReducedMotion() ? "smooth" : "instant" });
    if (history === "push" && hashId() !== id) window.history.pushState(window.history.state, "", `#${encodeURIComponent(id)}`);
    // Already there (or an instant jump): release the lock on the next frame.
    scheduleMeasure();
    return true;
  }, [scheduleMeasure]);

  // Keep the topic list and anchored headings clear of the sticky header.
  useEffect(() => {
    const update = () => setStickyTop(Math.round(stickyOffset()) + 16);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Deep link (refresh or shared URL): show that section, then follow the scroll.
  useEffect(() => {
    const initial = hashId();
    // Images, fonts and the video frame can move content after the first jump:
    // land again as the page settles, unless the reader has already taken over.
    const settle = () => { if (initial && !userTookOver.current) goTo(initial, "none", false); };
    const timers = [60, 500, 1500].map((delay, index) => window.setTimeout(() => {
      if (index === 0 && (!initial || !goTo(initial, "none", false))) measure();
      else settle();
    }, delay));
    window.addEventListener("load", settle);
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); window.removeEventListener("load", settle); };
  }, [goTo, measure]);

  useEffect(() => {
    const onScroll = () => {
      userScrolled.current = true;
      scheduleMeasure();
    };
    // The user taking over the scroll (wheel, touch, keys) ends a programmatic jump at once.
    const onUserScroll = () => {
      userTookOver.current = true;
      lockUntil.current = 0;
      lockTarget.current = null;
    };
    // Back/Forward and in-text links (#section) move between sections.
    const onHash = () => {
      const id = hashId();
      if (id && visibleRef.current.some((section) => section.id === id)) goTo(id, "none", false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", scheduleMeasure);
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true });
    window.addEventListener("keydown", onUserScroll);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    // Images, the video and late fonts change section heights after load.
    const content = document.getElementById("manual-content");
    const observer = typeof ResizeObserver !== "undefined" && content ? new ResizeObserver(scheduleMeasure) : null;
    if (observer && content) observer.observe(content);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", scheduleMeasure);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchstart", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      observer?.disconnect();
    };
  }, [goTo, scheduleMeasure]);

  // A search hides sections: re-check which visible one is current.
  useEffect(() => {
    // The page layout changed under any jump in progress, so stop waiting for it.
    lockUntil.current = 0;
    lockTarget.current = null;
    scheduleMeasure();
  }, [visible, scheduleMeasure]);

  // Keep the active topic visible inside the (scrollable) topic list.
  useEffect(() => {
    const panel = navRef.current;
    const link = panel?.querySelector<HTMLElement>(`[data-topic-desktop="${CSS.escape(activeId)}"]`);
    if (!panel || !link || panel.scrollHeight <= panel.clientHeight) return;
    const panelRect = panel.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const target = panelScrollTarget({ panelScrollTop: panel.scrollTop, panelHeight: panel.clientHeight, itemTop: linkRect.top - panelRect.top + panel.scrollTop, itemHeight: linkRect.height });
    if (target !== null) panel.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeId]);

  // Keep the address bar on the section being read without adding history entries.
  useEffect(() => {
    if (!activeId || !userScrolled.current) return;
    const timer = window.setTimeout(() => {
      if (lockUntil.current || hashId() === activeId) return;
      window.history.replaceState(window.history.state, "", `#${encodeURIComponent(activeId)}`);
    }, URL_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeId]);

  const onTopicClick = (event: MouseEvent<HTMLAnchorElement>, id: string, shown: boolean) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    userTookOver.current = true;
    if (!shown) return;
    goTo(id, "push", true);
    if (mobileRef.current) mobileRef.current.open = false;
  };

  const activeTitle = sections.find((section) => section.id === activeId)?.title || "";
  const topics = (desktop: boolean) => (
    <ul className={styles.topicList}>
      {sections.map((section) => {
        const shown = visible.includes(section);
        const active = shown && section.id === activeId;
        return (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={[shown ? "" : styles.topicDim, active ? styles.topicActive : ""].filter(Boolean).join(" ")}
              aria-disabled={!shown}
              aria-current={active ? "location" : undefined}
              onClick={(event) => onTopicClick(event, section.id, shown)}
              {...(desktop ? { "data-topic-desktop": section.id } : {})}
            >
              {section.title}
            </a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={styles.layout} style={{ ["--manual-sticky-top" as string]: `${stickyTop}px` } as CSSProperties}>
      <nav ref={navRef} className={styles.topics} aria-label="Manual topics">
        <label className={styles.search}>
          <span className={styles.srOnly}>Search the manual</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the manual" />
        </label>
        {normalized && <p className={styles.searchStatus} role="status">{visible.length === 0 ? "No topics match your search." : `${visible.length} topic${visible.length === 1 ? "" : "s"} match.`}</p>}
        {/* On a phone the list folds away so the manual itself is not pushed down the page. */}
        <details ref={mobileRef} className={styles.topicsMobile}>
          <summary>Topics{activeTitle && <span className={styles.currentTopic}> · {activeTitle}</span>}</summary>
          {topics(false)}
        </details>
        <div className={styles.topicsDesktop}>
          <strong>Topics</strong>
          {topics(true)}
        </div>
      </nav>

      <div id="manual-content" className={styles.content}>
        {video}
        <div className={styles.intro}>{intro}</div>
        {visible.length === 0 && <p className={styles.noResults}>No topics match “{query.trim()}”. Try a different word, such as “credits” or “interview”.</p>}
        {visible.map((section) => (
          <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`}>{section.title}</h2>
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}
