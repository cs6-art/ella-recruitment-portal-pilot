# Portal access model

The portal uses a simple capability model. `Access_Role` is a display label
and starting preset; the boolean capabilities below are the authorization
source of truth. HR is the only access administrator and assigns capabilities
when adding or editing an account.

## Directory schema

`User_Directory` stores:

`Email`, `Full_Name`, `Access_Role`, `Department`, `Can_Create_Role`,
`Can_Review_Role`, `Can_Approve_Role`, `Can_Edit_Settings`,
`Can_Manage_Users`, `Active`, `Can_Review_Department_Role`,
`Can_Manage_Credits`.

The Postgres `users` table stores the same capabilities using snake_case
columns. `Can_Manage_Credits` is intentionally separate from settings,
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
