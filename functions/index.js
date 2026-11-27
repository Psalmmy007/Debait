// Minimal App-Check-protected Firebase Cloud Function (v2 onCall) for debait-d6d5d.
// Mints single-use, short-lived ephemeral Gemini Live tokens with an atomic Firestore-backed
// per-caller (5/min) + global (30/min) rate limiter so browser clients never hold a long-lived
// Gemini API key and cannot bypass limits across concurrent requests or instances.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI } from '@google/genai';
import {
  createMintHandler,
  createAtomicRateLimiter,
  createFirestoreRateLimitStore,
} from './mintHandler.js';

if (!getApps().length) initializeApp();
const db = getFirestore();
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const handleMint = createMintHandler({
  getApiKey: () => geminiApiKey.value(),
  createClient: (opts) => new GoogleGenAI(opts),
  HttpsErrorCtor: HttpsError,
  logger,
  rateLimiter: createAtomicRateLimiter(createFirestoreRateLimitStore(db)),
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
