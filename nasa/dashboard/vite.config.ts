import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/v1': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/live': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
      '/metrics': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
