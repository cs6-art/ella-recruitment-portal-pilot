# Recommended portal access model

The portal currently exposes five boolean permissions in `User_Directory`:

- `canCreateRole` — submit and track role requests.
- `canReviewRole` — review roles, edit Recruitment Setup, review applicants, and manage interview operations.
- `canApproveRole` — approve or reject management-stage role decisions and review organization-wide records.
- `canEditSettings` — edit portal settings and connect or disconnect the shared HR Google Calendar.
- `canManageUsers` — manage user accounts and permissions.

## Recommended roles

| Access role | Create roles | Review HR setup/applicants | Approve roles | Edit settings | Manage users |
| --- | --- | --- | --- | --- | --- |
| CEO | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes |
| HR | Yes | Yes | No | No | No |
| Management | No | View-only | Yes | No | No |
| HOD / Department Head | Yes | Department view-only | No | No | No |
| Recruiter | Yes | Yes | No | No | No |
| Interviewer | No | Yes | No | No | No |
| Hiring Manager | No | Yes | Yes | No | No |
| Finance Reviewer | No | No | No | No | No |
| Auditor / Read-only | No | No | No | No | No |
| Requester / Employee | Yes | No | No | No | No |

The account editor exposes these roles in a dropdown and applies the listed
permissions as a starting point. Administrators can fine-tune the checkboxes
for a specific person without changing the role label.

## Calendar ownership

HR interviews use the shared calendar configured by `Final_Interview_Calendar_Email` and `Final_Interview_Calendar_ID` in Settings. The current connected Google account is visible read-only to every signed-in user; only Admin (or a specifically trusted HR operations administrator) can connect, disconnect, or change that Google account. Other users should receive access through Google Calendar sharing rather than connecting personal calendars to the portal.

If the organization later needs a separate calendar per interviewer, replace the shared setting with an explicit role-to-interviewer assignment and require each assigned interviewer to connect their own account. Do not infer calendar ownership from the person who created the role.
