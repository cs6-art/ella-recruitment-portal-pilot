# McLink Recruitment Portal UI/UX Audit

## Scope and design read

This is an audit of the existing frontend before the shared UI refactor. The portal is a Next.js App Router application with authenticated recruiter and hiring workflows. The design direction is a preserve-and-consolidate evolution: retain the McLink navy, blue, and yellow identity, keep route structure and content, and make the product read as one reliable operations tool.

The interface should be scan-friendly, calm, and moderately dense. Motion should remain subtle and functional. The primary audience is recruiters, HR reviewers, hiring managers, and department reviewers who need to move quickly through role requests, candidates, interviews, settings, and credits.

## Frontend structure

- `src/app/` contains the route tree and server-rendered page boundaries.
  - Auth and public surfaces: `/`, `/apply`, `/apply/[roleId]`, `/book/[kind]/[token]`, `/avatar/[token]`, `/privacy`.
  - Authenticated surfaces: `/dashboard`, `/roles`, `/roles/new`, `/roles/[roleId]`, `/roles/[roleId]/edit`, `/roles/[roleId]/applicants`, `/applicants`, `/applicants/[applicationId]`, `/bookings`, `/resume-screening`, `/settings`, `/profile`, `/credits`, `/user-accounts`.
- `src/components/` contains the interactive client components for lists, forms, interview flows, settings, credits, notifications, and the application shell.
- `src/app/globals.css` is the primary visual layer. It currently contains approximately 6,500 lines and approximately 2,500 rule blocks. Feature styling has accumulated in the same file over time.
- CSS Modules are used for the app shell, credits, help bot, and applicant notification bell. Live interview has a separate stylesheet.
- There is no third-party UI component library. `UiIcon`, `ActionFeedback`, `ConfirmationModal`, `Pagination`, `ValidationSummary`, `AppShell`, and `PortalBrandingContext` are the strongest existing shared primitives.
- `AppShell` owns authenticated navigation, responsive sidebar behavior, account actions, credits, applicant notifications, and the help bot. Page content is composed below it.

## Current design system

There is a partial design system, but it is not yet the single source of truth.

Existing foundations include:

- Brand tokens at the top of `globals.css`: `--navy`, `--blue`, `--yellow`, `--ink`, `--muted`, `--surface`, `--soft`, `--line`, `--success`, and `--danger`.
- Elevation tokens: `--elevation-1`, `--elevation-2`, and `--elevation-3`.
- Radius tokens: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, and `--radius-pill`.
- Shared control sizing tokens near the end of the stylesheet: `--control-height`, `--control-height-sm`, `--control-radius`, and `--control-border`.
- A late shared status/feedback token layer for danger, warning, and success at `globals.css:5223`.
- Shared CSS selectors for `.btn`, `.card`, `.card-header`, `.field`, `.status-badge`, `.table-wrap`, `.error-box`, `.warning-box`, and `.success-box`.

The main problem is layering and adoption. The same concepts are restated with literal values across feature selectors, and some components use local variants instead of the shared concepts.

## Inconsistencies found

### Tokens and styling duplication

- `:root` is declared three times, with shared tokens introduced at different points in the file rather than in one semantic token block.
- The stylesheet contains more than 1,100 literal hex values. Many are near-duplicates for the same role, especially pale blue surfaces, borders, muted text, success states, and warning states.
- The first button/card/form definitions are later overridden by a `Portal-wide visual language` block, which makes the effective style difficult to discover and easy to regress.
- CSS Modules repeat shell colors, borders, radii, shadows, and focus treatments instead of consuming the global semantic tokens.

### Buttons and actions

- `.btn-primary` and `.btn-secondary` are shared, but destructive, outline, link, inline, and feature-specific actions are implemented as separate classes with different heights, radii, shadows, and hover behavior.
- Control heights vary between 34px, 36px, 40px, 42px, 43px, and 44px depending on feature context.
- Some buttons use the shared `.btn` class while others use standalone classes such as `booking-inline-action`, `bulk-screening-link-button`, `drive-picker-close`, and `calendar-day-button`.
- Loading labels and disabled states exist, but there is no shared button API or consistent icon/loading placement contract.

### Statuses and badges

- Role statuses use `.status-badge` plus status-specific classes.
- Booking statuses use a separate `booking-status-*` class family.
- Bulk screening uses `bulk-status-*`.
- Calendar connections use `calendar-status-*`.
- Decision state uses `applicant-decision-badge`.
- Settings, user readiness, and email templates each have their own status/badge families.
- The same semantic state can therefore render with different colors. For example, pending/processing states are blue in some locations and amber in others.

### Forms and validation

- `.field` is a strong shared pattern, but standalone controls in calendars, settings, booking drawers, country selectors, and email templates use different padding, min-height, border, and radius values.
- Labels vary between direct text, `span`, and `label` compositions. Required-field presentation is not yet a single convention.
- Error presentation is better consolidated than most other areas through `ActionFeedback`, `ValidationSummary`, `.field-error`, and semantic `aria-invalid`, but older feature-specific error boxes still coexist.

### Cards, panels, and page layout

- `.card`, `.form-card`, `.sidebar-card`, `.bulk-screening-panel`, `.dashboard-attention`, and feature panels overlap in intent but use different radius, border, padding, and shadow values.
- Card radii vary from 8px through 28px. Common surfaces use 10px, 12px, 14px, 16px, and 18px without a documented component rule.
- Page containers use the shared 1680px max width, but public privacy content, resume screening, dashboard panels, and feature panels add their own widths such as 760px, 1180px, and 720px.
- Page headers use `hero-row`, `dashboard-welcome`, `settings-header`, and feature-specific header variants. The hierarchy is recognizable but not encoded as one reusable component.
- Eyebrow styles differ between `.eyebrow`, `.eyebrow-dark`, `.dashboard-eyebrow`, and uppercase feature kickers.

### Tables and dense lists

- `.table-wrap` is shared and responsive, but roles, applicants, bulk screening, user accounts, and calendar tables define their own header backgrounds, borders, row padding, and mobile transforms.
- Roles and applicants have good mobile adaptations, but the table contract is not shared and pagination/filter toolbars are repeated in feature components.
- Long-list separators are generally useful, but many feature areas add additional borders and nested cards, increasing visual noise.

### Feedback, loading, empty, and error states

- `ActionFeedback` and `ValidationSummary` provide a good basis for announced feedback and focus management.
- Success, warning, and error surfaces are shared late in the stylesheet, but info and neutral callouts are not first-class shared states.
- Loading states range from plain text in `.empty` to dashboard skeletons and feature-specific progress treatments.
- Empty states are often functional but inconsistent in copy, alignment, icon treatment, and action affordance.

### Navigation and iconography

- `AppShell` is reusable and has a responsive mobile drawer, collapsed desktop rail, active state, keyboard focus, and local persistence.
- The active navigation state is intentionally branded, but shell styles use their own literal values rather than the global token contract.
- `UiIcon` provides a consistent local stroke icon set. It is preferable to preserve it for this refactor rather than mix in another icon family or add a new dependency.

### Accessibility and responsive strengths to preserve

- Semantic labels and `aria-*` attributes are present in the main forms, tables, dialogs, and navigation.
- `ConfirmationModal` manages focus, Escape dismissal, and return focus.
- Reduced-motion rules exist in the shell, dashboard, and feature areas.
- Dense tables use horizontal overflow cues on desktop and card-like transforms on mobile in important surfaces.
- Authentication and portal forms already use explicit labels and inline validation patterns.

## Shared design token proposal

The first implementation pass will add semantic aliases to the existing brand values so feature CSS can migrate incrementally without changing backend behavior.

| Token group | Proposed contract |
| --- | --- |
| Brand | `--color-primary` navy for primary actions and headings; `--color-link` blue for links and focus; `--color-accent` McLink yellow for active navigation marker and high-salience brand detail |
| Surfaces | `--color-page` pale blue page background; `--color-surface` white content surfaces; `--color-surface-subtle` quiet panels and table headers; `--color-surface-selected` selected/active controls |
| Text | `--color-text` ink; `--color-text-muted` muted copy; `--color-text-subtle` labels and captions; `--color-text-on-primary` white |
| Borders | `--color-border` default border; `--color-border-strong` interactive/selected border |
| Status | `--color-status-positive-*`, `--color-status-progress-*`, `--color-status-warning-*`, `--color-status-negative-*`, `--color-status-neutral-*` with foreground, surface, border, and accent roles |
| Controls | `--control-height` 44px; `--control-height-sm` 36px; consistent 10px control radius; one focus ring |
| Shape | `--radius-sm` 8px for compact controls, `--radius-md` 10px for inputs/badges, `--radius-lg` 14px for cards, `--radius-pill` for statuses and compact chips |
| Elevation | `--elevation-1` for cards, `--elevation-2` for elevated panels, `--elevation-3` for dialogs |
| Spacing | Existing 4px-derived rhythm, with page gaps of 24px, section gaps of 16px, and control groups of 8px/12px |
| Typography | Existing system sans stack, 16px base body, 14px controls, 13px labels/captions, 20px section titles, 32px page titles |

## Reusable component proposal

Implement these shared pieces first and migrate existing surfaces to them incrementally:

1. `Button`: primary, secondary, outline, danger, ghost, and link variants; small/default sizes; loading and disabled states; consistent icon gap and focus behavior. It will support both buttons and links so navigation actions keep their existing routes.
2. `StatusBadge`: one semantic tone map for positive, progress, warning, negative, neutral, and info states. Feature-specific labels such as “Booked” can still be presented as “Scheduled” without changing the stored value.
3. `Card`: shared surface, header, body, and footer composition for the existing card family.
4. `PageHeader`: consistent title, description, eyebrow, and action layout for authenticated pages.
5. `Alert`: shared success, warning, error, info, and neutral treatments. Existing `ActionFeedback` remains the announced, dismissible action-feedback primitive and can use the same token layer.
6. `EmptyState`: shared icon, title, description, and optional action for lists, dashboards, and loading-adjacent empty states.
7. `FormField` styling contract: preserve existing field markup and behavior, but make labels, help text, invalid state, focus state, and control sizing consume the same tokens.
8. `DataTable` styling contract: preserve each table’s data and responsive behavior while standardizing header, row, border, hover, and mobile card tokens.

## Migration order

1. Add the semantic tokens and shared UI components.
2. Migrate shell and page-header surfaces so the application frame establishes the system.
3. Migrate status renderers in roles, applicants, bookings, and bulk screening to `StatusBadge`.
4. Migrate buttons, cards, forms, feedback, and empty states in the main authenticated routes.
5. Reconcile feature-specific CSS only where it expresses a real UX difference, keeping feature behavior and API contracts unchanged.
6. Verify authentication, role requests, applicants, screening, interviews, settings, credits, user management, mobile layouts, keyboard states, and loading/error/empty states.

## Constraints

- Do not change route slugs, form field names/order, API endpoints, database shape, permissions, or workflow transitions.
- Do not replace the existing `UiIcon` family with a second icon dependency.
- Do not remove the current mobile table adaptations, focus management, reduced-motion handling, or shell persistence.
- Do not rewrite product copy unless needed to clarify a broken UI state.
