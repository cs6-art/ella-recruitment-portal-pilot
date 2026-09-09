// Server-only helper for the LiveAvatar (HeyGen) integration that powers the
// "Meet Ella now" live video interview on the public apply page.
//
// This never runs in the browser: it holds the LiveAvatar secret API key and
// talks to https://api.liveavatar.com directly. The browser only ever
// receives the short-lived session token returned by createLiveAvatarSession.
//
// Customization by Job Description and role: the LiveAvatar "McLink AI
// Interviewer" voice agent's context uses ${role_title} and
// ${job_description} placeholders (configured in the LiveAvatar dashboard
// under Contexts). Every session passes the current role's title and
// published job description as dynamic_variables, so Ella's greeting and
// screening questions are generated for that specific role rather than a
// generic script. See docs/LIVE-AVATAR-INTEGRATION.md for setup details.

const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com";

export type LiveAvatarRoleContext = {
  roleTitle: string;
  jobDescription: string;
  candidateName?: string;
};

export type LiveAvatarSessionResult = {
  sessionToken: string;
  sessionId: string;
};

function requiredEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/**
 * True once an operator has configured the LiveAvatar env vars. The apply
 * page checks this (via the session API route) to decide whether to render
 * the "Meet Ella now" card at all, so the feature stays invisible instead of
 * broken on environments that have not been configured yet.
 */
export function isLiveAvatarConfigured(): boolean {
  return Boolean(
    requiredEnv("LIVEAVATAR_API_KEY") &&
      requiredEnv("LIVEAVATAR_AVATAR_ID") &&
      requiredEnv("LIVEAVATAR_VOICE_AGENT_ID"),
  );
}

// LiveAvatar dynamic_variables values are capped at 1000 characters and 64
// character keys (see docs.liveavatar.com/api-reference/sessions/create-session-token).
function clampVariable(value: string, maxLength = 1000): string {
  const trimmed = (value || "").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

/**
 * Creates a short-lived LiveAvatar session token scoped to one role's
 * published title and job description. Throws on any non-2xx response; the
 * caller (the API route) is responsible for turning that into a client-safe
 * error.
 */
export async function createLiveAvatarSession(
  role: LiveAvatarRoleContext,
): Promise<LiveAvatarSessionResult> {
  const apiKey = requiredEnv("LIVEAVATAR_API_KEY");
  const avatarId = requiredEnv("LIVEAVATAR_AVATAR_ID");
  const voiceAgentId = requiredEnv("LIVEAVATAR_VOICE_AGENT_ID");
  if (!apiKey || !avatarId || !voiceAgentId) {
    throw new Error("LiveAvatar is not configured (missing LIVEAVATAR_API_KEY, LIVEAVATAR_AVATAR_ID, or LIVEAVATAR_VOICE_AGENT_ID).");
  }

  const isSandbox = (process.env.LIVEAVATAR_IS_SANDBOX || "false").trim().toLowerCase() === "true";
  const language = requiredEnv("LIVEAVATAR_LANGUAGE") || "en";

  const dynamicVariables: Record<string, string> = {
    role_title: clampVariable(role.roleTitle || "this role"),
    job_description: clampVariable(role.jobDescription || "No job description was provided."),
  };
  if (role.candidateName) {
    dynamicVariables.candidate_name = clampVariable(role.candidateName, 200);
  }

  const response = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "FULL",
      avatar_id: avatarId,
      is_sandbox: isSandbox,
      voice_agent: {
        id: voiceAgentId,
        language,
        dynamic_variables: dynamicVariables,
      },
      interactivity_type: "CONVERSATIONAL",
      // Hard stop so an abandoned browser tab cannot run up LiveAvatar
      // credits indefinitely.
      // LiveAvatar sandbox keys currently enforce a 60-second maximum.
      // Staying at the provider limit prevents the session request from being
      // rejected before a room is created.
      max_session_duration: 60,
    }),
  });

  if (!response.ok) {
    let message = `LiveAvatar session request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body?.message || body?.error || message;
    } catch {
      // Response wasn't JSON; keep the generic message above.
    }
    throw new Error(message);
  }

  const body = await response.json();
  const sessionToken = body?.data?.session_token;
  const sessionId = body?.data?.session_id;
  if (!sessionToken || !sessionId) {
    throw new Error("LiveAvatar did not return a session token.");
  }
  return { sessionToken, sessionId };
}


