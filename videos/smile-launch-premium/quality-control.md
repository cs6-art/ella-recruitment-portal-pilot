# Quality control

## Export verification

Both MP4s decoded through FFmpeg without errors. ffprobe reports the requested frame sizes, 30 fps H.264 video, 48 kHz stereo AAC audio, and a duration of 25.000 seconds.

| File | Video | Size | File size | Audio |
|---|---|---:|---:|---|
| smile-launch-premium.mp4 | 1920×1080, H.264, 30 fps | 25.000 s | 11,071,208 bytes | AAC, stereo, 48 kHz |
| smile-launch-vertical.mp4 | 1080×1920, H.264, 30 fps | 25.000 s | 9,963,004 bytes | AAC, stereo, 48 kHz |

The 1920×1080 poster was extracted from the landscape master at 24.6 seconds and visually checked. The final card shows the Smile mark and the exact CTA “Try Smile now”.

## Motion and image review

Reviewed the landscape and portrait contact sheets across the complete seven-scene timeline, plus representative captures of the hook, screening result, consent state, connected workflow, and end card. The portrait version has its own layout and readable interface crops.

The rendered motion includes a moving résumé stack, staged UI reveals, a score-ring draw, interview-choice movement, consent reveal before the avatar start state, cursor/focus animation, an applicant marker traveling along the five workflow stages, and a closing mark/CTA assembly. The score, progress marker, and UI interactions animate; the campaign is not a static slide sequence.

The synthetic interface plates keep the visible ILLUSTRATIVE UI · DEMO DATA label. Product review controls are shown but not activated. The interview formats appear as choices, and the workflow states that HR makes the hiring decision.

## Automated checks

- HyperFrames lint: 0 errors and 0 warnings for each composition.
- Runtime and motion checks: 0 errors for each composition.
- Transition verification: all 6 of 6 inter-scene transitions verified in each composition.
- Contrast audit: 27 of 27 audited landscape text instances meet WCAG AA; the portrait check reported no contrast failures.
- Full-file FFmpeg decode: passed for both MP4s.
- EBU R128 analysis of the encoded audio: both cuts measure approximately −18.2 LUFS integrated loudness and 0.9 LU loudness range. True peak is −7.9 dBFS landscape and −7.8 dBFS portrait, leaving headroom.

## Reviewed checker findings

HyperFrames reports two content-overlap warnings at 19.125 and 19.25 seconds in each version. These occur during the designed handoff from HR review into the workflow overview. The settled workflow frame was reviewed after the overlap, and the UI cards and route remain readable. The checker also lists the intentional route connector and off-canvas transition elements as informational findings.

## Scope

No production candidate records were used. The score is original and synthesized locally. The existing campaign and source project were left intact. No production portal changes or publishing were performed.
