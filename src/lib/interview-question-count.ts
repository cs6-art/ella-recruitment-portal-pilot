const maxInterviewQuestions = 5;
const questionCountPattern = /\b(\d+)\s*(out of|of|\/)\s*(\d+)\s+questions?\s+answered\b/gi;

/**
 * Canonical numbered interview-question list. Blank slots are dropped and the
 * remaining questions are renumbered `Q1..Qn`, so the exact same string can be
 * put into the resolved Vapi prompt AND shown to HR — the AI voice evaluator
 * then associates each answer to a question by its `Qn` number rather than by
 * transcript turn order, which is what caused answers to be misattributed.
 */
export function buildNumberedInterviewQuestions(questions: (string | undefined | null)[]): string[] {
  return questions
    .map((question) => String(question ?? "").trim())
    .filter(Boolean)
    .map((question, index) => `Q${index + 1}: ${question}`);
}

/** Keep provider-reported question counts within the portal's five-question maximum. */
export function normalizeInterviewQuestionCount(value: string) {
  return value.replace(questionCountPattern, (match, answeredValue: string, separator: string, totalValue: string) => {
    const answered = Number.parseInt(answeredValue, 10);
    const total = Number.parseInt(totalValue, 10);
    if (!Number.isFinite(answered) || !Number.isFinite(total)) return match;

    const cappedTotal = Math.min(Math.max(total, 0), maxInterviewQuestions);
    const cappedAnswered = Math.min(Math.max(answered, 0), cappedTotal);
    const normalizedSeparator = separator.toLowerCase() === "out of" ? "out of" : separator === "/" ? "/" : "of";
    return `${cappedAnswered} ${normalizedSeparator} ${cappedTotal} question${cappedTotal === 1 ? "" : "s"} answered`;
  });
}
