import crypto from "node:crypto";
import { google } from "googleapis";

import { getCalendarConnection, saveCalendarConnection } from "@/lib/calendar-tokens";
import { getFinalInterviewCalendarConfig } from "@/lib/google-sheets";
import { scheduledInstant } from "@/lib/interview-time";
import { isDemoMode } from "@/lib/demo-mode";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  // Token introspection only includes the authorized account email when the
  // email scope was granted. This prevents a token for another Google account
  // from being stored under the HR role's expected email address.
  "https://www.googleapis.com/auth/userinfo.email",
];

export class CalendarAccountMismatchError extends Error {
  constructor() {
    super("calendar_account_mismatch");
    this.name = "CalendarAccountMismatchError";
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function finalInterviewCalendarTarget(fallbackEmail = ""): Promise<{ email: string; calendarId: string }> {
  const configured = await getFinalInterviewCalendarConfig();
  return {
    email: configured.email || normalizedEmail(fallbackEmail),
    calendarId: configured.calendarId || "primary",
  };
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
    scope: CALENDAR_SCOPES,
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
  await saveCalendarConnection({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || undefined,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "",
    scope: tokens.scope || CALENDAR_SCOPES.join(" "),
  });
}

type AuthorizedCalendar = { client: InstanceType<typeof google.auth.OAuth2>; accountEmail: string };

/**
 * Returns a calendar client only when its OAuth token belongs to the expected
 * HR email. Existing tokens without the email scope are treated as invalid so
 * HR must reconnect instead of silently using an unknown account.
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
  if (refreshedCredentials) {
    await saveCalendarConnection({
      email,
      accessToken: refreshedCredentials.access_token || "",
      tokenExpiresAt: refreshedCredentials.expiry_date ? new Date(refreshedCredentials.expiry_date).toISOString() : "",
      scope: refreshedCredentials.scope || CALENDAR_SCOPES.join(" "),
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
  if (!accountEmail) {
    try {
      // Calendar tokens created before identity introspection was added do not
      // include an email/profile scope. The events API still returns the
      // authenticated calendar owner's address without exposing event data;
      // use that owner identity for the read-only Settings status card.
      const events = await google.calendar({ version: "v3", auth: client }).events.list({
        calendarId: "primary",
        maxResults: 10,
        showDeleted: false,
        singleEvents: false,
        fields: "items(organizer,creator)",
      });
      const owner = (events.data.items || []).find((event) => event.organizer?.self || event.creator?.self);
      accountEmail = normalizedEmail(owner?.organizer?.email || owner?.creator?.email || "");
    } catch {
      // Empty calendars or restricted legacy tokens may not expose event
      // metadata; leave the account unknown rather than guessing.
    }
  }
  return accountEmail || null;
}

export async function getCalendarConnectionStatus(email = ""): Promise<{ connected: boolean; accountEmail: string | null; connectedAt: string | null; expectedEmail: string; accountMismatch: boolean }> {
  try {
    const target = await finalInterviewCalendarTarget(email);
    const connection = await getCalendarConnection(target.email);
    const accountEmail = await getStoredCalendarAccountEmail(target.email);
    const accountMismatch = Boolean(accountEmail && accountEmail !== target.email);
    const authorized = accountMismatch ? null : await getAuthorizedClientWithIdentity(target.email);
    return { connected: Boolean(authorized), accountEmail, connectedAt: connection?.connectedAt || null, expectedEmail: target.email, accountMismatch };
  } catch (error) {
    console.warn("[Google Calendar] Connection identity check failed:", error);
    return { connected: false, accountEmail: null, connectedAt: null, expectedEmail: normalizedEmail(email), accountMismatch: false };
  }
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
      const message = error instanceof Error ? error.message : String(error);
      if (!/insufficient authentication scopes|insufficient permission/i.test(message)) {
        return { available: false, checked: false, reason: "error", error: message };
      }

      // Older connections may have calendar.events but not calendar.freebusy.
      // Read event windows as a compatible fallback until HR reconnects.
      const events = await calendar.events.list({
        calendarId: target.calendarId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        showDeleted: false,
        maxResults: 2500,
      });
      const conflict = (events.data.items || []).find((event) => {
        const eventStart = event.start?.dateTime || event.start?.date;
        const eventEnd = event.end?.dateTime || event.end?.date;
        if (!eventStart || !eventEnd) return false;
        return Date.parse(eventStart) < end.getTime() && Date.parse(eventEnd) > start.getTime();
      });
      if (conflict) return { available: false, checked: true, reason: "conflict", busyUntil: conflict.end?.dateTime || conflict.end?.date || undefined };
      return { available: true, checked: true };
    }
  } catch (error) {
    return { available: false, checked: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export type CalendarBusyWindow = { start: string; end: string };
export type CalendarBusyWindowsResult =
  | { checked: true; busy: CalendarBusyWindow[] }
  | { checked: false; busy: CalendarBusyWindow[]; reason: "not_connected" | "error"; error?: string };

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
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: input.start.toISOString(),
          timeMax: input.end.toISOString(),
          items: [{ id: target.calendarId }],
        },
      });
      const busy = (response.data.calendars?.[target.calendarId]?.busy || [])
        .filter((window): window is { start: string; end: string } => Boolean(window.start && window.end))
        .map((window) => ({ start: window.start, end: window.end }));
      return { checked: true, busy };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/insufficient authentication scopes|insufficient permission/i.test(message)) {
        return { checked: false, busy: [], reason: "error", error: message };
      }
      const events = await calendar.events.list({
        calendarId: target.calendarId,
        timeMin: input.start.toISOString(),
        timeMax: input.end.toISOString(),
        singleEvents: true,
        showDeleted: false,
        maxResults: 2500,
      });
      const busy = (events.data.items || []).map((event) => ({ start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date }))
        .filter((window): window is { start: string; end: string } => Boolean(window.start && window.end))
        .map((window) => ({ start: window.start, end: window.end }));
      return { checked: true, busy };
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
    return { deleted: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
