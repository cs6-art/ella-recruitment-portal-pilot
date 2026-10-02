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

Ella Credits are priced at S$0.40 each by default. Set the `ELLA_CREDIT_PRICE_CENTS` environment variable (for example `50`) to change the per-credit price, which also reprices the packs and custom amounts. The built-in packs are Starter (50 credits for
S$20.00), Standard (100 credits for S$40.00) and Bulk (2,000 credits for
S$800.00). Buyers can also enter any whole number of credits from 1 to 10,000
at the same rate. The client sends only a pack id or a credit quantity; the
server derives the amount.

A purchase of 2,000 credits or more earns a 10% volume bonus, so Bulk adds 200
bonus credits. The bonus is a separate `volume_discount` ledger row written in
the same transaction as the purchase. The threshold and percent come from the
`Ella_Credit_Discount_Threshold` and `Ella_Credit_Discount_Percent` portal
settings (defaults 2000 and 10).

The deployed webhook route is:

```text
https://smile.mclinkgroup.com/api/webhooks/hitpay
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

## Costs and holds (updated 29 September 2026)

The product name is now **Smile Credits**. One organisation shares one balance, held in the
Postgres organisation wallet (`credit_accounts`). Prices, in credits:

| Action | Credits |
| --- | --- |
| CV analysis (each resume that screens successfully) | 1 |
| AI phone interview, completed | 10 |
| AI phone interview, connected but incomplete | 8 |
| AI phone interview, no answer | 5 |
| Interview with Smile on video (live avatar) | 20 |

Duplicate resumes for the same role and failed or invalid files are not charged.

A video interview reserves its 20 credits in a **credit hold** (`credit_holds`) when the
candidate starts it, under a row lock so two starts cannot spend the same credits. The hold is
released if the session cannot start or the recording cannot be set up, and converted into the
charge (idempotency key `live-avatar-session:<sessionId>`) when the interview is billed. Voice
interviews use the same hold mechanism. If the balance is short, the interview is refused
before any provider cost is incurred.

Payments are still HitPay. `HITPAY_MODE=sandbox` moves no real money; switch to live keys and
URLs only when the organisation is ready to take payment.
