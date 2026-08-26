# Application invitation email

Import `application-invite-email.json` into n8n and complete these two settings:

1. Assign the existing **Gmail account 4** credential to **Send Application Invitation**.
2. Protect the webhook with a header credential named `Application invite webhook secret` that checks `X-Webhook-Secret` against the same value used by the portal as `N8N_WEBHOOK_SECRET`.

Activate the workflow and set this server-only portal variable:

```text
N8N_APPLICATION_INVITE_EMAIL_WEBHOOK_URL=https://n8n.srv1457709.hstgr.cloud/webhook/application-invite-email
```

The portal sends the candidate name, candidate email, role, personal application link, and expiry date. The workflow sends the message and returns `{ "success": true }` so the portal can show that the email was sent.

For the first check, use the portal button with `cs6@mclinkgroup.com` as the candidate email. Confirm receipt before sending invitations to real candidates.
