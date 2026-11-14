// Firebase AI Logic engine — owned by the Firebase half of the team.
// Implement the three functions below (see docs/ENGINE.md), then set
// USE_MOCK = false in engine/index.js. Nothing in the UI needs to change.
//
// Runs inside the offscreen document (src/offscreen), which is a normal
// extension page, so the Firebase SDK and Chrome's Prompt API both work here.

const notWired = () => new Error('Firebase engine not wired yet (see docs/ENGINE.md)');

/** @type {import('./contract.js').Engine} */
export const firebaseEngine = {
  async scoreHeadlines(texts, { localOnly }) {
    throw notWired();
  },
  async getStatus({ localOnly }) {
    return { ready: false, source: 'none', localOnly, message: 'Firebase engine not wired yet' };
  },
  async initDeviceModel() {
    return { ready: false, source: 'none', localOnly: false, message: 'Firebase engine not wired yet' };
  },
};
