# PILOT recruitment Sheets classification

Historical pre-Postgres recruitment data remains in Google Sheets as a
read-only archive/reference and is not part of the pilot operational cutover.

## Operational (must be removed from target paths before cutover)

- `Role_Requests`: role creation, status changes, recruitment setup, and role
  status polling in the current portal/n8n paths.
- `High_Match_Profile`: application pipeline, screening results, HR decisions,
  voice status, and booking state in current portal/n8n paths.
- `Voice_Call_Queue`: current scheduled-call polling, locks, retries, and
  provider state.
- `Voice_Interview_Results` and `Call_Logs`: current result/status sync.
- `Interview_Slots` and `Final_Interview_Tracking`: current booking and F2F
  state.
- `Bulk_Resume_Queue`: current bulk intake and downstream status updates.
- `Candidate_Status_History` / `Role_Status_History`: current audit and
  notification state.

The target internal APIs do not import Google Sheets. The existing portal and
live n8n paths still do, so the operational dependency count is not zero and
the target stack is not ready for migration.

## Reporting / export

Any deliberately retained Sheets write used only for management reporting,
CSV export, or an audit mirror may remain after a target cutover, provided it
is not read as an operational queue or used to decide state.

## Archive / reference

All pre-cutover recruitment rows and legacy workbooks remain unchanged in
Sheets. No historical normalization or deletion is part of this pilot.

## Configuration

Workbook IDs, tab names, application links, notification endpoints, and other
portal settings are configuration dependencies. They are not operational
queue state, but target APIs must receive configuration through a reviewed
server-side setting rather than direct n8n database access.
