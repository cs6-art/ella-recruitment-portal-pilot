import styles from "./AppShell.module.css";

/**
 * Static fallback used while a dynamic portal route is streaming. It keeps a
 * stable shell on screen without rendering tenant-specific navigation or data.
 */
export default function PortalLoadingShell() {
  return (
    <main className={`container page ${styles.loadingPage}`} role="status" aria-live="polite" aria-busy="true" aria-label="Loading portal page">
      <span className={styles.loadingEyebrow} />
      <span className={styles.loadingTitle} />
      <span className={styles.loadingDescription} />
      <div className={styles.loadingRows}>
        <span /><span /><span />
      </div>
      <span className="sr-only">Loading portal page.</span>
    </main>
  );
}
