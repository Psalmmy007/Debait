// Firebase Cloud Functions (v2) for debait-d6d5d:
// 1. issueAppCheckToken: Custom Firebase App Check token provider for the production Debait MV3
//    Chrome extension (validates chrome-extension:// origin + X-Debait-Client header + atomic
//    Firestore rate limiting, mints short-lived 30-min App Check tokens via Firebase Admin SDK).
// 2. mintLiveVoiceToken: App-Check-enforced callable that mints single-use ephemeral Gemini Live
//    tokens (gated off in the extension release build until verified).
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI } from '@google/genai';
import {
  createMintHandler,
  createAtomicRateLimiter,
  createFirestoreRateLimitStore,
} from './mintHandler.js';
import {
  createAppCheckTokenHandler,
  DEBAIT_WEB_APP_ID,
  APP_CHECK_TTL_MS,
  APP_CHECK_GLOBAL_BUCKET_ID,
  APP_CHECK_CALLER_MAX,
  APP_CHECK_GLOBAL_MAX,
  APP_CHECK_WINDOW_MS,
} from './appCheckHandler.js';

if (!getApps().length) initializeApp();
const db = getFirestore();
const rateLimitStore = createFirestoreRateLimitStore(db);
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const handleIssueAppCheckToken = createAppCheckTokenHandler({
  createToken: (appId, opts) => getAppCheck().createToken(appId, opts),
  rateLimiter: createAtomicRateLimiter(rateLimitStore, {
    callerMax: APP_CHECK_CALLER_MAX,
    globalMax: APP_CHECK_GLOBAL_MAX,
    windowMs: APP_CHECK_WINDOW_MS,
    globalBucketId: APP_CHECK_GLOBAL_BUCKET_ID,
  }),
  appId: DEBAIT_WEB_APP_ID,
  ttlMillis: APP_CHECK_TTL_MS,
  logger,
});

export const issueAppCheckToken = onRequest(
  {
    region: 'us-central1',
    maxInstances: 5,
    concurrency: 20,
    timeoutSeconds: 10,
  },
  handleIssueAppCheckToken,
);

const handleMint = createMintHandler({
  getApiKey: () => geminiApiKey.value(),
  createClient: (opts) => new GoogleGenAI(opts),
  HttpsErrorCtor: HttpsError,
  logger,
  rateLimiter: createAtomicRateLimiter(rateLimitStore),
});

export const mintLiveVoiceToken = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    secrets: [geminiApiKey],
    maxInstances: 5,
    concurrency: 20,
    timeoutSeconds: 15,
  },
  handleMint,
);
