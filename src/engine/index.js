// The single switch between the mock and the real AI.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';

export const USE_MOCK = true;

export const engine = USE_MOCK ? mockEngine : firebaseEngine;
