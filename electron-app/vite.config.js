import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // Pre-bundle these upfront so Vite doesn't do it on first request
    include: ['react', 'react-dom', 'react-dom/client'],
    // Exclude Node.js / Electron-only packages from browser bundling
    exclude: ['electron'],
  },
});
