# Independent creative review — V3 to V4

## Review method and reference

I reviewed the V3 render and the final V4 render with HyperFrames snapshots at identical timestamps, then inspected the paired frames. This verifies specific moments in each MP4; I did not watch either file as uninterrupted playback.

The YouTube reference is [Hera, Your AI Motion Designer](https://www.youtube.com/watch?v=Lwnxr6VW4B8). It uses a warm pink grid, an active input, one result card that gains detail, a broader result reveal, then a centered export panel. The transferable idea is one visible cause leading to one evolving result. Smile should show its actual role, applicant, HR review, interview and scheduling actions rather than imitate the prompt interface.

## Five weakest V3 moments

| Exact V3 timestamp | Why it fails visually | Reference comparison | V4 source correction and visible result |
|---|---|---|---|
| **1.8s** | The role interface sits inside a large pale stage with small fields and little hierarchy. The viewer has no clear promise or product action to follow. | At roughly 0:02–0:06 the reference gives the cursor and input bar immediate focus, then changes the content. | Open on one large role card beside a direct benefit headline. Reveal the role draft, screening criteria and questions; a purposeful click resolves into “Role published · link ready.” |
| **5.4s** | V3 is still on role setup, so the same form holds for several seconds before the application and CV review become visible. | The reference reveals its first result card by about 0:07 and builds detail inside it. | Move to the synthetic application and resume by 3.6s. Reveal criteria evidence, then the labeled 82/100 synthetic match at 6.42s. |
| **13.9s** | V3 shows the voice and Live Avatar alternatives as simultaneously active, which can imply one candidate completes both. | The reference keeps a single result dominant while its contents change. | Keep both options visible as alternatives, mark Voice as the one selected route, then show the scheduled phone call, waveform, question and response. No Live Avatar duration is stated. |
| **18.0s** | V3's split review, numeric categories, strengths/gaps and persistent process rail compete for attention; the evidence does not lead clearly to a human action. | At about 0:15–0:19 the reference expands one established result into a broader reveal. | Carry the voice result into one HR review card: transcript excerpt, synthetic strength and follow-up area, then separate Approve/Reject controls owned by HR. |
| **21.2s** | V3 reduces scheduling to a small action under a mini-map and process rail, so the candidate's next step is hard to read. | At about 0:20–0:23 the reference centers its export panel and one primary action. | After the HR gate, reveal a larger candidate scheduler with three clearly labeled synthetic one-hour slots. The video does not claim that a meeting is booked. |

## Changes carried into the final V4 render

- A single large product folio remains the anchor while its content changes across the workflow; the permanent applicant rail and repeated overview template are gone.
- Product actions now have visible causes and results: role publish click → link-ready state; evidence rows → match score; HR CV approval → a separate Send interview invitation action → one candidate format choice; that choice → active call and response; interview review → candidate scheduling.
- CV approval and sending an interview invitation are shown as distinct HR actions, matching the portal controls. The candidate invitation appears only after the second action.
- The call question and answer reveal at 12.58s and 13.38s, so the right panel is no longer empty at 13.9s. The calendar panel appears at 20.58s and its slots begin at 20.88s, so they are visible at 21.2s.
- The interview card presents Voice and Live Avatar as alternatives; only Voice is selected and animated. The 10-minute claim applies to the phone call. No duration is assigned to Live Avatar.
- The CTA remains exactly **Try Smile now**.

## Final artifacts and verification

- Render: `renders/smile-recruitment-portal-v4-final.mp4` — 25.0 seconds, 1920×1080, 30 fps, H.264 video and AAC stereo audio, 5.8 MB.
- V3/V4 paired snapshots at 1.8, 5.4, 8.8, 13.9, 18.0, 21.2 and 23.7 seconds: `snapshots/v4-final-v3-compare/`.
- Final MP4 frame checks: `snapshots/v4-final-output-check/` and `snapshots/v4-final-actions-check/` (approval, separate invite send, candidate choice, interview evidence, scheduler and CTA).
- HyperFrames `check` passed with zero errors or warnings.
- FFprobe confirmed both streams, dimensions, frame rate and 25.0-second duration. FFmpeg decoded the complete video and audio without errors.

## Product facts used

The role, application, CV review, interview, HR approval and scheduling sequence is grounded in `docs/WORKING-RECRUITMENT-WORKFLOW.md`, `docs/SMILE-PORTAL-PRODUCT-KNOWLEDGE-PROMPT.md` and `src/components/ApplicantDecisionPanel.tsx`. Maya Chen, the match score, transcript example, findings and time slots are labeled synthetic. The 82/100 score is illustrative review evidence, not a hiring decision. Calendar times depend on configured availability.
