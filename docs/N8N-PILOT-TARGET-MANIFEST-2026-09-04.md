# Ella PILOT n8n target manifest

Status: **INACTIVE / preparation only**. This file is a local review
manifest, not an activation instruction. No n8n workflow was edited, imported,
published, or enabled by this preparation.

The n8n pilot instance must call the portal internal API with its credential
only. It must never receive `DATABASE_URL` or any other database credential.
The target routes are protected by `INTERNAL_API_SECRET` and an explicit
`INTERNAL_API_ENTITIES` entry. The currently configured allowlist remains the
four already-cleared entities, so all new target entities below are disabled
until separately reviewed and configured.

## Workflow inventory

| Workflow / domain | Pilot target | Target API contract | Status | Live rollback export |
|---|---|---|---|---|
| `29HvXI7H4eKUJ1Uv` Voice Result Status Sync | voice results/status | `GET voice/results`, `POST voice/results`, `GET status-history` | INACTIVE | BLOCKED-MANUAL: n8n export access not available locally |
| `cTJHm2ZAJQap7uWW` Scheduled Voice Calling | voice queue/attempts | `POST voice/queue/claim`, `POST voice/attempts/status`, `POST voice/logs` | INACTIVE | BLOCKED-MANUAL |
| Drive/bulk downstream | bulk queue | `POST bulk/queue/claim`, `POST bulk/queue/status` | INACTIVE | BLOCKED-MANUAL |
| role/requisition | roles/status | `GET/POST roles`, `POST roles/status` | INACTIVE | BLOCKED-MANUAL |
| applicant/application intake | applications | `GET/POST applicants`, `GET/POST applications` | INACTIVE | BLOCKED-MANUAL |
| screening | screening/invitations | `GET/POST screening`, `POST screening/invitations` | INACTIVE | BLOCKED-MANUAL |
| HR decision | HR decisions | `GET hr-decisions/queue`, `POST hr-decisions` | INACTIVE | BLOCKED-MANUAL |
| booking/F2F | bookings | `GET/POST bookings`, `POST bookings/tokens` | INACTIVE | BLOCKED-MANUAL |
| notification | notification data | `GET/POST notifications` | INACTIVE | BLOCKED-MANUAL |

The checked-in JSON/TypeScript files under `integrations/n8n/` are source
contracts and workflow building blocks, not verified exports of the current
live pilot workflows. A real rollback export must be downloaded from the pilot
n8n instance immediately before any future activation. Therefore verified live
rollback exports are **0/9** in this local-only preparation.

## Activation gate

For each row, a future operator must export the current pilot workflow, save a
versioned copy, review the API mapping, set the relevant entity flag, run the
synthetic UAT scenario, and only then activate the target version. This phase
does not perform any of those external activation actions.
