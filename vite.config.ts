import { defineConfig } from 'vite';

// GitHub Pages base path - repository name for project page
// Change to '/' if using a custom domain
export default defineConfig({
  base: '/antipodes/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
