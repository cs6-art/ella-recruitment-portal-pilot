/**
 * What Smile (the robot) says when someone uses a control, and where it stands
 * and speaks. Kept free of imports and of DOM access so the rules can be unit
 * tested directly: the browser side (useSmileGuide) turns an element into a
 * `TipContext`, and this module decides whether there is something useful to say.
 *
 * Every line must be true of the portal as it works today (see the user
 * manual). Prefer short, plain sentences; a control with nothing worth saying
 * gets no tip at all.
 */

export type TipEvent = "click" | "focus" | "change";

export type TipContext = {
  event: TipEvent;
  /** Current route, e.g. "/applicants/APP-123". */
  path: string;
  tag: string;
  /** Input type, or "" for other elements. */
  type: string;
  /** Lower-case label / button text / aria-label / placeholder, whitespace collapsed. */
  text: string;
  id: string;
  name: string;
  /** Selected option text for a select; the value for other inputs. */
  value: string;
  checked: boolean;
  /** A number input sitting in the same label (e.g. the automation minimum score). */
  number: string;
  /** Id of the nearest section/card that has one, e.g. "interview-automation". */
  section: string;
};

export type Tip = { key: string; text: string };

type Rule = {
  key: string;
  when: (c: TipContext) => boolean;
  say: (c: TipContext) => string;
};

const isCheck = (c: TipContext) => c.type === "checkbox" || c.type === "radio";
const onPath = (c: TipContext, pattern: RegExp) => pattern.test(c.path);
const hasText = (c: TipContext, pattern: RegExp) => pattern.test(c.text);
const buttonLike = (c: TipContext) => c.tag === "button" || c.tag === "a" || c.tag === "summary";

/** "communication quality" → "Communication quality" */
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const ROLE_FORM = /^\/roles\/(new|[^/]+\/edit)\/?$/;
const ROLE_PAGE = /^\/roles\/[^/]+\/?$/;
const APPLICANT_LIST = /^\/(applicants\/?|roles\/[^/]+\/applicants\/?)$/;
const APPLICANT_PAGE = /^\/applicants\/[^/]+/;

const STAGE_HINTS: Array<[RegExp, string]> = [
  [/^resume review/, "Resume Review: I've scored the resume and it's waiting for your decision."],
  [/^resume approved/, "Resume Approved: you approved them and the interview invitation is going out."],
  [/^interview choice pending/, "Interview Choice Pending: invited, but they haven't chosen a call or a Live Avatar interview yet."],
  [/^voice interview booking pending/, "Voice Interview Booking Pending: they have a link to pick a time for the call."],
  [/^voice interview scheduled/, "Voice Interview Scheduled: a call time is booked."],
  [/^voice interview review/, "Voice Interview Review: the call is done and waiting for your review."],
  [/^live avatar interview pending/, "Live Avatar Interview Pending: waiting for them to start the video interview."],
  [/^live avatar review/, "Live Avatar Review: the video interview is done and waiting for your review."],
  [/^approved for face-to-face/, "Approved for Face-to-Face Interview: they can book a time with your team."],
  [/^face-to-face interview scheduled/, "Face-to-Face Interview Scheduled: a time with your team is booked."],
  [/^passed face-to-face/, "Passed Face-to-Face Interview: they've passed the final step."],
  [/^rejected/, "Rejected: these applicants won't move forward."],
];

const FILTER_HINTS: Array<[RegExp, string]> = [
  [/highest match/, "Highest match first. The score helps you decide who to read first. It isn't a decision."],
  [/newest first/, "Newest applicants first."],
  [/oldest first/, "Oldest applicants first."],
  [/^awaiting screening/, "Showing resumes I haven't finished screening."],
  [/^screened/, "Showing resumes I've screened."],
  [/live avatar interview/, "Showing applicants on the Live Avatar interview."],
  [/^voice interview/, "Showing applicants on the voice (phone) interview."],
  [/^not selected/, "Showing applicants who haven't been given an interview yet."],
  [/^awaiting review/, "Interviews that are finished and waiting for your review."],
  [/^review complete/, "Interviews you've already reviewed."],
  [/^in progress/, "Interviews happening right now."],
  [/^not started/, "Interviews that haven't started."],
  [/^scheduled/, "Interviews with a booked time."],
  [/^all /, "Filter cleared. Showing everything again."],
];

const RULES: Rule[] = [
  // ---- Interview automation card -------------------------------------------------
  {
    key: "automation-switch",
    when: (c) => c.type === "checkbox" && /interview-automation/.test(c.section),
    say: (c) => c.checked
      ? `Got it. Once you press Save, applicants I screen from now on who score ${c.number || "that"}% or more are invited to interview automatically, and they're emailed. Anyone already waiting stays with you.`
      : "Automation is off. Every applicant waits for your review. Press Save to apply the change.",
  },
  {
    key: "automation-score",
    when: (c) => c.type === "number" && /interview-automation/.test(c.section),
    say: () => "This is the lowest screening score that gets invited automatically, from 1 to 100. Anyone below it still waits for your review.",
  },
  { key: "automation-review", when: (c) => /interview-automation/.test(c.section) && hasText(c, /review them/), say: () => "Opening the applicants waiting in Resume Review, best match first." },
  { key: "automation-save", when: (c) => /interview-automation/.test(c.section) && buttonLike(c) && hasText(c, /^save/), say: () => "Saving your automation setting. Invitations follow this role's interview type." },

  // ---- Interview type -----------------------------------------------------------
  {
    key: "interview-type",
    when: (c) => c.type === "radio" && /interview-?type/i.test(`${c.name} ${c.section}`),
    say: (c) => {
      if (/voice interview only/.test(c.text)) return "Voice only: applicants get an AI phone interview. They book a time and I call them. It costs 10 credits when completed.";
      if (/avatar interview only/.test(c.text)) return "Avatar only: applicants get a Live Avatar video interview from their email link. Set up recording storage in Settings first. It costs 2 credits per minute.";
      return "Both: you choose the phone or the avatar interview for each applicant. If you just Approve, the candidate chooses. They never have to do both.";
    },
  },
  { key: "interview-type-save", when: (c) => /interview-type/.test(c.section) && buttonLike(c) && hasText(c, /^save/), say: () => "Saved choices apply to interviews sent from now on. Invitations already sent aren't changed." },

  // ---- Role form ----------------------------------------------------------------
  { key: "role-jd-file", when: (c) => c.type === "file" && onPath(c, ROLE_FORM), say: () => "A PDF, DOC or DOCX works. Then press Generate draft and I'll prepare the screening criteria and interview questions." },
  { key: "role-jd", when: (c) => c.id === "jobDescription" && c.event === "focus", say: () => "Start with the job description. I'll draft the screening criteria and interview questions from it. Please read my draft before you create the role." },
  { key: "role-generate", when: (c) => buttonLike(c) && hasText(c, /generate (draft|ai questions)/), say: () => "Reading the job description now. I'll fill in the screening criteria and questions. Please check them before you continue." },
  {
    key: "role-request-type",
    when: (c) => c.id === "requestType" && c.event === "change",
    say: (c) => /replacement/i.test(c.value) ? "Staff Replacement: tell me which employee or position is being replaced." : "Staff Addition: a brand-new position.",
  },
  { key: "role-target-date", when: (c) => c.id === "targetHiringDate" && c.event === "focus", say: () => "Choose today or later. Once this date passes, the role stops taking new applicants and interviews." },
  { key: "role-vacancies", when: (c) => c.id === "numberOfVacancies" && c.event === "focus", say: () => "How many people you plan to hire for this role." },
  { key: "role-reason", when: (c) => c.id === "reasonForRequest" && c.event === "focus", say: () => "Say why the role is needed, so HR understands the request." },
  { key: "role-criteria", when: (c) => c.id === "setup_screeningCriteria" && c.event === "focus", say: () => "Describe a strong candidate: must-have experience, skills and qualifications. I score every resume against this." },
  {
    key: "role-salary",
    when: (c) => c.id === "setup_salaryDisclosureStatus" && c.event === "change",
    say: (c) => /^disclosed/i.test(c.value) ? "Disclosed: candidates will see the salary range, so enter it below." : "Not disclosed: candidates won't see it. I can still use the range when I assess them.",
  },
  {
    key: "role-license",
    when: (c) => c.id === "setup_licenseRequirementStatus" && c.event === "change",
    say: (c) => /^required/i.test(c.value) ? "Required: tell me which license or certificate, and I'll look for it on every resume." : /^preferred/i.test(c.value) ? "Preferred: I'll note it, but it won't be a must-have." : "Not required: I won't look for a license or certificate.",
  },
  {
    key: "role-f2f",
    when: (c) => c.id === "setup_hodInterviewRequired" && c.event === "change",
    say: (c) => /^required/i.test(c.value) ? "Required: enter the venue below, and connect Google Calendar in Settings so candidates can book a time." : "Not required: you don't need to enter a venue.",
  },
  { key: "role-question", when: (c) => /^setup_question\d/.test(c.id) && c.event === "focus", say: () => "I ask this exactly as written to every candidate. Keep it clear and fair." },
  { key: "role-prompt", when: (c) => c.id === "setup_aiSystemPrompt" && c.event === "focus", say: () => "Advanced. This is the script I follow on phone calls. Only edit it if the fields above can't say what you need." },
  { key: "role-custom-field", when: (c) => buttonLike(c) && hasText(c, /add (a )?custom field/), say: () => "Add a criterion specific to this role (up to 3) and tell me what evidence to look for." },
  {
    key: "role-scoring-area",
    when: (c) => c.type === "checkbox" && onPath(c, /^\/roles\//) && c.text.length > 0 && !/interview-automation/.test(c.section) && c.event === "click" && !/select all/.test(c.text),
    say: (c) => c.checked ? `Added "${sentence(c.text)}" to what I score and note for this role.` : `Removed "${sentence(c.text)}" from what I score for this role.`,
  },
  { key: "role-create", when: (c) => buttonLike(c) && hasText(c, /^create role$/), say: () => "Creating the role approves it and makes its application link available to candidates." },
  { key: "role-draft", when: (c) => buttonLike(c) && hasText(c, /^save as draft/), say: () => "A draft stays private. I also save it automatically while you type." },
  { key: "role-submit", when: (c) => buttonLike(c) && hasText(c, /^submit (for hr approval|& approve)/), say: () => "Sending this request on. HR approves or rejects it, and rejecting always comes with a reason." },
  { key: "role-save", when: (c) => buttonLike(c) && hasText(c, /^save role request/), say: () => "Saving your changes to this role." },
  { key: "role-new", when: (c) => buttonLike(c) && hasText(c, /create role request/), say: () => "Paste a job description and I'll draft the screening criteria and questions for you." },
  { key: "role-edit", when: (c) => buttonLike(c) && onPath(c, ROLE_PAGE) && hasText(c, /^edit request/), say: () => "You can change the role details here. Screening and interview settings are also on the role page." },
  { key: "role-delete", when: (c) => buttonLike(c) && onPath(c, ROLE_PAGE) && hasText(c, /^delete request/), say: () => "Deleting a role can't be undone. I'll ask you to confirm first." },

  // ---- Resume Screening ---------------------------------------------------------
  { key: "screening-file", when: (c) => c.type === "file" && onPath(c, /^\/resume-screening/), say: () => "PDF, DOC or DOCX, up to 10 MB each. Each successfully screened resume costs 1 credit. Duplicates and failed files are free." },
  { key: "screening-role", when: (c) => c.tag === "select" && c.event === "change" && onPath(c, /^\/resume-screening/), say: () => "Every resume in this batch is screened against this role." },
  { key: "screening-start", when: (c) => buttonLike(c) && onPath(c, /^\/resume-screening/) && hasText(c, /^start screening/), say: () => "Queuing your files. Watch the list: Queued, Processing, then Completed. I only charge for resumes I screen successfully." },
  { key: "screening-cv", when: (c) => buttonLike(c) && hasText(c, /start cv analysis/), say: () => "Screening this one resume. It costs 1 credit once the result is saved." },
  { key: "screening-google", when: (c) => buttonLike(c) && onPath(c, /^\/resume-screening/) && hasText(c, /(connect|choose from) google drive/), say: (c) => /^connect/.test(c.text) ? "Connecting Google Drive gives me read-only access so you can pick resumes from it." : "Pick the resumes to import. They go through the same screening queue as an upload." },
  { key: "screening-onedrive", when: (c) => buttonLike(c) && onPath(c, /^\/resume-screening/) && hasText(c, /(connect|choose from) onedrive/), say: (c) => /^connect/.test(c.text) ? "Connecting OneDrive gives me read-only access so you can pick resumes from it." : "Pick the resumes to import. They go through the same screening queue as an upload." },
  { key: "screening-stop", when: (c) => buttonLike(c) && hasText(c, /stop after current batch/), say: () => "I'll finish the batch in progress and stop. Files I haven't started stay selected." },
  { key: "screening-retry", when: (c) => buttonLike(c) && hasText(c, /retry failed/), say: () => "Trying the failed files again. Failed files are never charged." },
  { key: "screening-refresh", when: (c) => buttonLike(c) && onPath(c, /^\/resume-screening/) && hasText(c, /refresh status/), say: () => "Checking where each file is in the queue." },
  { key: "screening-view", when: (c) => buttonLike(c) && hasText(c, /view processed applicants/), say: () => "Opening the screened applicants so you can review them." },
  { key: "screening-link", when: (c) => buttonLike(c) && hasText(c, /copy link/), say: () => "Link copied. Send it to the candidate so they can apply for this role." },

  // ---- Applicants list ----------------------------------------------------------
  { key: "applicants-search", when: (c) => c.event === "focus" && onPath(c, APPLICANT_LIST) && hasText(c, /candidate, email, role or application reference/), say: () => "Search by name, email, role or application reference." },
  {
    key: "applicants-filter",
    when: (c) => c.tag === "select" && c.event === "change" && onPath(c, APPLICANT_LIST),
    say: (c) => {
      const value = c.value.toLowerCase();
      const stage = STAGE_HINTS.find(([pattern]) => pattern.test(value));
      if (stage && !/^all /.test(value)) return stage[1];
      return (FILTER_HINTS.find(([pattern]) => pattern.test(value)) || [null, "Filtering the list."])[1];
    },
  },
  {
    key: "applicants-select-all",
    when: (c) => c.type === "checkbox" && onPath(c, APPLICANT_LIST) && /select all/.test(c.text),
    say: (c) => c.checked ? "Selecting everyone on this page. Use the buttons above to approve them or send an interview." : "Selection cleared.",
  },
  {
    key: "applicants-row",
    when: (c) => c.type === "checkbox" && onPath(c, APPLICANT_LIST),
    say: (c) => c.checked ? "Selected. Tick more if you like, then use the buttons above to approve them or send them an interview." : "Unticked.",
  },
  { key: "applicants-approve-bulk", when: (c) => buttonLike(c) && onPath(c, APPLICANT_LIST) && hasText(c, /approve for interview/), say: () => "Approving the ticked applicants who are in Resume Review. Each one gets the interview set for their role: voice, avatar or both." },
  { key: "applicants-phone-bulk", when: (c) => buttonLike(c) && onPath(c, APPLICANT_LIST) && hasText(c, /send phone interview/), say: () => "Sending a phone interview. Unscreened resumes skip screening, and anyone already invited, or whose role doesn't use this type, is skipped." },
  { key: "applicants-avatar-bulk", when: (c) => buttonLike(c) && onPath(c, APPLICANT_LIST) && hasText(c, /send avatar interview/), say: () => "Sending a Live Avatar interview. Unscreened resumes skip screening, and anyone already invited, or whose role doesn't use this type, is skipped." },
  { key: "applicants-delete", when: (c) => buttonLike(c) && (onPath(c, APPLICANT_LIST) || onPath(c, APPLICANT_PAGE)) && hasText(c, /^delete( selected| applicant)?$/), say: () => "Deleting removes the applicant and everything about them for good. I'll ask you to confirm first." },
  { key: "applicants-clear", when: (c) => buttonLike(c) && onPath(c, APPLICANT_LIST) && hasText(c, /^clear/), say: () => "Cleared." },
  { key: "applicants-refresh", when: (c) => buttonLike(c) && onPath(c, APPLICANT_LIST) && hasText(c, /refresh applicants/), say: () => "Reloading the list." },
  { key: "export", when: (c) => buttonLike(c) && hasText(c, /export to excel/), say: () => "Downloading what you see right now, with your current filters." },

  // ---- One applicant ------------------------------------------------------------
  { key: "applicant-note", when: (c) => c.event === "focus" && onPath(c, APPLICANT_PAGE) && /-decision-comments$/.test(c.id), say: () => "A note is optional when approving and needed when rejecting. It's saved in the applicant's history." },
  { key: "applicant-approve", when: (c) => buttonLike(c) && onPath(c, APPLICANT_PAGE) && hasText(c, /^approve$/), say: () => "Approving moves this candidate on. At the resume stage they're invited to the interview set for the role. A note is optional." },
  { key: "applicant-reject", when: (c) => buttonLike(c) && onPath(c, APPLICANT_PAGE) && hasText(c, /^reject$/), say: () => "Rejecting stops this applicant here, and needs a short reason in the Note box." },
  { key: "applicant-phone", when: (c) => buttonLike(c) && onPath(c, APPLICANT_PAGE) && hasText(c, /^send phone interview/), say: () => "Sending a phone interview to this applicant. If the resume isn't screened yet, screening is skipped." },
  { key: "applicant-avatar", when: (c) => buttonLike(c) && onPath(c, APPLICANT_PAGE) && hasText(c, /^send avatar interview/), say: () => "Sending a Live Avatar interview. Make sure recording storage is set up in Settings, or it can't start." },
  { key: "applicant-switch", when: (c) => buttonLike(c) && hasText(c, /switch to (phone|avatar) interview/), say: () => "Switching replaces the unused invitation. The old link stops working and the candidate gets the new one by email." },
  { key: "applicant-reschedule", when: (c) => buttonLike(c) && hasText(c, /send reschedule link/), say: () => "Sending a fresh booking link. No call happens until the candidate books a new time." },
  { key: "applicant-retry", when: (c) => buttonLike(c) && hasText(c, /retry analysis/), say: () => "Running the interview review again. The transcript and recording are kept." },
  { key: "applicant-edit", when: (c) => buttonLike(c) && hasText(c, /^edit applicant/), say: () => "You can change the applicant's name, email or mobile number." },

  // ---- Credits ------------------------------------------------------------------
  { key: "promo-input", when: (c) => c.id === "smile-promo-code" && c.event === "focus", say: () => "Type your promo code. Each organisation can use a promotion once." },
  { key: "promo-redeem", when: (c) => buttonLike(c) && onPath(c, /^\/credits/) && hasText(c, /^redeem/), say: () => "Checking your code…" },
  { key: "credits-check", when: (c) => buttonLike(c) && hasText(c, /check payment again/), say: () => "Asking the payment provider whether your payment went through." },
  { key: "credits-search", when: (c) => c.event === "focus" && hasText(c, /search credit activity/), say: () => "Search the credit history by event, note, reference or person." },
  { key: "credits-filter", when: (c) => c.tag === "select" && c.event === "change" && onPath(c, /^\/credits/) && /filter credit activity/.test(c.text), say: () => "Filtering the credit history." },
  { key: "credits-buy", when: (c) => buttonLike(c) && onPath(c, /^\/credits/) && hasText(c, /(buy|pay|checkout|starter|standard|bulk)/), say: () => "Credits are added as soon as your payment is confirmed, and each purchase shows in the credit history." },

  // ---- Settings and profile -----------------------------------------------------
  { key: "settings-branding", when: (c) => buttonLike(c) && hasText(c, /save branding/), say: () => "Saving the name and subtitle your team and candidates see." },
  { key: "settings-calendar", when: (c) => buttonLike(c) && onPath(c, /^\/settings/) && hasText(c, /(re)?connect google calendar/), say: () => "This is the shared HR calendar. I use its free times for face-to-face interview bookings." },
  { key: "settings-drive", when: (c) => buttonLike(c) && onPath(c, /^\/settings/) && hasText(c, /(connect google drive|change folder|change google account)/), say: () => "Live Avatar recordings are saved to this Google Drive folder. Those interviews can't start without one." },
  { key: "settings-email-save", when: (c) => buttonLike(c) && hasText(c, /^save email/), say: () => "Saving this email's wording. Changes apply to emails sent from then on, usually within about five minutes." },
  { key: "settings-email-restore", when: (c) => buttonLike(c) && hasText(c, /^restore original/), say: () => "Putting the standard wording back for this email." },
  { key: "settings-email-discard", when: (c) => buttonLike(c) && hasText(c, /^discard changes/), say: () => "Dropping the edits you haven't saved." },
  { key: "profile-calendar", when: (c) => buttonLike(c) && hasText(c, /connect my google calendar/), say: () => "Connect your own calendar so you can be chosen as a role's interviewer. Only your free times are offered to candidates." },
  { key: "profile-calendar-off", when: (c) => buttonLike(c) && onPath(c, /^\/profile/) && hasText(c, /^disconnect/), say: () => "Disconnecting stops me offering your calendar's free times to candidates." },

  // ---- Interview Calendar, User Accounts, Dashboard -----------------------------
  { key: "calendar-exception", when: (c) => buttonLike(c) && hasText(c, /exception slot/), say: () => "Add an extra face-to-face time when the calendar has none that suits." },
  { key: "calendar-noshow", when: (c) => buttonLike(c) && hasText(c, /^mark no show/), say: () => "Records that the candidate didn't attend. It's available after the interview's start time." },
  { key: "calendar-today", when: (c) => buttonLike(c) && onPath(c, /^\/bookings/) && hasText(c, /^today$/), say: () => "Back to the current month." },
  { key: "accounts-invite", when: (c) => buttonLike(c) && hasText(c, /invite a teammate/), say: () => "Enter your colleague's email. They join your organisation when they register with it. Invitations count toward your people limit." },
  { key: "accounts-add", when: (c) => buttonLike(c) && hasText(c, /^add user account/), say: () => "Add someone directly and set what they can access." },
  { key: "accounts-org", when: (c) => buttonLike(c) && hasText(c, /^add organization/), say: () => "Create a client organisation and choose who may register into it." },
  { key: "accounts-withdraw", when: (c) => buttonLike(c) && hasText(c, /^withdraw/), say: () => "Cancels the invitation before it's used." },
  { key: "accounts-reset", when: (c) => buttonLike(c) && hasText(c, /^reset registration/), say: () => "Clears the sign-in credential so this email can register again." },
  { key: "accounts-save", when: (c) => buttonLike(c) && onPath(c, /^\/user-accounts/) && hasText(c, /^save account/), say: () => "Saving this person's access." },
  { key: "dash-credits", when: (c) => buttonLike(c) && hasText(c, /top up credits/), say: () => "Credits low? Buy a pack or redeem a promo code on the Credits page." },
  { key: "dash-calendar", when: (c) => buttonLike(c) && hasText(c, /(re)?connect calendar/), say: () => "Face-to-face interviews need a connected HR Google Calendar. You'll connect it in Settings." },
  { key: "dash-recording", when: (c) => buttonLike(c) && hasText(c, /set up recording storage/), say: () => "Live Avatar interviews need a Google Drive folder for their recordings. You'll choose it in Settings." },
  { key: "dash-screening", when: (c) => buttonLike(c) && hasText(c, /review resume screening/), say: () => "Some resumes couldn't be screened. Check the files and retry. Failed files aren't charged." },
  { key: "dash-roles", when: (c) => buttonLike(c) && hasText(c, /review role requests/), say: () => "Role requests are waiting for HR to approve or reject them." },
  { key: "dash-applicants", when: (c) => buttonLike(c) && onPath(c, /^\/dashboard/) && hasText(c, /review applicants/), say: () => "These applicants are waiting for you, or haven't moved in a few days." },
  { key: "dash-calendar-open", when: (c) => buttonLike(c) && hasText(c, /open interview calendar/), say: () => "Some phone interviews are scheduled in the past with no result recorded." },
  { key: "dash-checklist", when: (c) => buttonLike(c) && hasText(c, /(hide this checklist|open setup checklist)/), say: () => "The Getting Started checklist shows what's left to set up. You can bring it back any time." },
];

/** The tip for this control and event, or null when there is nothing useful to say. */
export function tipFor(context: TipContext): Tip | null {
  for (const rule of RULES) {
    if (!rule.when(context)) continue;
    // A state change (ticked / unticked, a new choice) is a different message.
    const state = isCheck(context) ? (context.checked ? ":on" : ":off") : context.tag === "select" ? `:${context.value}` : "";
    // Several controls share these rules, so tell them apart by their label.
    const which = rule.key === "role-scoring-area" || rule.key === "interview-type" ? `:${context.text.slice(0, 24)}` : "";
    const text = rule.say(context).replace(/\s+/g, " ").trim();
    return text ? { key: `${rule.key}${state}${which}`, text } : null;
  }
  return null;
}

const PAGE_INTROS: Array<[RegExp, string, string]> = [
  [/^\/dashboard/, "dashboard", "Welcome! This is your starting page: what needs your attention, your key numbers and upcoming interviews."],
  [/^\/roles\/new/, "role-new", "Creating a role? Start with the job description and I'll draft the rest."],
  [/^\/roles\/[^/]+\/edit/, "role-edit", "Editing a role. Changes are saved to the role's history."],
  [/^\/roles\/[^/]+\/applicants/, "role-applicants", "These are the applicants for one role."],
  [/^\/roles\/[^/]+/, "role-page", "This is the role page. Interview type and Interview automation are set here too."],
  [/^\/roles/, "roles", "Role Requests: every job you're hiring for. Open one to see its applicants, setup and history."],
  [/^\/applicants\/[^/]+/, "applicant", "This is one applicant. Read the evidence, then approve, send an interview or reject."],
  [/^\/applicants/, "applicants", "Applicants: everyone who applied. Sort by Highest match to see who to read first."],
  [/^\/resume-screening/, "screening", "Resume Screening: add resumes for a role and I'll score them. Each successfully screened resume costs 1 credit."],
  [/^\/bookings/, "bookings", "Interview Calendar: every scheduled interview, by month."],
  [/^\/credits/, "credits", "Credits: your shared balance and its history. Got a promo code? Redeem it here."],
  [/^\/settings/, "settings", "Settings: your branding, calendars, recording storage and the wording of candidate emails."],
  [/^\/user-accounts/, "accounts", "User Accounts: who has access to your organisation."],
  [/^\/profile/, "profile", "Your account details. You can connect your own Google Calendar here."],
];

/** A one-line welcome for a page (shown once per browser session), or null. */
export function pageIntroFor(path: string): Tip | null {
  const found = PAGE_INTROS.find(([pattern]) => pattern.test(path));
  return found ? { key: `page:${found[1]}`, text: found[2] } : null;
}

// ---- Where Smile stands and where its bubble goes ---------------------------------

export type Box = { left: number; top: number; right: number; bottom: number };
export type Placement = { left: number; top: number; side: "right" | "left" | "below" | "above" | "edge" };

/** Room the speech bubble needs above the robot. */
export const BUBBLE_HEADROOM = 100;
export const BUBBLE_WIDTH = 250;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the robot should stand so it is next to `target` without covering it:
 * to its right if there is room, else its left, else below, else above, else
 * against the right edge of the screen.
 */
export function placeBeside(target: Box, viewport: { width: number; height: number }, size: number, gap = 12, margin = 8): Placement {
  const maxLeft = viewport.width - size - margin;
  const maxTop = viewport.height - size - margin;
  const middle = clamp(target.top + (target.bottom - target.top) / 2 - size / 2, BUBBLE_HEADROOM, maxTop);
  if (target.right + gap <= maxLeft) return { left: target.right + gap, top: middle, side: "right" };
  if (target.left - gap - size >= margin) return { left: target.left - gap - size, top: middle, side: "left" };
  const below = target.bottom + gap;
  if (below <= maxTop) return { left: clamp(target.left, margin, maxLeft), top: below, side: "below" };
  const above = target.top - gap - size;
  if (above >= BUBBLE_HEADROOM) return { left: clamp(target.left, margin, maxLeft), top: above, side: "above" };
  return { left: maxLeft, top: middle, side: "edge" };
}

export type BubbleAlign = "start" | "center" | "end";

/**
 * Which way the bubble extends from the robot so it stays on screen and, when
 * the robot is beside a control, grows away from that control.
 */
export function bubbleAlign(robotLeft: number, size: number, viewportWidth: number, side: Placement["side"] | "home", margin = 8): BubbleAlign {
  const fitsStart = robotLeft + BUBBLE_WIDTH <= viewportWidth - margin;
  const fitsEnd = robotLeft + size - BUBBLE_WIDTH >= margin;
  const center = robotLeft + size / 2;
  const fitsCenter = center - BUBBLE_WIDTH / 2 >= margin && center + BUBBLE_WIDTH / 2 <= viewportWidth - margin;
  const preferred: BubbleAlign = side === "right" ? "start" : side === "left" ? "end" : "center";
  const fits: Record<BubbleAlign, boolean> = { start: fitsStart, end: fitsEnd, center: fitsCenter };
  if (fits[preferred]) return preferred;
  return (["center", "end", "start"] as BubbleAlign[]).find((option) => fits[option]) || (center < viewportWidth / 2 ? "start" : "end");
}

/** How long a bubble stays up: long enough to read, never more than 11 seconds. */
export function bubbleDuration(text: string): number {
  return Math.min(11_000, 3_500 + text.length * 45);
}

/** Pointer or keyboard activity is gone for this long: Smile steps out of the way. */
export const IDLE_AWAY_MS = 8_000;
