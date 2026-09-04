# Ella pilot clean-start recruitment plan

## Boundary

The pilot recruitment database is now the operational source of truth for new
pilot/UAT scenarios. Google Sheets historical recruitment data is retained
unchanged as a read-only archive, reporting/export source, and historical
reference. It is not normalized or used as a new operational queue.

The pilot Neon pre-migration branch remains the recovery point. Credits,
payments, payment events, `_migrations`, and the existing Google Sheets credit
ledger are outside the recruitment reset/seed boundary.

## Guarded commands

Both commands require pilot-main database identity and explicit confirmation:

```text
npm run db:reset:recruitment:pilot -- --confirm-pilot-reset
npm run db:seed:recruitment:pilot -- --confirm-pilot-seed
```

The reset deletes only the recruitment tables introduced by `0003` and
`0004`, in foreign-key-safe order. It never deletes credit/payment tables or
migration history. The seed refuses to run when recruitment tables are
non-empty and inserts only synthetic `example.invalid` identities.

## Seeded scenarios

- `PILOT-DUMMY-APP-A`: normal successful applicant with screening, completed
  voice result/log, and booked final interview state.
- `PILOT-DUMMY-APP-B`: no-show voice attempt followed by a scheduled retry.
- `PILOT-DUMMY-APP-C`: synthetic Drive/bulk queue item with screening result.

The seed does not perform a credit deduction. Credit charging must be tested
through the authenticated operational API after that API path is complete.

## Internal API cutover gate

The inactive target surface now covers role/application creation and reads,
screening reads/writes and invitations, bulk claims/status, voice claims,
attempts/results/logs, HR decisions, booking/F2F state, status/history, and
notification data. Every endpoint remains behind `INTERNAL_API_SECRET` and
`INTERNAL_API_ENTITIES`; n8n must never receive `DATABASE_URL`.

The target surface is not an activation or migration. New entity flags are not
enabled by this document, and no portal routing or n8n workflow has been
changed.

No n8n workflow has been changed in this phase. The workflow IDs
`29HvXI7H4eKUJ1Uv` and `cTJHm2ZAJQap7uWW`, followed by Drive/bulk processing,
remain Sheets-dependent until their rollback versions, API contracts, and
dummy-data tests are reviewed.
