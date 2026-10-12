# V7 Claim Sources

The V7 visuals use the repository's verified recruitment workflow. Candidate content, role details, interview answers, and availability in the video are synthetic examples.

## Product behavior shown

| Video statement or action | Source and qualification |
|---|---|
| AI drafts role details, screening criteria, and interview questions; HR reviews and publishes the role. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow steps 1–2. The publish control and result are illustrated in the source builder. |
| A resume is assessed against role criteria and supporting evidence is shown to HR. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow step 4. V7 removes the numeric match score. |
| HR approves the CV and separately sends the interview invitation. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow step 5; `src/components/ApplicantDecisionPanel.tsx` → distinct HR decision and send-invitation actions. |
| Voice and Live Avatar are alternative interview formats; this example follows Voice. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow steps 2, 5, and 6. Only Voice is demonstrated as a completed interview. |
| The Voice interview example is a 10-minute phone call; its answer returns as reviewable evidence. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow steps 6–7; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → steps 4–6. |
| HR reviews the transcript and summary, then decides whether the candidate advances. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow step 7; `src/components/ApplicantDecisionPanel.tsx` → explicit human review actions. |
| After HR approval, the candidate may choose an available one-hour slot. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → workflow step 8; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → step 7. Real availability depends on connected/configured calendars. |

## Synthetic content and limits

- Maya Chen, Product Marketing Lead, the resume excerpt, role criteria, phone question and answer, transcript, AI summary, and all displayed times are synthetic demo data.
- The interview answer and summary do not establish an actual candidate assessment or a hiring recommendation.
- The selected time is explicitly **Selected · not booked**; the video does not claim that an appointment was created.
- No numeric match score or automated hiring decision appears in V7.
- No duration or completed flow is claimed for Live Avatar; it appears only as an alternative.
- The CTA is **Try Smile now**.
