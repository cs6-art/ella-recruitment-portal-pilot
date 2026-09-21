# Ella Credits payments — pilot contract

The pilot uses HitPay sandbox only. `HITPAY_BASE_URL` is an API base URL that
includes the version path:

```text
HITPAY_MODE=sandbox
HITPAY_BASE_URL=https://api.sandbox.hit-pay.com/v1
HITPAY_WEBHOOK_SECRET=<sandbox webhook endpoint salt>
```

The application appends `/payment-requests` and
`/payment-requests/<id>`. Do not configure the host-only URL and do not add a
second `/v1`.

Ella Credits are priced at S$0.40 each. The built-in packs are 10 credits for
S$4.00, 50 credits for S$20.00, and 100 credits for S$40.00. The client sends
only a pack id; the server derives both the quantity and amount.

The deployed webhook route is:

```text
https://ella-recruitment-portal-pilot.vercel.app/api/webhooks/hitpay
```

Register that URL in the HitPay Sandbox Dashboard under Developers → Webhook
Endpoints and subscribe to `payment_request.completed` and
`payment_request.failed`. The dashboard webhook uses a raw JSON body and the
`Hitpay-Signature` HMAC-SHA256 header. The webhook endpoint salt belongs in
`HITPAY_WEBHOOK_SECRET`; do not put it in browser code or logs. The older
`webhook` field is intentionally not sent in payment creation because HitPay’s
current online-payments guide marks it deprecated.

Credits are granted only after a signature-verified completed provider event,
with a valid amount and matching currency/reference. Missing, malformed, or
mismatched amounts are rejected. Payment-event deduplication recognizes only
the `payment_events.dedupe_key` unique conflict; other database errors return a
failure so HitPay can retry.

The manual credit UI accepts positive whole-number additions and a required
reason. Credit management is limited to the CEO or Admin preset with settings
access and HR users with review access. Recruiter, Interviewer, Hiring Manager,
Management, HOD, and requester users are denied. There is no separate IT Admin
preset in the pilot; CEO and Admin are the administrative paths.

All authenticated users can open `/credits` and start a server-priced HitPay
purchase. Only CEO, Admin, and authorized HR users see the manual top-up control.
Payment status and reconciliation are limited to the purchaser, except that
authorized credit managers may review payments. Credits are granted only by
the verified webhook transition.
