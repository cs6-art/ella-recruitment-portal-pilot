# Smile Promo V6 — Creative Review

## Review scope

V6 keeps V4's accepted visual identity and workflow, and uses V5 as the editable starting point. The YouTube reference, [Hera, Your AI Motion Designer (Demo)](https://www.youtube.com/watch?v=Lwnxr6VW4B8), informed the use of a persistent, evolving interface, clear object movement, and rhythmic content reveals. Smile remains a recruitment portal: the promo does not portray it as chat-driven.

The V5 review used its editable source/tween timings, encoded frame samples around weak beats, the available V4/V5 review records, and encoded audio measurements. Direct local MP4 playback was blocked by the browser's file-access policy. I therefore cannot claim a continuous subjective watch or listen of V5 or V6; the notes below distinguish observed encoded-frame changes from measurements, and leave final audiovisual listening to a human playback.

## Three weakest V5 moments and V6 changes

| V5 time | Weakness in the source/render | V6 source correction | Same-time encoded comparison |
| --- | --- | --- | --- |
| **5.32–6.72s — resume evidence handoff** | The source phrase remained visible while the token moved toward the criteria panel, creating duplicate evidence. The whole folio shifted away and returned, competing with the evidence movement. | Keep the folio anchored. Fade the source phrase before the token leaves; use a short anticipate → accelerate → decelerate → settle path; reveal the linked source/destination labels after the token clears; pulse the receiving criterion and delay the illustrative score until the relationship reads. | `5.40s`, `6.14s`, `6.90s` in the comparison sheet. The `6.14s` V6 frame shows the evidence token over Campaign analytics; at `6.90s` the link label and criterion state are readable. |
| **14.71–16.30s — phone answer to HR evidence** | The waveform/answer finished around 14.71s, then the call screen held until HR review began, leaving about 1.6s without a new result. The change of interface did not show the completed call becoming HR-review material. | End the waveform cleanly, change the call status to **Interview complete**, show **Response ready for HR**, then move the answer phrase into the transcript before revealing the related summary and findings. The review still begins with HR deciding. | `14.40s`, `15.60s`, `17.50s`. V6 marks the call completion, starts the review sooner, and shows transcript + summary at the later review point. |
| **18.88–22.54s — HR approval to slot selection** | Approval moved into the scheduler without a distinct approval-success state. The slot choice was small and the scheduler held after it, weakening the causal chain from HR decision to candidate action. | Replace the approval buttons with an explicit HR-approved status, then open the calendar. Reveal choices sooner, use a more visible selected-slot response/check, and retain the truthful **Selected choice · not booked** label. Keep the closing CTA still and readable. | `18.10s`, `20.50s`, `21.70s`, `24.80s`. The first slot now begins entering as the panel settles; `21.70s` shows the selected option and not-booked state; the CTA is stable at `24.80s`. |

## Preserved and corrected

- Preserved the Smile identity, warm grid, layered folio, synthetic candidate, score qualification, voice-only example, human HR gates, and exact **Try Smile now** CTA.
- Kept CV approval and sending the interview invitation as separate HR actions.
- Kept the voice route to one 10-minute phone call; voice and Live Avatar are not shown as two required steps.
- Kept the interview evidence under HR review and slot choice after HR approval.
- Kept synthetic calendar examples and the selected slot explicitly **not booked**.
- Fixed the resume filename/privacy note collision found during V6 frame review.
- Reused the accepted V4 score rather than generating another paid music track. The final mix includes restrained interaction cues and a quieter phone beat followed by a lift into scheduling and CTA.

## Same-time encoded comparison

The comparison sheet extracts frames from the encoded V5 and final V6 MP4s at the identical timestamps listed above. It shows differences in visible states, not motion between frames. The editable V6 source carries the motion changes; the HyperFrames check and full MP4 decode verify timing/runtime and file integrity, but neither is a substitute for watching and listening.

## Verification and remaining limitation

- HyperFrames `check --snapshots`: zero lint/runtime/layout/motion errors or warnings across 9 layout samples; 80/80 contrast checks pass WCAG AA. Scene handoffs are sequential, without overlapping text headers.
- Final render: 25.000s, 1920×1080, 30 fps, H.264 video, 48 kHz stereo AAC; full FFmpeg decode exit code 0.
- Final audio measurement: −18.83 LUFS integrated, 3.30 LU LRA, −7.33 dBTP true peak. V5 measured −17.99 LUFS, 2.90 LU, −7.09 dBTP. The V6 peak is below clipping; the mix has a slightly wider measured loudness range and is about 0.8 LU quieter overall.
- The score WAV hash matches V5 exactly. A complete human playback/listen was unavailable in this session due to local browser file-access restrictions; no claim about subjective audio quality is made.

No numeric creative score is assigned. The progress record is the three source-level changes and their same-time encoded-frame comparisons.
