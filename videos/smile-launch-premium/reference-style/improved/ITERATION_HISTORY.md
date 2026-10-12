# ITERATION_HISTORY.md

## Version 1 — Smile reference-style promo (baseline)

- **Output:** `smile-launch-reference-style.mp4` (25 s, 1920×1080, 30 fps) and `smile-launch-reference-vertical.mp4` (25 s, 1080×1920).
- **Editable source:** `scripts/generate-reference-style.mjs`, `compositions/scene-0.html` through `compositions/scene-6.html`, and `index.html` in the `reference-style` project.
- **What worked:** Smile identity, warm grid, source-backed portal screens, local music and effects, synthetic-data treatment, and the exact `Try Smile now` CTA.
- **Review findings:** Five weakest moments were 0–3 s opening, 6–10 s CV screening, 10–15 s interview menu, 15–19 s interview review, and 19–22 s tile overview. Root cause: static UI plates plus generic cursor/focus overlays; no continuous candidate/evidence object. Full detail is in `VIDEO_GENERATION_LESSONS.md`.
- **Reference inspection:** Direct review of the 30-second YouTube demo found a persistent input/cursor, evolving interface content in one central card, and a final result gallery. The baseline borrowed the warm card vocabulary, but not its causal motion or result progression.
- **Weighted score:** 5.0/10 using the rubric below. Reference language 4/10 (25%), animation/transitions 4/10 (20%), art direction/composition 5/10 (15%), story/copy 5/10 (15%), product demo/factual accuracy 7/10 (15%), sound/finish 6/10 (10%). Weighted result: 4.95/10, rounded to 5.0.
- **Record status:** The earlier lesson/history files were absent before this review; these files establish the first documented baseline.

## Version 2 — structural revision

- **Output:** `improved/renders/smile-launch-improved-v2.mp4` (25 s, 1920×1080, 30 fps, H.264/AAC; 5.6 MB).
- **Changes:** Replaced the screenshot-only feature beats with editable UI. Put role creation before application, moved criteria evidence into the CV scene, added a progressing applicant rail, represented voice and Live Avatar as role-enabled alternatives, added transcript-to-HR review, and replaced the six-tile collage with one journey and booking card.
- **What worked:** Product sequence became chronological and one applicant remained visible through the HR gates. The new scene states visibly changed instead of relying on highlight boxes.
- **V2 score:** 7.1/10 using the unchanged rubric: reference language 5.5, animation/transitions 7.5, art direction/composition 7, story/copy 8, product demo/factual accuracy 8.5, sound/finish 6.5. Weighted result: 7.05/10.
- **V2 review:** Three actions were still inferred rather than shown: HR publishing the role, the candidate affirming recording/device consent before Live Avatar, and the candidate choosing an available one-hour slot. These became the V3 changes.
- **Comparison:** `improved/snapshots/compare-v2/v2-to-v3-five-scene-progress.jpg` compares the same five moments in V2 and V3.

## Version 3 — causal interaction refinement (superseded after review)

- **Outputs:** `improved/renders/smile-launch-improved.mp4` (25 s, 1920×1080, 30 fps, H.264/AAC; 5.7 MB) and `improved/renders/smile-launch-improved-vertical.mp4` (25 s, 1080×1920, 30 fps, H.264/AAC; 5.0 MB). Poster: `improved/smile-launch-improved-poster.png`.
- **Changes:** Publishing now resolves into a role-link-ready state. Live Avatar consent checkboxes begin unchecked; the candidate confirms recording and camera/mic readiness and continues before the call appears. The final route ends with a candidate-facing `Choose a 1-hour slot` control. The warm grid, brand, exact CTA, synthetic data, applicant rail, and HR gates were preserved.
- **V3 score:** 7.6/10 using the unchanged rubric: reference language 6.5, animation/transitions 8, art direction/composition 7.5, story/copy 8.5, product demo/factual accuracy 9, sound/finish 6.5. Weighted result: 7.625/10, rounded to 7.6.
- **Measured progress:** +2.6 points over the baseline (5.0 → 7.6) and +0.6 over V2 (7.1 → 7.6). All five baseline weak beats now have purposeful product storytelling. No key product scene relies on a screenshot plate.
- **Verification:** `npm run check` passed for landscape and portrait with zero lint, runtime, layout, or motion errors/issues. Nine minor contrast warnings remain on small status/icon details (4.41–4.45:1; target 4.5:1). Both MP4s passed full FFmpeg decode and ffprobe verification; duration is 25 s with audio present.
- **Comparison:** `improved/snapshots/compare-v1/before-after-five-weakest-scenes.jpg` compares the five exact weak-scene moments to V1. `improved/snapshots/compare-v2/v2-to-v3-five-scene-progress.jpg` shows the causal refinements from V2 to V3.

## Fixed scoring rubric

| Category | Weight |
|---|---:|
| Reference language | 25% |
| Animation and transitions | 20% |
| Art direction and composition | 15% |
| Story and copy | 15% |
| Product demonstration and factual accuracy | 15% |
| Sound and finish | 10% |

## Version 4 — accepted reference-led baseline for V5

- **Output:** `improved/v4/renders/smile-recruitment-portal-v4-final.mp4` (25.0 s, 1920×1080, 30 fps, H.264/AAC stereo; 5.8 MB). Landscape only; portrait adaptation is deferred until the landscape cut is accepted.
- **Editable source:** `improved/v4/scripts/build-smile-v4.mjs` generates `improved/v4/index.html`.
- **What changed:** Removed the persistent applicant rail and small overview montage. Made a single large folio the through-line and reshaped each beat around the actual product action: HR-reviewed role draft and publish, application/privacy notice, CV evidence, a separate HR CV approval and send-invitation action, one selected interview route, phone conversation and transcript, HR review, then candidate-facing one-hour scheduling.
- **Reference technique:** Kept the warm grid, one focused result and cause/effect progression from the YouTube reference. Did not depict Smile as a prompt/chat system.
- **Factual corrections:** Voice and Live Avatar are alternatives; this cut follows Voice only. It does not assign a duration to Live Avatar, automate HR decisions, or claim that the sample time slot is booked. The 82/100 match and all candidate evidence are synthetic.
- **Targeted timing correction:** The first V4 frame review showed an empty call-answer panel at 13.9s and an empty slot panel at 21.2s. The question/answer reveal was moved to 12.58/13.38s; the calendar and slots now begin at 20.58/20.88s. Final V4 snapshots confirm readable content at both moments.
- **Measured changes vs V3:** V4 has no persistent process rail; one interview route is active; five weak moments were compared at identical timestamps; the opening reaches the application/CV beat by 5.4s instead of still holding role setup; the scheduler exposes three labeled synthetic one-hour choices by 21.2s.
- **Verification:** HyperFrames `check` passed with zero errors or warnings. Final output probes as 25.0 s, 1920×1080, 30 fps H.264 with 48 kHz stereo AAC; full FFmpeg decode passed. See `improved/v4/CREATIVE_REVIEW.md` and `improved/v4/snapshots/v4-final-v3-compare/` for the five exact review beats and paired frames.
- **No subjective score assigned:** Changes are documented through exact source actions, reveal timings and same-time frame comparisons rather than a self-scored quality number.

## Version 5 — motion and sound refinement

- **Output:** `improved/v5/renders/smile-recruitment-portal-v5-final.mp4` (25.0 s, 1920×1080, 30 fps, H.264/AAC stereo; 6.8 MB).
- **Editable source:** `improved/v5/scripts/build-smile-v5.mjs` generates `improved/v5/index.html`.
- **Review and comparison:** `improved/v5/CREATIVE_REVIEW.md` and `improved/v5/snapshots/v4-v5-compare/paired-overview.png` compare V4/V5 at matching times. `improved/v5/snapshots/v5-encoded-check/` checks selected source frames against the final encoded V5 MP4.
- **Changes:** Carried the resume phrase into its matching role criterion; dimmed the unrelated criterion during travel; staged three phone waveform groups and sequential answer copy; carried the answer into the HR transcript and highlighted its supporting phrase; animated a cursor click and explicit selected/not-booked state in scheduling. The accepted CTA remains `Try Smile now`.
- **Sound:** Re-timed existing SFX and added resume/slot cues. Added a score-level envelope that fades in, lifts under evidence and HR review, dips during the phone call, rises through scheduling/CTA, and fades out. Final mix: −18.0 LUFS integrated, −7.1 dBTP, 3.0 LU loudness range; V4 was −20.7 LUFS and −10.0 dBTP.
- **Generated score limitation:** One Mureka instrumental was generated as requested, but its ChatCut browser export could not be transferred into the local V5 project. The MP4 retains V4's accepted score bed with the new automation; it does not contain the generated Mureka file. `improved/v5/CREATIVE_REVIEW.md` records this clearly.
- **Product truth:** Voice remains the only interview route shown. The HR decision stays human-owned. The candidate's evidence and slot availability are synthetic, and the selected slot is explicitly not booked.
- **Verification:** HyperFrames `check` reported zero errors/warnings and 79/79 contrast checks passed. FFprobe confirmed 25 seconds, 1920×1080 / 30 fps, H.264 and stereo AAC; FFmpeg decoded the full file without error.
- **No subjective score assigned:** The V5 review records exact visual changes and timing comparisons instead of claiming a numeric measure of creative quality.



## Version 6 review — evidence-led motion refinement (2026-10-10)

V6 preserves the accepted V4 identity and workflow, with V5 as the editable starting point. It targets three V5 weak stretches documented in `v6/CREATIVE_REVIEW.md`: the resume-evidence transfer (5.32–6.72s), the phone-call completion into HR evidence (14.71–16.30s), and HR approval into slot selection (18.88–22.54s).

- The resume phrase now leaves its source before a single token travels from the excerpt to Campaign analytics. The folio stays anchored; the destination label resolves after the token clears; criterion feedback precedes the illustrative score.
- The call closes with a completed status and response-ready chip. The answer phrase carries into the HR transcript before the summary and findings reveal.
- HR approval becomes an explicit state before the calendar opens. Slot choices enter sooner; the candidate's selected option retains the `not booked` qualification. The CTA is stable after its entrance.
- Same-time encoded V5/V6 frames are in `v6/snapshots/v5-v6-compare/paired-overview.png`, covering 5.40, 6.14, 6.90, 14.40, 15.60, 17.50, 18.10, 20.50, 21.70, and 24.80 seconds.
- A frame review found and fixed a collision between the resume filename and privacy note. The scheduling reveal was also tightened after the encoded comparison showed an empty panel at 20.50s.
- The soundtrack remains `v6/assets/audio/smile-original-score.wav`, the accepted V4 score already used in V5; SHA-256 is identical across versions. The separate Mureka asset remained cloud-only after the supported download attempt, so no new track was generated. V6 reshapes the score level arc and keeps restrained action cues.
- HyperFrames check: zero lint/runtime/layout/motion errors or warnings across 9 layout samples, 80/80 WCAG AA contrast checks pass. Final MP4: 25.0 s, 1920×1080/30 fps, H.264 + 48 kHz stereo AAC, full decode passed. Mix measures −18.83 LUFS, 3.30 LU LRA, and −7.33 dBTP true peak (V5: −17.99 LUFS, 2.90 LU, −7.09 dBTP).

The comparison documents visible states; it does not establish motion quality by itself. Direct local video playback was blocked by browser file-access policy, so this record does not claim a full human watch/listen or subjective sound-quality judgment. No numeric creative score is assigned.

## Version 7 — less copy, five clear steps (2026-10-10)

- **Output:** `v7/renders/smile-recruitment-portal-v7-final.mp4` (25.0 s, 1920×1080, 30 fps, H.264 + 48 kHz stereo AAC; 3.28 MB).
- **Editable source:** `v7/scripts/build-smile-v7.mjs` generates `v7/index.html`.
- **Measured copy reduction:** HTML text-node count fell from 571 words in V6 to 220 in V7 (**61.5% fewer**), excluding script/style/SVG/audio nodes.
- **Changes:** Replaced long narrative copy and a permanent process rail with five numbered current-step markers; enlarged the portal folio; removed the illustrative score and repetitive labels; preserved evidence transfer, separate CV approval and invite sending, Voice/Live Avatar alternatives, a concise phone answer, the human HR gate, and the selected-but-not-booked slot. The CTA remains **Try Smile now** for a stable 2.2-second hold.
- **Targeted correction:** Encoded review found the answer briefly floating before its transcript was visible at 15.2s. The HR review enters during the handoff; the final encoded key-action frame shows the transcript panel behind the arriving answer.
- **Comparison:** `v7/snapshots/v6-v7-five-step-comparison.png` compares the encoded versions at paired workflow moments: V6/V7 timestamps are 3.35/3.25, 6.90/6.80, 8.50/8.80, 10.20/10.80, 13.90/13.80, 18.30/17.80, 21.75/21.25, and 24.80/24.80 seconds. `v7/review/` contains one-second and key-action sheets from the final V7 MP4.
- **Sound:** Reuses `v7/assets/audio/smile-original-score.wav`, the accepted V4 score (same SHA-256 as V6: `BF2690F3FF97120BED0884E7012D6D922569640F8DD7DC8EBE54DE84F00C443E`). V7 uses remapped score automation and a restrained set of interaction cues. Final mix measures −18.8 LUFS integrated, 3.3 LU LRA, and −7.1 dBFS true peak.
- **Verification:** HyperFrames check reports zero lint/runtime/layout/motion issues across nine samples and 70/70 contrast checks pass. FFprobe confirms a 25.0-second 1920×1080/30 H.264 video and 48 kHz stereo AAC; full FFmpeg decode passes.
- **Remaining limit:** The encoded frames show the intended UI states and the answer handoff correction. Continuous video playback and listening were unavailable in this session, so this record does not claim a full human watch, natural-speed text readability, or subjective motion/sound quality. The V7 review documents this explicitly.
