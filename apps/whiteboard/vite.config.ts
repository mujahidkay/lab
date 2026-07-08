import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const API = process.env.DASH_PORT ? `http://127.0.0.1:${process.env.DASH_PORT}` : 'http://127.0.0.1:8787';

// The whiteboard is served at the site root (observatory lives at /observatory).
export default defineConfig({
  base: '/',
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
