import type { ManualVideo as ManualVideoSource } from "@/lib/manual-video";
import styles from "./ManualViewer.module.css";

/**
 * The tutorial video. It is responsive (16:9 and as wide as the page), shows
 * the browser's own playback controls, never autoplays, and is not fetched
 * until the person presses play (file) or scrolls near it (embedded player).
 */
export default function ManualVideo({ video }: { video: ManualVideoSource | null }) {
  if (!video) {
    return (
      <section className={styles.videoCard} aria-labelledby="manual-video-title">
        <h2 id="manual-video-title">Tutorial video</h2>
        <div className={`${styles.videoFrame} ${styles.videoPlaceholder}`} role="img" aria-label="Tutorial video coming soon">
          <span>Tutorial video coming soon</span>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.videoCard} aria-labelledby="manual-video-title">
      <h2 id="manual-video-title">Tutorial video</h2>
      <div className={styles.videoFrame}>
        {video.kind === "file" ? (
          <video controls preload="none" playsInline aria-label="Smile Recruitment Portal tutorial video">
            <source src={video.src} type={video.mimeType} />
            Your browser cannot play this video.
          </video>
        ) : (
          <iframe
            src={video.src}
            title="Smile Recruitment Portal tutorial video"
            loading="lazy"
            allow="fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </section>
  );
}
