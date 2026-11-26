// Minimal App-Check-protected Firebase Cloud Function (v2 onCall) for debait-d6d5d.
// Mints single-use, short-lived ephemeral Gemini Live tokens with per-caller rate limiting
// so browser clients never hold a long-lived Gemini API key and cannot run up unbounded costs.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI } from '@google/genai';
import { createMintHandler } from './mintHandler.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const handleMint = createMintHandler({
  getApiKey: () => geminiApiKey.value(),
  createClient: (opts) => new GoogleGenAI(opts),
  HttpsErrorCtor: HttpsError,
  logger,
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
