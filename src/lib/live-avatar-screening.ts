export type LiveAvatarPreparation = { resumeSummary: string; screeningQuestion: string };
export type LiveAvatarTranscriptTurn = { role?: string; transcript?: string };
export type LiveAvatarEvaluation = { score: number; answered: boolean; answer: string; summary: string; strengths: string[]; focusAreas: string[]; recommendation: string };

const STOP_WORDS = new Set(["about", "after", "also", "and", "are", "been", "being", "but", "can", "could", "from", "have", "into", "more", "most", "only", "role", "should", "that", "their", "them", "then", "there", "these", "they", "this", "through", "using", "what", "when", "where", "which", "with", "would", "your"]);
function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function tokens(value: string) { return clean(value).toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g)?.filter((token) => !STOP_WORDS.has(token)) || []; }
function clamp(value: string, max = 1000) { return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; }
function roleKeywords(roleTitle: string, roleDescription: string) {
  const counts = new Map<string, number>();
  for (const token of tokens(`${roleTitle} ${roleDescription}`)) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([token]) => token).slice(0, 18);
}
function evidenceLines(resumeText: string, keywords: string[]) {
  const lines = resumeText.split(/\r?\n/).map((line) => clean(line)).filter((line) => line.length >= 24 && line.length <= 180).filter((line) => !/^https?:\/\//i.test(line) && !/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(line));
  const keywordSet = new Set(keywords);
  return lines.map((line) => ({ line, relevance: tokens(line).filter((token) => keywordSet.has(token)).length })).filter(({ relevance }) => relevance > 0).sort((left, right) => right.relevance - left.relevance || left.line.length - right.line.length).map(({ line }) => line).slice(0, 3);
}
export function prepareLiveAvatarScreening(input: { roleTitle: string; roleDescription: string; screeningCriteria?: string; approvedQuestions?: string[]; resumeText: string }): LiveAvatarPreparation {
  const title = clean(input.roleTitle) || "this role";
  const keywords = roleKeywords(title, `${input.roleDescription} ${input.screeningCriteria || ""}`);
  const resumeTokens = new Set(tokens(input.resumeText));
  const matched = keywords.filter((keyword) => resumeTokens.has(keyword));
  const evidence = evidenceLines(input.resumeText, keywords);
  const evidenceText = evidence[0] || "the experience described in your resume";
  const approved = (input.approvedQuestions || []).map(clean).find(Boolean);
  const screeningQuestion = approved || `You mention ${evidenceText}. How did that experience prepare you for the ${title} role, and what outcome did you achieve?`;
  const matchedText = matched.slice(0, 8).join(", ") || "the experience and skills in your resume";
  return { resumeSummary: clamp(`Resume focus for ${title}: relevant signals include ${matchedText}. ${evidence.length ? evidence.join(" ") : "Ella will ask you to expand on the most relevant experience in your resume."}`), screeningQuestion: clamp(screeningQuestion, 500) };
}
function meaningfulUserTurns(transcript: LiveAvatarTranscriptTurn[]) { return transcript.filter((turn) => String(turn.role || "").toLowerCase() === "user").map((turn) => clean(turn.transcript)).filter((text) => text.length >= 8 && !/^(yes|no|okay|ok|sure|thanks|thank you)[.!]?$/i.test(text)); }
export function evaluateLiveAvatarTranscript(input: { roleTitle: string; roleDescription: string; question: string; transcript: LiveAvatarTranscriptTurn[] }): LiveAvatarEvaluation {
  const answer = meaningfulUserTurns(input.transcript).join(" ").slice(0, 5000);
  if (answer.length < 8) return { score: 0, answered: false, answer: "", summary: "Ella did not capture a complete response. A recruiter may follow up if another interview is needed.", strengths: [], focusAreas: ["Complete the interview question with a specific example and outcome."], recommendation: "Response incomplete — recruiter review recommended." };
  const answerTokens = new Set(tokens(answer));
  const keywords = roleKeywords(input.roleTitle, input.roleDescription);
  const relevant = keywords.filter((keyword) => answerTokens.has(keyword));
  const questionKeywords = tokens(input.question).filter((token) => answerTokens.has(token));
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const score = Math.max(20, Math.min(100, Math.min(35, Math.round((wordCount / 80) * 35)) + Math.min(45, Math.round((relevant.length / Math.max(3, Math.min(10, keywords.length))) * 45)) + Math.min(20, questionKeywords.length >= 2 ? 20 : questionKeywords.length === 1 ? 12 : 5)));
  const strengths = [wordCount >= 35 ? "Shared a detailed example rather than a one-line answer." : "Provided a direct response to Ella's question.", relevant.length > 0 ? `Mentioned role-relevant experience: ${relevant.slice(0, 4).join(", ")}.` : "Explained personal experience in their own words."];
  const missing = keywords.filter((keyword) => !answerTokens.has(keyword)).slice(0, 3);
  const focusAreas = [...(wordCount < 35 ? ["Add more detail about the actions you took and the outcome."] : []), ...(missing.length ? [`Explore evidence of ${missing.join(", ")}.`] : [])];
  return { score, answered: true, answer, summary: `Ella captured a ${wordCount >= 35 ? "detailed" : "concise"} response with ${relevant.length} clear role-relevant signal${relevant.length === 1 ? "" : "s"}.`, strengths, focusAreas: focusAreas.length ? focusAreas : ["Use the next interview to validate depth and consistency."], recommendation: score >= 70 ? "Strong response — recruiter review recommended." : score >= 45 ? "Promising response — recruiter review recommended." : "More detail would help — recruiter review recommended." };
}
