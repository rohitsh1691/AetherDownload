import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'path';

export default defineConfig({
  plugins: [react()],
  root: join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: join(__dirname, 'src/renderer/index.html')
    }
  },
  server: {
    port: 3000
  }
});
