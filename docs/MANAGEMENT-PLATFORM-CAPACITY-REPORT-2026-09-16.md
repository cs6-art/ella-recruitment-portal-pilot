# Management Platform Capacity and Go-Live Report

**System:** Ella Recruitment Portal Pilot  
**Assessment date:** 16 September 2026  
**Decision requested:** approve Vercel Pro for the production/commercial environment and fund the migration away from Google Sheets as an operational datastore.

## Executive recommendation

Upgrade the production Vercel project to **Pro** before commercial go-live. Do not treat “paying for Sheets API” as the main capacity solution.

The recommended order is:

1. **Now:** approve Vercel Pro, verify Fluid Compute, set production `CRON_SECRET`, confirm the production region, and verify the n8n plan and usage.
2. **Before sign-off:** execute one real end-to-end Vapi interview, verify its terminal status and exactly one correct credit charge, and confirm the production email, calendar, Drive/OneDrive, and HitPay settings.
3. **Next:** keep Postgres authoritative for recruitment data, keep Sheets only as a compatibility mirror/export, and move remaining queue and workflow state out of Sheets.
4. **Scale phase:** replace request-time bulk processing with a durable asynchronous worker/queue and add shared rate limiting, monitoring, retries, and alerting.

Vercel Pro will improve commercial suitability, cron precision, logs, build concurrency, team controls, and function headroom. It will **not** fix Google Sheets quota exhaustion, n8n execution limits, Vapi/provider failures, or the current explicit 60-second bulk-route limit by itself.

## If management ships today: decision brief

### Decision

**Do not ship as an unrestricted production launch today.** A controlled pilot release is possible if the safeguards below are accepted and a named operator is available. The two hard release gates are the first real post-fix voice interview and verification of the n8n plan/usage.

### What could happen after release

| Concern | Business impact | Severity | Minimum control before release |
|---|---|---:|---|
| Voice callback still has no post-fix real-call evidence | A completed interview may remain stuck, fail to finalize, or be billed incorrectly. The last live callback returned HTTP 500 for `outcome=incomplete`. | **P0** | Run one supervised real call; prove terminal status, result persistence, exactly one credit charge, and safe duplicate-callback behavior. |
| Vapi callback webhook has no authentication requirement | Anyone who discovers the URL could submit forged interview results or cause workflow activity. | **P0 security** | Add Vapi signature/shared-secret validation, or keep voice disabled until the callback is protected and rotated. |
| n8n plan may be below current execution volume | Workflows can fail immediately at the plan limit; queued work does not automatically catch up. Current workspace evidence is 5,775 executions since 15 September 00:00 UTC. | **P0 capacity** | Confirm plan, monthly usage, concurrency, and alerts. Upgrade/resize n8n or reduce pollers before opening to real users. [n8n execution limits](https://support.n8n.io/article/can-you-reset-my-executions) |
| Vercel Hobby is being used for a business service | Commercial-use and governance exposure, no paid overage safety valve, limited logs, and imprecise cron timing. | **P1 commercial/ops** | Move production to Vercel Pro. Hobby is documented for personal/non-commercial use. [Vercel pricing](https://vercel.com/pricing) |
| Bulk imports are synchronous and capped at six files | Slow Drive, extraction, database, or cold-start conditions can push a request over its 60-second route limit. Users may see uncertainty even if some records were created. | **P1 reliability** | Keep the six-file cap, show per-file status, and use a queue-first asynchronous worker for larger batches. |
| Sheets quota is shared across Vercel, n8n, and the service account | Legacy settings/tokens/credits or queue paths can receive 429s. A stale read may be shown, while a write can fail. Paying for Google Cloud does not make the Sheets API unlimited. | **P1 reliability** | Measure 429s, batch operations, reduce polling, request quota adjustment if needed, and keep Sheets out of the operational hot path. [Sheets limits](https://developers.google.com/workspace/sheets/api/limits) |
| Real payment path is not proven | If HitPay is still sandbox or production webhooks are misconfigured, customers can pay without the portal recording the right state, or the portal can expose a non-production payment flow. | **P0 if payments are enabled** | Keep payments disabled/sandbox until a supervised production-mode payment, webhook, idempotency, and refund test passes. |
| Outbound email may be fail-closed | Candidates or HR may not receive invitations or confirmations even though queue workers are healthy. | **P1** | Confirm `PILOT_OUTBOUND_EMAIL_ENABLED`, Gmail credentials, sender identity, and a real test mailbox. |
| Vercel cron failures are not automatically retried | Queue reconciliation, voice cleanup, or resume cleanup may remain incomplete without an operator noticing. | **P1 operations** | Add external alerts and a manual rerun procedure. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Active workflows have stale “keep inactive” labels; two are active with zero executions | An operator may disable a live workflow or assume a dead workflow is part of the production path. | **P1 change control** | Freeze workflow changes, correct labels, and deactivate only after dependency confirmation. |

### Minimum “ship today” package

If the boss insists on shipping today, release only with all of the following documented in the handover:

1. **Vercel:** Pro plan, production `CRON_SECRET`, correct environment-variable scopes, spend alerts, and an external log/alert destination.
2. **n8n:** confirmed plan has headroom for the observed execution rate, critical workflows are active, credentials are bound, and failure alerts are working.
3. **Voice:** one supervised call passes the full billing/result acceptance test; callback authentication is either fixed or voice is disabled.
4. **Payments:** HitPay remains sandbox/disabled unless production payment and webhook tests pass.
5. **Email and calendar:** one real invitation, confirmation, booking, cancellation, timezone, and conflict test passes.
6. **Resume intake:** retain the six-file limit; do not promise high-volume batch processing.
7. **Operations:** named owner watches n8n, Vercel, database, provider, and credit errors for the first 24 hours; rollback and manual reconciliation steps are ready.

### What should be stated to users and management

This is a **controlled pilot**, not a fully scaled production service. The product can create roles, accept applications, screen resumes, manage Postgres-backed recruitment data, and run the current n8n pollers. Voice, payment, high-volume imports, and provider outage recovery remain conditional until their live gates pass.

The cost of a premature unrestricted launch is not primarily a Vercel bill. It is silent recruitment-state inconsistency: a candidate completes an interview but remains stuck, a credit is charged twice or not at all, an email is not sent, a payment is not reconciled, or a workflow stops after an external quota is reached.

## What was verified

### Verified locally and against the live database

| Area | Result | Evidence |
|---|---|---|
| Automated regression suite | **PASS** | 453 tests passed, 0 failed |
| Type safety | **PASS** | `tsc --noEmit` clean |
| Lint/build | **PASS** | lint has 7 pre-existing warnings; production build succeeds |
| Recruitment DB integrity | **PASS** | 19/19 tables, 46 foreign keys, 0 orphan rows |
| Credits parity | **PASS** | Sheets ledger 384; Postgres balance/ledger 347; 37 intentional Postgres-only Scenario C rows reconcile arithmetically |
| Tenant isolation | **PASS after cleanup** | McLink and McPrint have separate active data and balances; duplicate active membership for `padillajuliojose@gmail.com` was removed from McLink |
| Resume screening | **PASS observed live** | Recent application auto-scored in approximately 13 seconds with match score 78 |
| Role archive behavior | **PASS in current commit** | Soft archive fix is committed as `24158f9`; history remains queryable |
| Voice orphan cleanup | **DONE** | 8 stale `initiated` attempts reconciled to `failed/system_failure`, with zero billing |
| Production reachability | **PASS** | Public portal and `/api/public/roles` returned HTTP 200 during this audit; this verifies availability, not authenticated mutations or provider transactions |

### Verified against live n8n

The n8n MCP read-only check found 149 workflows. For the Postgres-target pilot:

- The bulk poller has 757 executions since 15 September 00:00 UTC; the returned executions were successful.
- The scheduled voice, booking, notification, HR-decision, and status-sync pollers were running at approximately five-minute intervals and the returned executions were successful.
- Two active workflows have zero executions in that period: **McLink - Candidate Application Foundation** and **McLink - Role Request Status**. They are safe candidates for deactivation only after an operator confirms no external caller still depends on them.
- Multiple workflows are active while their descriptions still say **“MANUAL CREDENTIAL BINDING REQUIRED. Keep inactive.”** This is an operational-control risk.
- The live Vapi result callback workflow has one recent execution, on 15 September 00:17 UTC, and it failed. This is consistent with the known production incident; it is not proof that the post-fix path works.
- The failed execution reached the `Finalize Pilot voice attempt in Postgres` node with `status=completed` and `outcome=incomplete`, and the Vercel endpoint returned HTTP 500 `internal_error`. The callback webhook itself has no n8n webhook credential, so it is publicly reachable and should be protected with a Vapi signature/shared secret or a rotated unguessable endpoint plus server-side validation.
- The critical active workflow definitions have published active versions. The dispatch workflow claims attempts atomically before calling Vapi; the callback workflow writes an idempotent result/log before finalization; the notification workflow acknowledges only after Gmail. These are good control patterns, but they still depend on n8n credential binding and provider availability.
- The n8n workspace recorded 5,775 executions since 15 September 00:00 UTC across the workspace. This is not a recruitment-only count and the n8n plan is not visible from the repository, but it makes plan/usage verification urgent. If this were n8n Cloud, the observed daily rate would materially exceed a 2,500- or 10,000-execution monthly tier.

## Current architecture and where quotas apply

```text
Candidate / HR browser
        |
        v
Vercel Next.js API routes
  |          |             |
  v          v             v
Neon DB   Google Sheets   Drive / OneDrive / Calendar
  |          |             |
  +----------+-------------+
             |
             v
          n8n workflows
       /       |        \
      v        v         v
    Vapi    OpenAI      Gmail
      |
      v
 Vapi callback -> n8n -> Vercel internal API -> Postgres/credits
```

The current production mode is `RECRUITMENT_BACKEND=postgres` and `CREDITS_BACKEND=dual`. Recruitment queues, applicants, screening, booking, voice attempts, decisions, and history are therefore primarily Postgres-backed. Sheets is still used for legacy roles/settings, templates, token storage, legacy applicant/workflow paths, and the credit mirror.

## Vercel Hobby: quotas, behavior, and impact on this system

Vercel documents Hobby as a free plan for personal, non-commercial use. It is not a suitable long-term production contract for a business recruitment portal. See the [Vercel pricing page](https://vercel.com/pricing) and [Hobby plan documentation](https://vercel.com/docs/plans/hobby).

| Hobby limitation | Current impact |
|---|---|
| 1 million function invocations/month, 4 active CPU hours, and 360 GB-hours provisioned memory | The pilot is currently unlikely to hit these from portal traffic alone, but n8n callbacks, polling, retries, screening, and admin usage all add to the same project usage. There is no paid overage escape hatch on Hobby. |
| No paid overage; usage caps must wait for reset or a plan change | A cap can stop new production traffic rather than creating a controlled backlog. |
| Cron jobs are available, but Hobby schedules are limited to once daily and have hourly-scale timing jitter | The repository has three daily Vercel crons, so the present schedule is compatible. It is not suitable for minute-level queue processing or reliable exact-time operations. |
| Cron invocations are ordinary function executions, and failed cron invocations are not automatically retried | A failed reconciliation or cleanup run can leave stale records until the next scheduled run unless monitoring or an external retry is added. |
| Runtime logs are retained for about one hour | Incident investigation is harder, especially for asynchronous voice callbacks and scheduled jobs. Export logs to an external monitoring system. |
| One concurrent build versus 12 on Pro | A deployment can queue behind another build, increasing release delay and operational risk. |
| Function duration depends on Fluid Compute | For new projects with Fluid Compute, Hobby is currently shown as 300 seconds. Older projects without Fluid Compute can retain the legacy 10-second default/60-second maximum. Confirm the actual project setting in Vercel. |
| Current application routes explicitly set `maxDuration=60` for local upload, Google Drive import, and OneDrive import | Upgrading Vercel does not remove this application-level 60-second ceiling. The current six-file cap is still required until the path becomes asynchronous or is empirically re-tested. |
| No production team/RBAC and less deployment governance | Commercial operations have weaker separation of duties and release control. |

With Fluid Compute, Vercel currently documents Hobby at 300 seconds and Pro at 300 seconds by default, configurable up to 800 seconds on Pro. This only helps routes that do not explicitly set a lower duration; it does not turn a synchronous batch into a durable queue. See [Fluid Compute](https://vercel.com/docs/fluid-compute) and [Vercel limits](https://vercel.com/docs/limits).

## Google Sheets API: what “paying for Sheets” actually means

The Sheets API does not work like a simple per-call subscription that removes rate limits. Standard use is currently available at no additional charge. The relevant default limits are:

- 300 read requests/minute/project and 300 write requests/minute/project.
- 60 read requests/minute/user/project and 60 write requests/minute/user/project.
- A service account is effectively one user for the per-user quota, so many Vercel instances and n8n workflows sharing one service account can hit 60/minute even when the project-wide limit is unused.
- Exceeding the limit returns a rate/quota error, commonly HTTP 429. Google recommends truncated exponential backoff.
- A batch request containing multiple subrequests counts as one API request, subject to payload and processing limits.
- There is no ordinary daily request cap while the client stays within the per-minute limits.

See the official [Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits) and [Google Cloud quota management](https://docs.cloud.google.com/docs/quotas/view-manage).

The repository already has sensible first-line protections: a 20-second process-local read cache, a 1.2-second read pacing interval, in-flight request coalescing, and exponential backoff. That keeps one process below roughly 50 reads/minute. It does not coordinate multiple Vercel instances, n8n workers, or other processes, and it does not eliminate write bursts.

### What a Google Cloud payment/quota change can and cannot do

Enabling Google Cloud billing may be required to manage quotas, but it does not automatically make Sheets unlimited. A quota adjustment can be requested for the Cloud project; approval is not guaranteed. It also does not change the architectural cost of every n8n poller repeatedly reading and writing the same workbook.

The practical Sheets plan is therefore:

1. Measure `sheets.googleapis.com` read/write usage and 429s in the Cloud Console.
2. Request a quota adjustment only if measured traffic needs it.
3. Batch reads/writes, reduce polling, and keep the existing backoff.
4. Replace the process-local limiter with a shared limiter if Sheets remains on a multi-instance path.
5. Migrate operational state and queues to Postgres; use Sheets for export, reporting, or controlled compatibility only.

## Other ecosystem limits

| Component | Current position and limitation |
|---|---|
| n8n | The live workspace volume is 5,775 executions since 15 September 00:00 UTC, but its plan is unknown. Current n8n Cloud tiers document 2,500 executions/month on Starter, 10,000 on Pro-1, and 50,000 on Pro-2, with fixed concurrency tiers. Verify the actual plan immediately; n8n execution limits are separate from Vercel and can fail workflows even when Vercel is healthy. See [n8n pricing](https://n8n.io/pricing/) and [n8n Cloud plan FAQ](https://support.n8n.io/article/n-8-n-cloud-subscription-features-per-tier). |
| Neon/Postgres | Live integrity and credit parity passed. The application uses a serverless pool with `max: 1` per application instance, which is conservative and appropriate for a pilot but can serialize bursts. Provider plan, compute, storage, connection, and autoscaling limits require a Neon dashboard check. |
| Google Drive | Used for resume storage/import. Drive quotas are much larger than Sheets quotas, but list/download/upload operations still consume quota units and can be affected by bursts. Keep retries and avoid repeated folder scans. See [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits). |
| Google Calendar | Current API documentation lists 10,000 requests/minute/project, 600 requests/minute/user/project, and a one-million-request daily threshold before planned charges. The current booking volume is not close to those numbers, but repeated polling and rapid writes can still hit calendar-specific operational limits. See [Calendar API usage limits](https://developers.google.com/workspace/calendar/api/guides/quota). |
| Vapi | The application enforces a maximum of 10 concurrent voice interviews. Vapi is called by n8n, not directly by Vercel. Provider call cost, provider concurrency, webhook delivery, and callback authentication are separate from the Vercel plan. The current callback workflow description still identifies a missing signature/secret check. |
| OpenAI/AI nodes | Most AI processing is in n8n workflows. Token, model, rate, and spend limits are provider-specific and were not measurable from this repository. Add spend alerts and retry/dead-letter handling in n8n. |
| Gmail/email | Notification sending is asynchronous through n8n. The local `.env.local` does not set `PILOT_OUTBOUND_EMAIL_ENABLED`; production must be checked explicitly so a fail-closed pilot setting is not mistaken for a delivery failure. |
| HitPay | The repository defaults to sandbox mode in the example configuration, and the end-to-end audit did not perform a real production payment, refund, or webhook. Production payment readiness is therefore not proven. |
| LiveAvatar | The app uses an external/bridge design because long-lived stateful connections are a poor fit for ordinary serverless request execution. The WebSocket/bridge route has a 300-second application duration, but bridge availability, provider limits, and reconnect behavior require a live smoke test. |

## Functionality readiness matrix

| Functionality | Readiness | Main limitation or gate |
|---|---|---|
| Login, organizations, and tenant isolation | **Ready after cleanup** | Keep a database invariant preventing more than one active membership for the same email in a tenant-resolution path. |
| Role creation, status transitions, history, and archive | **Ready in current commit** | Confirm deployment includes commit `24158f9`; stale documentation still contains conflicting batch/archive statements. |
| Public application intake | **Working in Postgres target mode** | Depends on n8n/provider availability for downstream processing and notification. |
| Resume screening | **Observed working** | Six-file operator cap; direct request path remains sensitive to 60-second duration and Drive/API latency. |
| Google Drive and OneDrive import | **Code-path ready; scale-limited** | External API quotas, file size, extraction time, and synchronous request duration. |
| HR review and decisions | **Pollers healthy** | Some active zero-execution/deprecated workflows should be disabled after dependency confirmation. |
| Voice booking and dispatch | **Not final sign-off ready** | Run a real call after the fix and verify terminal result plus exact credit charge. |
| Voice callback and reconciliation | **Hardened but unproven live after fix** | Current callback failure is the only live post-incident execution; Vapi callback authentication remains a risk. |
| Google Calendar booking | **Likely working; smoke test required** | Verify real calendar insert, conflict detection, cancellation, timezone, and duplicate retry behavior. |
| Credits | **Parity passed in dual mode** | Continue the soak and complete backup/restore and operator approval before switching authority to Postgres. |
| HitPay | **Sandbox only until proven otherwise** | Production credentials, webhook signature/idempotency, settlement and refund tests. |
| Email notifications | **Workflow pollers healthy** | Verify production outbound flag, Gmail credentials, bounce handling, and delivery. |
| LiveAvatar | **Architecture present; provider E2E required** | Bridge uptime, session expiry, reconnects, and serverless connection behavior. |
| Maintenance | **Partially ready** | Three daily Vercel crons are configured; cron failure has no automatic Vercel retry, so external alerting is required. |

## Options for management

### Option A — remain on Hobby for the pilot only

Acceptable only for a controlled, non-commercial pilot with low traffic:

- Keep the six-file cap and daily cron schedule.
- Confirm Fluid Compute and keep request-time work small.
- Do not increase concurrency or rely on exact cron timing.
- Add external log retention and alerts.
- Keep n8n and Sheets usage under measured limits.

This option has the lowest Vercel bill but the highest operational and commercial risk. It is not recommended for a business go-live.

### Option B — upgrade Vercel to Pro

Recommended minimum production step. Vercel currently lists Pro at **$20/month**, with a $20 usage credit and pay-as-you-go usage beyond the included amount. It provides commercial use, team collaboration, spend management, longer log retention, higher build concurrency, and more function headroom. Verify current pricing and taxes at [Vercel pricing](https://vercel.com/pricing).

This improves the platform boundary but does not solve the Sheets quota or n8n execution-volume problem. Explicit 60-second routes also remain 60 seconds until changed in code.

### Option C — pay for or request more Sheets capacity

Useful only as a tactical compatibility measure. Request a quota adjustment after measuring usage; do not use extra service accounts as an ungoverned quota bypass. The durable benefit comes from batching, reducing polling, a shared limiter, and moving operational state to Postgres—not from buying more request headroom.

### Option D — medium-term production architecture

Make Postgres the authoritative system for all recruitment queues, settings needed by the portal, status/history, credits, and workflow state. Keep Sheets as a reporting/export or migration mirror. Use a durable asynchronous worker for resume batches and provider callbacks, with idempotency keys, retry queues, dead-letter states, and provider-specific monitoring.

This is the option that removes the most capacity risk. It requires engineering work but reduces dependence on Vercel request duration, Sheets quotas, and polling frequency.

## Recommended implementation plan

### 0–3 days: production gate

- Approve Vercel Pro and verify the actual project uses Fluid Compute.
- Configure and test production `CRON_SECRET`; the local environment inspected for this report does not contain it, so the production dashboard must be checked.
- Verify Vercel usage, region, deployment protection, environment-variable scopes, and spend alerts.
- Verify the n8n subscription/hosting model, monthly execution quota, concurrency, retention, and alerting. The observed workspace volume requires this before sign-off.
- Run one real voice interview. Acceptance evidence must show: dispatch, callback, terminal attempt status, result persisted, exactly one expected credit charge, and no duplicate charge on callback retry.
- Smoke-test real Drive/OneDrive import, Calendar booking/cancellation/conflict checks, outbound email, LiveAvatar session/reconnect, and HitPay production webhook behavior before enabling production payments.

### 1–2 weeks: reduce operational risk

- Deactivate the two confirmed zero-execution pilot workflows after dependency confirmation.
- Rename or correct stale “keep inactive” descriptions and separate live workflows from drafts.
- Add n8n error workflows/alerts and explicit retries/dead-letter handling for Vapi, Gmail, Drive, and internal API calls.
- Add Sheets and provider quota dashboards with alert thresholds at 70%, 85%, and 95%.
- Finish the 24–48 hour dual-credit soak, verify Neon backup/PITR and a test restore, then obtain approval before any credits-authority cutover.

### 30–60 days: capacity architecture

- Implement queue-first, asynchronous resume intake so the HTTP request only validates and enqueues work.
- Replace process-local Sheets pacing with a shared limiter during the transition period.
- Migrate remaining operational Sheets tabs to Postgres.
- Reduce or consolidate n8n polling; prefer event/webhook-driven transitions where providers support them.
- Co-locate Vercel and Neon where practical and measure p95 latency for Drive, AI, database, and callback paths.

## Management decision table

| Decision | Recommendation | Reason |
|---|---|---|
| Vercel plan | **Approve Pro now** | Commercial posture, governance, logs, cron precision, build concurrency, and controlled overage. |
| Sheets API spend | **Do not buy as the primary fix** | Standard API use is free; quota adjustments and batching are tactical. |
| Google Cloud billing | **Enable/confirm billing for quota management and alerts** | Needed for visibility and possible quota requests; does not make Sheets unlimited. |
| n8n plan | **Verify and size before go-live** | Live workspace volume is already 5,775 executions in the observed period; plan is unknown. |
| Recruitment data authority | **Postgres** | Better transactions, tenant isolation, idempotency, and queue state. |
| Sheets role | **Mirror/export/legacy compatibility** | Avoid making a rate-limited workbook the operational control plane. |
| Bulk processing | **Durable async worker** | Removes the current 60-second request ceiling and improves retryability. |
| Voice sign-off | **Blocked until one real post-fix call passes** | Code and regression tests are not a substitute for provider callback evidence. |

## Audit limitations

This report is evidence-based but is not a claim that every external transaction was performed. The audit verified repository tests/build/typecheck, live Postgres integrity and credit parity, and live n8n workflow/execution metadata. It did not perform a real Vapi call, production payment/refund, live outbound email, calendar mutation, Drive/OneDrive upload, or dashboard-level Vercel/Google/n8n billing inspection. Those are explicit go-live gates above.

## Primary sources

- [Vercel pricing](https://vercel.com/pricing)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel limits](https://vercel.com/docs/limits)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel cron management and retry behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits)
- [Google Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Google Calendar API usage limits](https://developers.google.com/workspace/calendar/api/guides/quota)
- [Google Cloud quota management](https://docs.cloud.google.com/docs/quotas/view-manage)
- [n8n pricing](https://n8n.io/pricing/)
- [n8n Cloud plan features and limits](https://support.n8n.io/article/n-8-n-cloud-subscription-features-per-tier)
