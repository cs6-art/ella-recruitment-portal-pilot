const RESUME_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const INTERVIEW_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // The Postgres target has its own transactional maintenance paths. Running
  // the legacy Sheets reconciler in every long-lived Vercel instance causes
  // needless reads/writes every five minutes and is the main source of idle
  // Fluid CPU consumption for the pilot deployment.
  const { isPostgresRecruitmentTarget } = await import("./lib/recruitment-target-mode");
  const usePostgresTarget = isPostgresRecruitmentTarget();

  // Keep scheduled Drive cleanup away from protected historical files while
  // demo safety is enabled. New uploads still retain their normal expiry.
  const { isDemoMode } = await import("./lib/demo-mode");
  if (!isDemoMode()) {
    const { cleanupExpiredResumeFiles } = await import("./lib/resume-files");
    const runCleanup = () => {
      void cleanupExpiredResumeFiles().catch((error) => {
        console.warn("[Resume Cleanup] Scheduled cleanup failed:", error);
      });
    };

    runCleanup();
    const timer = setInterval(runCleanup, RESUME_CLEANUP_INTERVAL_MS);
    timer.unref?.();
  }

  // Interview maintenance is safe in demo mode because each writer enforces
  // the fixed August 20 cutoff and skips protected historical records.
  if (usePostgresTarget) return;

  const { syncPastBookedInterviewsNoShow, syncPastAvailableInterviewSlots } = await import("./lib/applicant-workflow");
  const runInterviewMaintenance = () => {
    void (async () => {
      await syncPastBookedInterviewsNoShow();
      await syncPastAvailableInterviewSlots();
    })().catch((error) => {
      console.warn("[Interview Maintenance] Scheduled sync failed:", error);
    });
  };

  // Delay the first pass so application startup and the first navigation are
  // not competing with the maintenance sheet reads.
  const initialMaintenance = setTimeout(runInterviewMaintenance, 15_000);
  initialMaintenance.unref?.();
  const maintenanceTimer = setInterval(runInterviewMaintenance, INTERVIEW_MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref?.();
}
