"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import LiveAvatarInterview from "@/components/LiveAvatarInterview";
import { countryOptions, CountrySelect } from "@/components/CountryOptions";
import ValidationSummary from "@/components/ValidationSummary";
import { requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import type { LiveAvatarPreparation } from "@/lib/live-avatar-screening";

type RoleOption = {
  roleId: string;
  label: string;
  status?: string;
};

type Props = {
  roleId?: string;
  roleOptions?: RoleOption[];
  submitUrl?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  requireConsent?: boolean;
  showRoleSelect?: boolean;
  liveAvatarRoleTitle?: string;
  enableLiveAvatar?: boolean;
  successRedirectTo?: string;
};

type FormState = {
  candidateName: string;
  email: string;
  countryCode: string;
  localContactNumber: string;
  resumeRoleId: string;
};

const maxResumeFileBytes = 10 * 1024 * 1024;
// Keep client-side MIME checks aligned with server signature and extractor
// checks, including legacy binary Word documents.
const resumeMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

function cleanDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeCountryCode(value: string) {
  const digits = cleanDigits(value).slice(0, 4);
  return digits ? `+${digits}` : "";
}

function normalizedContactNumber(countryCode: string, localNumber: string) {
  return `${normalizeCountryCode(countryCode)}${cleanDigits(localNumber)}`;
}

function readFieldError(errors: Partial<Record<keyof FormState | "resumeFile", string>>, key: keyof FormState | "resumeFile") {
  return errors[key] || "";
}

const fieldLabels: Record<string, string> = {
  candidateName: "Full Name",
  localContactNumber: "Contact Number",
  email: "Email Address",
  resumeRoleId: "Role Applied For",
  resumeFile: "Resume Upload",
};

const fieldAnchors: Record<string, string> = {
  candidateName: "#candidate-name",
  localContactNumber: "#candidate-contact-number",
  email: "#candidate-email",
  resumeRoleId: "#candidate-role",
  resumeFile: "#candidate-resume",
};

export default function CandidateApplicationForm({
  roleId = "",
  roleOptions = [],
  submitUrl = "/api/public/applications",
  title = "Start a resume screening",
  description = "Upload the candidate resume to begin the automated screening process.",
  submitLabel = "Submit My Application",
  requireConsent = true,
  showRoleSelect = false,
  liveAvatarRoleTitle = "",
  enableLiveAvatar = false,
  successRedirectTo,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    candidateName: "",
    email: "",
    countryCode: "+63",
    localContactNumber: "",
    resumeRoleId: roleId,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState | "resumeFile", string>>>({});
  const [saving, setSaving] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [liveAvatarPreparation, setLiveAvatarPreparation] = useState<LiveAvatarPreparation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedRoleLabel = useMemo(
    () => roleOptions.find((option) => option.roleId === form.resumeRoleId)?.label || "",
    [form.resumeRoleId, roleOptions],
  );
  const selectedCountry = countryOptions.find((country) => country.code === form.countryCode) || countryOptions[0];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "candidateName") setLiveAvatarPreparation(null);
    setError("");
    setMessage("");
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  function validate() {
    const nextErrors: Partial<Record<keyof FormState | "resumeFile", string>> = {};
    const contactNumber = normalizedContactNumber(form.countryCode, form.localContactNumber);

    if (!form.candidateName.trim()) nextErrors.candidateName = "Full name is required.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim().toLowerCase())) nextErrors.email = "Enter a valid email address.";
    if (!/^\+[1-9]\d{7,14}$/.test(contactNumber)) nextErrors.localContactNumber = "Enter a valid local contact number.";
    if (!resumeFile) nextErrors.resumeFile = "Choose a PDF, DOC, or DOCX resume file.";
    if (showRoleSelect && !form.resumeRoleId.trim()) nextErrors.resumeRoleId = "Choose a role.";

    setFieldErrors(nextErrors);
    return nextErrors;
  }

  function selectResumeFile(file: File | null) {
    setResumeFile(null);
    setLiveAvatarPreparation(null);
    setFieldErrors((current) => ({ ...current, resumeFile: "" }));
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "doc", "docx"].includes(extension) || !resumeMimeTypes.has(file.type || "application/octet-stream")) {
      setFieldErrors((current) => ({ ...current, resumeFile: "Choose a valid PDF, DOC, or DOCX resume file." }));
      setError("The selected resume file is not supported.");
      return;
    }
    if (file.size > maxResumeFileBytes) {
      setFieldErrors((current) => ({ ...current, resumeFile: "Resume files must be 10 MB or smaller." }));
      setError("The selected resume file is too large.");
      return;
    }
    setResumeFile(file);
    setError("");
    setMessage("");
  }

  async function prepareElla() {
    if (!form.candidateName.trim() || !resumeFile) {
      setError("Enter the candidate name and choose a resume before meeting Ella.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("roleId", form.resumeRoleId || roleId);
      body.append("candidateName", form.candidateName.trim());
      body.append("resumeFile", resumeFile, resumeFile.name);
      const response = await fetch("/api/live-avatar/prepare", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true || !result.preparation) throw new Error(result.error || "Ella could not prepare the resume yet.");
      setLiveAvatarPreparation(result.preparation as LiveAvatarPreparation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ella could not prepare the resume yet.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setSaving(false);
      setError("Please fix the highlighted fields before submitting.");
      return;
    }

    try {
      const contactNumber = normalizedContactNumber(form.countryCode, form.localContactNumber);
      const body = new FormData();
      body.append("candidateName", form.candidateName.trim());
      body.append("email", form.email.trim().toLowerCase());
      body.append("roleId", form.resumeRoleId || roleId);
      // Keep the two existing backend/sheet aliases identical while the UI
      // exposes one contact number only.
      body.append("contactNumber", contactNumber);
      body.append("phone", contactNumber);
      body.append("preferredMobile", contactNumber);
      body.append("applicantCountry", selectedCountry.country);
      body.append("applicationSource", "Direct Application");
      body.append("consent", String(requireConsent));
      if (resumeFile) body.append("resumeFile", resumeFile, resumeFile.name);

      const response = await fetch(submitUrl, { method: "POST", body });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to submit application.");

      const creditsCharged = Number(result.creditsCharged);
      requestEllaCreditsRefresh(Number.isFinite(creditsCharged) && creditsCharged > 0 ? -creditsCharged : undefined);

      setMessage(result.message || `Application submitted. Application ID: ${result.applicationId}`);
      setForm({ candidateName: "", email: "", countryCode: "+63", localContactNumber: "", resumeRoleId: roleId || "" });
      setResumeFile(null);
      setLiveAvatarPreparation(null);
      setFileInputKey((value) => value + 1);
      if (fileInput.current) fileInput.current.value = "";
      setFieldErrors({});
      if (successRedirectTo) router.push(successRedirectTo);
      else router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit application.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-layout candidate-form-layout resume-screening-form" noValidate onSubmit={submit}>
      <div className="form-card candidate-form-card">
        <div className="card-header">
          <div>
            <span className="form-eyebrow">RESUME SCREENING</span>
            <h2>{title}</h2>
            <p>{description}</p>
            {selectedRoleLabel && <small>{selectedRoleLabel}</small>}
          </div>
        </div>

        {error && <ValidationSummary error={error} title="Submission failed" issues={Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([field, message]) => ({ field, label: fieldLabels[field] || field, message, href: fieldAnchors[field] }))} />}
        {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

        <div className="candidate-form-fields">
          <label className="field">
            <span>Full Name *</span>
            <input id="candidate-name" required value={form.candidateName} disabled={saving} onChange={(event) => update("candidateName", event.target.value)} />
            {readFieldError(fieldErrors, "candidateName") && <small>{readFieldError(fieldErrors, "candidateName")}</small>}
          </label>

          <div className="field contact-number-field">
            <span>Contact Number *</span>
            <div className="contact-number-controls">
              <label>
                <CountrySelect ariaLabel="Country code" value={form.countryCode} disabled={saving} onChange={(value) => update("countryCode", value)} />
              </label>
              <label>
                <span className="sr-only">Local contact number</span>
                <input id="candidate-contact-number" required aria-label="Local contact number" inputMode="numeric" placeholder={selectedCountry.placeholder} value={form.localContactNumber} disabled={saving} onChange={(event) => update("localContactNumber", cleanDigits(event.target.value))} />
              </label>
            </div>
            <small>Enter the local number only, without the country code.</small>
            {readFieldError(fieldErrors, "localContactNumber") && <small>{readFieldError(fieldErrors, "localContactNumber")}</small>}
          </div>

          <label className="field">
            <span>Email Address *</span>
            <input id="candidate-email" required type="email" value={form.email} disabled={saving} onChange={(event) => update("email", event.target.value)} />
            {readFieldError(fieldErrors, "email") && <small>{readFieldError(fieldErrors, "email")}</small>}
          </label>

          {showRoleSelect ? (
            <label className="field">
              <span>Role Applied For *</span>
              <select id="candidate-role" required value={form.resumeRoleId} disabled={saving} onChange={(event) => update("resumeRoleId", event.target.value)}>
                <option value="">Select a role</option>
                {roleOptions.map((option) => <option key={option.roleId} value={option.roleId}>{option.label}</option>)}
              </select>
              {readFieldError(fieldErrors, "resumeRoleId") && <small>{readFieldError(fieldErrors, "resumeRoleId")}</small>}
            </label>
          ) : <input type="hidden" name="roleId" value={form.resumeRoleId || roleId} />}

          <div className="field full resume-upload-field">
            <span>Resume Upload *</span>
            <label className="resume-file-picker">
                <input
                id="candidate-resume"
                key={fileInputKey}
                ref={fileInput}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={saving}
                onChange={(event) => selectResumeFile(event.target.files?.[0] || null)}
              />
              <span className="resume-file-button">Choose a resume file</span>
              <span className="resume-file-name">{resumeFile?.name || "No file selected"}</span>
            </label>
            <small>PDF, DOC, or DOCX · up to 10 MB</small>
            {readFieldError(fieldErrors, "resumeFile") && <small>{readFieldError(fieldErrors, "resumeFile")}</small>}
            {enableLiveAvatar && <div className="resume-avatar-action"><div><strong>Run Ella's resume-led screen</strong><small>Ella will analyze the candidate's resume, prepare one relevant question, and show you a response summary.</small></div><button type="button" className="btn btn-secondary" disabled={saving || !form.candidateName.trim() || !resumeFile} onClick={() => void prepareElla()}>{saving ? "Analyzing resume..." : liveAvatarPreparation ? "Re-analyze resume" : "Analyze resume & prepare Ella"}</button></div>}
          </div>
        </div>

        {enableLiveAvatar && liveAvatarPreparation && <LiveAvatarInterview roleId={form.resumeRoleId || roleId} roleTitle={liveAvatarRoleTitle || selectedRoleLabel || "this role"} candidateName={form.candidateName.trim()} preparation={liveAvatarPreparation} />}

        <div className="candidate-form-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Submitting..." : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}
