# VIDEO_GENERATION_LESSONS.md

## Review baseline

The most recent cut reviewed is `smile-launch-reference-style.mp4` (25 s, 1920×1080), built from `scripts/generate-reference-style.mjs`. I inspected the full export at one frame per second and spot-checked the dated moments below. The requested earlier lesson/history files were not present anywhere in the project or the other available work folder, so this is the first recorded review; it does not claim continuity with unavailable notes.

Benchmark: [Hera, Your AI Motion Designer (Demo)](https://www.youtube.com/watch?v=Lwnxr6VW4B8), inspected directly at 30 seconds. Its repeated visual device is a persistent prompt/input bar and cursor driving visible changes in one central interface; around 0:10–0:22 the generated card changes from a text prompt into a detailed vertical result, then around 0:25 the result opens into a gallery.

## Five weakest moments

| Timestamp | Previous approach | Problem | Root cause | Reference comparison | Corrective action | Prevention rule |
|---|---|---|---|---|---|---|
| 10.0–15.0 s — interview choice | Hold one interview-choice screenshot while blue outlines pulse on the call/avatar cards; show a check and duration line. | This is a menu, not an interview demonstration. The viewer never sees Voice Interview in progress or Live Avatar after consent. It consumes 20% of the runtime while the key capability stays abstract. | One static PNG carried the whole beat; overlays decorate the options instead of changing the product state. | In the reference, a persistent input/cursor initiates content that visibly develops inside the same central card. | Rebuild the beat as an approved one-path demonstration: show an active voice-call state with a moving waveform and question/response evidence, then a separate role-configured Live Avatar state after a clear consent gate. Label them as alternative formats; never imply one candidate completes both. | Each showcased feature needs at least one visibly changing in-product state and a readable cause/result, not only a highlighted menu item. |
| 6.0–10.0 s — CV screening | Hold `screening-panel.png`; sweep one blue rectangle, move the cursor, pop in an 82% demo score. | The resume never becomes evidence. The panel is largely static and the score arrives as a badge, so viewers can misread screening as an unexplained rating. | The source was treated as a screenshot plate; there are no native animated criteria, evidence rows, or visible resume-to-review transformation. | At roughly 0:10–0:20, the reference moves from a typed prompt to structured visible output within one continuing workspace. | Build the key screening content as editable UI: role criteria and resume evidence enter in sequence, matched strengths/gaps resolve, and the explicitly illustrative score completes last. Keep the actual portal capture as a quiet contextual layer. | For AI-assisted analysis, animate the inputs, intermediate evidence, and reviewable output. A score alone is not a product story. |
| 15.0–19.0 s — interview review | Hold `evidence-review-panel.png`, draw a focus rectangle, move a cursor, and add an HR-decision label. | The evidence is not read or transformed; the HR action is a caption over a still panel. There is no visible bridge from the prior interview to a human decision. | Generic cursor/focus overlays substituted for stateful transcript and review motion. | The reference keeps the product object central and lets its contents change before pulling back to a broader result view. | Animate interview evidence arriving as a short transcript/answer card, reveal the corresponding review categories, then show HR evaluating the evidence while leaving Approve/Reject untouched. | Human review should be shown as a deliberate evidence-to-decision beat; never animate an automated hiring outcome. |
| 19.0–22.0 s — workflow overview | Arrange six tiles in a 3×2 gallery and pull back once; place the complete route in a small ribbon. | Six competing miniatures and tiny labels turn the route into a contact sheet. The viewer cannot follow one candidate through the stages. | Montage density and an overview headline were used instead of a moving through-line; the gallery is more legible in source snapshots than at video scale. | Around 0:25, the reference expands the same generated output into a gallery, so the gallery feels like the consequence of the preceding interaction. | Keep the candidate/evidence token as the focal object and let three to four large stage cards arrive along one path; use the overview only as a brief payoff after the detailed scenes. | A gallery must be earned by a preceding result and remain legible at final playback size; do not put six dense screens on screen at once. |
| 0.0–3.0 s — opening/product reveal | Center the Smile logo on a warm grid; type a tagline and add a small `Human-led hiring` pill. | The first seconds are brand lockup, not a hook or product action. The eye has no meaningful object to follow, and the Smile reveal feels detached from the workflow. | The opening was designed as a static end-card layout with entrance fades, instead of a story-bearing object and transition into the portal. | The reference begins with an active text-entry bar and moving cursor; an interaction is underway immediately. | Open on a stylized synthetic resume/card entering frame and resolving into Smile's portal workflow; reveal the logo through that action while preserving the warm-grid art direction. | The opening must contain a story object and a clear motion event in its first second; a fade-in logo alone does not count as a hook. |

## Secondary note

The 22.0–25.0 s CTA is clear and factually sound, but its logo/title/button arrive as separate fades on an otherwise static grid. Preserve the exact `Try Smile now` copy; tie its arrival to the workflow path resolving into the Smile mark so the ending feels caused by the preceding story.

## Product-fact discrepancy found during this review

The dated working workflow says Live Avatar lasts up to about five minutes, while `.env.example`, `docs/LIVE-AVATAR-INTEGRATION.md`, `src/lib/live-avatar.ts`, and the default interview prompt describe a 20-minute default/provider cap. The deployed pilot override is not visible in source. The next cut must not show either duration until the active pilot configuration is confirmed; demonstrate consent, the live video conversation, transcript, and HR review without a minute count.

## Failure classes

- **Creative direction / storytelling:** The cut lists real stages but does not sustain one candidate object through them.
- **Composition / art direction:** A single stage-card template repeats; the six-tile overview is too dense at playback scale.
- **Animation:** Most product UI is a raster screenshot. Motion is concentrated in entering panels, outlines, cursors, and small badges, rather than UI state progression.
- **Timing:** The static interview-choice scene holds for five seconds, the same allocation as the full role setup. The repeated holds make the 25-second piece feel slower than its timeline.
- **Transition logic:** Scenes crossfade/slide independently; no resume, candidate, or evidence object carries motion across the cut.
- **Typography:** Type-on copy is used as a label layer; it does not initiate or explain the depicted interaction.
- **Rendering/technical constraints:** None identified as the cause of the weak beats. HyperFrames can animate native HTML/CSS/G​​SAP UI; the source design chose screenshot-only states.
- **Quality inspection:** The prior review concentrated on static snapshots and checker output; it did not score scene-level storytelling or compare moment-by-moment against the reference.

## Rules for the next generation

1. Preserve the established Smile logo, warm grid, local score/SFX, truthful product copy, synthetic demo data, and exact CTA.
2. Rebuild only the highest-impact scenes first: CV screening and interview demonstration. Improve HR review and route overview only where needed to connect those scenes.
3. Every key product demo must show a causal state change in editable UI; screenshots may establish authenticity but cannot be the whole animation.
4. Use one repeatable candidate/evidence object to connect stages. A transition must hand it forward, not merely replace one slide with another.
5. Show the two actual HR gates: CV review before an interview invitation; interview-result review before final face-to-face scheduling.
6. Voice call is ten minutes. Voice and Live Avatar are alternatives enabled by role settings. Show Live Avatar only after recording/camera/mic consent, and omit its duration until the conflicting pilot/configuration sources are reconciled. Never imply both are required.
7. Keep the 82% match as synthetic illustrative data; never frame it as a guaranteed result.
8. Judge at final-size frames, at least one per second across the complete cut, plus close inspections at every scene handoff. Measure results with identical categories/weights each generation.
9. Maintain this document and update it after a meaningful review; do not claim model training or learning outside the project record.

## Version 2 review — rendered structural revision

The V2 render was reviewed as a full 25-second MP4 at one frame per second and at transition points. It repaired the large story gaps, but its role-publish, Live Avatar consent, and slot-choice actions were still only implied.

The V3 changes made those actions visible in the product UI: `Publish role` resolves to a role-link-ready state; the candidate checks recording consent and camera/microphone readiness, then continues into the Live Avatar conversation; scheduling ends with a `Choose a 1-hour slot` control after the HR review gate.

## Version 3 review — superseded after independent creative review

The final cut is chronological: role setup → role publication → application/privacy notice → CV evidence → HR review before interview → one role-enabled interview format → transcript/evidence review by HR → one-hour face-to-face slot selection after approval → CTA. The same applicant identity and route marker carry the viewer through the workflow.

The two interview cards are explicitly alternatives, not two steps completed by one candidate. Voice is labeled as a 10-minute call; Live Avatar is shown after the candidate’s consent and device check. No Live Avatar duration appears because the repository’s working workflow and runtime/configuration sources conflict. The 82% CV match remains labeled illustrative/synthetic; no AI-triggered hiring decision is shown.

The fixed weighted rubric moved from 5.0/10 (V1) to 7.1/10 (V2) to 7.6/10 (V3). The scores are creative review judgments, not automatic measurements; the evidence is the same-time before/after sheets and the documented state changes.

## New lessons and remaining limit

- Show product actions as cause and result: publish → role link ready; explicit consent → live call; HR approval → candidate slot selection.
- A route rail can carry the product-native equivalent of the reference’s persistent prompt bar without falsely presenting Smile as a chat-driven system.
- The final wide shot should demonstrate a consequence (booking) instead of collecting six mini screens into a contact sheet.
- Keep both interview formats visibly alternative; use separate example cards and a prominent one-format-per-invite label.
- Keep the one-hour meeting claim and `Google Calendar · when connected` qualification. Do not state Live Avatar duration until the deployed pilot setting is confirmed.
- Minor contrast warnings remain for small status/indicator details (4.41–4.45:1). The main headers and key actions are readable in the rendered frames, but those small elements are still below the automated 4.5:1 threshold.

## Version 4 review — current final

The independent V3 review found the largest losses at exact V3 timestamps **1.8s, 5.4s, 13.9s, 18.0s and 21.2s**. The paired render/reference frames are in `improved/v4/snapshots/v4-final-v3-compare/`; the detailed creative comparison is in `improved/v4/CREATIVE_REVIEW.md`.

V4 uses the reference's active, evolving central result as a visual principle while keeping Smile's real workflow. One folio carries role setup into application and CV evidence, one interview format is active, evidence feeds a human HR decision, and the scheduler follows that approval gate. The permanent rail and mini-map were removed. The result is a more focused screen at the same timestamps, not an invented chat interaction.

The first V4 timing pass revealed two new weaknesses at 13.9s and 21.2s: the call-answer panel and available-slot row had not appeared yet. The source was corrected before the final render: question/answer reveals now start at 12.58/13.38s and calendar/slot reveals at 20.58/20.88s. Final MP4 frames at both timestamps show populated, readable UI. The HR review now displays one synthetic strength and one synthetic follow-up area instead of a generic list. A final product-truth pass also split CV approval from the separate HR action that sends an interview invitation.

### Lessons added

- A larger UI card does not automatically make a scene readable; inspect the specific video timestamp where the key fact should land.
- For every scene, capture one frame during entry and one after the primary reveal. A blank card for even a short hold weakens the whole beat.
- Keep the product's causal chain in one object, then let content change inside it. Do not keep a permanent route rail if the focused card can carry the story.
- If the product has separate approval and invite controls, show both. A transition from approval straight to a candidate invitation can falsely imply the invite is sent automatically.
- When the role enables two interview formats, make the alternatives legible but animate only the path the synthetic candidate chooses.
- Check the cursor tip, click target and success state at the same timestamp; transition feedback should replace the button rather than overlap it.
- Compare the encoded MP4 with the previous encoded MP4 at identical timestamps. Source snapshots alone will not catch encode, audio or timing failures.
- Readable synthetic examples are useful when labeled and tied to a real product concept. Do not turn an illustrative score or slot into an asserted product outcome.

### V4 verification record

HyperFrames `check` passed with zero errors or warnings. The final landscape MP4 is 25 seconds at 1920×1080 / 30 fps, H.264 with stereo AAC. FFprobe found both streams and FFmpeg decoded the full file without errors. Final MP4 snapshots were compared against V3 at 1.8, 5.4, 8.8, 13.9, 18.0, 21.2 and 23.7 seconds.

## Rule updates

10. Every user-owned action shown in the workflow must have an explicit affordance and visible state change; never make consent or HR approval appear automatic.
11. A demo route can show illustrative slot selection without inventing calendar availability or implying an appointment is booked. Keep connection qualifiers visible.
12. Compare each iteration at identical times and render settings; record a source change and observed effect before assigning a score. Do not describe the rubric as objective or claim model training.
13. Check an entry frame and a post-reveal frame for every key scene in the encoded MP4; move the reveal earlier if the product panel is empty at the scene's main review moment.
14. Record same-time rendered comparisons and concrete workflow/animation changes before assigning any creative score. A subjective score is optional; do not use it as evidence of improvement by itself.

## Version 5 review — motion and product-story refinement

V5 keeps the accepted V4 workflow and visual identity while adding clearer cause-and-effect animation in the resume, phone interview, HR review, and scheduling beats. Same-time V4/V5 frames are collected in `improved/v5/snapshots/v4-v5-compare/paired-overview.png`; the independent review is `improved/v5/CREATIVE_REVIEW.md`.

- At **5.4s**, the resume becomes the source object for the next beat. At **6.14s**, “Tracked campaign performance” travels into the matching Campaign analytics criterion; the unrelated row dims during travel and returns afterward. This makes the score feel supported by evidence rather than decorative.
- At **13.9s**, three waveform groups and sequential answer lines give the phone call a beginning, middle, and finish. Keep the demonstration within the existing 10-minute Voice interview and do not imply Live Avatar is also used.
- At **17.5s**, the candidate’s answer has populated the HR transcript and its supporting phrase is highlighted before the synthetic strength panel appears. The human review remains pending.
- At **22.2s**, the cursor selects a synthetic one-hour option and the UI says “Selected choice · not booked.” The action reads clearly without suggesting an appointment was created.
- The CTA remains “Try Smile now.” SFX are timed to the visible paper, match, invite, call, review, approval, calendar, slot, and CTA actions.

### Lessons added

- Move one meaningful piece of evidence between real interface states; isolate the receiving criterion while the evidence travels, then restore surrounding context.
- Animate speech in readable phrases. A waveform alone is decoration; its pulses should correspond to a visible question and answer progression.
- Make the interview-to-HR handoff visible as the same answer becoming reviewable evidence, while preserving the HR decision gate.
- Show the candidate's cursor, chosen slot, and explicit not-booked status together in the same frame.
- Soundtrack dynamics can add energy without increasing peak level. Here the accepted score remains in place with a level lift through evidence/review, a dip around the call, and a gradual rise into scheduling/CTA.
- A generated music asset only counts as the delivered soundtrack when it is actually embedded in and verified against the final MP4. The requested Mureka asset was generated but could not be transferred from the ChatCut browser to the local project; V5 therefore uses the accepted V4 score with revised automation and SFX timing. Record that limitation directly.
- Compare the encoded outputs at identical timestamps and check both source-to-encode correspondence and complete A/V decoding.

### V5 verification record

HyperFrames `check` reported zero errors and zero warnings; all 79/79 contrast checks passed. The final V5 MP4 is 25.0 seconds at 1920×1080 / 30 fps, H.264 video with 48 kHz stereo AAC, and passed a full FFmpeg decode. Its mix measured −18.0 LUFS integrated, −7.1 dBTP, and 3.0 LU loudness range. V4 measured −20.7 LUFS and −10.0 dBTP. Same-time review used 5.4, 6.14, 13.9, 17.5, 22.2, and 24.8 seconds; encoded-frame checks also passed at 6.14, 13.9, 17.5, 22.2, and 24.8 seconds.

## Version 6 lessons — evidence, handoff, and pacing

- Before a meaningful evidence move, remove the source phrase. Keep one readable token in motion; reveal its linked destination only after the token clears. Let the receiving criterion respond before showing its illustrative score.
- Close a speech-driven product beat with a visible completion state, then carry one answer phrase into the review surface. A cut to a new interface alone does not explain what happened to the response.
- Human approval should resolve to an explicit approved state before a dependent candidate action appears. Keep a selected-but-not-booked calendar state visually unmistakable.
- Bring the first useful item into a panel as it settles. An empty card that opens before its content can make a fast scene feel stalled.
- Keep essential text at full contrast when it first appears. Small positional motion can preserve energy without fading decision labels through low-contrast frames.
- A same-time encoded comparison is useful for checking changed UI states and reveals, but it cannot establish continuous motion or subjective soundtrack quality. Record that limit when playback/listening is unavailable.
- Resume filename and supporting metadata need separate block layout; inline adjacent spans can collide even when the rest of the card is well spaced.
- Reuse an existing paid/generated score when the newer asset cannot be transferred through a supported path. Record the exact embedded file and hash; do not imply a cloud catalog entry is present in the MP4.

## Rule updates

15. During an evidence handoff, show one instance of the moving claim at a time; sequence source removal, token travel, destination reveal, criterion response, and score.
16. Enter critical decision copy at legible contrast; use positional, scale, or shape response for motion when a fade would make controls temporarily unreadable.
17. Reveal useful card content while the card settles; review the first populated moment, not only the final hold.
18. Distinguish what the encoded frame sheet, render checks, audio measurements, and a human full-playback listen each establish.

## Version 7 lessons — lower reading load and visible handoffs

- Replace a permanent process rail and repeated scene narration with one short current-step marker when the product interface already explains the action. Keep qualifications such as synthetic data, alternatives, and not-booked status visible.
- Count authored copy with one repeatable method before and after the edit. Record the exclusions and do not use a smaller type size or faster reveal to manufacture a reduction.
- Removing copy only helps when the product action grows into the recovered space. Compare paired encoded frames to confirm the UI itself became more legible and dominant.
- Show separate user-owned actions as separate controls and outcomes. A CV approval must not visually imply that an interview invite was automatically sent.
- For a transfer between screens, reveal the destination surface before the moving evidence arrives. A floating answer over a blank folio weakens the cause-and-effect handoff even if the final transcript is correct.
- Inspect the encoded frame at the exact handoff timestamp after each timing correction. A source animation starting earlier is not proof that the destination is visible in the final MP4.
- Leave a truthful selected-but-not-booked result on screen, then hold the CTA still for at least two seconds.
- A one-frame-per-second sheet cannot establish continuous motion, normal-speed reading, sound synchronization, or a subjective full-mix impression. State which evidence was actually reviewed.

## Rule updates

19. Measure visible authored copy with the same script and exclusions across versions; report raw counts and percentage change.
20. During a cross-screen handoff, make the destination panel readable before the incoming object reaches it; verify the exact encoded landing frame.
21. A review frame sheet and technical render check do not substitute for full playback/listening. Report that limitation when continuous review is unavailable.
