type PublishedRoleState = {
  status?: string;
  recruitmentSetupStatus?: string;
  postingConfirmed?: string | boolean;
  postedAt?: string;
  archivedAt?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Intake requires durable publication evidence in either backend. An
 * archived role keeps its last status (archiving does not rewrite it) so
 * `archivedAt` is checked independently of the status/publication fields.
 */
export function isPublishedRoleForIntake(role: PublishedRoleState): boolean {
  const status = text(role.status).toLowerCase();
  const setupStatus = text(role.recruitmentSetupStatus).toLowerCase();
  const postingConfirmed = text(role.postingConfirmed).toLowerCase();
  return text(role.archivedAt) === ""
    && status === "job posted"
    && setupStatus === "published"
    && (postingConfirmed === "true" || text(role.postedAt) !== "");
}

/** Role target dates are calendar days in the portal's office timezone. */
export const ROLE_TARGET_DATE_TIME_ZONE = "Asia/Singapore";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function todayIn(timeZone: string, now: Date) {
  let zone = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(now); } catch { zone = ROLE_TARGET_DATE_TIME_ZONE; }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * True once the role's target hiring date has fully passed in the office
 * timezone. The target day itself is still open; a missing or unreadable
 * date never counts as passed.
 */
export function isRoleTargetDatePassed(targetHiringDate: unknown, now = new Date(), timeZone = ROLE_TARGET_DATE_TIME_ZONE): boolean {
  const target = text(targetHiringDate).slice(0, 10);
  return DATE_ONLY.test(target) && todayIn(timeZone, now) > target;
}

/**
 * The single rule for "can HR (or a candidate) pick this role for new work":
 * an overdue role is hidden from role pickers and rejected by the routes that
 * start new work on it. It is never deleted — role details, applicants,
 * history and reports stay available.
 */
export function isRoleOpenForSelection(role: { targetHiringDate?: unknown }, now = new Date()): boolean {
  return !isRoleTargetDatePassed(role.targetHiringDate, now);
}

export const ROLE_TARGET_DATE_PASSED_MESSAGE = "This role's target hiring date has passed, so it can no longer take new applicants or interviews.";

/** Published, not archived and not past its target date. */
export function isPublishedRoleOpenForIntake(role: PublishedRoleState & { targetHiringDate?: unknown }, now = new Date()): boolean {
  return isPublishedRoleForIntake(role) && isRoleOpenForSelection(role, now);
}
