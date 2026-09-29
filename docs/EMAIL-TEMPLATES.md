# Automated Emails: how they are sent and how an organisation edits them

Last updated: 29 September 2026

## How an email gets sent

1. Something happens in the portal (HR invites a candidate, a candidate books, a role is
   published). The portal writes a row to the notification queue with the event type.
2. An n8n workflow polls `GET /api/internal/recruitment/notifications` every five
   minutes. The portal claims the rows it returns for a short lease so two polls cannot
   send the same email.
3. Each item carries the finished email in `email`: `subject`, `message`, `cta` and
   `ctaLink` (primary button), `secondaryCta` and `secondaryCtaLink`, `signoff`,
   `imageUrl` and `imageAlt`. The workflow renders it as HTML and sends it from the
   connected Gmail account (`Gmail account 4`).
4. The workflow acknowledges the row with `POST /api/internal/recruitment/notifications`
   (`sent`, `failed`, ...). Failed rows are retried; a row older than
   `NOTIFICATION_MAX_AGE_HOURS` (48) is retired instead of being sent late.

The wording lives in the portal, not in n8n. That is what lets an organisation change it
without touching a workflow.

| Email | Event | n8n workflow (id) | Editable |
| --- | --- | --- | --- |
| AI Voice Interview Invitation | `voice_booking_invitation` | Voice Booking Notification Sender (`Rw4C1fv1QMQEs28z`) | Yes |
| AI Voice Interview Confirmation | `voice_booking_confirmation` | Voice Booking Confirmation Sender (`RT5FulX8zXeNryK9`) | Yes |
| New Role Posted | `job_posted` | Job Posted Notification Sender (`xCNkDrLMEGAmjgL4`) | Yes |
| Face-to-face invitation | `final_booking_invitation` | not sent through this queue with the portal's wording | No |

Only the emails a workflow actually delivers with the portal's wording are offered for
editing. If a workflow is moved onto the queue later, set `editable: true` for its event in
`src/lib/email-templates.ts` and it appears in Settings.

The confirmation workflow also sends a plain internal notice to HR. That notice is not
editable and is not part of the queue copy.

## What an organisation can change

Settings > **Automated Emails** (users with Edit settings). Per email:

- **Subject** and **Message**. Details such as `{{candidate_name}}`, `{{role_title}}`,
  `{{role_phrase}}`, `{{company_name}}`, `{{interview_time}}`, `{{ai_notice}}`,
  `{{recipient_name}}`, `{{role_id}}`, `{{department}}` and `{{requested_by}}` are filled
  in per recipient. Each email allows only the details that make sense for it. A line whose
  details are all empty is dropped (for example `Interview time: {{interview_time}}`).
- **Button text** for emails that have buttons. The link behind a button is never editable.
- **Header image**: a public `https://` link plus a description. The image is linked, not
  attached; it must stay online.

Not editable: the button links, the sign-off (`Kind regards,` and the organisation name from
Organization branding, added by the sender after the buttons) and the fixed layout.

`{{ai_notice}}` expands to the required AI interview notice. It is in the default voice
emails and should stay: candidates must be told an AI conducts the interview.

## Rules enforced

Checked in the editor, again in `PUT /api/email-templates`, and once more when the email is
built (`src/lib/email-templates.ts`):

- Subject at most 200 characters and one line; message at most 5,000; button text at most 40.
- `<` and `>` are rejected in edits and stripped from inserted details, because the senders
  place the text in an HTML email.
- Unknown or unclosed `{{...}}` details are rejected.
- The image link must be `https://`, at most 500 characters, with no spaces, quotes, angle
  brackets or credentials. An unsafe link that somehow reached storage is dropped instead of
  sent. The n8n senders escape the URL and description again.

## Storage and rollout

- Table `email_templates` (`organization_id`, `event_type`, `subject`, `body`, `cta_label`,
  `secondary_cta_label`, `image_url`, `image_alt`, `updated_by`, `updated_at`). A missing row
  means the standard wording. **Restore Original** deletes the row.
- Migrations `0030_email_templates.sql` and `0031_email_template_buttons_image.sql`. Apply
  both before using the section. If the table or columns are missing, emails are sent with the
  standard wording instead of failing, and the Settings section shows an error.
- The organisation name in subjects and sign-offs is the Organization branding display name.
  The original organisation keeps "McLink Group" until it sets its own name.

## The header image in n8n

The three sender workflows prefix the message with the image when `email.imageUrl` starts with
`https://`, and are byte-for-byte unchanged when it is empty. If a sender is rebuilt, keep that
behaviour (see [N8N-CONTRACTS.md](N8N-CONTRACTS.md)).

## Sending from an organisation's own Gmail

Not built on `main`. A working version (connect Gmail from Settings, per-organisation sending
through the Gmail API, five-minute scheduled sender) is parked on the local branch
`wip/gmail-and-legal`. It needs the Gmail API and the `gmail.send` scope on the Google OAuth
client, and Google's app verification before customers outside the test-user list can connect.
