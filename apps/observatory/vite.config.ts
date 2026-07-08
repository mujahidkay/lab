import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const API = process.env.DASH_PORT ? `http://127.0.0.1:${process.env.DASH_PORT}` : 'http://127.0.0.1:8787';

// The observatory is served under /observatory (the whiteboard owns the root).
export default defineConfig({
  base: '/observatory/',
  plugins: [react(), tailwind()],
  server: {
    port: 5174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
