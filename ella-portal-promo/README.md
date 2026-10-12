# Ella Recruitment Portal Pilot promo

This folder contains the editable HyperFrames source and the rendered advertisement. The composition is based on the portal repository's actual names, capabilities, UI labels, colors, and layout conventions.

## Deliverables

- `ella-recruitment-pilot.mp4` — 25-second, 1920×1080 H.264 video at 30 fps, with a stereo AAC original music bed.
- `index.html` — editable HyperFrames composition and motion timeline.
- `STORYBOARD.md` and `BRIEF.md` — story, source constraints, and creative choices.
- `assets/` — the source portal logo, local GSAP runtime, and generated score.
- `scripts/` — deterministic score generation and the Windows HyperFrames/FFmpeg runner.
- `screenshots/` — representative frame snapshots and a motion-sequence strip from the final render.
- `capture/` — source notes, verified brand tokens, and the copied logo asset.

The reconstructed application screens are **illustrative, noninteractive recreations** based on source components. Every screen carries an `ILLUSTRATIVE UI` label. Candidate names, role labels, and any displayed example score are fictional demo data; no real candidate records were used. The app itself was not launched against its configured services.

## Regenerate

Requirements: Node.js 22 or newer and FFmpeg/FFprobe. On Windows, the included runner detects the `Gyan.FFmpeg` WinGet installation used to render this video.

```powershell
npm install
npm run score
npm run check
npm run render
```

`npm run score` rebuilds `assets/ella-promo-score.wav` from the deterministic, sample-free synth in `scripts/create-score.mjs`. `npm run check` runs HyperFrames validation. `npm run render` writes `ella-recruitment-pilot.mp4` in this folder. The helper script temporarily adds the known WinGet FFmpeg folder to `PATH` for these commands.

Media validation used FFprobe to confirm 25 seconds, 1920×1080, 30 fps H.264 video, and 48 kHz stereo AAC audio. Representative stills were extracted from the rendered MP4 with FFmpeg.

The app repo's `AGENTS.md` requires reading the installed Next.js docs before framework-level app edits. This promo is a separate HTML/HyperFrames project and does not change the portal app.

## Content and licensing notes

- HyperFrames is Apache-2.0 and local rendering consumes no HeyGen credits. No hosted render, voice, avatar, or media-generation service is used.
- GSAP 3.14.2 uses GreenSock's standard no-charge license, including commercial use: <https://gsap.com/standard-license>.
- The music is synthesized from code in this folder with no third-party samples or recordings.
- The logo was copied from the repository's existing `public/smile-recruitment-portal-logo.png`.
- FFmpeg is used locally for encoding and validation and is not bundled here.

## Source references

- `src/app/globals.css` — portal color tokens and system UI font stack.
- `src/components/AppShell.tsx` and `src/components/AppShell.module.css` — navigation and branding.
- `src/app/resume-screening/page.tsx` and `src/components/BulkResumeScreeningPanel.tsx` — resume intake and queue UI.
- `src/app/applicants/[applicationId]/page.tsx` — applicant evidence and review labels.
- `docs/WORKING-RECRUITMENT-WORKFLOW.md` and `docs/LIVE-AVATAR-INTEGRATION.md` — interview choices and human-review workflow.
