# Smile Recruitment Portal Promo — V7

V7 is a 25-second, 1920×1080, 30 fps editable HyperFrames composition. It keeps V6's accepted Smile identity and workflow, cuts authored on-screen copy by 61.5%, and makes the five product steps visible through the portal's actions and results.

## Files

- `scripts/build-smile-v7.mjs` — editable source builder.
- `index.html` — generated composition.
- `renders/smile-recruitment-portal-v7-final.mp4` — final video.
- `CREATIVE_REVIEW.md` — chapter timing, word-count audit, V6 comparison, measurements, and review limits.
- `CLAIM_SOURCES.md` — product behavior and synthetic-data notes.
- `snapshots/v6-v7-five-step-comparison.png` — paired V6/V7 encoded frames with both timestamps labeled.
- `review/v7-one-second-encoded-review.png` — one encoded frame per second.
- `review/v7-key-actions-encoded-review.png` — encoded frames around key action beats.
- `scripts/count-copy.py` — repeatable HTML text-node word count.
- `scripts/make-v6-v7-compare.py` — rebuilds the V6/V7 and encoded V7 review sheets.

## Five-step timing plan

| Chapter | Time | Action → result |
|---|---:|---|
| 01 · Create role | 0.3–3.5 s | AI draft resolves; HR publishes; the role link appears. |
| 02 · Review applications | 3.5–9.6 s | Resume phrase links to Campaign analytics; HR approves the CV, then separately sends the invite. |
| 03 · Complete interview | 9.6–14.7 s | Voice is selected over Live Avatar; one 10-minute phone-call example shows a question and concise answer. |
| 04 · HR decides | 14.7–19.35 s | The answer transfers into a visible transcript; one summary finding appears; HR approves the next stage. |
| 05 · Choose a time | 19.35–22.15 s | After HR approval, the candidate selects one synthetic one-hour slot; it remains not booked. |
| CTA | 22.8–25.0 s | **Try Smile now** holds in place for 2.2 seconds. |

## Build and verify

```powershell
npm run build
npm run check -- --snapshots
npm run render -- --quality delivery --output renders/smile-recruitment-portal-v7-final.mp4
python scripts/count-copy.py ../v6/index.html index.html
python scripts/make-v6-v7-compare.py
```

The embedded score is `assets/audio/smile-original-score.wav`, the accepted V4 score (SHA-256 `BF2690F3FF97120BED0884E7012D6D922569640F8DD7DC8EBE54DE84F00C443E`). No replacement paid music was generated. The final mix measures −18.8 LUFS integrated, 3.3 LU LRA, and −7.1 dBFS true peak.

HyperFrames check passes with no lint, runtime, layout, or motion issues; contrast checks pass 70/70. The final MP4 is H.264 with 48 kHz stereo AAC and passes full FFmpeg decode. Continuous playback and listening were unavailable in this session; see `CREATIVE_REVIEW.md` for the review limits.

The shared lessons and iteration record are in the parent `improved` folder.
