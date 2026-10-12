# Reference-to-Smile scene map

Primary visual reference: [Hera, Your AI Motion Designer (Demo)](https://www.youtube.com/watch?v=Lwnxr6VW4B8). The timestamps are approximate, based on the 30-second player and YouTube storyboard tiles. The seven-second proof adapts the reference's compact, staged reveal while showing a real Smile HR workflow reconstructed from the portal source.

**Product boundary:** Hera's prompt capsule is part of its own generative-design interface. The Smile portal does not have that prompt interface, so the proof uses the actual Resume Screening and Applicant Review screens instead. Style is borrowed from the reference; product actions and labels are drawn from Smile's source.

## Reference to Smile translation

| Reference time | Reference visual beat | Smile workflow shown in a full ad | Style treatment |
|---|---|---|---|
| 0–3s | Centered brand mark and tagline form on the warm grid. | Introduce the Smile Recruitment Portal Pilot with a short hiring message. | Keep a restrained central reveal on the same warm field; use the Smile mark and copy only. |
| 4–8s | A capsule focuses the frame and text types on. | Show the real HR Resume Screening page: select a published role, add resumes from a computer or connected storage, and submit them for screening. | Replace the prompt with the source-faithful role selector, upload area, source options, and selected-file list. Keep the panel compact on the warm grid. Do not imply the portal has a generative prompt. |
| 9–12s | A result card appears above the capsule; its rows arrive askew and settle. | Show processing states in the screening records, then HR opens the processed applicants and sees the saved CV analysis. | Use the reference's stagger and settle on real status/evidence rows. Keep the upload workflow and the saved result visually distinct. |
| 13–14s | The result clears and a new prompt begins. | Navigate from Resume Screening to the Applicants list, then open the selected candidate's review page. | Treat these as actual page changes, with the portal sidebar persisting and the active Applicants item moving into focus. |
| 15–21s | A narrow phone-style example grows in; text and pointer animate. | At the later candidate stage, show only the interview route enabled for that role. Voice uses a candidate-booked time; Live Avatar uses its one-time invitation link and requires recording, camera, and microphone consent. | Build from the invitation wording and actual role settings. Do not depict an interview result before it exists. This stage is outside the short proof. |
| 22–26s | The camera pulls out to a dense gallery of generated work. | Show later workflow milestones such as interview review and face-to-face scheduling. | Pull back from portal artifacts; avoid a gallery of unrelated or fabricated product screens. This stage is outside the short proof. |
| 27–30s | The gallery resolves to the centered brand lockup and domain capsule. | End with Smile and the requested CTA **Try Smile now**. | Keep the warm field, simple center alignment, and one restrained CTA pulse. This stage is outside the short proof. |

## Seven-second proof

The proof shows the HR bulk-screening route, not a candidate typing a prompt:

1. **Resume Screening:** HR has selected a role and added demo resume files. The UI shows the actual computer-upload drop zone and the Google Drive / OneDrive options supported by the portal (cloud choices depend on connection or configuration).
2. **Screening:** the screen action leads into the actual queued processing states. `Screened`, `Bulk screening completed`, and `View Processed Applicants` reflect the portal's workflow labels; the compressed screen time is not a processing-time claim.
3. **Applicants list:** `View Processed Applicants` opens the Applicants list. HR chooses the sample applicant using the visible `View` action.
4. **Applicant review:** the portal reveals the real CV review fields: status, recommendation, HR decision, analysis summary, strengths, gaps, and the role settings Smile applied. Approve and Reject remain HR controls; the clip does not execute either decision.

Every candidate, role, score, recommendation, summary, strength, and gap is visibly marked as illustrative demo data. No real applicant records or outcomes are shown. The candidate-application, interview, and face-to-face stages remain for the full ad after the visual direction is approved.

## Source of product facts

- `README.md` — supported intake methods and high-level capabilities.
- `docs/WORKING-RECRUITMENT-WORKFLOW.md` — candidate and HR flow from application through face-to-face interview.
- `src/app/resume-screening/page.tsx` and `src/components/BulkResumeScreeningPanel.tsx` — HR role selection, resume intake, supported sources, screening states, and processed-applicant navigation.
- `src/app/applicants/[applicationId]/page.tsx` and `src/components/ApplicantDecisionPanel.tsx` — CV evidence, role settings, and human review actions.
