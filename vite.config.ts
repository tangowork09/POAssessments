import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = import.meta.dirname;

/**
 * Two entry points, deliberately. The candidate experience and the admin
 * console are separate shells that share only design tokens — there is no
 * router, layout or bundle in common, so no admin affordance can leak into a
 * candidate page.
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'web/index.html'),
        admin: resolve(here, 'web/admin.html'),
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
