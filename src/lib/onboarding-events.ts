/**
 * Browser events that keep the guided setup in sync without a page refresh.
 *
 * `requestOnboardingRefresh()` is called after any action that may complete a
 * step (role saved or published, resume submitted, review confirmed); the one
 * OnboardingProvider re-reads the organization's progress and every view of it
 * (Dashboard, sidebar, Smile, page banners) updates together.
 *
 * `showGuide()` spotlights a control marked `data-guide-target="<target>"` on
 * the current page and shows a short tip beside it.
 *
 * Dependency-free so any client component can import it.
 */
export const ONBOARDING_REFRESH_EVENT = "smile:onboarding-refresh";
export const GUIDE_EVENT = "smile:guide";

export type GuideTarget =
  | "sample-jd"
  | "jd-upload"
  | "generate-ai"
  | "review-setup"
  | "publish-role"
  | "sample-resume"
  | "resume-upload"
  | "screen-submit"
  | "review-results"
  | "review-confirm";

export const GUIDE_TIPS: Record<GuideTarget, string> = {
  "sample-jd": "Pick a sample job description, preview it, then press Use This Template. Nothing is published yet.",
  "jd-upload": "Upload your own job description (PDF, DOC or DOCX), or paste it into the Job Description box.",
  "generate-ai": "Press Generate AI questions. Smile drafts the role details, screening criteria and interview questions for you to review.",
  "review-setup": "Check the screening criteria and interview questions Smile drafted. Edit anything that isn't right for the role.",
  "publish-role": "When everything looks right, create (publish) the role. Candidates can apply once it is published.",
  "sample-resume": "Choose a sample resume, preview it, then press Use This Sample. It fills in a fictional candidate for you.",
  "resume-upload": "Or upload a real resume (PDF, DOC or DOCX) and enter the candidate's details.",
  "screen-submit": "Choose the role, check the credit cost, then press Screen resume to run the real AI screening.",
  "review-results": "Here is the screening result: the match score, summary, strengths and gaps. Read them before you decide.",
  "review-confirm": "When you've read the result, confirm it here to finish your guided setup.",
};

export function requestOnboardingRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ONBOARDING_REFRESH_EVENT));
}

export type GuideDetail = { target: GuideTarget; text?: string };

export function showGuide(target: GuideTarget, text?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GuideDetail>(GUIDE_EVENT, { detail: { target, text } }));
}

export function isGuideTarget(value: string | null | undefined): value is GuideTarget {
  return Boolean(value && Object.prototype.hasOwnProperty.call(GUIDE_TIPS, value));
}
