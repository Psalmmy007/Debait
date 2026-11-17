// Firebase web app configs. Debait tries them in order: the team project first, then a
// backup project, so one project that isn't set up (or is over quota) never breaks Debait.
// Firebase web configs are public by design; App Check protects each project.
export const FIREBASE_PROJECTS = [
  {
    name: 'Team',
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
// a warm female voice (Chirp 3 HD voice names)
export const LIVE_VOICE = 'Aoede';
