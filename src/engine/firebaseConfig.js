// Firebase web app configs. Primary project (Team / debait-d6d5d) enforces App Check and is
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
  {
    name: 'Backup',
    appCheckEnforced: false,
    config: {
      apiKey: 'AIzaSyDtxldc6JaRo-oA92h_xJLULyAt4m-OreU',
      authDomain: 'axi-chat-2026.firebaseapp.com',
      projectId: 'axi-chat-2026',
      storageBucket: 'axi-chat-2026.firebasestorage.app',
      messagingSenderId: '449903493205',
      appId: '1:449903493205:web:eb5c0ef517b0ce750654dc',
    },
  },
];

// kept for older imports: the first (team) project
export const firebaseConfig = FIREBASE_PROJECTS[0].config;

// the cloud model the web analyzer already uses
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

// live voice call models, tried in order (Gemini Developer API via Firebase AI Logic)
// (checked against the Live API: these accept a session; gemini-live-2.5-flash-preview does not)
export const LIVE_MODELS = ['gemini-2.5-flash-native-audio-latest', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-09-2025'];
// youthful, smooth, expressive female voice (Chirp 3 HD; 'Zephyr' is the bright/clear backup)
export const LIVE_VOICE = 'Leda';
