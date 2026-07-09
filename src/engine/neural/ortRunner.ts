/** onnxruntime-web wrapper for the JazzNet RNN/LSTM ONNX graphs.
 *
 * Lazy: onnxruntime-web and the .onnx bytes are only imported/fetched when a
 * neural model is first selected (mirrors the lazy `import torch` in the
 * Python engine — Markov-only users download zero neural bytes). WASM runtime
 * is self-hosted from public/ort/ (no CDN; offline / GitHub-Pages friendly),
 * single-threaded (no COOP/COEP on static hosting => no SharedArrayBuffer).
 *
 * One graph, explicit hidden I/O:
 *   RNN : (tokens int64[1,seq], h0 f32[L,1,H]) -> (logits f32[1,seq,V], hn)
 *   LSTM: (tokens, h0, c0)                      -> (logits, hn, cn)
 * First step feeds [BOS, idx] with zero hidden (== torch hidden=None); session
 * steps feed [idx] with the carried hidden.
 */

import type { InferenceSession, Tensor, TypedTensor } from 'onnxruntime-web'

export type Hidden = { h: Float32Array; c?: Float32Array }

export interface RunResult {
  /** logits at the final sequence position (length = vocabSize) */
  logitsLast: Float32Array
  hidden: Hidden
}

let ortModule: typeof import('onnxruntime-web') | null = null

async function loadOrt(): Promise<typeof import('onnxruntime-web')> {
  if (ortModule) return ortModule
  // The wasm-only backend (no WebGPU/JSEP) — smallest deploy for these tiny
  // models. The .wasm binary is self-hosted under public/ort/ (see
  // tools/copy_ort_assets.mjs) and served verbatim in dev AND build; pointing
  // wasmPaths there avoids the SPA-fallback 404 the bundle's own URL resolution
  // hits under `vite dev`.
  const ort = (await import('onnxruntime-web/wasm')) as typeof import('onnxruntime-web')
  ort.env.wasm.numThreads = 1 // static hosting can't set COOP/COEP => no threads
  // Absolute URL from the document base: a RELATIVE wasmPaths would resolve
  // against the ORT chunk's own location (/assets/), not the site root, so the
  // .wasm/.mjs 404. Deriving from document.baseURI is correct under any deploy
  // path (site root, GitHub Pages subpath, …).
  ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href
  ortModule = ort
  return ort
}

export class OrtRunner {
  private session: InferenceSession | null = null

  constructor(
    private kind: 'rnn' | 'lstm',
    private nLayers: number,
    private hiddenDim: number,
  ) {}

  get loaded(): boolean {
    return this.session !== null
  }

  /** Fetch + compile the graph. Throws if the .onnx asset is missing. */
  async load(): Promise<void> {
    if (this.session) return
    const ort = await loadOrt()
    const url = `${import.meta.env.BASE_URL}data/jazznet/${this.kind}.onnx`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`model fetch failed (${res.status}): ${url}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    this.session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
    })
  }

  /** Zero hidden state (equivalent to torch hidden=None on the first step). */
  zeroHidden(): Hidden {
    const size = this.nLayers * 1 * this.hiddenDim
    const h = new Float32Array(size)
    return this.kind === 'lstm' ? { h, c: new Float32Array(size) } : { h }
  }

  /**
   * Forward `tokens` (with `hidden`, defaulting to zeros) and return the final
   * position's logits plus the updated hidden state.
   */
  async run(tokens: number[], hidden?: Hidden | null): Promise<RunResult> {
    if (!this.session) throw new Error('OrtRunner not loaded')
    const ort = ortModule!
    const hid = hidden ?? this.zeroHidden()
    const seq = tokens.length

    const tokenTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(tokens.map((t) => BigInt(t))),
      [1, seq],
    )
    const hDims = [this.nLayers, 1, this.hiddenDim]
    const feeds: Record<string, Tensor> = {
      tokens: tokenTensor,
      h0: new ort.Tensor('float32', hid.h, hDims),
    }
    if (this.kind === 'lstm') {
      feeds.c0 = new ort.Tensor('float32', hid.c ?? new Float32Array(hid.h.length), hDims)
    }

    const out = await this.session.run(feeds)
    const logits = out.logits as TypedTensor<'float32'>
    const vocabSize = logits.dims[2]
    const data = logits.data as Float32Array
    // final sequence position: rows are [seq, vocab] within batch 0
    const start = (seq - 1) * vocabSize
    const logitsLast = data.slice(start, start + vocabSize)

    const hn = (out.hn as TypedTensor<'float32'>).data as Float32Array
    const newHidden: Hidden =
      this.kind === 'lstm'
        ? { h: Float32Array.from(hn), c: Float32Array.from((out.cn as TypedTensor<'float32'>).data as Float32Array) }
        : { h: Float32Array.from(hn) }

    return { logitsLast, hidden: newHidden }
  }
}
