/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The onnxruntime-web bundle references its .wasm via `new URL(..., import.meta
// .url)`, so Vite fingerprints and emits it. But we self-host that binary under
// public/ort/ (served verbatim in dev AND build) and point env.wasm.wasmPaths
// there, so the emitted copy is dead weight — drop it to ship the wasm once.
function dropBundledOrtWasm(): Plugin {
  return {
    name: 'drop-bundled-ort-wasm',
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(key)) delete bundle[key]
      }
    },
  }
}

// base './' so the built site works from any subpath (GitHub Pages, file://)
export default defineConfig({
  base: './',
  plugins: [react(), dropBundledOrtWasm()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
