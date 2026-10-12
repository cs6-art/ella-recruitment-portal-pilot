/**
 * The guided first-recruitment journey for a new organization.
 *
 * One organization-level model drives the Dashboard checklist, the sidebar
 * progress, Smile's guidance and the page gates, so they cannot disagree.
 * Steps complete only from real records (a saved role, a published role, an
 * application, a stored screening result, an HR review) and, once complete,
 * stay complete (`persisted`), so archiving a role later never re-locks
 * anything.
 *
 * Only organizations created through self-service onboarding
 * (`organizations.onboarding_started_at`) are guided. Established
 * organizations are never locked.
 *
 * Dependency-free so the rules can be unit tested and used on the client.
 */

export const CORE_STEP_KEYS = ["create_role", "publish_role", "add_candidate", "screen_resume", "review_applicant"] as const;
export type OnboardingStepKey = (typeof CORE_STEP_KEYS)[number];

export type OnboardingNavKey = "roles" | "resume-screening" | "applicants";

export type OnboardingStepDefinition = {
  key: OnboardingStepKey;
  number: number;
  title: string;
  /** Short label for the sidebar. */
  short: string;
  detail: string;
  /** Why it is locked, shown while earlier steps are unfinished. */
  lockedReason: string;
  nav: OnboardingNavKey;
  /** One sentence Smile says when this becomes the current step. */
  smileIntro: string;
};

export const CORE_STEPS: readonly OnboardingStepDefinition[] = [
  {
    key: "create_role",
    number: 1,
    title: "Create your first role request",
    short: "Create Role Request",
    detail: "Upload or paste a job description, or start from one of three sample job descriptions.",
    lockedReason: "",
    nav: "roles",
    smileIntro: "Let's create your first job opening. Upload a job description or try a sample.",
  },
  {
    key: "publish_role",
    number: 2,
    title: "Configure & publish the role",
    short: "Publish Role",
    detail: "Review the job details, screening criteria and AI interview questions, choose the interview type, then publish.",
    lockedReason: "Unlocks after you save your first role request.",
    nav: "roles",
    smileIntro: "Review the screening criteria and interview questions, then publish the role.",
  },
  {
    key: "add_candidate",
    number: 3,
    title: "Add your first resume",
    short: "Add a Resume",
    detail: "Upload a candidate's resume, or use a sample resume, and choose the role to screen against.",
    lockedReason: "Unlocks when a role is published. Resumes are screened against a published role.",
    nav: "resume-screening",
    smileIntro: "Ready to test resume screening? Upload your own resume or choose a sample.",
  },
  {
    key: "screen_resume",
    number: 4,
    title: "Screen the resume",
    short: "Screening Result",
    detail: "Smile reads the resume against the role's criteria. The result appears in Applicants, usually within a few minutes.",
    lockedReason: "Unlocks after you submit a resume for screening.",
    nav: "applicants",
    smileIntro: "Smile is screening the resume. The result will appear in Applicants shortly.",
  },
  {
    key: "review_applicant",
    number: 5,
    title: "Review your first applicant",
    short: "Review Applicant",
    detail: "Open the applicant and read the match score, summary, strengths, gaps and evidence.",
    lockedReason: "Unlocks when the first screening result is ready.",
    nav: "applicants",
    smileIntro: "Your screening is ready. Let's review the match score, strengths and gaps.",
  },
];

/** Facts read from the organization's own records. Counts only; never candidate details. */
export type OnboardingFacts = {
  roleCount: number;
  publishedRoleCount: number;
  applicationCount: number;
  screenedCount: number;
  /** Applications with an HR resume decision recorded. */
  decidedCount: number;
  /** Latest saved role that is not yet published (external id), for "Continue". */
  unpublishedRoleId: string;
  unpublishedRoleStatus: string;
  latestApplicationId: string;
  latestScreenedApplicationId: string;
  interviewInvitationsSent: boolean;
  hasInterviewEvidence: boolean;
  calendarConnected: boolean;
};

export type PersistedOnboarding = {
  steps?: Partial<Record<OnboardingStepKey, string>>;
  completedAt?: string;
  completionDismissedAt?: string;
  /** role uuid -> sample JD id, for roles created from a sample JD. */
  sampleRoles?: Record<string, string>;
};

export type OnboardingStepState = "done" | "current" | "waiting" | "locked";

export type OnboardingStepView = {
  key: OnboardingStepKey;
  number: number;
  title: string;
  short: string;
  detail: string;
  state: OnboardingStepState;
  lockedReason: string;
  completedAt: string;
};

export type OnboardingAction = { label: string; href: string };

export type OptionalActivity = {
  key: "ai_interviews" | "interview_evidence" | "face_to_face";
  title: string;
  detail: string;
  requirements: string[];
  status: string;
  available: boolean;
  action: OnboardingAction;
  learnMore: string;
};

export type OnboardingState = {
  /** "guided" for self-service organizations; "standard" never shows or locks anything. */
  mode: "guided" | "standard";
  status: "not_started" | "in_progress" | "completed";
  steps: OnboardingStepView[];
  completedCount: number;
  total: number;
  percent: number;
  currentStep: OnboardingStepKey | null;
  /** The primary call to action for the current step. */
  next: OnboardingAction | null;
  /** True when this user can complete the recruitment steps (HR). */
  canAct: boolean;
  /** Smile is waiting on an asynchronous screening result. */
  screeningPending: boolean;
  optional: OptionalActivity[];
  /** Show the small "You're ready" card (completed recently and not dismissed). */
  showCompletionCard: boolean;
  /** role external id -> recommended sample resume id. */
  sampleRecommendations: Record<string, string>;
  /** Navigation items still locked in the guided sequence. */
  lockedNav: OnboardingNavKey[];
  /** The navigation item the user should go to next. */
  guidedNav: OnboardingNavKey | null;
};

export const ONBOARDING_PERMISSION_MESSAGE = "This step requires an HR user or an authorized organization administrator.";

const COMPLETION_CARD_DAYS = 14;

/** Which steps the organization's current records prove are done. */
export function derivedCompletions(facts: OnboardingFacts): Set<OnboardingStepKey> {
  const done = new Set<OnboardingStepKey>();
  if (facts.roleCount > 0) done.add("create_role");
  if (facts.publishedRoleCount > 0) { done.add("create_role"); done.add("publish_role"); }
  if (facts.applicationCount > 0) done.add("add_candidate");
  if (facts.screenedCount > 0) { done.add("add_candidate"); done.add("screen_resume"); }
  if (facts.decidedCount > 0) done.add("review_applicant");
  return done;
}

function encodeId(id: string) {
  return encodeURIComponent(id);
}

function actionFor(step: OnboardingStepKey, facts: OnboardingFacts): OnboardingAction {
  switch (step) {
    case "create_role":
      return { label: "Create Your First Role Request", href: "/roles/new?guide=sample-jd" };
    case "publish_role":
      if (facts.unpublishedRoleId) {
        const draft = facts.unpublishedRoleStatus === "draft";
        return draft
          ? { label: "Finish & Publish Role", href: `/roles/${encodeId(facts.unpublishedRoleId)}/edit?guide=publish-role` }
          : { label: "Review & Publish Role", href: `/roles/${encodeId(facts.unpublishedRoleId)}?guide=publish-role` };
      }
      return { label: "Open Role Requests", href: "/roles" };
    case "add_candidate":
      return { label: "Add Your First Resume", href: "/resume-screening?guide=sample-resume" };
    case "screen_resume":
      return facts.latestApplicationId
        ? { label: "View Screening Progress", href: `/applicants/${encodeId(facts.latestApplicationId)}` }
        : { label: "Open Applicants", href: "/applicants" };
    case "review_applicant":
      return facts.latestScreenedApplicationId
        ? { label: "Review Applicant", href: `/applicants/${encodeId(facts.latestScreenedApplicationId)}?guide=review-results` }
        : { label: "Open Applicants", href: "/applicants" };
  }
}

function optionalActivities(facts: OnboardingFacts): OptionalActivity[] {
  return [
    {
      key: "ai_interviews",
      title: "Explore AI interview options",
      detail: "Choose Voice Interview (an AI phone call), Live Avatar Interview (a video interview) or both on each role. HR sends the interview from the applicant's page.",
      requirements: ["Interview type chosen on the role", "Smile Credits (charged only when an interview runs)", "Candidate consent, given on the booking page"],
      status: facts.interviewInvitationsSent ? "Interview invitation sent" : "Optional",
      available: true,
      action: { label: "Open Role Requests", href: "/roles" },
      learnMore: "/manual#h-interviews",
    },
    {
      key: "interview_evidence",
      title: "Review interview evidence",
      detail: "When a real candidate finishes an interview, the transcript, scores and recording (Live Avatar) appear on their applicant page.",
      requirements: ["A completed Voice or Live Avatar interview"],
      status: facts.hasInterviewEvidence ? "Evidence available" : "Available after an interview",
      available: facts.hasInterviewEvidence,
      action: { label: "Open Applicants", href: "/applicants" },
      learnMore: "/manual#h-interviews",
    },
    {
      key: "face_to_face",
      title: "Explore face-to-face scheduling",
      detail: "Roles that need a face-to-face interview let shortlisted candidates book a time from your connected Google Calendar.",
      requirements: ["Google Calendar connected in Settings", "Face-to-face interview set to Required on the role"],
      status: facts.calendarConnected ? "Calendar connected" : "Optional",
      available: true,
      action: { label: facts.calendarConnected ? "Open Interview Calendar" : "Connect Google Calendar", href: facts.calendarConnected ? "/bookings" : "/settings#calendar-settings-title" },
      learnMore: "/manual#h-interviews",
    },
  ];
}

export function computeOnboarding(input: {
  guided: boolean;
  facts: OnboardingFacts;
  persisted: PersistedOnboarding;
  canAct: boolean;
  /** role uuid -> external id for this organization's roles listed in persisted.sampleRoles. */
  roleExternalIds?: Record<string, string>;
  now?: Date;
}): OnboardingState {
  const { facts, persisted } = input;
  const now = input.now ?? new Date();
  const derived = derivedCompletions(facts);
  const persistedSteps = persisted.steps ?? {};
  const isDone = (key: OnboardingStepKey) => derived.has(key) || Boolean(persistedSteps[key]);
  const currentIndex = CORE_STEPS.findIndex((step) => !isDone(step.key));
  const allDone = currentIndex === -1;
  const screeningPending = !isDone("screen_resume") && isDone("add_candidate");

  const steps: OnboardingStepView[] = CORE_STEPS.map((step, index) => {
    let state: OnboardingStepState;
    if (isDone(step.key)) state = "done";
    else if (index === currentIndex) state = step.key === "screen_resume" ? "waiting" : "current";
    else state = "locked";
    return {
      key: step.key,
      number: step.number,
      title: step.title,
      short: step.short,
      detail: step.detail,
      state,
      lockedReason: state === "locked" ? step.lockedReason : "",
      completedAt: persistedSteps[step.key] || "",
    };
  });
  const completedCount = steps.filter((step) => step.state === "done").length;
  const currentStep = allDone ? null : CORE_STEPS[currentIndex].key;

  const sampleRecommendations: Record<string, string> = {};
  for (const [roleUuid, sampleJobId] of Object.entries(persisted.sampleRoles ?? {})) {
    const externalId = input.roleExternalIds?.[roleUuid];
    if (externalId) sampleRecommendations[externalId] = sampleJobId;
  }

  const completedAt = persisted.completedAt ? Date.parse(persisted.completedAt) : Number.NaN;
  const recent = !Number.isFinite(completedAt) || now.getTime() - completedAt < COMPLETION_CARD_DAYS * 24 * 60 * 60 * 1000;

  // Locks only ever apply to a guided organization that is still in the journey.
  const guidedInProgress = input.guided && !allDone;
  const lockedNav: OnboardingNavKey[] = [];
  if (guidedInProgress) {
    if (!isDone("publish_role")) lockedNav.push("resume-screening");
    if (!isDone("add_candidate")) lockedNav.push("applicants");
  }

  return {
    mode: input.guided ? "guided" : "standard",
    status: allDone ? "completed" : completedCount === 0 ? "not_started" : "in_progress",
    steps,
    completedCount,
    total: CORE_STEPS.length,
    percent: Math.round((completedCount / CORE_STEPS.length) * 100),
    currentStep,
    next: currentStep ? actionFor(currentStep, facts) : null,
    canAct: input.canAct,
    screeningPending,
    optional: optionalActivities(facts),
    showCompletionCard: input.guided && allDone && !persisted.completionDismissedAt && recent,
    sampleRecommendations,
    lockedNav,
    guidedNav: guidedInProgress && currentStep ? CORE_STEPS[currentIndex].nav : null,
  };
}

/** Steps that are complete now but not yet recorded, so the store can make them permanent. */
export function newlyCompletedSteps(state: OnboardingState, persisted: PersistedOnboarding): OnboardingStepKey[] {
  const recorded = persisted.steps ?? {};
  return state.steps.filter((step) => step.state === "done" && !recorded[step.key]).map((step) => step.key);
}

export function stepDefinition(key: OnboardingStepKey | null | undefined): OnboardingStepDefinition | null {
  return CORE_STEPS.find((step) => step.key === key) ?? null;
}
