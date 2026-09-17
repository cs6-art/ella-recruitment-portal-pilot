export type VoiceInterviewEvaluation = {
  score: number | null;
  recommendation: string;
  strengths: string;
  concerns: string;
  summary: string;
  riskFlags: string[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function candidateTurns(transcript: string) {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:user|candidate)\s*:\s*/i, "").trim())
    .filter((line) => line && !/^\s*(?:ai|assistant)\s*:/i.test(line))
    .filter((line) => !/^(yes|no|okay|ok|sure|thanks|thank you)[.!]?$/i.test(line));
}

function firstNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function claimedYears(text: string) {
  return firstNumber(text, /(?:about|around|approximately|over|more than|nearly)?\s*(\d{1,2})\s*(?:years?|yrs?)\b/i)
    ?? firstNumber(text, /(\d{1,2})\s*年/);
}

function resumeYears(text: string) {
  return firstNumber(text, /(?:with|having|has|of)\s*(?:about|around|approximately)?\s*(\d{1,2})\s*(?:years?|yrs?)\b/i)
    ?? firstNumber(text, /(\d{1,2})\s*年/);
}

function roleSignals(roleTitle: string, roleDescription: string, answer: string) {
  const roleText = `${roleTitle} ${roleDescription}`.toLowerCase();
  const answerText = answer.toLowerCase();
  const signals = [
    ["automation", /automati|自动化/],
    ["test", /\btest(?:ing|s)?\b|测试/],
    ["API", /\bapi\b/],
    ["CI/CD", /ci\s*[/&-]?\s*cd|pipeline|流水线/],
    ["Playwright", /playwright|pre[- ]?write/],
    ["Selenium", /selenium/],
    ["Cypress", /cypress/],
    ["regression", /regression|回归/],
  ] as const;
  return signals.filter(([, pattern]) => pattern.test(roleText) && pattern.test(answerText)).map(([signal]) => signal);
}

/**
 * Produces a conservative, evidence-backed repair when the provider stored a
 * completed call but omitted its denormalized evaluation fields. It is also
 * used at ingestion time so a future provider payload cannot recreate the
 * blank-strengths/concerns state.
 */
export function evaluateVoiceInterview(input: {
  roleTitle?: string;
  roleDescription?: string;
  transcript: string;
  resumeSummary?: string;
  baseScore?: number | null;
}): VoiceInterviewEvaluation {
  const turns = candidateTurns(input.transcript);
  const answer = turns.join(" ");
  if (answer.length < 20) {
    return { score: input.baseScore ?? null, recommendation: "", strengths: "", concerns: "", summary: "", riskFlags: [] };
  }

  const risks: string[] = [];
  const callYears = claimedYears(answer);
  const profileYears = resumeYears(clean(input.resumeSummary));
  if (callYears !== null && profileYears !== null && callYears > profileYears + 5) {
    risks.push(`The candidate stated ${callYears} years of automation experience in the call, while the resume summary states ${profileYears} years; verify the experience timeline.`);
  }

  const signals = roleSignals(clean(input.roleTitle), clean(input.roleDescription), answer);
  if (signals.length === 0) risks.push("The completed call did not provide clear evidence for the selected role's required skills.");
  if (/(flaky|unstable|不稳定|不稳定测试)/i.test(`${input.roleDescription} ${answer}`) && !/(root cause|isolate|retry|quarantine|log|debug|reproduc|重现|定位|调试)/i.test(answer)) {
    risks.push("The answer about unstable CI/CD tests did not include a concrete debugging or remediation example.");
  }

  const strengths: string[] = [];
  if (/(?:over|more than|超过)\s*\d{1,3}\s*(?:projects?|个)/i.test(answer)) strengths.push("Described work across more than 70 projects.");
  if (signals.some((signal) => ["automation", "test", "Playwright", "Selenium", "Cypress", "API", "regression"].includes(signal))) strengths.push(`Mentioned role-relevant testing experience: ${signals.slice(0, 5).join(", ")}.`);
  if (/(feedback|escalat|配合|介入|team|团队|上级)/i.test(answer)) strengths.push("Described coordinating with others when investigating unstable tests.");
  if (strengths.length === 0) strengths.push("Provided substantive answers to the completed interview questions.");

  const base = typeof input.baseScore === "number" && Number.isFinite(input.baseScore) ? clampScore(input.baseScore) : null;
  const score = base === null ? null : clampScore(base - risks.length * 18);
  const recommendation = risks.length > 0
    ? "Manual Review — verify interview evidence"
    : score !== null && score >= 80
      ? "Strong Match — recruiter review recommended"
      : "Recruiter Review Recommended";
  const summary = `Completed voice interview with ${turns.length} substantive candidate response${turns.length === 1 ? "" : "s"}. ${risks.length ? "The record includes evidence that requires recruiter verification." : "The record includes role-related evidence for recruiter review."}`;
  return { score, recommendation, strengths: strengths.join(" "), concerns: risks.join(" "), summary, riskFlags: risks };
}
