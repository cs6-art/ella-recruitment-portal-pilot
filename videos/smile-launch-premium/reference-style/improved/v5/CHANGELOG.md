# V5 changes

- Created an isolated V5 project and editable builder: `scripts/build-smile-v5.mjs` → `index.html`.
- Added a synthetic resume excerpt, moved its matching evidence phrase into Campaign analytics, focused the criterion during travel, and revealed the match score after the evidence lands.
- Replaced the single call waveform pulse with three timed energy groups and made the answer reveal line by line.
- Carried the interview answer into the HR transcript and highlighted its matching evidence phrase before the summary and strength appear.
- Changed the scheduler from a preselected-looking state to an explicit pointer click and selected state; the label says “Selected choice · not booked.”
- Re-timed existing SFX around those interactions and added resume-reveal and slot-selection cues.
- Added a music volume envelope: fade-in; lift through evidence; lower level around the call; gradual lift through review, scheduling and CTA; clean fade-out.
- Generated one original Mureka instrumental as requested. Its export remained in ChatCut's browser download area and was unavailable to the local filesystem; V5 therefore retains the accepted V4 score bed and uses the new mix automation.
- Added `scripts/render.ps1` so `npm run render` can locate FFmpeg in a standard WinGet installation without changing the system PATH.

## Output

- `renders/smile-recruitment-portal-v5-final.mp4`
- `snapshots/v4-v5-compare/paired-overview.png`
- `snapshots/v5-encoded-check/`
