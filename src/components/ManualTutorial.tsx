import type { ManualTutorial as ManualTutorialData } from "@/lib/manual-tutorials";
import styles from "./ManualViewer.module.css";

type ManualTutorialProps = {
  tutorial: ManualTutorialData;
  expanded: boolean;
  playing: boolean;
  failed: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onFailure: () => void;
  onNavigate: (sectionId: string) => void;
};

/** One reusable, consent-by-click YouTube player for every manual section. */
export default function ManualTutorial({ tutorial, expanded, playing, failed, onToggle, onPlay, onFailure, onNavigate }: ManualTutorialProps) {
  const { sectionId, sectionTitle, youtubeId, guideNumber, total, previous, next } = tutorial;
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

  return (
    <div className={styles.tutorial}>
      <button
        type="button"
        className={styles.tutorialToggle}
        aria-expanded={expanded}
        aria-controls={`manual-tutorial-${sectionId}`}
        onClick={onToggle}
      >
        <span className={styles.tutorialToggleIcon} aria-hidden="true">
          <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /><path d="m8.3 6.7 5 3.3-5 3.3z" /></svg>
        </span>
        <span className={styles.tutorialToggleLabel}>{expanded ? "Hide video walkthrough" : "Watch video walkthrough"}</span>
        <span className={styles.tutorialGuide}>Guide {guideNumber} of {total}</span>
        <svg className={expanded ? styles.tutorialChevronOpen : styles.tutorialChevron} viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>

      {expanded && (
        <div id={`manual-tutorial-${sectionId}`} className={styles.tutorialPanel}>
          <div className={styles.videoFrame}>
            {playing && !failed ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&autoplay=1`}
                title={`${sectionTitle} video walkthrough`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                onError={onFailure}
              />
            ) : failed ? (
              <div className={styles.videoUnavailable} role="status">
                <strong>This tutorial could not be embedded.</strong>
                <a href={watchUrl} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
              </div>
            ) : (
              <button type="button" className={styles.videoPoster} onClick={onPlay} aria-label={`Play ${sectionTitle} video walkthrough`}>
                {/* This image is only requested when its section is expanded. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.videoThumbnail}
                  src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className={styles.playButton} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M8 5.8v12.4L18 12z" /></svg>
                </span>
              </button>
            )}
          </div>

          {!failed && (
            <p className={styles.tutorialFallback}>
              If the player does not load, <a href={watchUrl} target="_blank" rel="noopener noreferrer">open this tutorial on YouTube</a>.
            </p>
          )}

          <nav className={styles.tutorialNavigation} aria-label="Tutorial navigation">
            <button type="button" onClick={() => previous && onNavigate(previous.sectionId)} disabled={!previous}>
              <span aria-hidden="true">←</span> Previous tutorial
            </button>
            <button type="button" onClick={() => next && onNavigate(next.sectionId)} disabled={!next}>
              Next tutorial <span aria-hidden="true">→</span>
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
