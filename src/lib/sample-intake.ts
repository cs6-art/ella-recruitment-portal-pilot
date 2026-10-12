import type { CandidateIntakeRequest } from "@/lib/candidate-intake";
import { sampleResumeById, type SampleResume } from "@/lib/sample-catalog";
import { renderSampleResumePdf } from "@/lib/sample-resume-pdf";

export type SampleIntake = { sample: SampleResume | null; error: string };

/**
 * When HR picks a built-in sample resume, the server supplies the file and the
 * candidate details itself. Whatever the browser sent for name, email or phone
 * is replaced by the sample's fictional values, so a sample application can
 * never carry a real person's contact details.
 */
export function applySampleResume(intake: CandidateIntakeRequest): SampleIntake {
  const requested = String(intake.body.sampleResumeId ?? "").trim();
  if (!requested) return { sample: null, error: "" };
  const sample = sampleResumeById(requested);
  if (!sample) return { sample: null, error: "Unknown sample resume." };
  const { candidate } = sample;
  intake.body.candidateName = candidate.name;
  intake.body.email = candidate.email;
  intake.body.contactNumber = candidate.phone;
  intake.body.phone = candidate.phone;
  intake.body.preferredMobile = candidate.phone;
  intake.body.applicantCountry = candidate.country;
  const bytes = renderSampleResumePdf(sample);
  intake.resumeFile = new File([bytes as BlobPart], sample.fileName, { type: "application/pdf" });
  return { sample, error: "" };
}
