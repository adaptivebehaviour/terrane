import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// The workspace packages ship TypeScript source, which Node and Electron cannot load at run time, so they are bundled
// into the main and preload builds instead of being left as `require()` calls. (The sandboxed preload may require
// nothing but `electron`, so it must be fully bundled anyway.)
const bundled = [
  '@adaptivebehaviour/desktop',
  '@adaptivebehaviour/manifesto',
  '@adaptivebehaviour/scenes',
  '@adaptivebehaviour/scenes-records',
  '@adaptivebehaviour/ui',
  'terrane-collection',
];

export default defineConfig({
  main: { build: { externalizeDeps: { exclude: bundled } } },
  preload: { build: { externalizeDeps: { exclude: bundled } } },
  renderer: { plugins: [react(), tailwindcss()] },
});
