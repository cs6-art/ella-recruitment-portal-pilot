# Before/after analysis

This analysis compares the baseline V1 export with the final V3 export at identical timestamps. The same weighted rubric is used for every generation.

| Baseline time | V1 weakness | V3 design change | Visible result |
|---|---|---|---|
| 0.0–3.0 s | Centered logo/tagline fades; no product action. | A role brief enters and resolves into a Smile-drafted role card. | The workflow starts with a real, product-backed object; role setup precedes applications. |
| 6.0–10.0 s | Static screening screenshot, cursor/scan box and unexplained 82% badge. | Native application and evidence UI; criteria bars resolve one by one; match stays explicitly illustrative. | Resume evidence becomes reviewable; HR review remains a visible gate before interview. |
| 10.0–15.0 s | Interview-choice menu; no interview in progress. | Two clearly labeled alternative formats. Voice has a moving waveform/transcript; Live Avatar begins only after recording consent and device check plus a continue action. | The audience sees the actual alternatives and a cause/result for the avatar state. |
| 15.0–19.0 s | Static review screenshot with cursor/focus rectangle; no evidence flow. | A response transcript arrives beside criterion evidence, strengths/gaps and HR controls. | HR owns the decision; the AI summary does not approve/reject automatically. |
| 19.0–22.0 s | Six dense tiles reduce the workflow to an unreadable contact sheet. | One candidate route advances through HR gates and ends on a candidate-facing one-hour slot choice. | The route has a legible consequence: schedule after approval. |

The exact same-time visual pairs are here:

![V3 render beside V1 at the five weakest scene times](snapshots/compare-v1/before-after-five-weakest-scenes.jpg)

![V3 beside V2 at the same five moments](snapshots/compare-v2/v2-to-v3-five-scene-progress.jpg)

## Weighted creative scores

| Version | Reference language 25% | Animation 20% | Art direction 15% | Story/copy 15% | Product accuracy 15% | Sound/finish 10% | Weighted |
|---|---:|---:|---:|---:|---:|---:|---:|
| V1 baseline | 4 | 4 | 5 | 5 | 7 | 6 | 5.0/10 |
| V2 structural | 5.5 | 7.5 | 7 | 8 | 8.5 | 6.5 | 7.1/10 |
| V3 final | 6.5 | 8 | 7.5 | 8.5 | 9 | 6.5 | 7.6/10 |

V3 gains 2.7 points over V1 and 0.6 over V2 on this consistent, human-scored rubric. The most measurable changes are structural: five identified weak beats were rebuilt, no key product scene is screenshot-only, the candidate route now progresses through the HR gates, and three previously implied user actions are explicit. The rubric remains a creative review judgment, not an objective model metric.

## Technical verification

- Final landscape: 25.0 s, 1920×1080, 30 fps, H.264 + AAC stereo at 48 kHz.
- Final portrait: 25.0 s, 1080×1920, 30 fps, H.264 + AAC stereo at 48 kHz.
- Both `npm run check` runs passed with zero lint/runtime/layout/motion errors or issues. Nine minor contrast warnings remain on small status/indicator details (4.41–4.45:1 vs. 4.5:1 target).
- Both MP4s were fully decoded with FFmpeg and probed with FFprobe.
