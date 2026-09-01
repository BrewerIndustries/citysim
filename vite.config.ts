import { defineConfig } from 'vite';

// BASE_PATH is set by CI: '/' for the main branch (prod) and '/dev/' for the dev branch,
// so both build from the same source into one Pages site. See .github/workflows/pages.yml.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // Bind every interface so the dev build is reachable from other machines on the LAN
  // and over Tailscale, not just localhost.
  // PORT lets a second checkout run alongside this one — see docs/TWO-INSTANCES.md.
  // Different ports are different origins, so each instance keeps its own saves.
  server: { host: true, port: Number(process.env.PORT ?? 5173), strictPort: true },
  preview: { host: true, port: Number(process.env.PORT ?? 5173), strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
  worker: { format: 'es' },
});
