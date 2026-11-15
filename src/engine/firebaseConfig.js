// Firebase web app config (from src/firebase.js, set up by the Firebase half of the team).
// Firebase web configs are public by design; App Check protects the project.
export const firebaseConfig = {
  apiKey: 'AIzaSyAjyYbK_Tc4s3ZqSbPBYblEJefkg0-l47A',
  authDomain: 'debait-d6d5d.firebaseapp.com',
  projectId: 'debait-d6d5d',
  storageBucket: 'debait-d6d5d.firebasestorage.app',
  messagingSenderId: '63438015732',
  appId: '1:63438015732:web:54ab25a947b03005efa2a1',
};

// the cloud model the web analyzer already uses
export const CLOUD_MODEL = 'gemini-3.5-flash-lite';

// live voice call models, tried in order (Gemini Developer API via Firebase AI Logic)
export const LIVE_MODELS = ['gemini-2.5-flash-native-audio-preview-09-2025', 'gemini-live-2.5-flash-preview'];
// a warm female voice (Chirp 3 HD voice names)
export const LIVE_VOICE = 'Aoede';
