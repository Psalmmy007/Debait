// Serves the demo feed. `npm run demo` → http://localhost:5180
// Add ?preview to the URL to see the Debait UI without installing the extension.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  publicDir: '../public',
  server: { port: 5180 },
});
