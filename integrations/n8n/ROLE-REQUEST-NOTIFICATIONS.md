# Role request notification workflow

The portal does not send role-request email itself. It posts the submitted
request to the role webhook and expects n8n to write the `Role_Requests` row,
send the internal notification, and return the notification result.

Import `role-request-foundation.json` into n8n, then complete these settings:

1. Assign the `Role request webhook secret` header-auth credential. Its value
   must match the portal's `N8N_WEBHOOK_SECRET` and validate the
   `X-Webhook-Secret` header.
2. Assign `Gmail account 4` to `Send Role Request Notification`.
3. Keep the documented pilot recipient `cs6@mclinkgroup.com` until the normal
   HR recipient resolver is enabled.
4. Activate the production workflow and set the portal's
   `N8N_Role_Webhook_URL` (or the matching Settings value) to its production
   webhook URL.

The email node uses `continueOnFail` so a Gmail outage does not roll back the
Sheet append. The final response reports `notificationStatus` as `sent` or
`failed`; the portal displays that outcome. A missing or inactive workflow is
not equivalent to a sent email and must be corrected in n8n before production
use.
