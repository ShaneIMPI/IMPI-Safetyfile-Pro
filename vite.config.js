import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from https://<user>.github.io/impi-safetyfile-pro/
// so the build must be prefixed with the repo name. Override with VITE_BASE if the
// repo is ever renamed or served from a custom domain (set VITE_BASE=/ in that case).
const base = process.env.VITE_BASE ?? '/impi-safetyfile-pro/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    // pdfjs + docx + pdf-lib are large; raise the warning ceiling so CI logs stay clean.
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    // pdfjs-dist ships an ESM worker that Vite needs to pre-bundle explicitly.
    include: ['pdfjs-dist'],
  },
})
