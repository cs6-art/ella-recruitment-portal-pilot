# Independent creative review — V5 against V4

## Review method

Compared V5 and the encoded V4 MP4 at the same timestamps. The six paired moments are in `snapshots/v4-v5-compare/paired-overview.png`. The V5 source was also paired against its final encoded MP4 at 6.14, 13.9, 17.5, 22.2 and 24.8 seconds; those checks are in `snapshots/v5-encoded-check/`. This review uses the selected frames and a full decode check, not an uninterrupted playback judgment.

The YouTube reference succeeds by keeping one central result alive while it gains evidence and detail. V5 carries that motion principle into Smile's actual resume review, phone interview, HR evidence and slot selection. It does not invent a prompt-based workflow.

## What changed visibly

| Timestamp | V4 frame | V5 frame | Creative effect |
|---|---|---|---|
| **5.4s** | Role/applicant material is presented as a static UI composition. | The application folio now occupies the scene and the resume excerpt is the visual source for the next evidence beat. | The viewer reaches the candidate workflow earlier and follows a concrete object into review. |
| **6.14s** | Criteria bars and the synthetic match score carry the information. | The phrase “Tracked campaign performance” lands against Campaign analytics; unrelated evidence dims during the transfer, then returns. | The match has a visible cause in the resume rather than appearing as an isolated score. |
| **13.9s** | A single call waveform sits beside the response. | Three timed waveform envelopes and sequential answer lines give the phone exchange a start, middle and resolution. | The call has a stronger rhythm while remaining a 10-minute phone interview. |
| **17.5s** | The HR review card has an empty transcript response area at this moment. | The spoken answer has landed in the transcript, one supporting phrase is highlighted, and the synthetic strength panel is visible. | Interview evidence now resolves into something HR can review. The human decision badge remains pending. |
| **22.2s** | The scheduler shows an available slot selection. | A click/check state marks one slot and says “Selected choice · not booked.” | The candidate action is legible without implying a calendar appointment was made. |
| **24.8s** | The same centered Smile message and CTA close the cut. | The accepted CTA remains “Try Smile now.” | The final brand lockup is preserved. |

## Motion and sound decisions

- Replaced the repeating full-folio rotation with more restrained content-specific handoffs. The resume phrase moves into its matching criterion; the interview response lands in the transcript; the scheduler shows a real selection state.
- The waveform has three timed pulse groups rather than one generic pulse. The slot pointer clicks the second synthetic option and then clears.
- Re-timed paper, match, invite, call, review, approval, calendar, slot and CTA cues around their visible actions. The score now fades in, dips around the phone call, rises through HR review and scheduling, and fades out with the CTA.
- The final mix measures **−18.0 LUFS integrated**, **−7.1 dBTP**, and **3.0 LU loudness range**. V4 measured −20.7 LUFS and −10.0 dBTP, so V5 is 2.7 LU louder with peak headroom preserved.

## Product truth and remaining limit

The voice call remains one selected interview path; Live Avatar is not shown as a second completed step. HR still owns the decision. Candidate evidence, 82/100 match, transcript and calendar examples remain synthetic. The slot is selected but explicitly not booked. The CTA is unchanged.

The requested Mureka instrumental was generated once and exported through the ChatCut browser, but that download was not exposed to the local project filesystem. The delivered V5 MP4 therefore keeps the V4 score and improves its level contour and sound-effect timing; it does not contain the separate Mureka file. It can be swapped in when that MP3 is present in `assets/audio/`.

## Verification

- HyperFrames `check`: 0 errors, 0 warnings; all 79/79 contrast checks pass. The 13 informational overlap notices are on intentional scene crossfades.
- Final MP4: 25.0 seconds, 1920×1080, 30 fps, H.264 video, 48 kHz stereo AAC audio; 6.8 MB.
- FFmpeg decoded the full video and audio without errors. FFprobe confirmed both streams and exact duration.
- The final render matches the selected source frames at 6.14, 13.9, 17.5, 22.2 and 24.8 seconds.
