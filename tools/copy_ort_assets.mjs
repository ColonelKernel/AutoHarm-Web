/** Copy the onnxruntime-web WASM runtime into public/ort/ so the app is fully
 * self-hosted (no CDN; works offline and on GitHub Pages) AND so the binary is
 * served verbatim in BOTH `vite dev` and `vite build` — the `new URL(...,
 * import.meta.url)` resolution the ORT bundle uses otherwise 404s to the SPA
 * fallback in dev. `ortRunner` points `env.wasm.wasmPaths` at /ort/.
 *
 * Run after `npm install` (wired as the `prepare-ort` npm script, also invoked
 * from `predev`/`prebuild`). */

import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'node_modules', 'onnxruntime-web', 'dist')
const dst = join(here, '..', 'public', 'ort')

mkdirSync(dst, { recursive: true })
// The plain single-threaded SIMD wasm is all the wasm-only backend needs.
const files = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']
for (const f of files) {
  const from = join(src, f)
  if (existsSync(from)) {
    copyFileSync(from, join(dst, f))
    console.log(`copied ${f}`)
  } else {
    console.warn(`missing ${f} — is onnxruntime-web installed?`)
  }
}
