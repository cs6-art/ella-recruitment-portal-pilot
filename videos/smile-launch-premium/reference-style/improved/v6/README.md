# Smile Recruitment Portal Promo — V6

V6 is a 25-second, 1920×1080, 30 fps product promo built as an editable HyperFrames composition.

## Files

- `scripts/build-smile-v6.mjs` — source builder for the film.
- `index.html` — generated editable composition.
- `renders/smile-recruitment-portal-v6-final.mp4` — final H.264/AAC render.
- `snapshots/v5-v6-compare/paired-overview.png` — encoded V5/V6 frames at identical timestamps.
- `CREATIVE_REVIEW.md` — three targeted weak moments, changes, and review limits.
- `CLAIM_SOURCES.md` — source notes for product claims (carried forward from V5).

## Rebuild

From this directory:

```powershell
npm run build
npm run check -- --snapshots
npm run render -- --quality delivery --output renders/smile-recruitment-portal-v6-final.mp4
python scripts/make-v5-v6-compare.py
```

The comparison script requires Pillow. Use a Python environment with Pillow installed if the system Python does not include it.

## Soundtrack

The embedded music is `assets/audio/smile-original-score.wav`, the accepted score carried from V4 into V5. Its SHA-256 is identical in V5 and V6 (`BF2690F3FF97120BED0884E7012D6D922569640F8DD7DC8EBE54DE84F00C443E`). The separate Mureka track remained cloud-only after the supported download attempt, so no replacement track was generated. V6 keeps the score and changes its level arc, with restrained paper, evidence, interface, call-complete, approval, slot, and CTA cues.

## Workflow shown

HR defines and publishes a role; the synthetic applicant submits a resume; evidence is linked to criteria for HR review; HR approves the CV and separately sends the voice interview invitation; the candidate completes a 10-minute phone interview; HR reviews the transcript and summary and decides whether to advance; then the candidate selects a synthetic one-hour slot marked **not booked**. The 82/100 match is synthetic and a review aid, not a hiring decision. The CTA is **Try Smile now**.
