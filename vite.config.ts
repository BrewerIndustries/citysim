import { defineConfig } from 'vite';

// BASE_PATH is set by CI: '/' for the main branch (prod) and '/dev/' for the dev branch,
// so both build from the same source into one Pages site. See .github/workflows/pages.yml.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', outDir: 'dist' },
  worker: { format: 'es' },
});
