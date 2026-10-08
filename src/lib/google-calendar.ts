import crypto from "node:crypto";
import { google } from "googleapis";

import { getCalendarConnection, saveCalendarConnection } from "@/lib/calendar-tokens";
import { getFinalInterviewCalendarConfig } from "@/lib/google-sheets";
import { scheduledInstant } from "@/lib/interview-time";
import { isDemoMode } from "@/lib/demo-mode";
import { configureGoogleApiTimeout } from "@/lib/google-api-options";
import { checkGrantedScopes, USER_OAUTH_SCOPES } from "@/lib/google-oauth-scopes";

configureGoogleApiTimeout();

// calendar.events.freebusy: availability checks only. calendar.events: creating,
// moving and cancelling interview events only. userinfo.email: token
// introspection only includes the authorized account email when the email
// scope was granted, so a token for another Google account is never stored
// under the HR role's expected email address. Defined in google-oauth-scopes.ts.
const CALENDAR_SCOPES = USER_OAUTH_SCOPES.calendar;

/** True when a stored connection carries exactly the approved calendar scopes. */
export function calendarScopesApproved(scope: string) {
  return checkGrantedScopes("calendar", scope).ok;
}

export class CalendarAccountMismatchError extends Error {
  constructor() {
    super("calendar_account_mismatch");
    this.name = "CalendarAccountMismatchError";
  }
}

export class CalendarScopeError extends Error {
  constructor(detail: string) {
    super(`calendar_scope_not_approved: ${detail}`);
    this.name = "CalendarScopeError";
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function finalInterviewCalendarTarget(assignedEmail = ""): Promise<{ email: string; calendarId: string }> {
  const configured = await getFinalInterviewCalendarConfig();
  const assigned = normalizedEmail(assignedEmail);
  // A role's assigned interviewer wins only when that person has connected
  // their own calendar; otherwise every role keeps using the shared HR
  // calendar exactly as before, so an assignment can never break booking.
  if (assigned && assigned !== normalizedEmail(configured.email || "") && await getCalendarConnection(assigned)) {
    return { email: assigned, calendarId: "primary" };
  }
  return {
    email: configured.email || assigned,
    calendarId: configured.calendarId || "primary",
  };
}

/** The calendar account a role's face-to-face interviews will actually use. */
export async function resolveFinalInterviewCalendarEmail(assignedEmail = ""): Promise<string> {
  return (await finalInterviewCalendarTarget(assignedEmail)).email;
}

// Reuses the same OAuth 2.0 Web application client already registered for
// "Sign in with Google" (NEXT_PUBLIC_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID).
// That flow only ever requests an ID token, so it never needed a client
// secret; the calendar flow uses the authorization-code grant instead
// (offline access, so we can refresh without HR present), which does.
// Add GOOGLE_OAUTH_CLIENT_SECRET to enable it; the redirect URI is derived
// from the current request origin, with GOOGLE_OAUTH_REDIRECT_URI retained as
// a fallback for non-requested server-side callers.
function oauthConfig(requestOrigin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  // Prefer the current deployed origin so a stale localhost or preview URL
  // cannot be used during the authorization-code exchange.
  const appOrigin = requestOrigin || process.env.NEXT_PUBLIC_APP_URL || "";
  const redirectUri = appOrigin
    ? new URL("/api/auth/google-calendar/callback", appOrigin).toString()
    : process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured.");
  if (!redirectUri) throw new Error("GOOGLE_OAUTH_REDIRECT_URI is not configured.");
  return { clientId, clientSecret, redirectUri };
}

function newOAuthClient(requestOrigin?: string) {
  const { clientId, clientSecret, redirectUri } = oauthConfig(requestOrigin);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Signed, expiring state param — protects the OAuth redirect against CSRF
 * and carries the session email through the round trip to Google. */
export function createOAuthState(email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const payload = JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 600 });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(state: string): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { email: string; exp: number };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.email;
  } catch {
    return null;
  }
}

export function getGoogleConsentUrl(email: string, requestOrigin?: string): string {
  const client = newOAuthClient(requestOrigin);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent", // lets HR choose the intended Google account and renews the refresh token
    scope: [...CALENDAR_SCOPES],
    include_granted_scopes: false,
    state: createOAuthState(email),
    login_hint: email,
  });
}

export async function exchangeCodeAndStore(code: string, email: string, requestOrigin?: string): Promise<void> {
  const client = newOAuthClient(requestOrigin);
  const { tokens } = await client.getToken(code);
  // A connection without an access token would look saved but fail every
  // later Calendar API call, so reject incomplete OAuth responses early.
  if (!tokens.access_token) throw new Error("Google did not return an access token.");
  // `login_hint` is only a suggestion. Google may authorize whichever account
  // is active in the browser, so verify the token owner before persisting it.
  const tokenInfo = await client.getTokenInfo(tokens.access_token);
  const expectedEmail = normalizedEmail(email);
  const authorizedEmail = normalizedEmail(tokenInfo.email || "");
  if (!authorizedEmail || authorizedEmail !== expectedEmail) throw new CalendarAccountMismatchError();
  // Both calendar scopes are required: without calendar.events.freebusy the portal
  // cannot check availability, and it never falls back to reading events.
  const scopes = checkGrantedScopes("calendar", tokenInfo.scopes);
  if (!scopes.ok) throw new CalendarScopeError([...scopes.missing.map((scope) => `missing ${scope}`), ...scopes.unapproved.map((scope) => `unapproved ${scope}`)].join(", "));
  await saveCalendarConnection({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || undefined,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "",
    scope: tokenInfo.scopes.join(" "),
  });
}

type AuthorizedCalendar = { client: InstanceType<typeof google.auth.OAuth2>; accountEmail: string };

/**
 * Returns a calendar client only when its OAuth token belongs to the expected
 * HR email and carries the approved calendar scopes. Existing tokens without
 * the email or free/busy scope are treated as invalid so HR must reconnect
 * instead of silently using an unknown account or a broader workaround.
 */
async function getAuthorizedClientWithIdentity(email: string): Promise<AuthorizedCalendar | null> {
  const connection = await getCalendarConnection(email);
  if (!connection || !connection.refreshToken) return null;

  const client = newOAuthClient();
  const expiresAt = connection.tokenExpiresAt ? Date.parse(connection.tokenExpiresAt) : 0;
  const needsRefresh = !connection.accessToken || !expiresAt || expiresAt < Date.now() + 60_000;
  let refreshedCredentials: { access_token?: string | null; expiry_date?: number | null; scope?: string | null } | null = null;

  if (needsRefresh) {
    client.setCredentials({ refresh_token: connection.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    refreshedCredentials = credentials;
  } else {
    client.setCredentials({ access_token: connection.accessToken, refresh_token: connection.refreshToken });
  }

  const accessToken = client.credentials.access_token;
  if (!accessToken) return null;
  const tokenInfo = await client.getTokenInfo(accessToken);
  const accountEmail = normalizedEmail(tokenInfo.email || "");
  if (!accountEmail || accountEmail !== normalizedEmail(email)) {
    console.warn("[Google Calendar] Stored OAuth token does not belong to the expected HR account.");
    return null;
  }
  // Tokens from before calendar.events.freebusy was required, or with permissions the
  // portal no longer asks for, need a reconnect rather than a workaround.
  if (!checkGrantedScopes("calendar", tokenInfo.scopes).ok) {
    console.warn("[Google Calendar] Stored OAuth token does not carry the approved calendar scopes; HR must reconnect.");
    return null;
  }
  if (refreshedCredentials) {
    await saveCalendarConnection({
      email,
      accessToken: refreshedCredentials.access_token || "",
      tokenExpiresAt: refreshedCredentials.expiry_date ? new Date(refreshedCredentials.expiry_date).toISOString() : "",
      scope: tokenInfo.scopes.join(" "),
    });
  }
  return { client, accountEmail };
}

/** Returns a ready-to-use OAuth2 client for this HR interviewer, refreshing (and
 * persisting) the access token first if it's expired or close to it. */
async function getAuthorizedClient(email: string) {
  const authorized = await getAuthorizedClientWithIdentity(email);
  return authorized?.client || null;
}

/**
 * Inspect the stored token owner for the Settings status card. This is read
 * only: a mismatched account is shown for transparency but is never used to
 * create or inspect final-interview events.
 */
async function getStoredCalendarAccountEmail(email: string): Promise<string | null> {
  const connection = await getCalendarConnection(email);
  if (!connection?.refreshToken) return null;
  const client = newOAuthClient();
  const expiresAt = connection.tokenExpiresAt ? Date.parse(connection.tokenExpiresAt) : 0;
  if (!connection.accessToken || !expiresAt || expiresAt < Date.now() + 60_000) {
    client.setCredentials({ refresh_token: connection.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
  } else {
    client.setCredentials({ access_token: connection.accessToken, refresh_token: connection.refreshToken });
  }
  const accessToken = client.credentials.access_token;
  if (!accessToken) return null;
  const tokenInfo = await client.getTokenInfo(accessToken);
  let accountEmail = normalizedEmail(tokenInfo.email || "");
  if (!accountEmail) {
    try {
      const userInfo = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
      accountEmail = normalizedEmail(userInfo.data.email || "");
    } catch {
      // Older tokens may not include a profile scope; the status card can
      // still safely report disconnected when Google does not reveal an email.
    }
  }
  // Calendar events are never read to work out who owns a token: a token that
  // does not reveal its email is left unknown and the card asks for a reconnect.
  return accountEmail || null;
}

/**
 * What HR needs to know about the calendar connection, without raw OAuth or
 * API text: `needs_reconnect` (expired, revoked or wrong account — only a new
 * connection fixes it) versus `unavailable` (Google could not be reached).
 */
export type CalendarIntegrationState = "connected" | "not_connected" | "needs_reconnect" | "unavailable";

export function classifyCalendarError(error: unknown): "needs_reconnect" | "unavailable" {
  const message = error instanceof Error ? `${error.message} ${(error as { code?: unknown }).code ?? ""}` : String(error);
  const response = (error as { response?: { status?: number; data?: { error?: unknown } } } | null)?.response;
  const status = Number(response?.status || (error as { status?: unknown } | null)?.status || 0);
  if (/invalid_grant|invalid_token|unauthorized_client|revoked|expired|insufficient.*(scope|permission)|account_mismatch/i.test(message)) return "needs_reconnect";
  if (status === 401 || (status === 403 && !/rate|quota/i.test(message))) return "needs_reconnect";
  return "unavailable";
}

export async function getCalendarConnectionStatus(email = ""): Promise<{ connected: boolean; state: CalendarIntegrationState; accountEmail: string | null; connectedAt: string | null; expectedEmail: string; accountMismatch: boolean }> {
  let expectedEmail = normalizedEmail(email);
  let connection: Awaited<ReturnType<typeof getCalendarConnection>> = null;
  try {
    const target = await finalInterviewCalendarTarget(email);
    expectedEmail = target.email;
    connection = await getCalendarConnection(target.email);
    if (!connection?.refreshToken) return { connected: false, state: "not_connected", accountEmail: null, connectedAt: null, expectedEmail, accountMismatch: false };
    const accountEmail = await getStoredCalendarAccountEmail(target.email);
    const accountMismatch = Boolean(accountEmail && accountEmail !== target.email);
    const authorized = accountMismatch ? null : await getAuthorizedClientWithIdentity(target.email);
    // A stored token that no longer proves the expected account can only be
    // fixed by connecting again.
    return { connected: Boolean(authorized), state: authorized ? "connected" : "needs_reconnect", accountEmail, connectedAt: connection.connectedAt || null, expectedEmail, accountMismatch };
  } catch (error) {
    console.warn("[Google Calendar] Connection identity check failed:", error);
    const state: CalendarIntegrationState = connection?.refreshToken ? classifyCalendarError(error) : "not_connected";
    return { connected: false, state, accountEmail: null, connectedAt: connection?.connectedAt || null, expectedEmail, accountMismatch: false };
  }
}

const integrationStateCache = new Map<string, { state: CalendarIntegrationState; expiresAt: number }>();
const INTEGRATION_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The shared HR calendar's state for dashboard alerts, cached per
 * organization for ten minutes so a dashboard refreshing every 30 seconds
 * does not call Google each time. Call inside the organization's request.
 */
export async function getCachedCalendarIntegrationState(organizationId: string): Promise<CalendarIntegrationState> {
  const cached = integrationStateCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  const { state } = await getCalendarConnectionStatus();
  integrationStateCache.set(organizationId, { state, expiresAt: Date.now() + INTEGRATION_STATE_TTL_MS });
  return state;
}

export type CalendarEventInput = {
  hodEmail: string;
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm:ss
  endTime: string; // HH:mm:ss
  timezone: string;
  attendeeEmails: string[];
  location?: string;
};

export type CalendarEventResult =
  | { created: true; eventId: string; htmlLink: string }
  | { created: false; reason: "not_connected" | "error" | "demo_mode"; error?: string };

export type CalendarAvailabilityResult =
  | { available: true; checked: true }
  | { available: false; checked: true; reason: "conflict"; busyUntil?: string }
  | { available: false; checked: false; reason: "not_connected" | "error"; error?: string };

/**
 * Creates the final-interview event on HR's connected Google Calendar.
 * Deliberately non-throwing: an HR interviewer who hasn't connected their
 * calendar yet (or a transient API error) must never block the candidate's
 * booking — the caller logs the outcome and moves on.
 */
export async function createFinalInterviewEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
  try {
    const target = await finalInterviewCalendarTarget(input.hodEmail);
    const client = await getAuthorizedClient(target.email);
    if (!client) return { created: false, reason: "not_connected" };

    const calendar = google.calendar({ version: "v3", auth: client });
    const start = scheduledInstant(input.date, input.startTime, input.timezone);
    const end = scheduledInstant(input.date, input.endTime, input.timezone);
    const response = await calendar.events.insert({
      calendarId: target.calendarId,
      sendUpdates: "all",
      requestBody: {
        summary: input.summary,
        description: input.description,
        ...(input.location?.trim() ? { location: input.location.trim() } : {}),
        start: { dateTime: start.toISOString(), timeZone: input.timezone },
        end: { dateTime: end.toISOString(), timeZone: input.timezone },
        attendees: input.attendeeEmails.map((email) => ({ email })),
      },
    });

    return { created: true, eventId: response.data.id || "", htmlLink: response.data.htmlLink || "" };
  } catch (error) {
    return { created: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

function googleErrorStatus(error: unknown) {
  const value = error as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return Number(value?.response?.status || value?.status || value?.code || 0);
}

/** Move an existing interview event to a new time (HR reschedule). The candidate is notified by Google. */
export async function updateFinalInterviewEvent(input: { hodEmail: string; eventId: string; date: string; startTime: string; endTime: string; timezone: string }): Promise<{ updated: true; eventId: string; htmlLink: string } | { updated: false; reason: "not_connected" | "not_found" | "error" | "demo_mode"; error?: string }> {
  if (isDemoMode()) return { updated: false, reason: "demo_mode" };
  try {
    const target = await finalInterviewCalendarTarget(input.hodEmail);
    const client = await getAuthorizedClient(target.email);
    if (!client) return { updated: false, reason: "not_connected" };
    const calendar = google.calendar({ version: "v3", auth: client });
    const start = scheduledInstant(input.date, input.startTime, input.timezone);
    const end = scheduledInstant(input.date, input.endTime, input.timezone);
    const response = await calendar.events.patch({
      calendarId: target.calendarId,
      eventId: input.eventId,
      sendUpdates: "all",
      requestBody: {
        start: { dateTime: start.toISOString(), timeZone: input.timezone },
        end: { dateTime: end.toISOString(), timeZone: input.timezone },
      },
    });
    return { updated: true, eventId: response.data.id || input.eventId, htmlLink: response.data.htmlLink || "" };
  } catch (error) {
    const status = googleErrorStatus(error);
    if (status === 404 || status === 410) return { updated: false, reason: "not_found" };
    return { updated: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function checkCalendarAvailability(input: Pick<CalendarEventInput, "hodEmail" | "date" | "startTime" | "endTime" | "timezone">): Promise<CalendarAvailabilityResult> {
  try {
    const target = await finalInterviewCalendarTarget(input.hodEmail);
    const client = await getAuthorizedClient(target.email);
    if (!client) return { available: false, checked: false, reason: "not_connected" };

    const start = scheduledInstant(input.date, input.startTime, input.timezone);
    const end = scheduledInstant(input.date, input.endTime, input.timezone);
    const calendar = google.calendar({ version: "v3", auth: client });
    try {
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          items: [{ id: target.calendarId }],
        },
      });
      const busy = response.data.calendars?.[target.calendarId]?.busy || [];
      const conflict = busy.find((window) => window.start && window.end);
      if (conflict) return { available: false, checked: true, reason: "conflict", busyUntil: conflict.end || undefined };
      return { available: true, checked: true };
    } catch (error) {
      // Availability comes only from calendar.events.freebusy; event contents are never read.
      return { available: false, checked: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
    }
  } catch (error) {
    return { available: false, checked: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export type CalendarBusyWindow = { start: string; end: string };
export type CalendarBusyWindowsResult =
  | { checked: true; busy: CalendarBusyWindow[] }
  | { checked: false; busy: CalendarBusyWindow[]; reason: "not_connected" | "error"; error?: string };

const FREE_BUSY_CHUNK_MS = 60 * 24 * 60 * 60 * 1000;

function freeBusyChunks(start: Date, end: Date): Array<[Date, Date]> {
  const chunks: Array<[Date, Date]> = [];
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += FREE_BUSY_CHUNK_MS) {
    chunks.push([new Date(cursor), new Date(Math.min(cursor + FREE_BUSY_CHUNK_MS, end.getTime()))]);
  }
  return chunks.length ? chunks : [[start, end]];
}

/**
 * Reads one bounded free/busy range so recurring candidate slots do not cause
 * one Google request per generated time. A failed lookup is non-blocking here;
 * the reservation endpoint performs the authoritative final check.
 */
export async function getCalendarBusyWindows(input: { hodEmail: string; start: Date; end: Date }): Promise<CalendarBusyWindowsResult> {
  try {
    const target = await finalInterviewCalendarTarget(input.hodEmail);
    const client = await getAuthorizedClient(target.email);
    if (!client) return { checked: false, busy: [], reason: "not_connected" };
    const calendar = google.calendar({ version: "v3", auth: client });
    try {
      // Google rejects free/busy ranges longer than a few months, so a long
      // lookahead (the Interview Calendar asks for 180 days) is read in chunks.
      const busy: CalendarBusyWindow[] = [];
      for (const [chunkStart, chunkEnd] of freeBusyChunks(input.start, input.end)) {
        const response = await calendar.freebusy.query({
          requestBody: {
            timeMin: chunkStart.toISOString(),
            timeMax: chunkEnd.toISOString(),
            items: [{ id: target.calendarId }],
          },
        });
        const calendarResult = response.data.calendars?.[target.calendarId];
        // Google can return HTTP 200 with a per-calendar failure. Never expose
        // an unreadable calendar as an empty, successfully checked calendar.
        if (!calendarResult || calendarResult.errors?.length) {
          const reasons = (calendarResult?.errors || []).map((entry) => entry.reason).filter(Boolean).join(", ");
          return { checked: false, busy: [], reason: "error", error: `Google Calendar availability could not be read${reasons ? ` (${reasons})` : ""}.` };
        }
        busy.push(...(calendarResult.busy || [])
          .filter((window): window is { start: string; end: string } => Boolean(window.start && window.end))
          .map((window) => ({ start: window.start, end: window.end })));
      }
      return { checked: true, busy };
    } catch (error) {
      // Availability comes only from calendar.events.freebusy; event contents are never read.
      return { checked: false, busy: [], reason: "error", error: error instanceof Error ? error.message : String(error) };
    }
  } catch (error) {
    return { checked: false, busy: [], reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteFinalInterviewEvent(hodEmail: string, eventId: string, options: { allowDemoSideEffect?: boolean } = {}): Promise<{ deleted: true } | { deleted: false; reason: "not_connected" | "error" | "demo_mode"; error?: string }> {
  if (!eventId) return { deleted: true };
  if (isDemoMode() && !options.allowDemoSideEffect) return { deleted: false, reason: "demo_mode" };
  try {
    const target = await finalInterviewCalendarTarget(hodEmail);
    const client = await getAuthorizedClient(target.email);
    if (!client) return { deleted: false, reason: "not_connected" };
    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.delete({ calendarId: target.calendarId, eventId, sendUpdates: "all" });
    return { deleted: true };
  } catch (error) {
    // Already removed in Google (by HR or a previous attempt): nothing left to do.
    const status = googleErrorStatus(error);
    if (status === 404 || status === 410) return { deleted: true };
    return { deleted: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
