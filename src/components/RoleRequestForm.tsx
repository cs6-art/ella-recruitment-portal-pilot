"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import UiIcon from "@/components/UiIcon";
import ValidationSummary from "@/components/ValidationSummary";
import { DEPARTMENT_OPTIONS, isKnownDepartment } from "@/lib/department-options";
import { todayDateInputValue, toDateInputValue } from "@/lib/date-only";
import { roleRequestSchema } from "@/lib/role-schema";
import { renderRecruitmentSystemPrompt, STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE } from "@/lib/recruitment-prompt";
import { EVALUATION_FIELD_CATALOG } from "@/lib/recruitment-setup-schema";
import { getSetupReadiness } from "@/lib/recruitment-setup-readiness";
import { buildNumberedInterviewQuestions } from "@/lib/interview-question-count";
import type { RoleAiDraft } from "@/lib/role-ai-draft-schema";

type RoleRequestFormProps = {
  user: {
    name: string;
    email: string;
  };
  roleId?: string;
  status?: string;
  initialValues?: Partial<FormState>;
  /** Approvers (every HR account) get their new request approved on submission. */
  canApproveRole?: boolean;
  /** One top-to-bottom form that also fills in the recruitment setup and can publish. */
  unified?: boolean;
};

const POSTING_CHANNELS = ["LinkedIn", "Facebook", "JobStreet"];
const QUESTION_NUMBERS = [1, 2, 3, 4, 5] as const;

// Setup problems are keyed like form fields so they reuse the same error
// summary; each key is also the id of the input it points at.
const SETUP_FIELD_FOR_KEY: Record<string, string> = {
  Screening_Criteria: "setup_screeningCriteria",
  Required_Interview_Question_1: "setup_question1",
  Required_Interview_Question_2: "setup_question2",
  Required_Interview_Question_3: "setup_question3",
  Posting_Channels: "setup_channels",
  License_or_Certificate_Required: "setup_license",
  Final_Interview_Venue: "setup_venue",
};

type RoleSubmissionResult = {
  success?: boolean;
  roleId?: string;
  status?: string;
  notificationStatus?: string;
  notificationError?: string;
  error?: string;
};

type FormState = {
  requestType: string;
  department: string;
  jobTitle: string;
  employmentType: string;
  numberOfVacancies: number;
  reasonForRequest: string;
  jobDescription: string;
  replacementEmployee: string;
  targetHiringDate: string;
  hodEmail: string;
  customScreeningQuestion1: string;
  customScreeningQuestion2: string;
  aiGeneratedScreeningQuestions: string[];
  recruitmentSetupDraft: RoleAiDraft["recruitmentSetup"];
};

export type RoleRequestFormValues = FormState;

// All HR interviews are owned by the shared HR calendar account.
const HR_INTERVIEW_EMAIL = "hrsg@mclinkgroup.com";

const initial: FormState = {
  requestType: "Staff Addition",
  department: "",
  jobTitle: "",
  employmentType: "Full-Time",
  numberOfVacancies: 1,
  reasonForRequest: "",
  jobDescription: "",
  replacementEmployee: "",
  targetHiringDate: "",
  hodEmail: HR_INTERVIEW_EMAIL,
  customScreeningQuestion1: "",
  customScreeningQuestion2: "",
  aiGeneratedScreeningQuestions: [],
  recruitmentSetupDraft: {
    jobDescription: "",
    screeningCriteria: "",
    requiredInterviewQuestion1: "",
    requiredInterviewQuestion2: "",
    requiredInterviewQuestion3: "",
    requiredInterviewQuestion4: "",
    requiredInterviewQuestion5: "",
    keywordsToLookFor: "",
    minimumYearsOfExperience: "",
    transferableSkillsAccepted: "",
    licenseOrCertificateRequired: "",
    salaryOrBudgetRange: "",
    earliestAvailabilityRule: "",
    evaluationFieldToggles: [],
    customEvaluationFields: [],
    postingChannels: [],
    salaryDisclosureStatus: "",
    licenseRequirementStatus: "",
    hodInterviewRequired: "",
    finalInterviewVenue: "",
  },
};

const fieldLabels: Record<string, string> = {
  requestType: "Request Type",
  department: "Department",
  jobTitle: "Job Title",
  numberOfVacancies: "Number of Vacancies",
  reasonForRequest: "Reason for Request",
  jobDescription: "Job Description",
  replacementEmployee: "Employee or Position Being Replaced",
  targetHiringDate: "Target Hiring Date",
  hodEmail: "HR interviewer email",
  customScreeningQuestion1: "Custom Screening Question 1",
  customScreeningQuestion2: "Custom Screening Question 2",
  setup_screeningCriteria: "Screening criteria",
  setup_question1: "Interview question 1",
  setup_question2: "Interview question 2",
  setup_question3: "Interview question 3",
  setup_channels: "Posting channels",
  setup_license: "License or certificate",
  setup_venue: "Face-to-face interview venue",
};

export default function RoleRequestForm({ user, roleId, status = "", initialValues, canApproveRole = false, unified = false }: RoleRequestFormProps) {
  const router = useRouter();
  const initialForm = useMemo<FormState>(() => ({
    ...initial,
    ...initialValues,
    targetHiringDate: toDateInputValue(initialValues?.targetHiringDate),
    hodEmail: HR_INTERVIEW_EMAIL,
  }), [initialValues]);
  const [form, setForm] = useState<FormState>(() => initialForm);
  const [draftRoleId, setDraftRoleId] = useState(roleId || "");
  const effectiveRoleId = roleId || draftRoleId;
  const isEditing = Boolean(effectiveRoleId);
  const isAutoDraft = !roleId && Boolean(draftRoleId);
  const isDraftRole = isAutoDraft || status === "Draft";
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftError, setDraftError] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ roleId: string; status: string; notificationStatus: string; notificationError: string } | null>(null);
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const draftSaveInFlight = useRef<Promise<void> | null>(null);
  const draftClientId = useRef(globalThis.crypto.randomUUID());
  const initialFormKey = useMemo(() => JSON.stringify(initialForm), [initialForm]);
  const [savedFormKey, setSavedFormKey] = useState(initialFormKey);
  const hasChanges = JSON.stringify(form) !== savedFormKey;

  useEffect(() => {
    setSavedFormKey(initialFormKey);
  }, [initialFormKey]);

  function scrollToErrorSummary() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function update(name: keyof FormState, value: string | number) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "requestType" && value === "Staff Addition"
        ? { replacementEmployee: "" }
        : {}),
    }));
    setError("");
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  function availabilityPayload() {
    return {
      hodEmail: HR_INTERVIEW_EMAIL,
      // Legacy sheet fields stay empty. HR interview times now come from
      // the connected HR Google Calendar rather than manually entered windows.
      hodAvailabilitySlots: [],
      hodAvailabilityDates: "",
      hodAvailabilityTimes: "",
    };
  }

  async function autosaveDraft() {
    if (!hasChanges || loading || parsing || draftSaveInFlight.current) return;
    const snapshot = form;
    const request = (async () => {
      setDraftSaving(true);
      setDraftError("");
      try {
        const endpoint = effectiveRoleId ? `/api/roles/${encodeURIComponent(effectiveRoleId)}` : "/api/roles";
        const response = await fetch(endpoint, {
          method: effectiveRoleId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...snapshot,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: snapshot.requestType === "Staff Replacement" ? snapshot.replacementEmployee : "",
            draft: true,
            draftId: draftClientId.current,
          }),
        });
        const result = await response.json() as RoleSubmissionResult;
        if (!response.ok || result.success !== true || !result.roleId) throw new Error(result.error || "Unable to autosave this draft.");
        if (!effectiveRoleId) {
          setDraftRoleId(result.roleId);
          window.history.replaceState(null, "", `/roles/${encodeURIComponent(result.roleId)}/edit`);
        }
        setSavedFormKey(JSON.stringify(snapshot));
        setDraftSavedAt(new Date().toISOString());
      } catch (caught) {
        setDraftError(caught instanceof Error ? caught.message : "Unable to autosave this draft.");
      } finally {
        setDraftSaving(false);
        draftSaveInFlight.current = null;
      }
    })();
    draftSaveInFlight.current = request;
    await request;
  }

  useEffect(() => {
    if (!hasChanges) return;
    const timer = window.setTimeout(() => void autosaveDraft(), 850);
    return () => window.clearTimeout(timer);
  }, [form, hasChanges, effectiveRoleId, loading, parsing]);

  async function populateFromJobDescription() {
    if (!jobDescriptionFile && form.jobDescription.trim().length < 20) {
      setParseError("Enter at least 20 characters in the job description or attach a PDF, DOC, or DOCX file.");
      return;
    }

    setParsing(true);
    setParseError("");
    try {
      const body = new FormData();
      if (jobDescriptionFile) body.append("jobDescriptionFile", jobDescriptionFile);
      else {
        body.append("jobDescriptionText", form.jobDescription.trim());
        body.append("jobTitle", form.jobTitle.trim());
        body.append("department", form.department.trim());
      }
      const response = await fetch("/api/roles/parse-description", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      // A proxy or an interrupted upstream workflow can return an empty body.
      // Do not let Response.json() mask that as a browser-level exception.
      const raw = await response.text();
      let result: { success?: boolean; error?: string; draft?: RoleAiDraft } = {};
      if (raw.trim()) {
        try {
          result = JSON.parse(raw) as typeof result;
        } catch {
          throw new Error("The AI draft service returned an invalid response. Please try again.");
        }
      }
      if (!raw.trim()) {
        throw new Error(`The AI draft service returned an empty response (HTTP ${response.status}). Please try again.`);
      }
      if (!response.ok || result.success !== true || !result.draft) throw new Error(result.error || "Unable to generate the role draft.");

      const questions = [
        result.draft.recruitmentSetup.requiredInterviewQuestion1,
        result.draft.recruitmentSetup.requiredInterviewQuestion2,
        result.draft.recruitmentSetup.requiredInterviewQuestion3,
        result.draft.recruitmentSetup.requiredInterviewQuestion4,
        result.draft.recruitmentSetup.requiredInterviewQuestion5,
      ].filter(Boolean);

      setForm((current) => ({
        ...current,
        ...result.draft?.role,
        // Keep values HR already entered when the AI draft cannot infer them.
        jobTitle: result.draft?.role.jobTitle || current.jobTitle,
        department: result.draft?.role.department || current.department,
        jobDescription: result.draft?.role.jobDescription || current.jobDescription,
        // The parser intentionally does not invent a hiring date. Do not let
        // its empty placeholder erase a date HR already selected.
        targetHiringDate: result.draft?.role.targetHiringDate || current.targetHiringDate,
        aiGeneratedScreeningQuestions: questions,
        recruitmentSetupDraft: result.draft?.recruitmentSetup || current.recruitmentSetupDraft,
      }));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Unable to generate the role draft.");
    } finally {
      setParsing(false);
    }
  }

  // ---- Single-form mode: setup values, defaults and payload -------------
  const setupDraft = form.recruitmentSetupDraft;
  const salaryStatus = setupDraft.salaryDisclosureStatus || "Not disclosed";
  const licenseStatus = setupDraft.licenseRequirementStatus || (setupDraft.licenseOrCertificateRequired?.trim() ? "Required" : "Not required");
  const interviewStatus = setupDraft.hodInterviewRequired || "Not required";

  function updateSetup(key: keyof FormState["recruitmentSetupDraft"], value: string | string[]) {
    setForm((current) => ({ ...current, recruitmentSetupDraft: { ...current.recruitmentSetupDraft, [key]: value } }));
    setError("");
    setFieldErrors((current) => {
      const next = { ...current };
      for (const field of Object.values(SETUP_FIELD_FOR_KEY)) if (field !== "setup_channels" || key === "postingChannels") delete next[field];
      return next;
    });
  }

  function toggleChannel(channel: string) {
    const selected = setupDraft.postingChannels || [];
    updateSetup("postingChannels", selected.includes(channel) ? selected.filter((item) => item !== channel) : [...selected, channel]);
  }

  function setupPayload(setupAction: "publish_role" | "save_draft") {
    const questions = QUESTION_NUMBERS.map((number) => String(setupDraft[`requiredInterviewQuestion${number}` as const] || "").trim());
    const licenseRequired = licenseStatus === "Not required" ? "" : String(setupDraft.licenseOrCertificateRequired || "").trim();
    const values = {
      ...setupDraft,
      jobDescription: form.jobDescription,
      salaryDisclosureStatus: salaryStatus,
      licenseRequirementStatus: licenseStatus,
      licenseOrCertificateRequired: licenseRequired,
      hodInterviewRequired: interviewStatus,
      finalInterviewVenue: interviewStatus === "Required" ? String(setupDraft.finalInterviewVenue || "").trim() : "",
      postingChannels: setupDraft.postingChannels || [],
      requiredInterviewQuestion1: questions[0],
      requiredInterviewQuestion2: questions[1],
      requiredInterviewQuestion3: questions[2],
      requiredInterviewQuestion4: questions[3],
      requiredInterviewQuestion5: questions[4],
    };
    // Every role starts from the standard interview script and the default
    // scoring fields; HR can fine-tune both later in Recruitment Setup.
    const evaluationFields = [
      ...EVALUATION_FIELD_CATALOG.filter((field) => (values.evaluationFieldToggles || []).includes(field.key)),
      ...(values.customEvaluationFields || []),
    ];
    const resolvedAiSystemPrompt = renderRecruitmentSystemPrompt(STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE, {
      roleTitle: form.jobTitle,
      jobDescription: form.jobDescription,
      screeningCriteria: values.screeningCriteria,
      interviewQuestions: buildNumberedInterviewQuestions(questions).join("\n"),
      licenseOrCertificateRequired: values.licenseOrCertificateRequired,
      keywordsToLookFor: values.keywordsToLookFor,
      transferableSkillsAccepted: values.transferableSkillsAccepted,
      experienceRequired: String(values.minimumYearsOfExperience || ""),
      salaryOrBudgetRange: values.salaryOrBudgetRange,
      noticePeriodRequirement: values.earliestAvailabilityRule,
      earliestAvailabilityRule: values.earliestAvailabilityRule,
      evaluationFields,
    });
    return {
      ...values,
      aiSystemPrompt: STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE,
      resolvedAiSystemPrompt,
      initialInterviewBookingLink: "",
      hodInterviewBookingLink: "",
      setupAction,
      actionRequestId: globalThis.crypto.randomUUID(),
    };
  }

  function validateSetup() {
    const readiness = getSetupReadiness(setupPayload("publish_role"), "ready-for-publishing");
    if (readiness.valid) return true;
    const messages: Record<string, string> = {
      setup_screeningCriteria: "Describe what a strong candidate looks like.",
      setup_question1: "Write the first interview question.",
      setup_question2: "Write the second interview question.",
      setup_question3: "Write the third interview question.",
      setup_channels: "Choose at least one place to post this role.",
      setup_license: "Say which license or certificate is needed.",
      setup_venue: "Enter the address and arrival instructions for the interview.",
    };
    const next: Record<string, string> = {};
    for (const missing of readiness.missingFields) {
      const field = SETUP_FIELD_FOR_KEY[missing.key];
      if (field) next[field] = messages[field];
    }
    if (Object.keys(next).length === 0) return true;
    setFieldErrors((current) => ({ ...current, ...next }));
    setError("Please complete the highlighted fields before publishing.");
    scrollToErrorSummary();
    return false;
  }

  async function saveDraftAndExit() {
    setError("");
    if (draftSaveInFlight.current) await draftSaveInFlight.current;
    await autosaveDraft();
    if (draftSaveInFlight.current) await draftSaveInFlight.current;
    window.location.assign("/roles");
  }

  function fieldErrorProps(field: string) {
    return { "aria-invalid": Boolean(fieldErrors[field]) };
  }

  function formatFieldError(field: string, message: string) {
    const readableMessage = message
      .replace(/^String must/, "Must")
      .replace(/^Invalid input/, "Invalid value");
    const label = fieldLabels[field]
      || field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()).trim();
    return { label, message: readableMessage };
  }

  function validateForm() {
    const availability = availabilityPayload();
    const parsed = roleRequestSchema.safeParse({
      ...form,
      ...availability,
      requesterName: user.name,
      requesterEmail: user.email,
      replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
    });

    if (parsed.success) {
      setFieldErrors({});
      return true;
    }

    const nextErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] || "form");
      if (!nextErrors[field]) nextErrors[field] = issue.message;
    }
    setFieldErrors(nextErrors);
    setError("Please correct the highlighted fields before submitting.");
    scrollToErrorSummary();
    return false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roleValid = validateForm();
    const setupValid = !unified || validateSetup();
    if (!roleValid || !setupValid) return;

    setLoading(true);
    setStage("Saving the role…");
    setError("");
    setSuccess(null);

    try {
      let response: Response;
      if (isDraftRole) {
        // Do not submit while the initial autosave is still being persisted.
        // Otherwise the PATCH can race the POST that created this draft.
        if (draftSaveInFlight.current) await draftSaveInFlight.current;

        // Save the final form snapshot first, then use the audited status
        // transition so submitting a draft cannot create a duplicate role.
        response = await fetch(`/api/roles/${encodeURIComponent(effectiveRoleId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...form,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
            draft: true,
          }),
        });
        const savedDraft = await response.json() as RoleSubmissionResult;
        if (!response.ok || savedDraft.success !== true) throw new Error(savedDraft.error || "Unable to save this draft.");
        response = await fetch(`/api/roles/${encodeURIComponent(effectiveRoleId)}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "submit_draft_for_hr", comments: "Draft completed and submitted for HR discussion.", actionRequestId: globalThis.crypto.randomUUID() }),
        });
      } else {
        response = await fetch(isEditing ? `/api/roles/${encodeURIComponent(effectiveRoleId)}` : "/api/roles", {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...form,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
          }),
        });
      }
      const result = (await response.json()) as RoleSubmissionResult;

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to submit role request.");
      }

      const savedRoleId = result.roleId || effectiveRoleId || "";
      let finalStatus = result.status || "Pending HR Discussion";
      // An approver submitting a new request is the reviewer too, so approve it
      // in the same step instead of leaving a formality to click through. If
      // this fails the request simply stays pending for a manual approval.
      if (canApproveRole && (!isEditing || isDraftRole) && savedRoleId) {
        setStage("Approving…");
        try {
          const approval = await fetch(`/api/roles/${encodeURIComponent(savedRoleId)}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ action: "approve_role", comments: "Approved on submission.", actionRequestId: globalThis.crypto.randomUUID() }),
          });
          const approved = await approval.json().catch(() => ({})) as RoleSubmissionResult;
          if (approval.ok && approved.success === true) finalStatus = approved.status || "Approved";
        } catch (approvalError) {
          console.error("[Role Request Form] Automatic approval failed:", approvalError);
        }
      }
      if (unified && savedRoleId) {
        if (finalStatus !== "Approved") {
          throw new Error(`The role ${savedRoleId} was saved but could not be approved automatically, so it has not been published. Open it from Role Requests to finish.`);
        }
        setStage("Publishing…");
        const published = await fetch(`/api/roles/${encodeURIComponent(savedRoleId)}/recruitment-setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(setupPayload("publish_role")),
        });
        const publishResult = await published.json().catch(() => ({})) as RoleSubmissionResult & { message?: string; missingFieldLabels?: string[] };
        if (!published.ok || publishResult.success !== true) {
          const detail = publishResult.missingFieldLabels?.length ? `Missing: ${publishResult.missingFieldLabels.join(", ")}.` : publishResult.error || publishResult.message || "Please try again from the role page.";
          throw new Error(`The role ${savedRoleId} was created and approved, but publishing failed. ${detail}`);
        }
        finalStatus = publishResult.status || "Job Posted";
      }
      setSuccess({
        roleId: savedRoleId || "Not provided",
        status: finalStatus,
        notificationStatus: result.notificationStatus || "not_configured",
        notificationError: result.notificationError || "",
      });
      if (isEditing) {
        router.push(`/roles/${encodeURIComponent(savedRoleId)}?updated=1`);
        router.refresh();
      } else {
        // The new role is written by n8n outside the Next.js process. A full
        // navigation avoids reusing a prefetched/stale client tree and prevents
        // the first redirect from briefly showing "Role request not found".
        window.location.assign(`/roles/${encodeURIComponent(savedRoleId)}`);
      }
      if (!isEditing) setForm(initial);
    } catch (submissionError) {
      console.error("[Role Request Form] Submission failed:", submissionError);
      setError(submissionError instanceof Error ? submissionError.message : "Submission failed.");
      scrollToErrorSummary();
    } finally {
      setLoading(false);
      setStage("");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-layout">
      <div className="form-card">
        {success && (
          <div className="section">
            <ActionFeedback kind="success">
              <strong>Role request submitted.</strong><br />
              Role ID: {success.roleId}<br />
              Status: {success.status}<br />
              Email notification: {success.notificationStatus.replace(/_/g, " ")}{success.notificationError ? ` (${success.notificationError})` : ""}
            </ActionFeedback>
          </div>
        )}

        {error && <div className="section"><ValidationSummary error={error} issues={Object.entries(fieldErrors).map(([field, message]) => { const formatted = formatFieldError(field, message); return { field, label: formatted.label, message: formatted.message, href: `#${field}` }; })} summaryRef={errorSummaryRef} /></div>}
        {(isDraftRole || draftSaving || draftSavedAt || draftError) && <div className="draft-autosave-status" role="status"><strong>Draft</strong>{draftSaving ? " · Saving automatically..." : draftError ? ` · ${draftError}` : draftSavedAt ? ` · Saved ${new Date(draftSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · Changes will be saved automatically"}</div>}

        <section className="section">
          <div className="section-title">
            <span className="section-number">1</span>
          <h2>{isEditing ? "Edit role request" : "Role request"}</h2>
          </div>
          <p className="section-intro">Provide the information HR and Smile need to understand the vacancy.</p>

          <div className="form-stack">
            <div className="field full">
              <div className="ai-draft-panel">
                <div>
                  <strong>Populate from a job description</strong>
                  <small className="field-help">Upload a PDF, DOC, or DOCX, or use the job description below. Smile will prepare role details, screening criteria, and interview questions for HR to review.</small>
                </div>
                <div className="ai-draft-controls">
                  {/* Keep the picker aligned with the server document extractor. */}
                  <input id="jobDescriptionFile" type="file" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(event) => { setJobDescriptionFile(event.target.files?.[0] || null); setParseError(""); }} />
                  <button type="button" className="btn btn-secondary" onClick={populateFromJobDescription} disabled={parsing || (!jobDescriptionFile && form.jobDescription.trim().length < 20)}>
                    {parsing ? "Generating AI guidance…" : jobDescriptionFile ? "Generate draft" : "Generate AI questions"}
                  </button>
                </div>
                {jobDescriptionFile && <small className="field-help">Selected: {jobDescriptionFile.name}</small>}
                {parseError && <div className="error-box message-box" role="alert"><span className="message-box-icon" aria-hidden="true"><UiIcon name="alert" size={17} /></span><span>{parseError}</span></div>}
              </div>
              <label htmlFor="jobDescription">Job Description <strong className="required-mark">*</strong></label>
              <textarea id="jobDescription" {...fieldErrorProps("jobDescription")} required value={form.jobDescription} onChange={(event) => update("jobDescription", event.target.value)} placeholder="Describe the purpose and main scope of this role." />
            </div>

            <div className="field">
              <label htmlFor="requestType">Request Type <strong className="required-mark">*</strong></label>
              <select id="requestType" {...fieldErrorProps("requestType")} value={form.requestType} onChange={(event) => update("requestType", event.target.value)}>
                <option>Staff Addition</option>
                <option>Staff Replacement</option>
              </select>
            </div>

            {form.requestType === "Staff Replacement" && (
              <div className="field full">
                <label htmlFor="replacementEmployee">Employee or Position Being Replaced <strong className="required-mark">*</strong></label>
                <input id="replacementEmployee" {...fieldErrorProps("replacementEmployee")} required value={form.replacementEmployee} onChange={(event) => update("replacementEmployee", event.target.value)} placeholder="Name or position" />
              </div>
            )}

            <div className="field">
              <label htmlFor="jobTitle">Job Title <strong className="required-mark">*</strong></label>
              <input id="jobTitle" {...fieldErrorProps("jobTitle")} required value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} placeholder="e.g. Inside Sales Specialist" />
            </div>

            <div className="field">
              <label htmlFor="department">Department <strong className="required-mark">*</strong></label>
              <select id="department" {...fieldErrorProps("department")} required value={form.department} onChange={(event) => update("department", event.target.value)}>
                {form.department && !isKnownDepartment(form.department) && <option value={form.department}>{form.department} (existing)</option>}
                <option value="">Select a department</option>
                {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="employmentType">Employment Type <strong className="required-mark">*</strong></label>
              <select id="employmentType" {...fieldErrorProps("employmentType")} value={form.employmentType} onChange={(event) => update("employmentType", event.target.value)}>
                <option>Full-Time</option>
                <option>Part-Time</option>
                <option>Contract</option>
                <option>Temporary</option>
                <option>Internship</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="numberOfVacancies">Number of Vacancies <strong className="required-mark">*</strong></label>
              <input id="numberOfVacancies" {...fieldErrorProps("numberOfVacancies")} required min="1" max="100" type="number" value={form.numberOfVacancies} onChange={(event) => update("numberOfVacancies", Number(event.target.value))} />
            </div>

            <div className="field">
              <label htmlFor="targetHiringDate">Target Hiring Date <strong className="required-mark">*</strong></label>
              <input id="targetHiringDate" {...fieldErrorProps("targetHiringDate")} required min={todayDateInputValue()} type="date" value={form.targetHiringDate} onChange={(event) => update("targetHiringDate", event.currentTarget.value)} onInput={(event) => update("targetHiringDate", event.currentTarget.value)} />
              <small className="field-help">Select today or a future date. Earlier dates cannot be submitted.</small>
            </div>

            <div className="field full">
              <label htmlFor="reasonForRequest">Reason for Request <strong className="required-mark">*</strong></label>
              <textarea id="reasonForRequest" {...fieldErrorProps("reasonForRequest")} required value={form.reasonForRequest} onChange={(event) => update("reasonForRequest", event.target.value)} placeholder="Why is this additional or replacement staff member needed?" />
            </div>
          </div>
        </section>

        {unified ? (
          <>
            <section className="section">
              <div className="section-title">
                <span className="section-number">2</span>
                <h2>Screening and interview</h2>
              </div>
              <p className="section-intro">Smile screens every resume against these criteria and asks the questions below exactly as written, in order. They are prefilled from the job description, so just review and adjust.</p>
              <div className="form-stack">
                <div className="field">
                  <label htmlFor="setup_screeningCriteria">Screening criteria <strong className="required-mark">*</strong></label>
                  <textarea id="setup_screeningCriteria" {...fieldErrorProps("setup_screeningCriteria")} value={setupDraft.screeningCriteria} onChange={(event) => updateSetup("screeningCriteria", event.target.value)} placeholder="What does a strong candidate look like? Must-have experience, skills and qualifications." />
                </div>
                {QUESTION_NUMBERS.map((number) => {
                  const key = `requiredInterviewQuestion${number}` as const;
                  const required = number <= 3;
                  return (
                    <div className="field" key={number}>
                      <label htmlFor={`setup_question${number}`}>Interview question {number} {required ? <strong className="required-mark">*</strong> : <span className="field-optional">(optional)</span>}</label>
                      <textarea id={`setup_question${number}`} {...fieldErrorProps(`setup_question${number}`)} value={setupDraft[key] || ""} onChange={(event) => updateSetup(key, event.target.value)} placeholder={required ? "A question Smile should ask every candidate" : "Add another question if you need one"} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="section">
              <div className="section-title">
                <span className="section-number">3</span>
                <h2>Publishing</h2>
              </div>
              <p className="section-intro">Choose where the role is posted and a few hiring policies. Sensible defaults are already selected.</p>
              <div className="form-stack">
                <fieldset className="field publish-channels" id="setup_channels" aria-invalid={Boolean(fieldErrors.setup_channels)}>
                  <legend>Post this role on <strong className="required-mark">*</strong></legend>
                  {POSTING_CHANNELS.map((channel) => (
                    <label key={channel} className="publish-channel-option">
                      <input type="checkbox" checked={(setupDraft.postingChannels || []).includes(channel)} onChange={() => toggleChannel(channel)} />
                      <span>{channel}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="field">
                  <label htmlFor="setup_salary">Show the salary to candidates?</label>
                  <select id="setup_salary" value={salaryStatus} onChange={(event) => updateSetup("salaryDisclosureStatus", event.target.value)}>
                    <option value="Not disclosed">No, keep it private</option>
                    <option value="Disclosed">Yes, show it</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="setup_licenseStatus">Is a license or certificate needed?</label>
                  <select id="setup_licenseStatus" value={licenseStatus} onChange={(event) => updateSetup("licenseRequirementStatus", event.target.value)}>
                    <option value="Not required">Not required</option>
                    <option value="Preferred">Preferred</option>
                    <option value="Required">Required</option>
                  </select>
                </div>
                {licenseStatus === "Required" && (
                  <div className="field">
                    <label htmlFor="setup_license">Which license or certificate? <strong className="required-mark">*</strong></label>
                    <input id="setup_license" {...fieldErrorProps("setup_license")} value={setupDraft.licenseOrCertificateRequired} onChange={(event) => updateSetup("licenseOrCertificateRequired", event.target.value)} placeholder="e.g. Professional Engineer license" />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="setup_interview">Add a face-to-face interview with HR?</label>
                  <select id="setup_interview" value={interviewStatus} onChange={(event) => updateSetup("hodInterviewRequired", event.target.value)}>
                    <option value="Not required">No</option>
                    <option value="Required">Yes</option>
                  </select>
                  <small className="field-help">Times come from the HR Google Calendar connected in Settings.</small>
                </div>
                {interviewStatus === "Required" && (
                  <div className="field">
                    <label htmlFor="setup_venue">Interview venue and arrival instructions <strong className="required-mark">*</strong></label>
                    <textarea id="setup_venue" {...fieldErrorProps("setup_venue")} value={setupDraft.finalInterviewVenue} onChange={(event) => updateSetup("finalInterviewVenue", event.target.value)} placeholder="Address, floor or room, and who to ask for." />
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
        <section className="section">
          <div className="section-title">
            <span className="section-number">2</span>
            <h2>Face-to-Face interview and screening</h2>
          </div>
          <p className="section-intro">Review the HR interviewer and add up to two optional questions. AI-generated questions appear below for HR guidance and can be refined later in Recruitment Setup.</p>

          <div className="form-stack">
            <div className="field full">
              <label htmlFor="hodEmail">Shared HR Calendar Account</label>
              <input id="hodEmail" type="text" value="Configured in Settings" readOnly aria-readonly="true" />
              <small className="field-help">HR interview availability is read from the shared account configured in Settings and its connected HR Google Calendar. This role does not choose a personal calendar.</small>
            </div>
            <div className="field full">
              <label htmlFor="customScreeningQuestion1">HR Screening Question 1 <span className="field-optional">(optional)</span></label>
              <textarea id="customScreeningQuestion1" value={form.customScreeningQuestion1} onChange={(event) => update("customScreeningQuestion1", event.target.value)} placeholder="Ask something specific to this role" />
            </div>
            <div className="field full">
              <label htmlFor="customScreeningQuestion2">HR Screening Question 2 <span className="field-optional">(optional)</span></label>
              <textarea id="customScreeningQuestion2" value={form.customScreeningQuestion2} onChange={(event) => update("customScreeningQuestion2", event.target.value)} placeholder="Ask another role-specific question" />
            </div>
            {form.aiGeneratedScreeningQuestions.length > 0 && (
              <div className="field full">
                <div className="ai-question-review">
                  <strong>AI-generated screening questions for HR review</strong>
                  <small className="field-help">These were generated from the role description. HR can review and refine them in Recruitment Setup before publishing.</small>
                  <ol>
                    {form.aiGeneratedScreeningQuestions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </section>
        )}

        {(!isEditing || hasChanges || isDraftRole) && (
          <>
          <div className="form-actions">
            <a className="btn btn-secondary" href="/roles">Cancel</a>
            {unified && <button type="button" className="btn btn-secondary" disabled={loading || parsing} onClick={() => void saveDraftAndExit()}>Save as draft</button>}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (stage || "Submitting…") : unified ? "Create & publish" : isEditing && !isDraftRole ? "Save role request" : canApproveRole ? "Submit & approve" : "Submit for HR approval"}
            </button>
          </div>
          {unified && <p className="form-actions-hint">Create &amp; publish approves the role and posts it to the channels you selected. Save as draft keeps it private so you can finish later.</p>}
          </>
        )}
      </div>

      <aside className="sidebar-card">
        <h3>What happens next</h3>
        <div className="sidebar-list">
          {unified
            ? <><div><strong>1. Create &amp; publish</strong><br />The role is approved and posted to the channels you chose.</div>
              <div><strong>2. Candidates apply</strong><br />Each candidate gets a link, is screened by Smile and can book an interview.</div>
              <div><strong>3. You decide</strong><br />Review results in Applicants. Fine-tune the AI script any time in Recruitment Setup.</div></>
            : <><div><strong>1. Submit</strong><br />{canApproveRole ? "As HR, your request is approved as soon as you submit it." : "HR reviews your request and approves or rejects it."}</div>
              <div><strong>2. Recruitment setup</strong><br />HR confirms Smile's generated screening setup.</div>
              <div><strong>3. Job posting</strong><br />Approved roles can be published to the selected channels.</div></>}
        </div>
      </aside>
    </form>
  );
}
