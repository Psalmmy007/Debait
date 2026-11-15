// Build-time intent plus runtime packaging: no credentials belong in Vite variables.
export async function installationType(chromeApi = globalThis.chrome) {
  try { return (await chromeApi.management.getSelf()).installType; } catch { return 'unknown'; }
}

// Offscreen documents can use runtime messaging, not chrome.management.
// The service worker derives the answer from Chrome; callers never supply it.
export async function installationTypeFromWorker(chromeApi = globalThis.chrome) {
  try {
    const reply = await chromeApi.runtime.sendMessage({ type: 'debait/installation-type' });
    return reply?.ok === true && ['development', 'normal', 'sideload', 'admin', 'other'].includes(reply.installType)
      ? reply.installType : 'unknown';
  } catch { return 'unknown'; }
}

export function debugAppCheckAllowed(env, manifest, installType) {
  return ['development', 'demo'].includes(env?.MODE) &&
    env?.VITE_DEBAIT_APP_CHECK === 'debug' && installType === 'development' &&
    !!manifest && typeof manifest === 'object' && !('update_url' in manifest);
}

export function appCheckSetupError(message) {
  return Object.assign(new Error(message), { code: 'debait/app-check-setup' });
}

// SDK dependencies are injected so the authentication boundary is testable offline.
// A production provider must obtain short-lived tokens from a trusted issuer;
// it must never mint tokens or contain a service-account key in this extension.
export function createFirebaseAccess({ sdk, config, env, manifest, globals, productionProvider, getInstallType = installationType }) {
  let ai, appCheck;
  let debug;
  let initialDebugToken;
  return {
    get debug() { return debug === true; },
    async getAi(debugToken) {
      if (env?.VITE_DEBAIT_APP_CHECK === 'debug' && !['development', 'demo'].includes(env?.MODE)) {
        throw appCheckSetupError('Debug authentication was requested in a production-mode build. Rebuild with VITE_DEBAIT_APP_CHECK=debug npm run build:dev, then reload the unpacked extension.');
      }
      if (debug === undefined) debug = debugAppCheckAllowed(env, manifest, await getInstallType());
      if (env?.VITE_DEBAIT_APP_CHECK === 'debug' && !debug) {
        throw appCheckSetupError('Development authentication is blocked: Chrome did not verify an unpacked development installation. Reload the extension and check its service worker. Debug authentication is never allowed for packaged installs.');
      }
      if (!ai) {
        let provider;
        if (debug) {
          if (typeof debugToken !== 'string' || !debugToken.trim()) {
            throw appCheckSetupError('Development App Check needs this installation’s registered debug token. Open the popup setup instructions.');
          }
          initialDebugToken = debugToken;
          globals.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
          // Firebase's supported debug mode exchanges the debug token instead of
          // calling this provider. If debug mode is not active, fail closed.
          provider = new sdk.CustomProvider({ getToken: async () => {
            throw appCheckSetupError('Development App Check debug mode was not activated. Reload the extension.');
          } });
        } else {
          if (typeof globals.FIREBASE_APPCHECK_DEBUG_TOKEN === 'string' || globals.FIREBASE_APPCHECK_DEBUG_TOKEN === true) {
            throw appCheckSetupError('Debug App Check is forbidden in this build. Reload a clean production extension context.');
          }
          if (!productionProvider) {
            throw appCheckSetupError('Cloud AI is not configured: production requires a trusted App Check custom-token provider. Local Only remains available on supported hardware.');
          }
          provider = new sdk.CustomProvider({ getToken: async () => {
            const issued = await productionProvider.getToken();
            if (typeof issued?.token !== 'string' || !issued.token ||
                !Number.isFinite(issued.expireTimeMillis) || issued.expireTimeMillis <= Date.now()) {
              throw appCheckSetupError('The trusted App Check provider returned an invalid or expired token.');
            }
            return issued;
          } });
        }
        const app = sdk.initializeApp(config, 'debait-cloud');
        appCheck = sdk.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: false });
        ai = sdk.getAI(app, { backend: new sdk.GoogleAIBackend() });
      }
      if (debug && debugToken !== initialDebugToken) {
        throw appCheckSetupError('The development App Check token changed. Reload the extension before retrying.');
      }
      // The SDK may otherwise send a dummy App Check token after an exchange failure.
      // Explicitly validate authentication before any cloud inference or Live connection.
      const result = await sdk.getToken(appCheck, false);
      if (result?.error || typeof result?.token !== 'string' || !result.token) {
        throw appCheckSetupError('App Check did not return a valid token. Cloud AI was not contacted.');
      }
      return ai;
    },
  };
}
