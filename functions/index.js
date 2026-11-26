// Minimal App-Check-protected Firebase Cloud Function (v2 onCall) for debait-d6d5d.
// Mints single-use, short-lived ephemeral Gemini Live tokens so browser clients never hold
// a long-lived Gemini API key and cannot bypass Firebase App Check enforcement.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI } from '@google/genai';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const ALLOWED_LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-09-2025',
];
const LIVE_VOICE = 'Leda';
const EPHEMERAL_API_VERSION = 'v1alpha';
const SESSION_TTL_MS = 30 * 60 * 1000;      // 30 min max live call duration
const HANDSHAKE_WINDOW_MS = 60 * 1000;      // 60 s window to open the WebSocket

export const mintLiveVoiceToken = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    secrets: [geminiApiKey],
    maxInstances: 10,
    timeoutSeconds: 15,
  },
  async (request) => {
    const requestedModel = typeof request.data?.model === 'string' ? request.data.model.trim() : '';
    const model = ALLOWED_LIVE_MODELS.includes(requestedModel) ? requestedModel : ALLOWED_LIVE_MODELS[0];

    const apiKey = geminiApiKey.value();
    if (!apiKey) {
      logger.error('GEMINI_API_KEY secret is not configured for mintLiveVoiceToken.');
      throw new HttpsError('failed-precondition', 'Voice token service is missing GEMINI_API_KEY secret.');
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: EPHEMERAL_API_VERSION },
      });

      const now = Date.now();
      const expireTime = new Date(now + SESSION_TTL_MS).toISOString();
      const newSessionExpireTime = new Date(now + HANDSHAKE_WINDOW_MS).toISOString();

      const tokenRes = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: `models/${model}`,
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: LIVE_VOICE },
                },
              },
            },
          },
        },
      });

      if (!tokenRes?.name) {
        throw new Error('Gemini authTokens.create returned an empty token');
      }

      return {
        token: tokenRes.name,
        model,
        apiVersion: EPHEMERAL_API_VERSION,
        expiresAt: expireTime,
      };
    } catch (err) {
      logger.error('mintLiveVoiceToken failed', { message: err?.message || String(err), model });
      throw new HttpsError('internal', 'Failed to mint ephemeral Gemini Live token.');
    }
  },
);
