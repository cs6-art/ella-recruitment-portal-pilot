# Smile Promo V7 — Creative Review

## What changed

V7 keeps the accepted warm grid, layered folio, Smile identity, evidence transfer, and exact **Try Smile now** CTA. It replaces V6's long scene-side headlines and explanatory paragraphs with five numbered chapter markers and a larger product interface. The 82/100 illustrative match score and repeated labels are removed. One resume phrase now links directly to its matching criterion; the two HR actions remain separate; the Voice example ends with the answer becoming HR transcript evidence; HR approval precedes candidate slot selection.

The copy audit counted **571 words in V6 and 220 in V7**, a reduction of **61.5%**. The script counts authored HTML text nodes while excluding script, style, SVG, and audio content. It counts labels in the source even when animation reveals them later, so the method is consistent across both versions.

## Five chapter plan and results

| Chapter | Timing | Action → visible result | Reading hold |
|---|---:|---|---|
| 01 · Create role | 0.3–3.5s | Draft details resolve → HR publishes → role link is ready. | Published state holds before the application screen. |
| 02 · Review applications | 3.5–9.6s | One resume excerpt travels into Campaign analytics → HR approves the CV → HR separately sends the invite. | Each approval/sent state replaces the previous control. |
| 03 · Complete interview | 9.6–14.7s | Voice is selected while Live Avatar remains an alternative → one 10-minute phone example shows a question and answer. | The answer and completed-call status hold before review. |
| 04 · HR decides | 14.7–19.35s | The answer moves into a visible transcript → one summary finding appears → HR approves the next stage. | The HR-approved state remains visible before scheduling. |
| 05 · Choose a time | 19.35–22.15s | After approval, a candidate selects one synthetic one-hour option. | The selected slot remains **Selected · not booked**. |
| CTA | 22.8–25.0s | Smile identity resolves to **Try Smile now**. | CTA is stable for 2.2 seconds. |

## V6 / V7 encoded comparison

The paired sheet compares the same workflow moments and labels both timestamps where timing changed. It records visible states in the encoded MP4s, not motion between frames.

| Moment | V6 | V7 | Observed difference |
|---|---:|---:|---|
| Role published | 3.35s | 3.25s | V7 gives the role interface the main frame and removes the supporting story paragraph. |
| Evidence linked | 6.90s | 6.80s | V7 keeps the criterion/result focus and removes the illustrative score. |
| Invite sent | 8.50s | 8.80s | V7 shows CV approval and invite sent as separate states. |
| Interview route | 10.20s | 10.80s | V7 states one route per invite, with Voice selected and Live Avatar as the alternative. |
| Phone answer | 13.90s | 13.80s | V7 gives the call a short question/answer example and completed state. |
| HR evidence/decision | 18.30s | 17.80s | V7 shows a concise transcript, one summary finding, and a human HR action. |
| Selected slot | 21.75s | 21.25s | V7 makes the one-hour choice and not-booked qualification visible together. |
| CTA | 24.80s | 24.80s | The requested CTA is centered and settled. |

Encoded review also caught a weak answer handoff at 15.2s: the answer arrived before the HR transcript surface became readable. The source transition was moved earlier so the review card enters behind the flying answer. The final key-action sheet at 15.2s shows the transcript panel present beneath the answer as it lands.

## Sound and verification

- Embedded score: `assets/audio/smile-original-score.wav`, the accepted V4 score. SHA-256: `BF2690F3FF97120BED0884E7012D6D922569640F8DD7DC8EBE54DE84F00C443E`.
- The original score is reused; V7 reshapes its volume automation and retains a small number of timed UI/call cues. No replacement paid track was generated.
- Final mix measurement: **−18.8 LUFS integrated**, **3.3 LU LRA**, **−7.1 dBFS true peak**.
- HyperFrames `check --snapshots`: zero lint, runtime, layout, and motion issues across nine layout samples; **70/70** contrast checks pass WCAG AA.
- Final MP4: **25.000s**, **1920×1080**, **30 fps**, H.264 video and 48 kHz stereo AAC. Full FFmpeg decode passed.
- `review/v7-one-second-encoded-review.png` samples the encoded MP4 once per second. `review/v7-key-actions-encoded-review.png` samples the action beats. `snapshots/v6-v7-five-step-comparison.png` compares V6 and V7 at matching workflow moments.

## Remaining weakness and review limit

The story is less crowded, but the portal interface still contains small secondary labels. The review confirms their presence at selected encoded timestamps; it does not prove every label can be read at normal playback speed. Local browser policy prevented continuous MP4 playback and listening in this session. Frame sheets, automated checks, and loudness measurements verify selected images, technical structure, and audio level; they do not establish continuous motion quality, intelligibility, or subjective soundtrack quality. No full-watch or full-listen claim is made.
