# Ella Credits payments — pilot contract

The pilot uses HitPay sandbox only. `HITPAY_API_URL` is an API base URL that
includes the version path:

```text
HITPAY_MODE=sandbox
HITPAY_API_URL=https://api.sandbox.hit-pay.com/v1
```

The application appends `/payment-requests` and
`/payment-requests/<id>`. Do not configure the host-only URL and do not add a
second `/v1`.

Credits are granted only after a signature-verified completed provider event,
with a valid amount and matching currency/reference. Missing, malformed, or
mismatched amounts are rejected. Payment-event deduplication recognizes only
the `payment_events.dedupe_key` unique conflict; other database errors return a
failure so HitPay can retry.

The manual credit UI accepts positive whole-number additions and a required
reason. Credit management is limited to the Admin preset with settings access
and HR users with review access. Recruiter, Interviewer, Hiring Manager,
Management, HOD, and requester users are denied. There is no separate IT Admin
preset in the pilot; Admin is the administrative path.

All authenticated users can open `/credits` and start a server-priced HitPay
purchase. Only Admin and authorized HR users see the manual top-up control.
Payment status and reconciliation are limited to the purchaser, except that
authorized credit managers may review payments. Credits are granted only by
the verified webhook transition.
