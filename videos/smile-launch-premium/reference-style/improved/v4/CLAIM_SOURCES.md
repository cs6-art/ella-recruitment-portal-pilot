# V4 claim sources

This list separates current product behavior from the illustrative material used to make the video readable.

## Product behavior shown

| Video statement or action | Source |
|---|---|
| Smile can draft role details, screening criteria and interview questions; HR reviews before publishing. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → End-to-end workflow, steps 1–2. |
| A candidate can apply with contact details and a resume and acknowledge the privacy notice. | `docs/WORKING-RECRUITMENT-WORKFLOW.md` → The path a candidate takes, step 1; `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 3. |
| CV analysis compares a resume with configured role criteria and returns a 0–100 match score and reviewable evidence. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 4. The document explicitly says the score is a review aid, not a verdict or guarantee. |
| HR reviews CV evidence and can approve, reject or send an enabled interview. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 5; `src/components/ApplicantDecisionPanel.tsx` → `DecisionRow` actions. |
| Approving the CV review and sending an interview invitation are separate actions. | `src/components/ApplicantDecisionPanel.tsx` → `decide("Approve")` and `sendInterview(kind)` are separate handlers and buttons. |
| Role settings can offer Voice, Live Avatar or Both; with Both, a candidate chooses one interview format. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → steps 2, 5 and 6. |
| A Voice interview is a 10-minute phone-call booking; it uses role questions and its result/transcript returns for HR review. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 6; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → steps 4–6. |
| Live Avatar uses a private link and requires the candidate to review notice, agree and check camera/microphone. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 6; `src/components/LiveAvatarInterview.tsx` → candidate disclosure and checks. V4 describes these requirements as copy on the alternative-format card; it does not animate the Avatar route. |
| HR reviews interview evidence before deciding whether the candidate advances. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 7; `src/components/ApplicantDecisionPanel.tsx` → voice-stage review and explicit Approve/Reject actions. |
| After approval for a face-to-face stage, the candidate books one available hour from the configured interviewer or shared HR calendar. | `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` → step 8; `docs/WORKING-RECRUITMENT-WORKFLOW.md` → step 7. |

## Synthetic-only content

- Candidate name: Maya Chen; resume filename and job title are demonstrative.
- CV match: 82/100, explicitly marked synthetic and review-only. It does not represent an actual applicant or outcome.
- Interview question, response, transcript excerpt, “Cross-team launch work” strength and “Depth of measurement” follow-up are illustrative sample content.
- Three scheduler times are labeled synthetic availability. They do not establish actual calendar availability or a booking.

## Deliberately omitted

- Live Avatar duration is omitted because project sources have historically disagreed on the active pilot limit.
- No interview automation threshold is shown, no AI hiring recommendation is presented as a decision, and no calendar slot is represented as booked.
