import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

// A fingerprint for this build. It is baked into the extension AND written to dist/build.json,
// so a running (unpacked) Debait can tell when the files on disk are newer and reload itself.
const BUILD_ID = Date.now().toString(36);

const stampBuild = {
  name: 'debait-build-stamp',
  closeBundle() {
    writeFileSync('dist/build.json', JSON.stringify({ id: BUILD_ID, built: new Date().toISOString() }));
  },
};

export default defineConfig({
  plugins: [crx({ manifest }), stampBuild],
  define: { __DEBAIT_BUILD__: JSON.stringify(BUILD_ID) },
  build: {
    outDir: 'dist',
    // keep older files: the version Chrome is running still needs them until it reloads
    emptyOutDir: false,
    rollupOptions: {
      // The offscreen page isn't in the manifest, so list it here.
      input: { offscreen: 'src/offscreen/index.html', voice: 'src/voice/index.html' },
    },
  },
});
