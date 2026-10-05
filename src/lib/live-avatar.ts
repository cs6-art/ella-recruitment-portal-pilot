// Server-only helper for the LiveAvatar (HeyGen) integration that powers the
// "Meet Smile now" live video interview on the public apply page.
//
// This never runs in the browser: it holds the LiveAvatar secret API key and
// talks to https://api.liveavatar.com directly. The browser only ever
// receives the short-lived session token returned by createLiveAvatarSession.
//
// Customization by Job Description and role: the LiveAvatar "McLink AI
// Interviewer" voice agent's context uses ${role_title} and
// ${job_description} placeholders (configured in the LiveAvatar dashboard
// under Contexts). Every session passes the current role's title and
// published job description as dynamic_variables, so Smile's greeting and
// screening questions are generated for that specific role rather than a
// generic script. See docs/LIVE-AVATAR-INTEGRATION.md for setup details.

import { avatarOpeningText, avatarPromptVariables, renderAvatarPrompt } from "./avatar-prompt.ts";
import crypto from "node:crypto";

const LIVEAVATAR_API_URL = process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com";
const MAX_SESSION_DURATION_SECONDS = 20 * 60;
const DEFAULT_MAX_SESSION_DURATION_SECONDS = MAX_SESSION_DURATION_SECONDS;

function maxSessionDurationSeconds(): number {
  const configured = Number.parseInt(process.env.LIVEAVATAR_MAX_SESSION_DURATION_SECONDS || "", 10);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_SESSION_DURATION_SECONDS;

  // Never request more than the provider's twenty-minute plan limit, even when
  // an environment override is set higher than the supported maximum.
  return Math.min(configured, MAX_SESSION_DURATION_SECONDS);
}

export type LiveAvatarRoleContext = {
  roleTitle: string;
  jobDescription: string;
  candidateName?: string;
  resumeSummary?: string;
  screeningQuestion?: string;
  // HR-configured grading context from the role request. The LiveAvatar
  // context must reference ${role_requirements}, ${interview_questions} and
  // ${evaluation_fields} for Smile to use them (LiveAvatar dashboard > Contexts).
  roleRequirements?: string;
  interviewQuestions?: string;
  evaluationFields?: string;
  // The role's editable Smile Avatar script (empty = the standard script). When
  // set together with the role context, the script is sent to LiveAvatar as a
  // context of its own instead of relying on the dashboard's stored context.
  avatarSystemPrompt?: string;
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
 * the "Meet Smile now" card at all, so the feature stays invisible instead of
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

// Contexts cannot be deleted through the API, so identical scripts reuse one.
const contextIdsByHash = new Map<string, string>();

/**
 * Creates (or reuses) a LiveAvatar context holding this role's rendered Smile
 * script. Returns null when the provider refuses, so the caller can fall back
 * to the stored voice agent instead of blocking the interview.
 */
async function ensureAvatarContext(apiKey: string, roleTitle: string, prompt: string): Promise<string | null> {
  const hash = crypto.createHash("sha256").update(prompt).digest("hex");
  const cached = contextIdsByHash.get(hash);
  if (cached) return cached;
  try {
    const response = await fetch(`${LIVEAVATAR_API_URL}/v1/contexts`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Smile ${roleTitle}`.slice(0, 50) + ` ${hash.slice(0, 8)}`, prompt, opening_text: avatarOpeningText() }),
    });
    const body = await response.json().catch(() => null);
    const id = body?.data?.id;
    if (!response.ok || typeof id !== "string") {
      console.error("[LiveAvatar] Could not create the role context; using the stored voice agent instead:", response.status, body?.message || "");
      return null;
    }
    contextIdsByHash.set(hash, id);
    return id;
  } catch (error) {
    console.error("[LiveAvatar] Could not create the role context; using the stored voice agent instead:", error);
    return null;
  }
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
  if (role.resumeSummary) dynamicVariables.resume_summary = clampVariable(role.resumeSummary);
  if (role.screeningQuestion) dynamicVariables.screening_question = clampVariable(role.screeningQuestion, 500);
  if (role.roleRequirements) dynamicVariables.role_requirements = clampVariable(role.roleRequirements);
  if (role.interviewQuestions) dynamicVariables.interview_questions = clampVariable(role.interviewQuestions);
  if (role.evaluationFields) dynamicVariables.evaluation_fields = clampVariable(role.evaluationFields);

  // A role-level script is only used for interviews that carry the full role
  // context; the preview path keeps the stored voice agent.
  let contextId: string | null = null;
  if (role.roleRequirements !== undefined && role.interviewQuestions !== undefined) {
    const prompt = renderAvatarPrompt(role.avatarSystemPrompt, {
      roleTitle: role.roleTitle,
      jobDescription: role.jobDescription,
      roleRequirements: role.roleRequirements || "",
      interviewQuestions: role.interviewQuestions || "",
      evaluationFields: role.evaluationFields || "",
    });
    contextId = await ensureAvatarContext(apiKey, role.roleTitle || "role", prompt);
    // Variables the script references must always be supplied.
    for (const name of avatarPromptVariables(prompt)) if (!(name in dynamicVariables)) dynamicVariables[name] = "Not provided.";
  }
  const voiceId = requiredEnv("LIVEAVATAR_VOICE_ID");

  const requestSession = (agent: Record<string, unknown>) => fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "FULL",
      avatar_id: avatarId,
      is_sandbox: isSandbox,
      ...agent,
      interactivity_type: "CONVERSATIONAL",
      // Keep an abandoned browser tab from running up LiveAvatar credits
      // indefinitely, and stay within the provider's twenty-minute plan limit.
      max_session_duration: maxSessionDurationSeconds(),
    }),
  });
  const storedAgent = { voice_agent: { id: voiceAgentId, language, dynamic_variables: dynamicVariables } };

  let response: Response;
  if (contextId) {
    response = await requestSession({ avatar_persona: { context_id: contextId, language, ...(voiceId ? { voice_id: voiceId } : {}) }, dynamic_variables: dynamicVariables });
    if (!response.ok) {
      // The inline persona is a deprecated provider option; never let it stop an interview.
      console.error("[LiveAvatar] Session with the role script was refused; using the stored voice agent instead:", response.status);
      response = await requestSession(storedAgent);
    }
  } else {
    response = await requestSession(storedAgent);
  }

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


