import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  // The wasm runtime is imported with ?url in src/lib/router.ts, so the bundler
  // emits exactly one hashed copy and the code points at it. public/ holds only
  // what the page fetches by name: the int8 graph, its metadata and the
  // tokenizer. The fp32 graph is an intermediate and lives in build-model/,
  // outside the served tree, because a 20 MB file nothing loads was being
  // copied into dist.
  assetsInlineLimit: 0,
})
