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

## Version 3 — causal interaction refinement / final

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


