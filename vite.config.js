import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The offscreen page isn't in the manifest, so list it here.
      input: { offscreen: 'src/offscreen/index.html' },
    },
  },
});
