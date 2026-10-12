"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import { countryOptions, CountrySelect } from "@/components/CountryOptions";
import { internationalNumber, phoneGuide, phonePlaceholder, phoneProblem } from "@/lib/phone-guide";
import ValidationSummary from "@/components/ValidationSummary";
import { requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import { clientErrorMessage } from "@/lib/client-error";
import SampleResumePicker from "@/components/onboarding/SampleResumePicker";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { requestOnboardingRefresh, showGuide } from "@/lib/onboarding-events";
import { sampleJobById, type SampleResume } from "@/lib/sample-catalog";

type RoleOption = {
  roleId: string;
  label: string;
  status?: string;
};

type Props = {
  roleId?: string;
  organizationId?: string;
  roleOptions?: RoleOption[];
  submitUrl?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  requireConsent?: boolean;
  showRoleSelect?: boolean;
  submitInUploadCard?: boolean;
  successRedirectTo?: string;
  /** HR screening only: offer the built-in sample resumes. */
  allowSamples?: boolean;
};

type FormState = {
  candidateName: string;
  email: string;
  countryCode: string;
  country: string;
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
  organizationId = "",
  roleOptions = [],
  submitUrl = "/api/public/applications",
  title = "Start a resume screening",
  description = "Upload the candidate resume to begin the automated screening process.",
  submitLabel = "Submit My Application",
  requireConsent = true,
  showRoleSelect = false,
  submitInUploadCard = false,
  successRedirectTo,
  allowSamples = false,
}: Props) {
  const router = useRouter();
  const { state: onboarding } = useOnboarding();
  // Candidates apply through the public form and must agree to the privacy
  // notice themselves. HR staff screening a resume on someone's behalf (the
  // role picker variant) handle consent outside this form.
  const needsConsentCheckbox = requireConsent && !showRoleSelect;
  const [consentGiven, setConsentGiven] = useState(false);
  const [form, setForm] = useState<FormState>({
    candidateName: "",
    email: "",
    countryCode: "+63",
    country: "PH",
    localContactNumber: "",
    resumeRoleId: roleId,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState | "resumeFile", string>>>({});
  const [saving, setSaving] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  // A built-in sample: the server supplies its PDF and fixed fictional details.
  const [sample, setSample] = useState<SampleResume | null>(null);
  const [credit, setCredit] = useState<{ available: number; cost: number } | null>(null);
  const [creditShortfall, setCreditShortfall] = useState(false);
  const sampleRoles = onboarding?.sampleRecommendations ?? {};
  const recommendedSampleId = sampleJobById(sampleRoles[form.resumeRoleId])?.matchingResumeId || "";
  const suggestedRole = sample && !form.resumeRoleId ? roleOptions.find((option) => sampleRoles[option.roleId] === sample.intendedJobId) : undefined;

  // HR sees the screening cost and the organization's shared balance before submitting.
  useEffect(() => {
    if (!showRoleSelect) return;
    let active = true;
    fetch("/api/ella-credits/balance", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active || data?.success !== true) return;
        const available = Number(data.available ?? data.balance);
        const cost = Number(data.pricing?.cvAnalysis ?? 1);
        if (Number.isFinite(available)) setCredit({ available, cost: Number.isFinite(cost) && cost > 0 ? cost : 1 });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [showRoleSelect, message]);

  function applySampleResume(resume: SampleResume) {
    const country = countryOptions.find((option) => option.country === resume.candidate.country);
    const local = country ? resume.candidate.phone.replace(country.code, "") : resume.candidate.phone.replace(/^\+/, "");
    setSample(resume);
    setForm((current) => ({ ...current, candidateName: resume.candidate.name, email: resume.candidate.email, country: country?.country || current.country, countryCode: country?.code || current.countryCode, localContactNumber: local }));
    setResumeFile(null);
    setFileInputKey((value) => value + 1);
    setFieldErrors({});
    setError("");
    setMessage("");
    setCreditShortfall(false);
    window.setTimeout(() => showGuide("screen-submit", `${resume.candidate.name}'s sample resume is ready. Choose the role to screen against, check the credit cost, then press Screen resume.`), 150);
  }

  function clearSample() {
    setSample(null);
    setForm((current) => ({ ...current, candidateName: "", email: "", countryCode: "+63", country: "PH", localContactNumber: "" }));
  }

  const selectedRoleLabel = useMemo(
    () => roleOptions.find((option) => option.roleId === form.resumeRoleId)?.label || "",
    [form.resumeRoleId, roleOptions],
  );
  const selectedCountry = countryOptions.find((country) => country.country === form.country)
    || countryOptions.find((country) => country.code === form.countryCode)
    || countryOptions[0];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  function updateCountry(country: (typeof countryOptions)[number]) {
    setForm((current) => ({ ...current, country: country.country, countryCode: country.code }));
    setError("");
    setMessage("");
    setFieldErrors((current) => ({ ...current, localContactNumber: "" }));
  }

  function validate() {
    const nextErrors: Partial<Record<keyof FormState | "resumeFile", string>> = {};

    // A sample's details and file come from the server, so only the role is checked.
    if (!sample) {
      if (!form.candidateName.trim()) nextErrors.candidateName = "Full name is required.";
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim().toLowerCase())) nextErrors.email = "Enter a valid email address.";
      const contactProblem = phoneProblem(selectedCountry, form.localContactNumber);
      if (contactProblem) nextErrors.localContactNumber = contactProblem;
      if (!resumeFile) nextErrors.resumeFile = "Choose a PDF, DOC, or DOCX resume file, or use a sample resume.";
    }
    if (showRoleSelect && !form.resumeRoleId.trim()) nextErrors.resumeRoleId = "Choose a role.";

    setFieldErrors(nextErrors);
    return nextErrors;
  }

  function selectResumeFile(file: File | null) {
    setResumeFile(null);
    // Clear the native input after a rejected pick so the same file can be
    // re-chosen and the form never keeps a stale, unusable selection.
    const rejectFile = () => { if (fileInput.current) fileInput.current.value = ""; };
    setFieldErrors((current) => ({ ...current, resumeFile: "" }));
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "doc", "docx"].includes(extension) || !resumeMimeTypes.has(file.type || "application/octet-stream")) {
      setFieldErrors((current) => ({ ...current, resumeFile: "Choose a valid PDF, DOC, or DOCX resume file." }));
      setError("The selected resume file is not supported.");
      rejectFile();
      return;
    }
    if (file.size > maxResumeFileBytes) {
      setFieldErrors((current) => ({ ...current, resumeFile: "Resume files must be 10 MB or smaller." }));
      setError("The selected resume file is too large.");
      rejectFile();
      return;
    }
    setResumeFile(file);
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    setCreditShortfall(false);

    const validation = validate();
    if (Object.keys(validation).length > 0) {
      setSaving(false);
      setError("Please fix the highlighted fields before submitting.");
      return;
    }

    try {
      const contactNumber = internationalNumber(selectedCountry, form.localContactNumber);
      if (needsConsentCheckbox && !consentGiven) {
        setError("Please confirm you have read the privacy notice and agree before submitting.");
        return;
      }
      const body = new FormData();
      body.append("candidateName", form.candidateName.trim());
      body.append("email", form.email.trim().toLowerCase());
      body.append("roleId", form.resumeRoleId || roleId);
      if (organizationId.trim()) body.append("organizationId", organizationId.trim());
      // Keep the two existing backend/sheet aliases identical while the UI
      // exposes one contact number only.
      body.append("contactNumber", contactNumber);
      body.append("phone", contactNumber);
      body.append("preferredMobile", contactNumber);
      body.append("applicantCountry", selectedCountry.country);
      body.append("applicationSource", "Direct Application");
      body.append("consent", String(requireConsent));
      if (sample) body.append("sampleResumeId", sample.id);
      else if (resumeFile) body.append("resumeFile", resumeFile, resumeFile.name);

      const response = await fetch(submitUrl, { method: "POST", body });
      const result = await response.json();
      // Not enough credits: keep the role and sample selected so HR can retry after topping up.
      if (response.status === 402) setCreditShortfall(true);
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to submit application.");
      requestOnboardingRefresh();

      const creditsCharged = Number(result.creditsCharged);
      requestEllaCreditsRefresh(Number.isFinite(creditsCharged) && creditsCharged > 0 ? -creditsCharged : undefined);

      setMessage(result.message || `Application submitted. Application ID: ${result.applicationId}`);
      setForm({ candidateName: "", email: "", countryCode: "+63", country: "PH", localContactNumber: "", resumeRoleId: roleId || "" });
      setResumeFile(null);
      setSample(null);
      setConsentGiven(false);
      setFileInputKey((value) => value + 1);
      if (fileInput.current) fileInput.current.value = "";
      setFieldErrors({});
      if (successRedirectTo) router.push(successRedirectTo);
      else router.refresh();
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to submit application."));
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
            <input id="candidate-name" required value={form.candidateName} disabled={saving} readOnly={Boolean(sample)} onChange={(event) => update("candidateName", event.target.value)} />
            {readFieldError(fieldErrors, "candidateName") && <small>{readFieldError(fieldErrors, "candidateName")}</small>}
          </label>

          <div className="field contact-number-field">
            <span>Contact Number *</span>
            <div className="contact-number-controls">
              <label>
                <CountrySelect ariaLabel="Country code" value={form.country} disabled={saving || Boolean(sample)} onChange={updateCountry} />
              </label>
              <label>
                <span className="sr-only">Local contact number</span>
                <input id="candidate-contact-number" required aria-label="Local contact number" inputMode="numeric" placeholder={phonePlaceholder(selectedCountry)} value={form.localContactNumber} disabled={saving} readOnly={Boolean(sample)} onChange={(event) => update("localContactNumber", cleanDigits(event.target.value))} />
              </label>
            </div>
            <small>{phoneGuide(selectedCountry)}</small>
            {readFieldError(fieldErrors, "localContactNumber") && <small>{readFieldError(fieldErrors, "localContactNumber")}</small>}
          </div>

          <label className="field">
            <span>Email Address *</span>
            <input id="candidate-email" required type="email" value={form.email} disabled={saving} readOnly={Boolean(sample)} onChange={(event) => update("email", event.target.value)} />
            {readFieldError(fieldErrors, "email") && <small>{readFieldError(fieldErrors, "email")}</small>}
          </label>

          {showRoleSelect ? (
            <label className="field">
              <span>Role Applied For *</span>
              <select id="candidate-role" required value={form.resumeRoleId} disabled={saving || roleOptions.length === 0} onChange={(event) => update("resumeRoleId", event.target.value)}>
                <option value="">{roleOptions.length === 0 ? "No published roles available" : "Select a role"}</option>
                {roleOptions.map((option) => <option key={option.roleId} value={option.roleId}>{option.label}</option>)}
              </select>
              {roleOptions.length === 0 && <small>No published roles are available for your organization.</small>}
              {readFieldError(fieldErrors, "resumeRoleId") && <small>{readFieldError(fieldErrors, "resumeRoleId")}</small>}
              {suggestedRole && <small>Suggested role for this sample: <button type="button" className="inline-link-button" onClick={() => update("resumeRoleId", suggestedRole.roleId)}>{suggestedRole.label}</button></small>}
            </label>
          ) : <input type="hidden" name="roleId" value={form.resumeRoleId || roleId} />}

          <div className="field full resume-upload-field">
            <span>Resume Upload *</span>
            {sample ? (
              <div className="sample-applied" role="status">
                <span><strong>Sample resume:</strong> {sample.fileName} · fictional candidate, never contacted. <a href={`/api/samples/resumes/${encodeURIComponent(sample.id)}`} target="_blank" rel="noreferrer">Preview</a></span>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={clearSample}>Remove sample</button>
              </div>
            ) : <>
              <label className="resume-file-picker" data-guide-target="resume-upload">
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
            </>}
            {readFieldError(fieldErrors, "resumeFile") && <small>{readFieldError(fieldErrors, "resumeFile")}</small>}
            {allowSamples && !sample && <>
              <div className="sample-divider" aria-hidden="true">OR</div>
              <SampleResumePicker recommendedId={recommendedSampleId} onUse={applySampleResume} disabled={saving} />
            </>}
            {submitInUploadCard && <div className="resume-inline-submit" data-guide-target="screen-submit"><div><strong>Ready to screen this resume?</strong><small>{roleOptions.length === 0 && showRoleSelect
              ? "Publish a role for your organization before starting a CV analysis."
              : credit
                ? `Screening uses ${credit.cost} Smile Credit${credit.cost === 1 ? "" : "s"} from your organization's shared balance (${credit.available} available), charged when Smile finishes the screening. Choosing or previewing a sample is free.`
                : "Start the billable CV screening and save the screening record. Screening uses 1 Smile Credit."}</small>
              {credit && credit.available < credit.cost && <small className="resume-credit-warning">Not enough Smile Credits to screen. <Link href="/credits">Add credits</Link>, then come back. Your selections stay here.</small>}
            </div><button type="submit" className="btn btn-primary" disabled={saving || (showRoleSelect && roleOptions.length === 0)}>{saving ? "Starting..." : submitLabel}</button></div>}
            {creditShortfall && <ActionFeedback kind="error">Your organization doesn&apos;t have enough Smile Credits to screen this resume, so nothing was charged or saved. <Link href="/credits">Open Credits</Link> to add more; your role and sample are still selected.</ActionFeedback>}
          </div>
        </div>

        {needsConsentCheckbox && (
          <label className="field consent-check" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" checked={consentGiven} onChange={(event) => setConsentGiven(event.target.checked)} style={{ marginTop: 4 }} />
            <span>I have read the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a> and agree that my details and resume may be processed for this application, including AI-assisted screening and interviews that may be recorded. A person reviews every hiring decision.</span>
          </label>
        )}
        {!submitInUploadCard && <div className="candidate-form-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Submitting..." : submitLabel}</button></div>}
      </div>
    </form>
  );
}
