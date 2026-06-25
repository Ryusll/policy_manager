import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** pdf.js worker: stable URL under /pdf.worker.mjs (avoids hashed chunk + MIME issues behind nginx). */
function copyPdfWorkerToPublic(): Plugin {
  return {
    name: 'copy-pdf-worker-to-public',
    buildStart() {
      const pkgRoot = dirname(require.resolve('pdfjs-dist/package.json'));
      const src = join(pkgRoot, 'build', 'pdf.worker.mjs');
      const publicDir = join(__dirname, 'public');
      mkdirSync(publicDir, { recursive: true });
      copyFileSync(src, join(publicDir, 'pdf.worker.mjs'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyPdfWorkerToPublic()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});