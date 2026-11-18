// Copies Debait's font from node_modules into public/fonts so the
// content script can load them from the extension (no remote font requests).
import { copyFileSync, mkdirSync } from 'node:fs';

const fonts = {
  // Inter with optical sizes: big numbers switch to its display cut automatically
  'inter.woff2': '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2',
};

mkdirSync('public/fonts', { recursive: true });
for (const [out, src] of Object.entries(fonts)) {
  copyFileSync(`node_modules/${src}`, `public/fonts/${out}`);
}
console.log('Fonts copied to public/fonts');
