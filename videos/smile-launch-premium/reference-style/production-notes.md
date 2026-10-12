# Production notes — Version 2 final

- Runtime: 25 seconds at 30 fps.
- Landscape master: `smile-launch-reference-style.mp4` — 1920 × 1080, H.264 video + AAC stereo audio, 7.87 MB.
- Portrait master: `smile-launch-reference-vertical.mp4` — 1080 × 1920, independently composed, H.264 video + AAC stereo audio, 7.44 MB.
- Poster: `smile-launch-reference-poster.png` — extracted from the final landscape export at 24.5 seconds, 1920 × 1080.
- Audio: original local Smile campaign score and designed interface sound effects; no narration.
- Fonts and visual assets are local project assets.
- Applicant details and the 82% sample score are synthetic. The visible workflow timing is condensed and does not imply processing speed.
- The role-specific route includes role setup and HR publication; candidate application with resume/privacy notice; role-based CV evidence; HR review before an interview invitation; one role-enabled interview; a second HR review; and final face-to-face scheduling against a configured calendar. Google Calendar availability is conditional on connection.
- Live Avatar is shown as up to about five minutes, after recording, camera, and microphone consent. The voice call is ten minutes. HR owns each hiring decision.

Regenerate landscape scenes from this directory with `node scripts/generate-reference-style.mjs . 1920 1080`. Regenerate portrait scenes from `vertical` with `node ..\scripts\generate-reference-style.mjs . 1080 1920`. The project uses HyperFrames 0.8.143.
