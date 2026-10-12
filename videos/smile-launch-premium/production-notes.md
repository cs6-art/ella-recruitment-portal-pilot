# Production notes

## Deliverables

- smile-launch-premium.mp4 — 1920×1080, 16:9, 30 fps, 25 seconds, H.264 video with AAC stereo audio.
- smile-launch-vertical.mp4 — 1080×1920, 9:16, 30 fps, 25 seconds, H.264 video with AAC stereo audio. This is its own composition.
- smile-launch-poster.png — 1920×1080 PNG extracted from the landscape end card at 24.6 seconds.
- index.html, compositions/frames/, assets/, scripts/, STORYBOARD.md, BRIEF.md, and frame.md — editable project source and local resources.
- research-references.md, creative-direction.md, and quality-control.md — research, art direction, and final checks.

## Source and editability

The landscape and portrait compositions each contain seven editable scene files, an assembled timeline, local UI plates, the official Smile logo, font files, score, and sound cues. scripts/generate-scenes.mjs generates the scene HTML for the chosen canvas size. scripts/render-audio.mjs creates the local score and cue WAV files. Editing generated scene files directly is appropriate for a one-off change; rerunning the scene generator replaces those files.

HyperFrames CLI is pinned at version 0.8.143 in the package scripts. A compatible Node.js install and FFmpeg/ffprobe on PATH are needed for a local re-render. The FFmpeg binaries used for this export were a temporary local tool runtime and are not included in the campaign folder.

## Re-render

From the campaign directory, rerender the landscape master:

    npx hyperframes@0.8.143 check
    npx hyperframes@0.8.143 render . --output smile-launch-premium.mp4 --fps 30 --resolution landscape --quality delivery

Then rerender the portrait composition:

    Set-Location vertical
    npx hyperframes@0.8.143 check
    npx hyperframes@0.8.143 render . --output ..\smile-launch-vertical.mp4 --fps 30 --resolution portrait --quality delivery

To regenerate the authored scene HTML intentionally, run node scripts/generate-scenes.mjs . 1920 1080 in the campaign directory, or node scripts/generate-scenes.mjs . 1080 1920 from vertical. To rebuild the score and sound cues, run node scripts/render-audio.mjs in the corresponding project directory. Rerender after regenerating either source.

## Product and data accuracy

- Resume screening supports HR with a match score and evidence such as strengths and gaps; it is not a hiring decision.
- Screening criteria and interview questions can be AI drafted; HR reviews them before publishing.
- The scheduled voice call is labeled as 10 minutes. The Live Avatar option is shown with the product privacy notice and recording consent before its start state. The candidate chooses one available format.
- HR reviews interview evidence and makes the decision. The campaign does not show AI approving or rejecting a candidate.
- Scheduling is represented as a workflow stage. A connected Google Calendar is required for calendar scheduling.
- The 82% score and all candidate details in the interface plates are synthetic illustrative demo data, not a product promise or outcome.

No production records, real candidate data, credentials, fabricated customer outcomes, or unverified integrations were used. The original promo source and export were left in place.


