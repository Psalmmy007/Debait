import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Sites where Debait runs. localhost = the demo feed (npm run demo).
export const SITES = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://www.youtube.com/*',
  'https://www.bbc.com/*',
  'https://www.bbc.co.uk/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

export default defineManifest({
  manifest_version: 3,
  name: 'Debait',
  version: pkg.version,
  description: 'Nutrition facts for your feed. Tags bait headlines and rewrites them calmly, on-device.',
  action: {
    default_title: 'Debait',
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/sw.js',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: ['storage', 'offscreen', 'sidePanel'],
  content_scripts: [
    {
      matches: SITES,
      js: ['src/content/main.js'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    { resources: ['fonts/*'], matches: SITES },
  ],
});
