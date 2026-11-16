import { defineConfig, loadEnv } from 'vite';
import { quotaConfig } from './src/shared/quotaConfig.js';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

export default defineConfig(({ mode }) => {
  quotaConfig({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env });
  return {
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The offscreen page isn't in the manifest, so list it here.
      input: { offscreen: 'src/offscreen/index.html', voice: 'src/voice/index.html' },
    },
  },
  };
});
