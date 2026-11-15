# Firebase authentication for the Debait extension

## What is implemented and what is not verified

The original Vite web prototype (`src/firebase.js`, `src/main.js`) is unchanged. Its
reCAPTCHA Enterprise setup does not authenticate the extension automatically.
The extension continues using Firebase AI Logic, not a direct Gemini API client.
Its hybrid mode is `PREFER_ON_DEVICE`; Local Only is `ONLY_ON_DEVICE` and uses a
separate Firebase app without requesting cloud App Check credentials.

Normal operation has no automatic mock fallback. Authentication is checked with
Firebase App Check `getToken()` before handing the cloud AI client to inference
or voice. Failed authentication does not start a cloud inference request. Token
refresh is demand-driven: the SDK caches valid tokens; each cloud operation calls
`getToken()` again, with no idle background refresher.

Source labels use the SDK response's `inferenceSource`, not a guess based on model
availability or a field inside generated JSON. Before a successful analysis, the
status is unverified. A displayed source describes the last successful analysis,
not a guarantee of which model a future request will choose.

Automated tests use controlled SDK responses. One test loads the installed Firebase
SDK and checks that unconfigured production authentication fails closed. Neither
that negative check nor a passing build proves successful Firebase authentication
or real model execution. Those remain unverified in this environment.

## Secure development test, step by step

Your development project is `debait-d6d5d`; its public app configuration is already
in `src/engine/firebaseConfig.js`. The Firebase API key in that web configuration
is not an App Check debug credential. Do not add service-account keys or debug
tokens to that file, any Vite variable, or Git.

1. Build a development extension explicitly:
   ```bash
   VITE_DEBAIT_APP_CHECK=debug npm run build:dev
   ```
   Do **not** set `VITE_DEBAIT_ENGINE=mock`. `?preview` is also simulated UI and
   cannot demonstrate Firebase execution.
2. In desktop Chrome, open `chrome://extensions`, enable Developer mode, and load
   this checkout's `dist` directory unpacked. The code checks Chrome's installation
   type using `chrome.management.getSelf()` in the service worker, as well as build
   intent and manifest packaging. The worker also reads manifest packaging (`getManifest()` is not available in
   the offscreen context). The offscreen document obtains both results through
   a worker message restricted to that document. Chrome does not require the broad
   `management` permission for `getSelf()`; no new permissions are added. Offscreen
   documents cannot call `chrome.management` directly. A store or sideloaded packaged
   install cannot use debug authentication.
3. Turn Local Only off. For a cloud-only development test, use a browser/profile
   where Nano is unavailable. Visit a supported public test page with a new headline,
   so a cache hit cannot be mistaken for a new Firebase request.
4. The first attempt should fail if its debug token is not registered. Open the popup.
   Its setup area provides the installation token. Treat it as a password: copy it
   directly into Firebase Console, not chat, shared logs, screenshots or source code.
   Firebase itself also logs debug tokens to the private development console; do not
   publish that console output. No token value is included in these instructions.
5. In Firebase Console, select **debait-d6d5d → App Check → Apps → the matching web
   app → Manage debug tokens → Add debug token**. Register this installation's token
   with a recognizable development label. Keep Firebase AI Logic enforcement enabled.
   Console labels may vary slightly. The account needs permission to manage App Check.
6. Retry a new headline after registration. Inspect the extension offscreen page via
   `chrome://extensions` and its Network panel. Verify a successful Firebase AI Logic
   request, successful response parsing and `inferenceSource: in_cloud`. Record only
   redacted status/source evidence; never share request authentication headers or tokens.
7. If App Check succeeds but inference fails, distinguish model availability, quota,
   API restrictions and project access. The existing `gemini-3.5-flash-lite` model ID
   was preserved, not asserted to be available. Confirm the ID in the current Firebase
   model documentation for your project before changing it. Do the same for Live models.
8. Repeat with Local Only on: no App Check exchange, cloud inference or voice connection
   should occur. Test real Nano on supported hardware; otherwise expect a clear error.
9. Revoke temporary debug tokens in Console when testing is finished. For release,
   build with plain `npm run build`; that build rejects debug authentication.

The debug credential is stored in extension-origin IndexedDB, not the preferences
store exposed to content scripts. Development builds migrate and remove a legacy
`chrome.storage.local` token; other builds remove that legacy value without using it.
Only the extension popup receives the setup token. Signing out of Firebase Console
is different from revoking an App Check debug credential.

## Updating an existing unpacked development installation

`VITE_DEBAIT_APP_CHECK=debug npm run build` is **not** a development-mode build:
Vite still selects production mode. The flag alone must not enable debug authentication.
Use `VITE_DEBAIT_APP_CHECK=debug npm run build:dev` instead.

After updating this branch, rebuild with that command, click **Reload** on the existing
Debait card in `chrome://extensions`, then refresh the test page. This loads the corrected
worker and offscreen code. You do not need to remove/reinstall the extension or grant
new permissions. Keep the same `dist` location so its development identity and stored
debug token remain stable. Register a new token only if the installation's token changed.
A successful build or installation-type check still does not prove App Check authentication;
complete the Firebase Console and real-request verification steps above.

## Communication and on-device retest

The engine now waits for an offscreen readiness response before forwarding operations.
A temporary missing worker response does not permanently disable development verification;
it still denies that request and retries verification on a later request. Installation
metadata must contain both Chrome's install type and worker-derived packaging information.
No permissions or authentication requirements have been relaxed.

After updating, rebuild with `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`, reload the
existing unpacked extension in `chrome://extensions`, and refresh **all test tabs**.
Reloading an extension invalidates old content scripts; injecting new scripts does not
reliably repair the old execution context. Current content scripts report a refresh
instruction and stop retrying after context invalidation instead of throwing a raw
`sendMessage` TypeError. Do not uninstall or clear storage just to perform this update.

Check cloud authentication with a fresh public test headline and Local Only off on a
profile where Nano is unavailable; do not use the mock preview as evidence. Then test
Nano separately with Local Only on. All availability/create calls should specify English
input **and output**. An availability result of `available` is not proof that a model
session can execute.

The message “model was available but there was not an execution config available”
comes from the on-device execution path; this repository alone cannot establish why
Chrome's configuration was unavailable. It is now reported separately from App Check.
Do not disable enforcement or change browser security flags to hide it. If it persists,
collect Chrome version and OS, whether the error is from the offscreen/popup/content
context, and the redacted file/line/stack of the first error after a clean reload.
In the offscreen console, this credential-free capability check may help:

```js
await LanguageModel.availability({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }]
})
```

Share only the availability result and redacted diagnostics, never App Check tokens,
provider payloads or authentication headers. The reported raw `sendMessage` error
cannot be assigned to one original call site without its stack trace; context
invalidation is handled defensively, not asserted as the proven origin of that report.
Successful App Check/model execution must still be established from actual browser requests.

## Production strategy and release blocker

**There is no trusted production token issuer in this repository or deployment
configuration. Production cloud and voice deliberately fail closed until one exists.**
The implemented `createFirebaseAccess` adapter supports the Firebase SDK's
`CustomProvider` contract: `getToken()` supplies an App Check token plus its future
`expireTimeMillis`. No default production provider is wired into `firebaseEngine.js`.
Do not fill this gap with a static token, an unauthenticated token endpoint, a
service-account key in the extension, or a debug token registered for every user.

A supported production design requires a trusted HTTPS service that verifies an
appropriate client attestation/abuse signal before issuing limited-lifetime App Check
tokens with the Firebase Admin SDK for the intended app. The server holds its own
credentials. Use a separate production Firebase app/project and review its public
configuration before release; the existing configuration is the development project. User sign-in, allowed origins or a Chrome extension ID alone do not
prove app authenticity; that verification policy needs a security review.

One candidate for review is a companion HTTPS page where reCAPTCHA Enterprise can
run, followed by a server-validated, short-lived, one-use exchange bound to the
extension's authenticated session and a PKCE challenge. The extension must validate
redirects/origins, bind the exchange to its initiating session and renew tokens
securely. This would require backend implementation and potentially a browser auth
flow; it is a proposed design, not a deployed or verified solution. The existing
web prototype should not be repurposed or its settings changed without review.

Once that service is designed/deployed, connect its authenticated token client via
`productionProvider` in `createFirebaseAccess`, test expiration/replay/revocation,
and verify actual App Check-enforced cloud and Live requests. Keep enforcement on.
A production model/source label is not a substitute for that evidence.

## References and evidence limits

- https://firebase.google.com/docs/app-check/web/debug-provider
- https://firebase.google.com/docs/app-check/web/custom-provider
- https://firebase.google.com/docs/app-check/custom-provider
- https://firebase.google.com/docs/ai-logic/hybrid-inference
- https://developer.chrome.com/docs/extensions/reference/api/management#method-getSelf
- https://developer.chrome.com/docs/extensions/reference/api/offscreen
- https://github.com/chromium/chromium/blob/main/extensions/common/api/_api_features.json

Chrome/Firebase documentation pages returned HTTP 403 in this environment. The official
Chromium API feature definitions were retrieved: `management.getSelf` has no permission
dependency and runs in a privileged extension context, not an offscreen context. SDK compatibility
was checked against installed Firebase 13.3.0 code/types; live documentation, Console
configuration and server/browser runtime behavior still need review by the team.
