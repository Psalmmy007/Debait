
import { initializeApp } from "firebase/app";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyAjyYbK_Tc4s3ZqSbPBYblEJefkg0-l47A",
  authDomain: "debait-d6d5d.firebaseapp.com",
  projectId: "debait-d6d5d",
  storageBucket: "debait-d6d5d.firebasestorage.app",
  messagingSenderId: "63438015732",
  appId: "1:63438015732:web:54ab25a947b03005efa2a1"
};

export const app = initializeApp(firebaseConfig);

// Enable the debug provider during development only.
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    import.meta.env.VITE_RECAPTCHA_SITE_KEY
  ),
  isTokenAutoRefreshEnabled: true
});
