import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from https://<user>.github.io/<repo>/ and that
// path is CASE-SENSITIVE, so the build's asset prefix must match the repo name
// exactly. In GitHub Actions, GITHUB_REPOSITORY is "owner/repo" — derive the base
// from it so a rename or different casing can never break the deploy. Locally
// (no GITHUB_REPOSITORY) we serve from root. Override with VITE_BASE for a custom domain.
const ghRepo = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.VITE_BASE ?? (ghRepo ? `/${ghRepo}/` : '/')

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
