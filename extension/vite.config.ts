import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Extension pages must resolve assets relatively (chrome-extension://<id>/...).
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'sidepanel.html',
    },
  },
});
