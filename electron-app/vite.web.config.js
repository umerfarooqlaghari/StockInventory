import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client'],
  },
});
