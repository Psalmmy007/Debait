import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';
import { createEngine } from './runtime.js';
import { DEMO_MODE } from './mode.js';

// Mock results require an explicitly selected demo build. Normal builds never fall back.
export const USE_MOCK = DEMO_MODE;
export const engine = createEngine({ firebaseEngine, mockEngine, demo: USE_MOCK });
