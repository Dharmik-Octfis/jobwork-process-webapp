import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Emit into the backend so the static files ship inside the same AppSail
  // bundle as the API — Express serves them (see backend/src/app.ts).
  build: { outDir: '../backend/public', emptyOutDir: true },
  server: {
    // In dev, VITE_API_URL defaults to `/api`; proxy it to the local Express API
    // so the httpOnly refresh cookie stays same-origin. See docs/FRONTEND_SETUP.md §7.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
