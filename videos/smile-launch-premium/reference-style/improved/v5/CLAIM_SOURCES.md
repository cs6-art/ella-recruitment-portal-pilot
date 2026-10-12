# V5 claim sources

V5 carries forward the verified workflow shown in V4. Its new animation changes only how existing evidence is revealed; it does not add new product behavior.

## Product behavior shown

| Video statement or action | Source |
|---|---|
| HR reviews and publishes a role with criteria and interview questions. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → end-to-end workflow, steps 1–2. |
| A candidate applies with contact details and a resume and acknowledges the privacy notice. | `docs/WORKING-RECRUITMENT-WORKFLOW.md` → candidate path, step 1; `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 3. |
| CV analysis compares a resume with role criteria and provides a 0–100 match score with reviewable evidence. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 4; the score is a review aid, not a verdict. |
| HR reviews CV evidence and can approve, reject or separately send an enabled interview. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 5; `src/components/ApplicantDecisionPanel.tsx` → separate decision and send-interview actions. |
| Voice and Live Avatar are role-enabled alternatives; this example follows Voice. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → steps 2, 5 and 6. |
| The Voice interview is a 10-minute phone call; its response returns as evidence for HR review. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → steps 6–7; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → steps 4–6. |
| HR reviews interview evidence before deciding whether the candidate advances. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 7; `src/components/ApplicantDecisionPanel.tsx` → voice-stage review and explicit HR actions. |
| After HR approval, a candidate may select one available hour from configured interviewer/HR calendar availability. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 8; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → step 7. |

## Synthetic-only content

- Maya Chen, the resume file and the Product Marketing Lead role are demonstration data.
- The 82/100 match, resume excerpt, question, response, transcript, evidence strength and follow-up area are illustrative.
- The three one-hour slots are synthetic availability. The selected slot is not a booking.

## Deliberately omitted

- No duration is assigned to Live Avatar because the pilot duration is not confirmed consistently in repository sources.
- No AI hiring decision or automatic calendar booking is represented.
