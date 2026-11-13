import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }

          if (id.includes('/lucide-react/')) {
            return 'vendor-icons';
          }

          if (
            id.includes('/mediabunny/') ||
            id.includes('/music-metadata/') ||
            id.includes('/@mediabunny/')
          ) {
            return 'vendor-media';
          }
        },
      },
    },
  },
});
