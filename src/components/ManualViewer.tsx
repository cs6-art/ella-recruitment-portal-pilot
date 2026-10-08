"use client";

import { useMemo, useState, type ReactNode } from "react";

import styles from "./ManualViewer.module.css";

export type ManualViewerSection = { id: string; title: string; searchText: string; content: ReactNode };

type ManualViewerProps = {
  /** Tutorial video, rendered on the server. */
  video: ReactNode;
  /** The manual's introduction (what it describes, version). */
  intro: ReactNode;
  sections: ManualViewerSection[];
};

/**
 * Topic list + search + the manual itself. The text is rendered on the server
 * and passed in, so this component only handles filtering and navigation.
 */
export default function ManualViewer({ video, intro, sections }: ManualViewerProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => (normalized ? sections.filter((section) => section.searchText.includes(normalized)) : sections), [normalized, sections]);

  const topics = (
    <ul className={styles.topicList}>
      {sections.map((section) => {
        const shown = visible.includes(section);
        return (
          <li key={section.id}>
            <a href={`#${section.id}`} className={shown ? "" : styles.topicDim} aria-disabled={!shown}>{section.title}</a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={styles.layout}>
      <nav className={styles.topics} aria-label="Manual topics">
        <label className={styles.search}>
          <span className={styles.srOnly}>Search the manual</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the manual" />
        </label>
        {normalized && <p className={styles.searchStatus} role="status">{visible.length === 0 ? "No topics match your search." : `${visible.length} topic${visible.length === 1 ? "" : "s"} match.`}</p>}
        {/* On a phone the list folds away so the manual itself is not pushed down the page. */}
        <details className={styles.topicsMobile}>
          <summary>Topics</summary>
          {topics}
        </details>
        <div className={styles.topicsDesktop}>
          <strong>Topics</strong>
          {topics}
        </div>
      </nav>

      <div className={styles.content}>
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
