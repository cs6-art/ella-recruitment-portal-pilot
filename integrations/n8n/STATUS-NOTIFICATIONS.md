# Role status notification rules

<!-- Routing note: n8n resolves notification recipients; the portal only sends
     the transition payload and never sends email directly. -->

The Next.js status API sends every transition to the n8n role webhook. The
browser never sends email directly. n8n should use the transition `action`,
the `Requester_Email` value from `Role_Requests`, and `User_Directory` to
resolve recipients.

Temporary routing exception (active): production role request, recruitment
status, and recruitment setup notifications are sent only to
`cs6@mclinkgroup.com`. This is an email-routing override only; it does not
change User_Directory access or review/approval permissions. Remove the
override from the three recipient resolver nodes when normal HR distribution
should resume.

The transition payload includes `portalUrl`, built from `NEXT_PUBLIC_APP_URL`
or the forwarded request host, followed by `/roles/{Role_ID}`. Use that value
in email links; do not hardcode `localhost`.

The Management-approval step was removed (URS Phase 1). An HR reviewer now
approves or rejects a role directly from the HR discussion stage;
`send_for_management_approval`, `return_for_revision_management`,
`place_on_hold_management`, `resume_management_approval`, and the
`Pending Management Approval` status no longer occur. Legacy history rows that
still carry those action names should keep rendering with a readable label.

| Action | Recipients |
| --- | --- |
| `approve_role` | `Requester_Email` and active HR reviewers |
| `reject_role` | `Requester_Email` and active HR reviewers |
| `return_for_revision_hr` | `Requester_Email` |
| `place_on_hold_hr` | `Requester_Email` and active HR reviewers |
| `resume_hr_review` | Active HR reviewers |

Return an HTTP 200 JSON response after the status and history writes complete:

```json
{
  "success": true,
  "status": "Approved",
  "notificationStatus": "sent",
  "notificationError": ""
}
```

Use `sent`, `pending`, `failed`, or `not_configured` for
`notificationStatus`. The portal treats `sent` as success and displays a
warning while preserving the status update for the other values.

Required environment variables:

```text
N8N_ROLE_WEBHOOK_URL=https://your-n8n-domain/webhook/role-request
N8N_WEBHOOK_SECRET=your-shared-webhook-secret
NEXT_PUBLIC_APP_URL=https://your-production-portal-domain
```

The n8n webhook header-auth credential must validate the
`X-Webhook-Secret` header against `N8N_WEBHOOK_SECRET`.
