// The Firebase headline analyzer web page (index.html + src/main.js).
// `npm run dev` → http://localhost:5173
// Separate from vite.config.js, which builds the Chrome extension.
import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist-web' },
});
