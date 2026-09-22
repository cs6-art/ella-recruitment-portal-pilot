"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ValidationSummary, { type ValidationIssue } from "@/components/ValidationSummary";
import { countryOptions, CountrySelect } from "@/components/CountryOptions";

type ApplicantEditValues = { applicationId: string; candidateName: string; email: string; contactNumber: string; roleId: string; selectedRole: string; department: string; applicantCountry: string };

export default function ApplicantEditForm({ applicant }: { applicant: ApplicantEditValues }) {
  const router = useRouter();
  const [candidateName, setCandidateName] = useState(applicant.candidateName);
  const [email, setEmail] = useState(applicant.email);
  const initialCountry = countryOptions.find((country) => applicant.contactNumber.replace(/\D/g, "").replace(/^00/, "").startsWith(country.code.slice(1))) || countryOptions[0];
  const initialLocalNumber = applicant.contactNumber.replace(/\D/g, "").replace(/^00/, "").startsWith(initialCountry.code.slice(1)) ? applicant.contactNumber.replace(/\D/g, "").replace(/^00/, "").slice(initialCountry.code.length - 1) : applicant.contactNumber.replace(/\D/g, "");
  const [countryCode, setCountryCode] = useState(initialCountry.code);
  const [localNumber, setLocalNumber] = useState(initialLocalNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setFieldErrors({});
    const issues: ValidationIssue[] = [];
    if (candidateName.trim().length < 3) issues.push({ field: "candidateName", label: "Full name", message: "Enter at least 3 characters.", href: "#applicant-edit-name" });
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) issues.push({ field: "email", label: "Email address", message: "Enter a valid email address.", href: "#applicant-edit-email" });
    const digits = localNumber.replace(/\D/g, "");
    const validLocalNumber = countryCode === "+63"
      ? /^\d{10}$/.test(digits)
      : countryCode === "+65"
        ? /^\d{8}$/.test(digits)
        : /^\d{8,10}$/.test(digits);
    if (!validLocalNumber) issues.push({ field: "localNumber", label: "Preferred mobile number", message: `Enter a valid local ${selectedCountry.label} mobile number.`, href: "#applicant-edit-mobile" });
    if (issues.length > 0) {
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field || issue.label, issue.message])));
      setError("Please correct the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const selectedCountry = countryOptions.find((country) => country.code === countryCode) || countryOptions[0];
      const preferredMobile = `${countryCode}${localNumber.replace(/\D/g, "")}`;
      const response = await fetch(`/api/applicants/${encodeURIComponent(applicant.applicationId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ candidateName, email, preferredMobile, applicantCountry: selectedCountry.country }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        const field = data.field === "preferredMobile" ? "localNumber" : data.field;
        if (typeof field === "string" && typeof data.error === "string") setFieldErrors({ [field]: data.error });
        throw new Error(data.error || "Unable to update the applicant.");
      }
      router.push(`/applicants/${encodeURIComponent(applicant.applicationId)}?updated=1`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the applicant.");
      setSaving(false);
    }
  }

  const selectedCountry = countryOptions.find((country) => country.code === countryCode) || countryOptions[0];
  return <section className="card applicant-edit-card"><div className="card-header"><div><Link className="portal-back-link applicant-back-link" href={`/applicants/${encodeURIComponent(applicant.applicationId)}`}>← Back to applicant</Link><h1>Edit applicant</h1><p>Update the candidate&apos;s contact details without changing their workflow history.</p></div></div>{error && <ValidationSummary error={error} title="Save failed" issues={Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([field, message]) => ({ field, label: field === "candidateName" ? "Full name" : field === "localNumber" ? "Preferred mobile number" : "Email address", message, href: field === "candidateName" ? "#applicant-edit-name" : field === "localNumber" ? "#applicant-edit-mobile" : "#applicant-edit-email" }))} />}<form className="applicant-edit-form" noValidate onSubmit={(event) => void submit(event)}><div className="applicant-edit-meta"><div><span>Application ID</span><strong>{applicant.applicationId}</strong></div><div><span>Role</span><strong>{applicant.selectedRole || applicant.roleId}</strong><small>{applicant.department}</small></div></div><label>Full name *<input id="applicant-edit-name" required minLength={3} maxLength={150} value={candidateName} aria-invalid={Boolean(fieldErrors.candidateName)} onChange={(event) => { setCandidateName(event.target.value); setFieldErrors((current) => ({ ...current, candidateName: "" })); }} />{fieldErrors.candidateName && <small className="field-error">{fieldErrors.candidateName}</small>}</label><label>Email address *<input id="applicant-edit-email" required type="email" value={email} aria-invalid={Boolean(fieldErrors.email)} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: "" })); }} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</label><label>Preferred mobile number *<div className="contact-number-controls"><CountrySelect ariaLabel="Country code" value={countryCode} onChange={setCountryCode} /><input id="applicant-edit-mobile" required inputMode="numeric" placeholder={selectedCountry.placeholder} value={localNumber} aria-invalid={Boolean(fieldErrors.localNumber)} onChange={(event) => { setLocalNumber(event.target.value.replace(/\D/g, "")); setFieldErrors((current) => ({ ...current, localNumber: "" })); }} /></div><small>Enter the local number only, without the country code.</small>{fieldErrors.localNumber && <small className="field-error">{fieldErrors.localNumber}</small>}</label><div className="applicant-edit-actions"><Link className="btn btn-secondary" href={`/applicants/${encodeURIComponent(applicant.applicationId)}`}>Cancel</Link><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div></form></section>;
}
