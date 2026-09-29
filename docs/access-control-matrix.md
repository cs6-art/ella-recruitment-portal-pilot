# Portal access model

The portal uses a simple capability model. `Access_Role` is a display label
and starting preset; the boolean capabilities below are the authorization
source of truth. HR is the only access administrator and assigns capabilities
when adding or editing an account.

## Directory schema

In production the directory is the Postgres `users` table, with these columns per
person and organisation: `email`, `full_name`, `access_role`, `department`,
`can_create_role`, `can_review_role`, `can_approve_role`, `can_edit_settings`,
`can_manage_users`, `active`, `can_review_department_role`, `can_manage_credits`.
The legacy Google Sheets `User_Directory` tab uses the same fields (`Can_Create_Role`, ...)
and is only read as a last-resort fallback for the original organisation. `Can_Manage_Credits` is intentionally separate from settings,
recruitment, and user administration.

## Presets

| Preset | Starting capabilities |
| --- | --- |
| HR | Manage access, create/review recruitment, applicant and interview operations |
| Admin | Manage Smile Credits only |
| Custom access | No elevated access; HR selects the minimum required capabilities |

Presets are starting points. HR may grant a custom account additional
capabilities when the business requires it, and the resulting booleans are
what the API enforces.

## Capability meanings

| Capability | Grants |
| --- | --- |
| Create role | Create and submit role requests, scoped to the user's own drafts where applicable |
| Review recruitment | Company-wide recruitment setup, role review, applicants, screening, bookings, and applicant workflow operations |
| Review own department | Read-only roles and candidates in the user's department |
| Approve role / hiring decisions | Decision actions reserved for the approval tier; this is separate from HR operational review |
| Manage Smile Credits | Manual credit administration and authorized credit purchases |
| Edit settings | Portal settings and shared HR calendar connection management |
| Manage users | Retained as a compatibility field; effective account administration is HR-only |

## How accounts are created

People sign in with **email and password**. Creating an account (`Create account` on the
sign-in page) requires an address that belongs to an organisation: the organisation's allowed
email domains or allowed addresses decide which one, and an allowed address wins over a domain.
A confirmation link (valid 24 hours) must be used before the first login. Passwords are
salted scrypt hashes (10-character minimum). Sign-in, registration, password reset and public
form attempts are rate limited in the database.

A self-registered account starts as **HR** with the full HR capabilities (create, review and
approve roles, edit settings, manage users) but **not** Manage Smile Credits, and it is
scoped to its own organisation. HR can change any account afterwards. Adding a person in User
Accounts pre-sets their access; they still create their own password.

Google is no longer used to sign in. Google is used only to connect a calendar (settings
administrators for the shared HR calendar; any reviewer for their own calendar on Profile)
and Drive.

## Enforcement rules

- Every protected API route checks the signed-in session server-side.
- HR access administration is limited to an active account labelled `HR` with
  recruitment review access.
- An `Admin` preset does not receive recruitment, settings, or user-management
  access; it receives only the explicit Smile Credits capability.
- Organization and user data remain tenant-scoped.
- Account deactivation is reversible and preserves history.

The account editor applies HR, Admin, or Custom starting values, then permits
HR to adjust the individual capability switches. Permission changes should be
audited and should invalidate existing sessions in a future hardening pass.
