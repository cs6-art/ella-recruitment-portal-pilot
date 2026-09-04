/**
 * Explicit switch for the dormant Postgres recruitment target.
 *
 * The default remains Sheets so preparing the target cannot silently cut over
 * the live portal. The Pilot operator must set RECRUITMENT_BACKEND=postgres
 * in the Pilot deployment as a separate, reviewed cutover action.
 */
export function isPostgresRecruitmentTarget() {
  return process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
}
