# Rewrite integrity and quota follow-up

## Confirmed causes and implementation

The old card and bulk/voice actions equated a non-Clean classification with having
an available rewrite. They could display the original as a suggestion, mark it
rewritten and increment counts. That is fixed by a shared, case-preserving comparison
(Unicode NFC, whitespace, typographic quotes). No changed wording is forced.

The card now says “No safe alternative available” and offers no rewrite action for
unchanged text. Individual, automatic, page-wide and voice tool paths use the same
eligibility decision. DOM swaps return a success flag; only completed meaningful
changes count. Voice tools report actual completed counts, not predicted bait counts.
Quoted speech must be retained verbatim, allowing only normalized whitespace and
typographic quote forms. Contractions within quotations are handled as apostrophes.
Existing name/number/negation/attribution/quantity/duration tripwires remain in place.
These checks are conservative, not a complete semantic or factual proof.

A privacy-safe rewriteReason enum distinguishes `model_unchanged` from
`preservation_guard` (and `clean`/`alternative`). It survives internal normalizer/cache
hops; model-supplied provenance is ignored. Rejected proposal text is not retained.
The old reported output cannot be retrospectively attributed to Gemini or the guard.
The quality policy/cache version is bumped so new results contain reliable provenance.
Historical reading statistics are retained, not retrospectively recalculated.

The classifier receives a targeted reminder that a first-person quotation describing
fear or distress is not automatically publisher manipulation. Authenticity cannot be
established from a headline alone. No categories, category guide, popup, or weekly
report UI were changed. Recommended next quality work is a small human-reviewed
matched-pair dataset of attributed distress quotes versus publisher-added threats,
with per-source evaluation on cloud and Nano. Prompt wording does not establish a
measured accuracy improvement; no broad classifier redesign was done.

## Quota findings and local configuration

The existing gate still coordinates tabs in one installation, deduplicates in-flight
headlines, retains legitimate cache hits, honors exposed server retry guidance, and
bounds retries. The pause/resume cycle can be an expected cooldown/retry, not proof
of a storm. Without current server quota details we cannot attribute the observed
429s to discovery, other users, or a particular RPM/TPM/day allocation.

The short discovery coalescing window increases from 120ms to 400ms, preserving the
8-headline maximum. This lets nearby discoveries share a fuller batch; it is not a
new global work queue. Existing cooldown/pause logic prevents new discoveries from
restarting the retry timer. Local pacing, a real Gemini 429 cooldown, and the local
daily budget now have explicitly different notices.

Local budgets are configurable public build settings:

- `VITE_DEBAIT_QUOTA_RPM`: positive integer; default 6 (10-second spacing).
- `VITE_DEBAIT_QUOTA_RPD`: positive integer; default 240 per UTC day.

These are operating defaults, NOT verified Google allocations. Verify the current
project/model limits in AI Studio/Cloud Console and reserve room for other clients
before choosing values. Model ID, billing and credentials are unchanged. Invalid
values fail the build. No new settings UI is added. For example, to choose stricter
local budgets without changing code:

```bash
VITE_DEBAIT_APP_CHECK=debug VITE_DEBAIT_QUOTA_RPM=3 VITE_DEBAIT_QUOTA_RPD=100 npm run build:dev
```

A server RetryInfo/Retry-After delay remains a lower bound regardless of these settings.
The Firebase SDK normally exposes RetryInfo but discards response headers; unavailable
headers cannot be recovered by this client. Per-installation limits cannot reserve
project-wide capacity, measure global TPM, or control other users, profiles, the web
prototype or voice models. Stronger enforcement still requires a trusted shared
backend/admission queue and project/model accounting that cloud clients cannot bypass.
Never solve this by weakening App Check or silently using cloud in Local Only mode.

## Validation and browser retest

Automated tests cover normalization, quotes/contractions, guard/model provenance,
zero-op DOM swaps, completed swaps, configurable pacing, distinct quota messages,
and all prior authentication/privacy/cache/backoff guarantees. Controlled Chromium
preview tests exercise the card, individual/automatic/page-wide actions, voice tool
counts and restoration. Those simulate model responses and do not consume Gemini
quota or verify real classification quality.

One previous test permitted dropping the childbirth headline's quote. It initially
failed under the stricter preservation requirement and was updated to require retaining
both the quote and permanence claim. See the final test run for the passing count.

1. Update only `repair/priority2-firebase-auth` with a fast-forward pull; run `npm ci`.
2. Run `VITE_DEBAIT_APP_CHECK=debug npm run build:dev` (optionally with verified local
   quota budgets as above). Keep the same `dist` path and private App Check registration.
3. Reload the existing unpacked extension in `chrome://extensions`. Refresh all test
   tabs and reopen offscreen DevTools if needed. No uninstall or credential reset.
4. With automatic rewriting off, inspect the supplied teenager headline. If the safe
   result repeats it, expect “No safe alternative available” and no Debait it action.
   Repeated orb/voice actions must not count it. Confirm quotes remain intact and a
   genuinely changed safe headline still rewrites/restores normally.
5. Test automatic rewriting separately if desired, then turn it back off. Unchanged
   headlines must stay unmodified and uncounted; actual model labels still need review.
6. Slowly discover public test headlines in two tabs. Compare local waiting versus
   server cooldown notices. During cooldown, additional scrolling should not trigger
   API retries. Identical headlines should share in-flight analysis/use the cache.
7. Do not deliberately exhaust the free tier. If a natural 429 persists, supply only
   redacted status/code, RetryInfo delay, quota metric, model ID and current Console
   limits. Do not share debug tokens, headers, provider payloads or private headlines.
8. Repeat Local Only checks: no cloud fallback, and no mocked success on failure.
