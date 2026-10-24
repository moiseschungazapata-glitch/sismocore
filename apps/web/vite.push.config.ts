import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// An independent bundle prevents page-only code from entering the service worker.
export default defineConfig({
  build: {
    outDir:'dist', emptyOutDir:false, minify:true,
    lib:{ entry:resolve(import.meta.dirname,'src/firebase-messaging-sw.ts'),formats:['es'],fileName:()=>'firebase-messaging-sw.js' },
    rollupOptions:{ output:{ inlineDynamicImports:true } },
  },
})
