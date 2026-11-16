import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { quotaConfig } from './src/shared/quotaConfig.js';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

export default defineConfig(({ mode }) => {
  quotaConfig({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env });
  let gitSha = 'unknown', gitDirty = true;
  try {
    gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    gitDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  } catch { /* Source archive, no Git metadata. */ }
  return {
  define: { __DEBAIT_BUILD_SHA__: JSON.stringify(gitSha), __DEBAIT_BUILD_DIRTY__: JSON.stringify(gitDirty) },
  plugins: [crx({ manifest }), ...(mode === 'development' ? [{
    name: 'evaluation-sample',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'dev/evaluation/sample.csv', source: readFileSync('dev/evaluation/sample.csv', 'utf8') }); },
  }] : [])],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The offscreen page isn't in the manifest, so list it here.
      input: { offscreen: 'src/offscreen/index.html', voice: 'src/voice/index.html', ...(mode === 'development' ? { evaluation: 'dev/evaluation/index.html' } : {}) },
    },
  },
  };
});
