/**
 * The single source of truth for every Google OAuth scope this portal uses.
 *
 * User OAuth scopes are what HR users see on Google's consent screen, and they
 * must match Google Auth Platform -> Data Access exactly. Service-account
 * scopes never reach a consent screen, but they follow the same rule: no
 * restricted Drive scope anywhere.
 *
 * This file must stay free of imports so the regression tests can load it
 * directly.
 */

export const GOOGLE_SCOPE = {
  userinfoEmail: "https://www.googleapis.com/auth/userinfo.email",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
  calendarEventsFreebusy: "https://www.googleapis.com/auth/calendar.events.freebusy",
  spreadsheets: "https://www.googleapis.com/auth/spreadsheets",
} as const;

export type UserOAuthFlow = "resumeDrive" | "recordingDrive" | "calendar";

/**
 * What each consent flow requests. `userinfo.email` lets the server confirm
 * the token belongs to the expected account before storing it.
 */
export const USER_OAUTH_SCOPES: Record<UserOAuthFlow, readonly string[]> = {
  // Bulk Resume Screening: HR picks resumes in the Google Picker.
  resumeDrive: [GOOGLE_SCOPE.driveFile, GOOGLE_SCOPE.userinfoEmail],
  // Settings -> Live Avatar recordings: saved into a folder picked in the Picker.
  recordingDrive: [GOOGLE_SCOPE.driveFile, GOOGLE_SCOPE.userinfoEmail],
  // Final interviews: freebusy checks availability, events creates/moves/cancels the interview.
  calendar: [GOOGLE_SCOPE.calendarEvents, GOOGLE_SCOPE.calendarEventsFreebusy, GOOGLE_SCOPE.userinfoEmail],
};

/** Exactly what Google Auth Platform -> Data Access should list. */
export const APPROVED_USER_OAUTH_SCOPES: readonly string[] = [...new Set(Object.values(USER_OAUTH_SCOPES).flat())];

/** Server-to-server credentials. Never shown to users and never on a consent screen. */
export const SERVICE_ACCOUNT_SCOPES = {
  // Resume storage in the configured Shared Drive. drive.file reaches only the
  // folder and files this service account creates.
  resumeStorage: [GOOGLE_SCOPE.driveFile],
  // Playback/deletion of recordings saved by the service account before
  // organizations connected their own Drive.
  legacyRecordingStorage: [GOOGLE_SCOPE.driveFile],
  // Portal records kept in spreadsheets the service account owns or was shared.
  sheets: [GOOGLE_SCOPE.spreadsheets],
} as const;

// Google may echo identity aliases next to the requested scopes.
const IDENTITY_ALIASES = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.profile", "profile"]);

/** Any Drive scope broader than per-file access: drive, drive.readonly, drive.metadata(.readonly), ... */
export function isBroadDriveScope(scope: string) {
  return /^https:\/\/www\.googleapis\.com\/auth\/drive(\.|$)/.test(scope) && scope !== GOOGLE_SCOPE.driveFile;
}

export type GrantedScopeCheck =
  | { ok: true }
  | { ok: false; missing: string[]; unapproved: string[] };

/**
 * A stored or freshly issued token is usable only if it has every scope its
 * flow needs and nothing outside the approved list. A token issued before the
 * move to drive.file (drive.readonly) fails here, so the user reconnects
 * instead of the portal quietly keeping the old permission.
 */
export function checkGrantedScopes(flow: UserOAuthFlow, granted: string | readonly string[] | null | undefined): GrantedScopeCheck {
  const list = typeof granted === "string" ? granted.split(/\s+/) : [...(granted || [])];
  const scopes = new Set(list.map((scope) => scope.trim()).filter(Boolean));
  const missing = USER_OAUTH_SCOPES[flow].filter((scope) => !scopes.has(scope));
  const unapproved = [...scopes].filter((scope) => isBroadDriveScope(scope) || (!APPROVED_USER_OAUTH_SCOPES.includes(scope) && !IDENTITY_ALIASES.has(scope)));
  return missing.length === 0 && unapproved.length === 0 ? { ok: true } : { ok: false, missing, unapproved };
}
