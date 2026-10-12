"use client";

import { useEffect, useId, useState } from "react";

import UiIcon from "@/components/UiIcon";
import { SAMPLE_RESUMES, sampleJobById, sampleResumeById, type SampleResume } from "@/lib/sample-catalog";
import styles from "./Onboarding.module.css";

/**
 * "Try a sample resume" for HR's single-resume screening form. Choosing and
 * previewing a sample is free; it only fills the form with a fictional
 * candidate. Screening still runs through the normal pipeline, charged only
 * when HR presses Screen resume and Smile finishes the screening.
 */
export default function SampleResumePicker({ recommendedId, onUse, disabled = false }: { recommendedId: string; onUse: (resume: SampleResume) => void; disabled?: boolean }) {
  const id = useId();
  const [selected, setSelected] = useState(recommendedId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const resume = sampleResumeById(selected);

  // Follow the recommendation when HR picks a role created from a sample JD.
  useEffect(() => {
    if (recommendedId) { setSelected(recommendedId); setPreviewOpen(false); }
  }, [recommendedId]);

  return <div className={styles.samplePicker} data-guide-target="sample-resume">
    <div className={styles.sampleHead}>
      <strong>Try a sample resume</strong>
      <small><span className={styles.sampleBadge}>Fictional candidate</span> Never contacted. Free to preview.</small>
    </div>
    <div className={styles.sampleControls}>
      <label className="sr-only" htmlFor={`${id}-select`}>Sample resume</label>
      <select id={`${id}-select`} value={selected} disabled={disabled} onChange={(event) => { setSelected(event.target.value); setPreviewOpen(false); }}>
        <option value="">Select a sample resume…</option>
        {SAMPLE_RESUMES.map((sample) => <option key={sample.id} value={sample.id}>{sample.label}{sample.id === recommendedId ? " (recommended for this role)" : ""}</option>)}
      </select>
      <button type="button" className={styles.ghost} disabled={!resume || disabled} aria-expanded={previewOpen} aria-controls={`${id}-preview`} onClick={() => setPreviewOpen((open) => !open)}>
        {previewOpen ? "Hide preview" : "Preview Resume"}
      </button>
      <button type="button" className={styles.cta} disabled={!resume || disabled} onClick={() => { if (resume) { onUse(resume); setPreviewOpen(false); } }}>
        <UiIcon name="check" size={15} />Use This Sample
      </button>
    </div>
    {resume && <p className={styles.sampleSummary}>
      {resume.id === recommendedId && <span className={`${styles.sampleBadge} ${styles.recommended}`}>Recommended sample</span>}{" "}
      <strong>{resume.candidate.name}</strong> · {resume.summary} Written for the {sampleJobById(resume.intendedJobId)?.title} sample role; Smile&apos;s screening decides the actual result.
    </p>}
    {resume && previewOpen && <iframe id={`${id}-preview`} className={styles.previewFrame} title={`Sample resume: ${resume.candidate.name}`} src={`/api/samples/resumes/${encodeURIComponent(resume.id)}`} />}
    {resume && previewOpen && <a className={styles.linkButton} href={`/api/samples/resumes/${encodeURIComponent(resume.id)}`} target="_blank" rel="noreferrer">Open the PDF in a new tab</a>}
  </div>;
}
