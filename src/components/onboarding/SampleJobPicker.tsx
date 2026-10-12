"use client";

import { useId, useState } from "react";

import UiIcon from "@/components/UiIcon";
import { SAMPLE_JOB_DESCRIPTIONS, sampleJobById, type SampleJobDescription } from "@/lib/sample-catalog";
import styles from "./Onboarding.module.css";

/**
 * "Try a sample job description" for the role form. Choosing, previewing and
 * using a template is free and only fills the form: nothing is saved,
 * generated or published until HR continues with the normal role steps.
 */
export default function SampleJobPicker({ onUse, disabled = false }: { onUse: (job: SampleJobDescription) => void; disabled?: boolean }) {
  const id = useId();
  const [selected, setSelected] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const job = sampleJobById(selected);

  return <div className={styles.samplePicker} data-guide-target="sample-jd">
    <div className={styles.sampleHead}>
      <strong>Try a sample job description</strong>
      <small><span className={styles.sampleBadge}>No credits used</span> Edit anything before you create the role.</small>
    </div>
    <div className={styles.sampleControls}>
      <label className="sr-only" htmlFor={`${id}-select`}>Sample job description</label>
      <select id={`${id}-select`} value={selected} disabled={disabled} onChange={(event) => { setSelected(event.target.value); setPreviewOpen(false); }}>
        <option value="">Select a job description…</option>
        {SAMPLE_JOB_DESCRIPTIONS.map((sample) => <option key={sample.id} value={sample.id}>{sample.title}</option>)}
      </select>
      <button type="button" className={styles.ghost} disabled={!job || disabled} aria-expanded={previewOpen} aria-controls={`${id}-preview`} onClick={() => setPreviewOpen((open) => !open)}>
        {previewOpen ? "Hide preview" : "Preview Template"}
      </button>
      <button type="button" className={styles.cta} disabled={!job || disabled} onClick={() => { if (job) { onUse(job); setPreviewOpen(false); } }}>
        <UiIcon name="check" size={15} />Use This Template
      </button>
    </div>
    {job && <p className={styles.sampleSummary}><strong>{job.title}</strong> · {job.department === "Other" ? "Customer Service" : job.department} · {job.summary}</p>}
    {job && previewOpen && <pre id={`${id}-preview`} className={styles.preview} tabIndex={0} aria-label={`${job.title} sample job description`}>{job.content}</pre>}
  </div>;
}
