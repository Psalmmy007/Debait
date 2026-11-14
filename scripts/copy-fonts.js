// Copies the three Debait fonts from node_modules into public/fonts so the
// content script can load them from the extension (no remote font requests).
import { copyFileSync, mkdirSync } from 'node:fs';

const fonts = {
  'inter.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'bricolage.woff2': '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
  'newsreader.woff2': '@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2',
};

mkdirSync('public/fonts', { recursive: true });
for (const [out, src] of Object.entries(fonts)) {
  copyFileSync(`node_modules/${src}`, `public/fonts/${out}`);
}
console.log('Fonts copied to public/fonts');
