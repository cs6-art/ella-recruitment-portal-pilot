"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import ValidationSummary, { type ValidationIssue } from "@/components/ValidationSummary";
import { notificationPresentation } from "@/lib/notification-status";
import {
  hasLegacyInterviewQuestionBlock,
  rebrandAssistantName,
  renderRecruitmentSystemPrompt,
  renderRecruitmentSystemPromptSample,
  STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE,
} from "@/lib/recruitment-prompt";
import {
  BASELINE_EVALUATION_FIELDS,
  EVALUATION_FIELD_CATALOG,
  recruitmentSetupSchema,
} from "@/lib/recruitment-setup-schema";
import {
  getSetupReadiness,
  type SetupReadinessInput,
  type SetupReadinessLevel,
} from "@/lib/recruitment-setup-readiness";
import { parseVoiceInterviewSlots, type VoiceInterviewSlot } from "@/lib/voice-interview-availability";
import { buildNumberedInterviewQuestions } from "@/lib/interview-question-count";
import { formatPortalDateTime } from "@/lib/portal-time";

type Setup = {
  roleTitle?: string;
  jobDescription: string;
  screeningCriteria: string;
  requiredInterviewQuestion1?: string;
  requiredInterviewQuestion2?: string;
  requiredInterviewQuestion3?: string;
  requiredInterviewQuestion4?: string;
  requiredInterviewQuestion5?: string;
  hodScreeningQuestion1?: string;
  hodScreeningQuestion2?: string;
  aiGeneratedScreeningQuestions?: string | string[];
  aiSystemPrompt: string;
  resolvedAiSystemPrompt?: string;
  initialInterviewBookingLink: string;
  hodInterviewBookingLink: string;
  postingChannels: string[] | string;
  evaluationFieldToggles?: string[] | string;
  customEvaluationFields?: { key: string; label: string; description: string }[];
  licenseOrCertificateRequired: string;
  keywordsToLookFor: string;
  minimumYearsOfExperience?: number | string;
  transferableSkillsAccepted: string;
  salaryOrBudgetRange: string;
  earliestAvailabilityRule: string;
  experienceRequired?: string;
  salaryMin?: string;
  salaryMax?: string;
  noticePeriodRequirement?: string;
  salaryDisclosureStatus?: string;
  experienceRequirementStatus?: string;
  licenseRequirementStatus?: string;
  hodInterviewRequired?: string;
  finalInterviewVenue?: string;
  voiceInterviewAvailabilityMode?: string;
  voiceInterviewSlots?: VoiceInterviewSlot[] | string;
  voiceInterviewAutoStartDate?: string;
  voiceInterviewAutoEndDate?: string;
  voiceInterviewTimezone?: string;
  voiceInterviewSlotsGeneratedAt?: string;
  recruitmentSetupStatus?: string;
  applicationLink?: string;
};

type Props = {
  roleId: string;
  status: string;
  setup: Setup;
  editable: boolean;
  /** Version token used to prevent one browser session overwriting another. */
  version?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByEmail?: string;
  onSaved?: (expectedStatus?: string) => void;
};

type SetupField = keyof Setup;
type SetupValue = string | string[] | VoiceInterviewSlot[];

type RecruitmentTemplate = {
  id: string;
  name: string;
  sourceRoleId: string;
  setup: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
};

const questionKeys = [
  "requiredInterviewQuestion1",
  "requiredInterviewQuestion2",
  "requiredInterviewQuestion3",
  "requiredInterviewQuestion4",
  "requiredInterviewQuestion5",
] as const;

const channels = ["LinkedIn", "Facebook", "JobStreet"];

function normalizeChannels(value: string[] | string | undefined) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value?: string) {
  return formatPortalDateTime(value || "", true);
}

function valueText(value: unknown) {
  return String(value ?? "").trim();
}

const templateReplacedFields: SetupField[] = [
  "jobDescription",
  "screeningCriteria",
  "requiredInterviewQuestion1",
  "requiredInterviewQuestion2",
  "requiredInterviewQuestion3",
  "requiredInterviewQuestion4",
  "requiredInterviewQuestion5",
  "aiSystemPrompt",
  "evaluationFieldToggles",
  "customEvaluationFields",
  "licenseOrCertificateRequired",
  "keywordsToLookFor",
  "minimumYearsOfExperience",
  "transferableSkillsAccepted",
  "salaryOrBudgetRange",
  "earliestAvailabilityRule",
];

function hasNonEmptyTemplateFields(values: Setup) {
  return templateReplacedFields.some((key) => {
    const value = values[key];
    return Array.isArray(value) ? value.length > 0 : valueText(value) !== "";
  });
}

const setupFieldLabels: Record<string, string> = {
  Job_Description: "Job description",
  Screening_Criteria: "Screening instructions",
  AI_System_Prompt: "VAPI system prompt",
  Required_Interview_Question_1: "Question 1",
  Required_Interview_Question_2: "Question 2",
  Required_Interview_Question_3: "Question 3",
  Required_Interview_Question_4: "Question 4",
  Required_Interview_Question_5: "Question 5",
  Posting_Channels: "At least one posting channel",
  Salary_Disclosure_Status: "Salary visibility",
  License_Requirement_Status: "License or certificate requirement",
  License_or_Certificate_Required: "License or certificate details",
  HOD_Interview_Required: "HR interview requirement",
  Final_Interview_Venue: "Face-to-Face interview venue",
  screeningCriteria: "Screening instructions",
  requiredInterviewQuestion1: "Question 1",
  requiredInterviewQuestion2: "Question 2",
  requiredInterviewQuestion3: "Question 3",
  requiredInterviewQuestion4: "Question 4",
  requiredInterviewQuestion5: "Question 5",
  postingChannels: "Posting channels",
  salaryDisclosureStatus: "Salary visibility",
  licenseRequirementStatus: "License requirement",
  hodInterviewRequired: "Face-to-Face interview",
  finalInterviewVenue: "Face-to-Face interview venue",
  customEvaluationFields: "Custom evaluation fields",
};

const setupFieldAnchors: Record<string, string> = {
  Job_Description: "#recruitment-setup",
  Screening_Criteria: "#vapi-screeningCriteria",
  AI_System_Prompt: "#vapi-preview",
  Required_Interview_Question_1: "#vapi-question-1",
  Required_Interview_Question_2: "#vapi-question-2",
  Required_Interview_Question_3: "#vapi-question-3",
  Required_Interview_Question_4: "#vapi-question-4",
  Required_Interview_Question_5: "#vapi-question-5",
  Posting_Channels: "#vapi-posting-channels",
  Salary_Disclosure_Status: "#vapi-salary-disclosure",
  License_Requirement_Status: "#vapi-license-requirement",
  License_or_Certificate_Required: "#vapi-license",
  HOD_Interview_Required: "#vapi-hr-interview",
  Final_Interview_Venue: "#vapi-final-interview-venue",
  screeningCriteria: "#vapi-screeningCriteria",
  requiredInterviewQuestion1: "#vapi-question-1",
  requiredInterviewQuestion2: "#vapi-question-2",
  requiredInterviewQuestion3: "#vapi-question-3",
  requiredInterviewQuestion4: "#vapi-question-4",
  requiredInterviewQuestion5: "#vapi-question-5",
  salaryDisclosureStatus: "#vapi-salary-disclosure",
  licenseRequirementStatus: "#vapi-license-requirement",
  hodInterviewRequired: "#vapi-hr-interview",
  finalInterviewVenue: "#vapi-final-interview-venue",
};

function setupFieldLabel(field: string) {
  return setupFieldLabels[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function questionFallbacks(setup: Setup) {
  return questionKeys.map((key) => valueText(setup[key]));
}

function suggestedQuestionItems(value: string | string[] | undefined) {
  let source: string[] = Array.isArray(value) ? value.map(String) : String(value || "").split(/\r?\n/);
  if (source.length === 1 && source[0].trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(source[0]);
      if (Array.isArray(parsed)) source = parsed.map(String);
    } catch {
      // Keep the original text when an older workflow stores non-JSON text.
    }
  }
  return source
    .map((question) => question.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function buildInitialValues(setup: Setup): Setup {
  const questions = questionFallbacks(setup);
  const hodQuestion1 = valueText(setup.hodScreeningQuestion1);
  const hodQuestion2 = valueText(setup.hodScreeningQuestion2);
  return {
    ...setup,
    // Slots 1-2 are reserved for HR's screening questions from the
    // role request, when they provided any — HR fills in the remaining slots.
    requiredInterviewQuestion1: hodQuestion1 || questions[0],
    requiredInterviewQuestion2: hodQuestion2 || questions[1],
    requiredInterviewQuestion3: questions[2],
    requiredInterviewQuestion4: questions[3],
    requiredInterviewQuestion5: questions[4],
    postingChannels: normalizeChannels(setup.postingChannels),
    evaluationFieldToggles: normalizeChannels(setup.evaluationFieldToggles),
    customEvaluationFields: Array.isArray(setup.customEvaluationFields) ? setup.customEvaluationFields.slice(0, 3) : [],
    voiceInterviewAvailabilityMode: setup.voiceInterviewAvailabilityMode || "none",
    voiceInterviewSlots: parseVoiceInterviewSlots(setup.voiceInterviewSlots),
    recruitmentSetupStatus: setup.recruitmentSetupStatus || "Draft",
  };
}

function getEvaluationFields(values: Setup) {
  const toggled = normalizeChannels(values.evaluationFieldToggles)
    .map((key) => EVALUATION_FIELD_CATALOG.find((field) => field.key === key))
    .filter((field): field is (typeof EVALUATION_FIELD_CATALOG)[number] => Boolean(field));
  const custom = (values.customEvaluationFields || []).filter((field) => field.key && field.label);
  return [...toggled, ...custom];
}

function promptRenderInput(values: Setup) {
  return {
    roleTitle: values.roleTitle,
    jobDescription: values.jobDescription,
    screeningCriteria: values.screeningCriteria,
    interviewQuestions: buildNumberedInterviewQuestions(questionKeys.map((key) => valueText(values[key]))).join("\n"),
    licenseOrCertificateRequired: values.licenseOrCertificateRequired,
    keywordsToLookFor: values.keywordsToLookFor,
    transferableSkillsAccepted: values.transferableSkillsAccepted,
    experienceRequired: valueText(values.minimumYearsOfExperience) || values.experienceRequired,
    salaryMin: values.salaryMin,
    salaryMax: values.salaryMax,
    salaryOrBudgetRange: values.salaryOrBudgetRange,
    noticePeriodRequirement: values.noticePeriodRequirement || values.earliestAvailabilityRule,
    earliestAvailabilityRule: values.earliestAvailabilityRule,
    evaluationFields: getEvaluationFields(values),
  };
}

function generatedPrompt(values: Setup, template = STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE) {
  return renderRecruitmentSystemPrompt(template, promptRenderInput(values));
}

/** HR-facing only — never used for the value that gets saved or sent to
 * Vapi. Fills the remaining {{candidate_name}} / {{email}} / {{match_score}}
 * / {{ai_summary}} tags with a sample candidate so HR sees plain, readable
 * text instead of template syntax. */
function generatedSamplePrompt(values: Setup, template = STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE) {
  return renderRecruitmentSystemPromptSample(template, promptRenderInput(values));
}

function getQuestions(values: Setup) {
  return questionKeys.map((key) => valueText(values[key])).filter(Boolean);
}

function promptPayload(values: Setup, template: string, action: string, actionRequestId: string) {
  return {
    ...values,
    aiSystemPrompt: template,
    resolvedAiSystemPrompt: generatedPrompt(values, template),
    postingChannels: normalizeChannels(values.postingChannels),
    setupAction: action,
    actionRequestId,
  };
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  hint,
  placeholder,
  multiline = false,
  required = false,
  type = "text",
}: {
  id: string;
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  type?: "text" | "date";
}) {
  return (
    <label className={`field${multiline ? " field-wide" : ""}`} htmlFor={id}>
      <span>{label}{required ? " *" : ""}</span>
      {multiline ? (
        <textarea id={id} value={value ?? ""} disabled={disabled} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} type={type} value={value ?? ""} disabled={disabled} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function RecruitmentSetupEditor({ roleId, status, setup, editable: canReview, version, updatedAt, updatedBy, updatedByEmail, onSaved }: Props) {
  // Published roles are a viewing surface. Keep the setup controls disabled
  // there so opening a role does not expose a misleading Save action.
  const baseEditable = canReview && (status === "Approved" || status === "Recruitment Setup");
  const canAdvanceWorkflow = status !== "Job Posted";
  const router = useRouter();
  const setupKey = JSON.stringify(setup);
  const initialValues = useMemo(() => buildInitialValues(JSON.parse(setupKey) as Setup), [setupKey]);
  const [values, setValues] = useState<Setup>(() => buildInitialValues(setup));
  const [advancedPrompt, setAdvancedPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(version || "");
  const [templates, setTemplates] = useState<RecruitmentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateActionId, setTemplateActionId] = useState("");
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const actionRequestId = useRef(globalThis.crypto.randomUUID());
  const saveInFlight = useRef(false);
  const dirtyRef = useRef(false);
  const saveRef = useRef<((action: string) => Promise<void>) | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const initialSetupKey = useMemo(() => JSON.stringify(initialValues), [initialValues]);
  const [savedSetupKey, setSavedSetupKey] = useState(initialSetupKey);
  const editable = baseEditable && !conflict;

  useEffect(() => {
    setValues(initialValues);
    setSavedSetupKey(initialSetupKey);
    setExpectedVersion(version || "");
    setConflict(false);
    setAdvancedPrompt(false);
    setSelectedTemplateId("");
  }, [initialSetupKey, initialValues, version]);

  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    async function loadTemplates() {
      setTemplateLoading(true);
      setTemplateError("");
      try {
        const response = await fetch("/api/recruitment-templates", { credentials: "same-origin", cache: "no-store" });
        const result = await response.json();
        if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to load recruitment templates.");
        if (!cancelled) setTemplates(Array.isArray(result.templates) ? result.templates : []);
      } catch (caught) {
        if (!cancelled) setTemplateError(caught instanceof Error ? caught.message : "Unable to load recruitment templates.");
      } finally {
        if (!cancelled) setTemplateLoading(false);
      }
    }
    void loadTemplates();
    return () => { cancelled = true; };
  }, [editable]);

  const currentPrompt = rebrandAssistantName(valueText(values.aiSystemPrompt) || STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE);
  const generated = useMemo(() => generatedPrompt(values, currentPrompt), [currentPrompt, values]);
  const generatedSample = useMemo(() => generatedSamplePrompt(values, currentPrompt), [currentPrompt, values]);
  const questions = getQuestions(values);
  const suggestedQuestions = useMemo(() => suggestedQuestionItems(values.aiGeneratedScreeningQuestions), [values.aiGeneratedScreeningQuestions]);
  const missingRequiredQuestionIndexes = questionKeys.slice(0, 3)
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !valueText(values[key]));
  const draftPayload = promptPayload(values, currentPrompt, "save_draft", actionRequestId.current);
  const readinessInput = draftPayload as SetupReadinessInput;
  const draftReadiness = getSetupReadiness(readinessInput, "draft");
  const recruitmentReadiness = getSetupReadiness(readinessInput, "recruitment-ready");
  const publishingReadiness = getSetupReadiness(readinessInput, "ready-for-publishing");
  const setupStatus = values.recruitmentSetupStatus || setup.recruitmentSetupStatus || "Draft";

  const setupHasChanges = JSON.stringify(values) !== savedSetupKey;
  const savedTemplates = templates.filter((template) => template.id);
  const legacyPromptNeedsSync = hasLegacyInterviewQuestionBlock(currentPrompt);

  useEffect(() => {
    dirtyRef.current = setupHasChanges;
  }, [setupHasChanges]);

  // Keep edits local while HR is working. A route change commits the pending
  // draft once; individual keystrokes never trigger a network write.
  useEffect(() => {
    if (!editable) return;
    return () => {
      if (dirtyRef.current && !saveInFlight.current) void saveRef.current?.("autosave_draft");
    };
  }, [editable]);

  if (!(status === "Approved" || status === "Recruitment Setup" || status === "Job Posted")) return null;

  const update = (key: SetupField, value: SetupValue) => {
    setValues((current) => ({ ...current, [key]: value }));
    setMessage("");
    setWarning("");
    setError("");
    setValidationIssues([]);
  };

  const confirmTemplateReplacement = (templateLabel: string) => {
    if (!hasNonEmptyTemplateFields(values)) return true;
    const detail = setupHasChanges
      ? "Your current unsaved changes will be replaced."
      : "The current non-empty setup fields will be replaced.";
    return window.confirm(`Load ${templateLabel}? ${detail} This cannot be undone from the editor unless you reset or re-enter the previous values.`);
  };

  const applyStandardTemplate = () => {
    if (!confirmTemplateReplacement("the standard interview script")) return;
    setValues((current) => ({ ...current, aiSystemPrompt: STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE }));
    setSelectedTemplateId("");
    setAdvancedPrompt(true);
    setMessage("Standard interview script loaded. Review the role-specific sections before saving.");
    setWarning("");
    setError("");
  };

  const applyTemplate = (template: RecruitmentTemplate) => {
    if (!confirmTemplateReplacement(`template \"${template.name}\"`)) return;
    setValues(buildInitialValues({
      ...template.setup,
      roleTitle: values.roleTitle,
      postingChannels: normalizeChannels(template.setup.postingChannels as string[] | string | undefined),
    } as Setup));
    setSelectedTemplateId(template.id);
    setAdvancedPrompt(true);
    setMessage(`Loaded template \"${template.name}\" into the editor. Review the changes, then save when ready.`);
    setWarning("");
    setError("");
  };

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      setTemplateError("Enter a template name before saving.");
      return;
    }

    setTemplateActionId("saving");
    setTemplateError("");
    try {
      const response = await fetch("/api/recruitment-templates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "",
          name,
          sourceRoleId: roleId,
          setup: { ...values, aiSystemPrompt: currentPrompt, postingChannels: normalizeChannels(values.postingChannels) },
        }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to save recruitment template.");
      const nextTemplate = result.template as RecruitmentTemplate;
      setTemplates((current) => [...current.filter((template) => template.id !== nextTemplate.id), nextTemplate]);
      setSelectedTemplateId(nextTemplate.id);
      setTemplateName("");
      setMessage(`Template \"${name}\" saved.`);
    } catch (caught) {
      setTemplateError(caught instanceof Error ? caught.message : "Unable to save recruitment template.");
    } finally {
      setTemplateActionId("");
    }
  }

  async function deleteTemplate(template: RecruitmentTemplate) {
    if (!window.confirm(`Delete template \"${template.name}\"?`)) return;
    setTemplateActionId(template.id);
    setTemplateError("");
    try {
      const response = await fetch(`/api/recruitment-templates?id=${encodeURIComponent(template.id)}`, { method: "DELETE", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to delete recruitment template.");
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (selectedTemplateId === template.id) setSelectedTemplateId("");
      setMessage(`Template \"${template.name}\" deleted.`);
    } catch (caught) {
      setTemplateError(caught instanceof Error ? caught.message : "Unable to delete recruitment template.");
    } finally {
      setTemplateActionId("");
    }
  }

  const openAdvancedPrompt = () => {
    setValues((current) => ({ ...current, aiSystemPrompt: valueText(current.aiSystemPrompt) || generated }));
    setAdvancedPrompt(true);
  };

  const toggleChannel = (channel: string) => {
    const selected = normalizeChannels(values.postingChannels);
    update("postingChannels", selected.includes(channel) ? selected.filter((item) => item !== channel) : [...selected, channel]);
  };

  const toggleEvaluationField = (key: string) => {
    const selected = normalizeChannels(values.evaluationFieldToggles);
    update("evaluationFieldToggles", selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };

  const customFieldKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

  const updateCustomField = (index: number, patch: Partial<{ key: string; label: string; description: string }>) => {
    setValues((current) => {
      const fields = [...(current.customEvaluationFields || [])];
      fields[index] = { ...fields[index], ...patch };
      return { ...current, customEvaluationFields: fields };
    });
    setMessage("");
    setWarning("");
    setError("");
    setValidationIssues([]);
  };

  const addCustomField = () => {
    setValues((current) => ((current.customEvaluationFields || []).length >= 3 ? current
      : { ...current, customEvaluationFields: [...(current.customEvaluationFields || []), { key: "", label: "", description: "" }] }));
  };

  const removeCustomField = (index: number) => {
    setValues((current) => ({ ...current, customEvaluationFields: (current.customEvaluationFields || []).filter((_, itemIndex) => itemIndex !== index) }));
  };

  const resetChanges = () => {
    setValues(initialValues);
    setAdvancedPrompt(false);
    setMessage("");
    setWarning("");
    setError("");
    setValidationIssues([]);
  };

  async function save(action: string) {
    setSaving(true);
    setSavingAction(action);
    setMessage("");
    setWarning("");
    setError("");
    setValidationIssues([]);

    const payload = promptPayload(values, currentPrompt, action, actionRequestId.current);
    const parsed = recruitmentSetupSchema.safeParse(payload);
    if (!parsed.success && action !== "autosave_draft") {
      const issues = parsed.error.issues.map((issue) => {
        const field = String(issue.path[0] || "setup");
        return { field, label: setupFieldLabel(field), message: issue.message, href: setupFieldAnchors[field] };
      });
      setValidationIssues(issues);
      setError("Please correct the highlighted setup fields before saving.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      setSaving(false);
      setSavingAction("");
      return;
    }

    const level: SetupReadinessLevel = action === "mark_recruitment_ready"
      ? "recruitment-ready"
      : action === "mark_ready_for_publishing" || action === "publish_role"
        ? "ready-for-publishing"
        : "draft";
    const readiness = getSetupReadiness((parsed.success ? parsed.data : payload) as SetupReadinessInput, level);
    if (!readiness.valid && action !== "autosave_draft") {
      setValidationIssues(readiness.missingFields.map((field) => ({ field: field.key, label: field.label, message: "Complete this item before continuing.", href: setupFieldAnchors[field.key] })));
      setError("Please complete the highlighted setup fields before continuing.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      setSaving(false);
      setSavingAction("");
      return;
    }

    let conflictDetected = false;
    try {
      saveInFlight.current = true;
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/recruitment-setup`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, expectedUpdatedAt: expectedVersion }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        if (response.status === 409 && result.code === "ROLE_WRITE_CONFLICT") {
          conflictDetected = true;
          setConflict(true);
          throw new Error("Another browser session saved this setup while you were editing. Your changes were not saved. Reload the latest setup before continuing.");
        }
        throw new Error(result.message || result.error || "Unable to save recruitment setup.");
      }
      const notification = notificationPresentation(result.notificationStatus || "not_configured", result.notificationError);
      const confirmationMessages: Record<string, string> = {
        save_draft: "Changes saved successfully.",
        autosave_draft: "Draft saved automatically.",
        mark_recruitment_ready: "Recruitment setup marked as ready.",
        mark_ready_for_publishing: "Recruitment setup is ready for publishing.",
        publish_role: "Role published successfully.",
      };
      setMessage(confirmationMessages[action] || result.message || "Recruitment setup saved successfully.");
      setWarning([notification.warning, typeof result.voiceSlotWarning === "string" ? result.voiceSlotWarning : ""].filter(Boolean).join(" "));
      setSavedSetupKey(JSON.stringify(values));
      if (typeof result.updatedAt === "string" && result.updatedAt) setExpectedVersion(result.updatedAt);
      actionRequestId.current = globalThis.crypto.randomUUID();
      // Keep the local draft mounted after a normal Save. Reloading the parent
      // immediately can race the workflow's sheet write and make selected
      // checkboxes appear to clear even though the draft was accepted.
      if (action !== "save_draft" && action !== "autosave_draft") onSaved?.(typeof result.status === "string" ? result.status : undefined);
      if (action === "publish_role") {
        router.push("/roles?published=1");
      }
    } catch (caught) {
      setValidationIssues([]);
      const message = caught instanceof Error ? caught.message : "Unable to save recruitment setup.";
      setError(conflictDetected || conflict ? message : `${message} Your entries remain on screen so you can review them before retrying.`);
      // The setup fields are written before the workflow call. Keep the local
      // draft mounted after an error so HR can retry without losing checkbox
      // selections or other in-progress fields.
    } finally {
      setSaving(false);
      setSavingAction("");
      saveInFlight.current = false;
    }
  }

  saveRef.current = save;

  const actionLabel = (action: string, idle: string) => savingAction === action ? action === "publish_role" ? "Publishing…" : "Saving…" : idle;

  return (
    <section id="recruitment-setup" className="card role-section recruitment-editor vapi-setup-editor">
      <div className="card-header">
        <div>
          <span className="eyebrow-dark">RECRUITMENT SETUP</span>
          <h2>AI Phone Interview Setup</h2>
          <p className="section-subtitle">Set up what Smile asks and looks for when she calls candidates for this role.</p>
          {updatedAt && <small>Last saved {formatDate(updatedAt)}{updatedBy ? ` by ${updatedBy}` : ""}</small>}
        </div>
        <span className="setup-readonly">{conflict ? "Refresh required" : editable ? "Editable by HR reviewers" : "Read-only"}</span>
      </div>

      {error && <ValidationSummary error={error} title="Setup save failed" issues={validationIssues} summaryRef={errorSummaryRef} />}
      {conflict && <div className="section" role="alert"><button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>Reload latest saved setup</button></div>}
      {message && <ActionFeedback kind="success" className="vapi-message">{message}</ActionFeedback>}
      {warning && <ActionFeedback kind="warning" className="vapi-message">{warning}</ActionFeedback>}
      {editable && <>
        <div className="vapi-template-bar">
          <div>
            <strong>Reusable interview setup</strong>
            <small>Load a saved setup or start from Smile's standard interview script. Nothing is saved to this role until you click Save.</small>
          </div>
          <div className="vapi-template-actions">
            <button type="button" className="btn btn-secondary" disabled={saving || templateLoading} onClick={applyStandardTemplate}>Load standard script</button>
            <label className="field vapi-template-name">
              <span>Template name</span>
              <input value={templateName} disabled={saving || templateActionId === "saving"} placeholder="Save current setup as a template" onChange={(event) => setTemplateName(event.target.value)} />
            </label>
            <button type="button" className="btn btn-secondary" disabled={saving || templateActionId === "saving"} onClick={() => void saveTemplate()}>Save as template</button>
          </div>
        </div>
        <div className="vapi-template-library">
          <div className="vapi-section-heading">
            <div><span className="vapi-kicker">TEMPLATE LIBRARY</span><h3>Saved interview setups</h3><p>Loading a template replaces the current fields locally. Review the changes and save the role when ready.</p></div>
            <span className="vapi-readonly-badge">{templateLoading ? "Loading..." : `${savedTemplates.length} saved`}</span>
          </div>
          {templateError && <ActionFeedback kind="error" className="vapi-message">{templateError}</ActionFeedback>}
          {savedTemplates.length === 0 && !templateLoading ? (
            <div className="vapi-template-empty">No saved interview templates are available yet.</div>
          ) : (
            <>
              <div className="vapi-template-picker">
                <label className="field">
                  <span>Saved template</span>
                  <select aria-label="Saved recruitment templates" value={selectedTemplateId} disabled={saving || templateLoading} onChange={(event) => {
                    const selected = savedTemplates.find((template) => template.id === event.target.value);
                    if (selected) applyTemplate(selected);
                  }}>
                    <option value="">Choose a saved template</option>
                    {savedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="vapi-template-list">
                {savedTemplates.map((template) => (
                  <div className={`vapi-template-item${selectedTemplateId === template.id ? " is-selected" : ""}`} key={template.id}>
                    <div><strong>{template.name}</strong><small>{template.sourceRoleId ? `Source role ${template.sourceRoleId}` : "No source role recorded"}</small></div>
                    <div className="vapi-template-item-actions">
                      {selectedTemplateId === template.id && <span className="vapi-template-selected">Loaded</span>}
                      <button type="button" className="btn btn-secondary" disabled={saving || templateActionId === template.id} onClick={() => applyTemplate(template)}>Load</button>
                      <button type="button" className="btn btn-secondary" disabled={saving || templateActionId === template.id} onClick={() => void deleteTemplate(template)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </>}
      {setupHasChanges && <div className="vapi-unsaved-notice" role="status"><strong>Unsaved changes</strong><span>These setup changes are local to this editor and will not affect the role until you save.</span></div>}

      <div className="vapi-builder">
        <div className="vapi-section-heading">
          <div><span className="vapi-kicker">HR EDITS THESE SECTIONS</span><h3>Screening instructions</h3><p>Add only the guidance that is specific to this role.</p></div>
        </div>
        <div className="form-grid vapi-form-grid vapi-form-grid-single-column">
        <Field id="vapi-screeningCriteria" label="What should Smile listen for?" value={values.screeningCriteria} onChange={(value) => update("screeningCriteria", value)} disabled={!editable || saving} multiline required placeholder="What evidence should HR and Smile look for in each candidate?" hint="Smile will use this as extra guidance during the call, alongside the fields below." />
          <Field id="vapi-license" label="License or certificate" value={values.licenseOrCertificateRequired} onChange={(value) => update("licenseOrCertificateRequired", value)} disabled={!editable || saving} required={values.licenseRequirementStatus === "Required"} placeholder="Example: CPA preferred" />
          <Field id="vapi-keywords" label="Keywords to look for" value={values.keywordsToLookFor} onChange={(value) => update("keywordsToLookFor", value)} disabled={!editable || saving} placeholder="Separate keywords with commas" />
           <Field id="vapi-transferable-skills" label="Transferable skills accepted" value={values.transferableSkillsAccepted} onChange={(value) => update("transferableSkillsAccepted", value)} disabled={!editable || saving} multiline placeholder="Describe adjacent experience that may be accepted." />
           <Field id="vapi-experience" label="Minimum relevant experience" value={values.minimumYearsOfExperience} onChange={(value) => update("minimumYearsOfExperience", value)} disabled={!editable || saving} placeholder="Example: None, 3 years, or 5+ years" hint="Use None when no experience threshold applies." />
           <Field id="vapi-salary" label="Approved salary or budget range" value={values.salaryOrBudgetRange} onChange={(value) => update("salaryOrBudgetRange", value)} disabled={!editable || saving} placeholder="Example: PHP 45,000 to PHP 60,000 per month" />
           <Field id="vapi-availability" label="Earliest availability instructions" value={values.earliestAvailabilityRule} onChange={(value) => update("earliestAvailabilityRule", value)} disabled={!editable || saving} placeholder="Example: Ask whether the candidate can start within 30 days." />
        </div>
      </div>

      <div className="vapi-builder">
        <div className="vapi-section-heading">
          <div><span className="vapi-kicker">EVALUATION FIELDS</span><h3>What should Smile score or note for this role?</h3><p>Score, recommendation, strengths, and concerns are always included. Add anything extra this role needs — the same list is used for both resume screening and the voice interview.</p></div>
        </div>
        <div className="vapi-baseline-fields">
          <span className="vapi-kicker">Always included</span>
          <div className="vapi-baseline-chip-row">
            {BASELINE_EVALUATION_FIELDS.map((field) => <span className="vapi-chip" key={field.key}>{field.label}</span>)}
          </div>
        </div>
        <fieldset className="vapi-channel-fieldset">
          <legend>Optional fields</legend>
          <div className="vapi-channel-options">
            {EVALUATION_FIELD_CATALOG.map((field) => (
              <label key={field.key} className="vapi-channel-option" title={field.description}>
                <input type="checkbox" checked={normalizeChannels(values.evaluationFieldToggles).includes(field.key)} disabled={!editable || saving} onChange={() => toggleEvaluationField(field.key)} />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="vapi-custom-fields">
          <div className="vapi-section-heading">
            <div><span className="vapi-kicker">CUSTOM FIELDS</span><h4>Add up to 3 fields specific to this role</h4></div>
            <span className="vapi-count-badge">{(values.customEvaluationFields || []).length} of 3</span>
          </div>
          {(values.customEvaluationFields || []).map((customField, index) => (
            <div className="vapi-custom-field-row" key={index}>
              <Field id={`vapi-custom-label-${index}`} label="Field name" value={customField.label} onChange={(value) => updateCustomField(index, { label: value, key: customFieldKey(value) })} disabled={!editable || saving} placeholder="Example: Technical depth" />
              <Field id={`vapi-custom-desc-${index}`} label="What should Smile assess?" value={customField.description} onChange={(value) => updateCustomField(index, { description: value })} disabled={!editable || saving} placeholder="One plain-English sentence, e.g. Assess how deeply the candidate understands the required technical stack." />
              <button type="button" className="btn btn-secondary" disabled={!editable || saving} onClick={() => removeCustomField(index)}>Remove</button>
            </div>
          ))}
          {(values.customEvaluationFields || []).length < 3 && (
            <button type="button" className="btn btn-secondary" disabled={!editable || saving} onClick={addCustomField}>Add custom field</button>
          )}
        </div>
      </div>

      <div className="vapi-builder">
        <div className="vapi-section-heading">
          <div><span className="vapi-kicker">INTERVIEW QUESTIONS</span><h3>What should Smile ask?</h3><p>{(valueText(values.hodScreeningQuestion1) || valueText(values.hodScreeningQuestion2)) ? "HR's questions from the role request come first and can't be edited here. Add your own questions after that, in order — Smile asks all of them exactly as written." : "Write 3 to 5 questions in the order you want them asked. Smile asks them exactly as written, one at a time, and doesn't make up her own."} These questions appear directly in the script preview below.</p></div>
          <span className={`vapi-count-badge ${questions.length >= 3 ? "complete" : ""}`}>{questions.length} of {questionKeys.length} configured · 3 required</span>
        </div>
        <div className={`vapi-question-guidance${missingRequiredQuestionIndexes.length ? " has-missing" : ""}`} role="status">
          <strong>{missingRequiredQuestionIndexes.length ? "Remaining questions to complete" : "Required questions ready"}</strong>
          <p>{missingRequiredQuestionIndexes.length
            ? `${missingRequiredQuestionIndexes.length} required question${missingRequiredQuestionIndexes.length === 1 ? "" : "s"} still need HR's wording before Recruitment Ready.`
            : "Questions 1–3 are complete. Questions 4–5 are optional and can be added for extra role-specific coverage."}</p>
          {missingRequiredQuestionIndexes.length > 0 && (
            <ul>
              {missingRequiredQuestionIndexes.map(({ index }) => <li key={questionKeys[index]}><a href={`#vapi-question-${index + 1}`}>Question {index + 1}</a></li>)}
            </ul>
          )}
          {suggestedQuestions.length === 0 && <small>No AI suggestions are saved for this role yet. Generate guidance from the role description during role creation, or write the questions below manually.</small>}
        </div>
        {suggestedQuestions.length > 0 && (
          <div className="vapi-suggested-questions">
            <div className="vapi-section-heading">
              <div><span className="vapi-kicker">AI SUGGESTIONS</span><h4>Suggested interview questions</h4><p>Review these ideas with HR and enter the final wording in the question fields below.</p></div>
              <span className="vapi-readonly-badge">For review</span>
            </div>
            <ol>
              {suggestedQuestions.map((question, index) => <li key={`${question}-${index}`}><p>{question}</p></li>)}
            </ol>
          </div>
        )}
        <div className="vapi-question-grid">
          {questionKeys.map((key, index) => {
            const lockedFromHr = index === 0 ? valueText(values.hodScreeningQuestion1) : index === 1 ? valueText(values.hodScreeningQuestion2) : "";
            return (
              <label id={`vapi-question-${index + 1}`} className={`vapi-question${lockedFromHr ? " vapi-question-locked" : ""}`} htmlFor={`vapi-question-input-${index + 1}`} key={key}>
                <span><strong>{index + 1}</strong>{`Question ${index + 1}`}{lockedFromHr ? " · from HR" : index < 3 ? " *" : " (optional)"}</span>
                {lockedFromHr ? (
                  <p className="vapi-question-locked-text">{lockedFromHr}</p>
                ) : (
                  <textarea id={`vapi-question-input-${index + 1}`} value={values[key] ?? ""} disabled={!editable || saving} placeholder="Write the exact question Smile should ask." onChange={(event) => update(key, event.target.value)} />
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div id="vapi-preview" className="vapi-preview">
        <div className="vapi-section-heading">
          <div><span className="vapi-kicker">{advancedPrompt ? "ADVANCED" : "SCRIPT PREVIEW"}</span><h3>{advancedPrompt ? "Edit the full interview script" : "See what Smile will say"}</h3><p>{advancedPrompt ? "For advanced use only. Keep the marker that says system_prompt exactly where it is — that's where your field answers above get inserted automatically." : "This includes your questions above and everything else Smile will say on the call, after your answers are filled in."}</p></div>
          <div className="vapi-preview-actions">
            {advancedPrompt && <button type="button" className="btn btn-secondary" disabled={!editable || saving} onClick={() => setAdvancedPrompt(false)}>Back to simple view</button>}
            {!advancedPrompt && <button type="button" className="btn btn-secondary" disabled={!editable || saving} onClick={openAdvancedPrompt}>Advanced: edit full script</button>}
          </div>
        </div>
        {legacyPromptNeedsSync && <div className="vapi-prompt-warning" role="status"><strong>Legacy prompt detected</strong><span>This saved script contains fixed interview questions. The preview and future calls now use the question fields above; save the setup to keep the corrected prompt.</span></div>}
        {advancedPrompt ? (
           <textarea className="vapi-full-prompt" aria-label="Full interview script" value={currentPrompt} disabled={!editable || saving} onChange={(event) => update("aiSystemPrompt", event.target.value)} />
        ) : (
          <details className="vapi-prompt-preview">
            <summary>See a sample call with an example candidate</summary>
            <small>This shows what Smile would say on a real call, using a made-up candidate (&quot;Jamie Cruz&quot;) so you can read it as plain text.</small>
            <pre>{generatedSample}</pre>
          </details>
        )}
      </div>

      <details id="vapi-publishing-checklist" className="vapi-publishing" open>
        <summary><span><strong>Publishing checklist</strong><small>Complete the missing items below before publishing.</small></span><span className="vapi-status-badge">{setupStatus}</span></summary>
        <div className="vapi-publishing-content">
          <fieldset id="vapi-posting-channels" className="vapi-channel-fieldset">
            <legend>Posting channels *</legend>
            {normalizeChannels(values.postingChannels).length === 0 && <small className="vapi-required-help">Choose at least one place to publish this role.</small>}
            <div className="vapi-channel-options">
              {channels.map((channel) => (
                <label key={channel} className="vapi-channel-option">
                  <input type="checkbox" checked={normalizeChannels(values.postingChannels).includes(channel)} disabled={!editable || saving} onChange={() => toggleChannel(channel)} />
                  <span>{channel}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="vapi-policy-grid">
            <label htmlFor="vapi-salary-disclosure"><span>Salary visibility *</span><select required id="vapi-salary-disclosure" value={values.salaryDisclosureStatus || ""} disabled={!editable || saving} onChange={(event) => update("salaryDisclosureStatus", event.target.value)}><option value="">Choose one</option><option>Disclosed</option><option>Not disclosed</option></select></label>
            <label htmlFor="vapi-license-requirement"><span>License requirement *</span><select required id="vapi-license-requirement" value={values.licenseRequirementStatus || ""} disabled={!editable || saving} onChange={(event) => update("licenseRequirementStatus", event.target.value)}><option value="">Choose one</option><option>Required</option><option>Preferred</option><option>Not required</option></select></label>
            <label htmlFor="vapi-hr-interview"><span>Face-to-Face interview *</span><select required id="vapi-hr-interview" value={values.hodInterviewRequired || ""} disabled={!editable || saving} onChange={(event) => update("hodInterviewRequired", event.target.value)}><option value="">Choose one</option><option>Required</option><option>Not required</option></select></label>
          </div>
          {values.hodInterviewRequired === "Required" && (
            <Field
              id="vapi-final-interview-venue"
              label="Face-to-Face interview venue"
              value={values.finalInterviewVenue || ""}
              onChange={(value) => update("finalInterviewVenue", value)}
              disabled={!editable || saving}
              multiline
              required
              placeholder={"Full address, floor / room, arrival instructions, and who to ask for on arrival.\nExample: MCLink Group, 10 Anson Road, #12-05, Singapore 079903. Ask for HR reception on level 12."}
              hint="Included in the candidate's face-to-face interview invitation and calendar event."
            />
          )}
        </div>
      </details>

      <div className="setup-readiness" aria-label="Setup readiness">
        {[{ title: "Draft", readiness: draftReadiness }, { title: "Recruitment ready", readiness: recruitmentReadiness }, { title: "Ready for publishing", readiness: publishingReadiness }].map(({ title, readiness }) => (
          <div className={`setup-readiness-card${readiness.valid ? "" : " has-missing"}`} key={title}>
            <strong>{title}</strong>
            <small>{readiness.valid ? "All required items complete" : `${readiness.missingFields.length} item${readiness.missingFields.length === 1 ? "" : "s"} missing`}</small>
            {!readiness.valid && <ul>{readiness.missingFields.map((field) => <li key={field.key}>{setupFieldAnchors[field.key] ? <a href={setupFieldAnchors[field.key]}>{field.label}</a> : field.label}</li>)}</ul>}
          </div>
        ))}
      </div>

      <div className="setup-action-bar">
        <div className="vapi-save-note"><strong>{editable ? "Review the prompt before saving." : status === "Job Posted" ? "Read-only — this role is already published" : "Read-only setup"}</strong><small>{status === "Job Posted" ? `This is the setup Smile uses for applicants to this role.${updatedByEmail ? ` Last updated by ${updatedByEmail}.` : ""}` : updatedByEmail ? `Last updated by ${updatedByEmail}` : "The standard template remains available for this role."}</small></div>
        <div className="vapi-save-actions">
          {editable && <>
            {setupHasChanges && <button type="button" className="btn btn-secondary" disabled={saving} onClick={resetChanges}>Reset changes</button>}
            <button type="button" className="btn btn-secondary" aria-busy={savingAction === "save_draft"} disabled={saving} onClick={() => void save("save_draft")}>{actionLabel("save_draft", "Save")}</button>
            {canAdvanceWorkflow && <>
              <button type="button" className="btn btn-secondary" aria-busy={savingAction === "mark_recruitment_ready"} disabled={saving || !recruitmentReadiness.valid} onClick={() => void save("mark_recruitment_ready")}>{actionLabel("mark_recruitment_ready", "Mark as Recruitment Ready")}</button>
              <button type="button" className="btn btn-secondary" aria-busy={savingAction === "mark_ready_for_publishing"} disabled={saving || !publishingReadiness.valid} onClick={() => void save("mark_ready_for_publishing")}>{actionLabel("mark_ready_for_publishing", "Mark as Ready for Publishing")}</button>
              <button type="button" className="btn btn-primary" aria-busy={savingAction === "publish_role"} disabled={saving || !publishingReadiness.valid} onClick={() => void save("publish_role")}>{actionLabel("publish_role", "Publish Role")}</button>
            </>}
          </>}
        </div>
      </div>
    </section>
  );
}
