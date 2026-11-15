// Firebase AI Logic engine: Gemini Nano on-device first, Gemini in the cloud as a fallback.
// Uses the Firebase project set up in src/firebase.js. Runs in the offscreen page.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, CustomProvider, getToken } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai';
import { firebaseConfig, CLOUD_MODEL } from './firebaseConfig.js';

import { createFirebaseAccess, installationFromWorker } from './authPolicy.js';
import { aiError } from './errors.js';
import { createHeadlineEngine } from './inference.js';
import { deviceAvailability } from './device.js';
import { headlinePrompt } from './qualityPolicy.js';

// Production intentionally has no default issuer: an authenticated server-side
// attestation/token service must be provisioned and reviewed before connecting one.
const access = createFirebaseAccess({
  sdk: { initializeApp, initializeAppCheck, CustomProvider, getToken, getAI, GoogleAIBackend },
  config: firebaseConfig,
  env: import.meta.env,
  globals: globalThis,
  getInstallation: () => installationFromWorker(),
});
export async function getAi(debugToken) {
  try { return await access.getAi(debugToken); } catch (error) { throw aiError(error); }
}
let deviceAi;
function getDeviceAi() {
  // ONLY_ON_DEVICE never needs a cloud App Check exchange or cloud credentials.
  deviceAi ||= getAI(initializeApp(firebaseConfig, 'debait-device'), { backend: new GoogleAIBackend() });
  return deviceAi;
}

const KINDS = ['rage', 'fear', 'envy', 'clean'];
const LANG = [{ type: 'text', languages: ['en'] }];

const cloudSchema = Schema.object({
  properties: {
    results: Schema.array({
      items: Schema.object({
        properties: {
          kind: Schema.enumString({ enum: KINDS }),
          score: Schema.integer(),
          triggers: Schema.array({ items: Schema.object({ properties: { word: Schema.string(), why: Schema.string() } }) }),
          honest_rewrite: Schema.string(),
        },
      }),
    }),
  },
});
const deviceSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          triggers: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, why: { type: 'string' } }, required: ['word', 'why'] } },
          honest_rewrite: { type: 'string' },
        },
        required: ['kind', 'score', 'triggers', 'honest_rewrite'],
      },
    },
  },
  required: ['results'],
};


export const firebaseEngine = createHeadlineEngine({
  getAi, getDeviceAi, getGenerativeModel, InferenceMode,
  cloudModel: CLOUD_MODEL, cloudSchema, deviceSchema, lang: LANG,
  prompt: headlinePrompt, deviceAvailability,
  createDevice: options => LanguageModel.create(options),
});
