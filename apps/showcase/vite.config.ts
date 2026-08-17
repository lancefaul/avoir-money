import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  resolve: {
    alias: {
      '@budget-tracker/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    host: true,
    port: 3002,
    allowedHosts: ['ds.budget.home'],
  },
  build: {
    outDir: 'dist',
  },
});
