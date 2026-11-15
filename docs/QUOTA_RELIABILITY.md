# Headline quota controls

The reported 15/15 RPM, 13.05K/250K TPM and 52/500 RPD values are peaks from a
28-day dashboard view. They do not establish that the project is exhausted now.
No model, billing setting, Firebase enforcement or production credential was changed.

## Audit and changes

Previously each page independently sent batches of up to eight headlines. Different
tabs could miss the same cache at the same time and make duplicate requests. Failed
batches retried every minute without a per-headline retry limit. The engine's outer
timeout did not cancel the SDK's underlying cloud request.

The service worker now coalesces in-flight identical headlines (with separate privacy
revisions/modes) and applies a common admission gate to normal hybrid headline batches:

- One active batch, at least 10 seconds between request starts: approximately 6 RPM.
- A conservative local budget of 240 attempts per UTC day, leaving room below the
  reported 500/day for other traffic. Failed attempts count conservatively too.
- A persisted 45-second in-flight reservation survives an unexpected worker restart.
- Accepted attempts use the existing SDK request path. Local Only and the explicit
  demo bypass the cloud gate. Cache hits do not consume request budget.
- A 429 sets a shared cooldown: 30, 60, 120 seconds, increasing to a 5-minute backoff
  cap for later failures, plus jitter. Available server retry guidance is a lower
  bound and is never shortened to that cap. After three consecutive 429s, automatic
  retries stop. A later permitted successful request resets the failure count.
- Each headline gets at most two automatic retries after failed attempts. Normal
  pacing waits have a separate maximum of 30 deferrals, so waiting for a slot does
  not immediately use up the failure retry budget. Deferrals never submit Gemini
  requests. Tabs have one retry timer and stop draining batches during a quota pause.
- SDK cloud calls receive an AbortSignal and 25-second timeout; late authentication
  cannot start inference after that deadline. Cancellation cannot undo server work
  already accepted. Native model cancellation is subject to the SDK/browser's support.

There is no internal automatic replay of a failed Gemini call. The bounded tab retry
happens only after cooldown, through the same central admission gate and privacy checks.
Other errors' existing retries are now bounded too. No failure becomes Clean or mock.

Firebase 13.3.0 exposes HTTP status in `customData.status` and server error details in
`customData.errorDetails`. The implementation preserves only the scalar retry delay
from `google.rpc.RetryInfo`, not provider payloads. It also supports Retry-After seconds
or HTTP dates when a transport exposes headers. The installed Firebase SDK does not
normally preserve response headers, so a header-only hint may be unavailable; then
conservative local backoff applies. Do not log headers or debug credentials to diagnose it.

Budget/cooldown state is local scalar metadata under `aiRequestBudget`; policy-versioned
headline caching and historical reading statistics are preserved. This local UTC day
is not a claim about Google's precise daily quota reset time. The gate also conservatively
paces a hybrid request which eventually runs on-device; Local Only remains independent.

## Limits of this architecture

This coordinates tabs in one browser installation/profile, not different installations,
users, the original web prototype, Live voice streaming, or other project clients. The
headroom is a policy choice, not a reservation of 9 RPM or 260 daily requests. It cannot
guarantee the shared project avoids 429s, and it does not independently measure/enforce
project-wide TPM. There is no persistent fair work queue; busy tabs can be deferred, and
reloads create new page retry budgets, while the central persisted pacing/daily cap remains.
Client-side controls can be modified or bypassed and are not a production abuse boundary.

Production-wide limits require a trusted server with atomic shared counters/leases or
a queue (for example Redis/Firestore transactions plus controlled workers), project/model
RPM/TPM/day accounting, per-user limits, and shared cooldowns. Strong enforcement requires
an architecture in which cloud requests cannot bypass that server. A client-only gate
or an optional reservation endpoint is insufficient. Review that architecture together
with production App Check/token issuance; do not weaken supported hybrid behavior.

## Update and manual retest

1. Update `repair/priority2-firebase-auth`, run `npm ci`, then build with
   `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`.
2. Reload the existing unpacked extension and refresh test tabs. Keep the same dist
   location and private App Check registration. Leave automatic rewriting off.
3. Use public test headlines. Open the same headline in two tabs: requests in flight
   should be shared; later requests should use the valid cache. For distinct batches,
   inspect request-start timestamps: starts are spaced at least 10 seconds apart.
4. Waiting tabs should show an honest budget/rate-limit notice, with no fake tags or
   rewritten text. Retry timing includes jitter. Large pages may take longer or reach
   the bounded wait allowance and need a later manual refresh.
5. Do not deliberately exhaust the project's free quota. Automated tests inject 429s
   and advance a fake clock. If a natural 429 occurs, verify the shared cooldown and
   eventual recovery. Check both the SDK request log and UI; never share auth headers.
6. Repeat with Local Only: genuine device results remain allowed without cloud budget
   consumption, and unavailable Nano must still produce an error, never cloud fallback.

Tests cover pacing, reservation persistence, bounded retries/backoff, server guidance,
daily cap/recovery, in-flight deduplication, Local Only, cache behavior and cancellation.
They use controlled SDK/Chrome responses and do not demonstrate current live quota
headroom, Google server cancellation, or a successful real-model request in this task.
