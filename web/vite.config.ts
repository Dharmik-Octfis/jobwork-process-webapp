import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
