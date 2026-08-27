# HR Application Link Flow

This is the simple process for sending one candidate a private application
link using the supplied `index.html` candidate page.

The candidate page is invite-only. Direct visits without an invitation token
are redirected away, and the submission API independently rejects requests
without a valid invitation.

## What HR does

1. Open **Resume Screening**.
2. Choose a published role.
3. Enter the candidate's name and email address.
4. Select **Generate application link**.
5. Copy the link and send it only to that candidate.

## What the candidate sees

The link opens the candidate-facing `index.html` design. The role, candidate
name, and email are already prepared. The candidate adds their contact number,
uploads a PDF, DOC, or DOCX resume, reviews the consent message, and submits.

## What the system does

```text
HR chooses role and candidate
        ↓
Portal creates a random private link
        ↓
Candidate opens the supplied index.html page
        ↓
Role, name, and email are checked
        ↓
Candidate uploads resume and submits
        ↓
Resume is sent for screening
        ↓
Link is marked Used after the application is accepted
        ↓
Applicant appears for HR review
```

## Link rules

- Each link is for one role and one intended candidate.
- The role cannot be changed from the candidate page.
- The server keeps the invited name and email as the official values.
- The link works once only after a successful submission.
- An unused link expires after the configured number of days.
- If a submission fails before it is accepted, the candidate can retry the
  same link.
- An expired or revoked link shows an unavailable message. An already-used
  link shows that the application was received and displays its current
  applicant status, normally Pending HR Review; HR should generate a new link
  only if a different application is needed.

## Candidate page setup

The supplied `index.html` and its image are included in the portal unchanged.
The candidate page is available at:

```text
/index.html
```

Set `RESUME_SCREENING_INVITE_BASE_URL` to the full public address of that page.
For example:

```text
https://recruitment.example.com/index.html
```

The page reads the `invite` value from the URL, checks the link, and sends it
with the candidate's application. When the page is hosted by the
portal itself, it uses the same public address for the application service.
When the page is hosted on a separate site, that site must be listed as an
allowed candidate-page origin.

## HR checklist

- The role is published and accepting applications.
- The candidate name and email are correct before generating the link.
- The link is sent privately to the intended candidate.
- HR checks the applicant list after the candidate submits.
- HR reviews the resume and makes the hiring decision; the automatic screening
  result is only supporting information.
