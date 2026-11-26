import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Sites where Debait runs (X, YouTube, BBC, Google, news sites, local demo),
// explicitly excluding sensitive IDEs, webmail, workspaces, chat apps, and banking hosts.
export const SITES = ['http://*/*', 'https://*/*'];
export const EXCLUDED_SITES = [
  '*://*.github.dev/*',
  '*://*.vscode.dev/*',
  '*://mail.google.com/*',
  '*://docs.google.com/*',
  '*://drive.google.com/*',
  '*://sheets.google.com/*',
  '*://slides.google.com/*',
  '*://outlook.live.com/*',
  '*://outlook.office.com/*',
  '*://*.slack.com/*',
  '*://discord.com/*',
  '*://*.notion.so/*',
  '*://*.figma.com/*',
  '*://*.linear.app/*',
  '*://*.chase.com/*',
  '*://*.bankofamerica.com/*',
  '*://*.wellsfargo.com/*',
  '*://*.paypal.com/*',
];

export default defineManifest({
  manifest_version: 3,
  name: 'Debait',
  version: pkg.version,
  description: 'Nutrition facts for your feed. Tags bait headlines and rewrites them calmly, on-device.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: {
    default_title: 'Debait',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/sw.js',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: ['storage', 'offscreen', 'sidePanel', 'scripting', 'alarms'],
  host_permissions: ['http://*/*', 'https://*/*'],
  content_scripts: [
    {
      matches: SITES,
      exclude_matches: EXCLUDED_SITES,
      js: ['src/content/main.js'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    { resources: ['fonts/*'], matches: SITES },
  ],
});
