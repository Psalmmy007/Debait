// Firebase web app config. Primary project (Team / debait-d6d5d) enforces App Check and is
// the ONLY project permitted in release builds. Unprotected backup fallback is disabled so
// headline analysis, summaries, and voice never silently bypass App Check authentication.
export const ALLOW_BACKUP_FALLBACK = false;

export const FIREBASE_PROJECTS = [
  {
    name: 'Team',
    appCheckEnforced: true,
    config: {
      apiKey: 'AIzaSyAjyYbK_Tc4s3ZqSbPBYblEJefkg0-l47A',
      authDomain: 'debait-d6d5d.firebaseapp.com',
      projectId: 'debait-d6d5d',
      storageBucket: 'debait-d6d5d.firebasestorage.app',
      messagingSenderId: '63438015732',
      appId: '1:63438015732:web:54ab25a947b03005efa2a1',
    },
  },
];

// Primary (Team) Firebase project config.
export const firebaseConfig = FIREBASE_PROJECTS[0].config;

// The cloud model used for headline analysis.
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

// Live voice call models, tried in order (Gemini Developer API via Firebase AI Logic).
export const LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-09-2025',
];
// Youthful, smooth, expressive female voice (Chirp 3 HD).
export const LIVE_VOICE = 'Leda';

// App-Check-protected Cloud Function (v2 onCall) on debait-d6d5d that mints short-lived ephemeral Live tokens.
export const FUNCTIONS_REGION = 'us-central1';
export const LIVE_TOKEN_FUNCTION = 'mintLiveVoiceToken';

// Production App Check custom-token issuer endpoint on debait-d6d5d (Firebase Functions v2 onRequest).
// Mints short-lived App Check tokens server-side using Firebase Admin SDK so the extension bundle
// never embeds debug tokens or service-account credentials.
export const APP_CHECK_TOKEN_FUNCTION = 'issueAppCheckToken';
export const APP_CHECK_TOKEN_URL = `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/${APP_CHECK_TOKEN_FUNCTION}`;

// Release gate: keep the full LIVE_VOICE ('Leda') + ephemeral token backend intact in the repo,
// but gate the live voice trigger until mintLiveVoiceToken is deployed and verified on debait-d6d5d.
export const ENABLE_LIVE_VOICE = false;
export const VOICE_GATED_MESSAGE = 'Voice requires ephemeral token backend under App Check';
