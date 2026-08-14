import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss(), vanillaExtractPlugin()],
  resolve: {
    alias: {
      '@budget-tracker/ui/theme': resolve(__dirname, '../../packages/ui/src/theme'),
      '@budget-tracker/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: true,
    hmr: {
      clientPort: 443,
      host: process.env.VITE_HMR_HOST || 'app.budget.home',
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
