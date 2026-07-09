/** ONNX logit-parity test: run the exported .onnx graphs via onnxruntime-node
 * and confirm the logits match the fixtures captured (by Python onnxruntime)
 * in tools/export_onnx.py. This validates the JS-side tensor plumbing
 * (int64 tokens, hidden-state shapes, final-position slicing) end-to-end.
 *
 * Skips gracefully if the .onnx assets / fixtures aren't present (they are
 * produced by `python3 tools/export_onnx.py`, which needs the checkpoints).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import type { VocabJson } from '../src/engine/neural/vocab'

const ROOT = join(__dirname, '..')
const fixturesPath = join(ROOT, 'test', 'fixtures', 'neural_logits.json')
const vocabPath = join(ROOT, 'public', 'data', 'jazznet', 'vocab.json')
const haveAssets =
  existsSync(fixturesPath) &&
  existsSync(join(ROOT, 'public', 'data', 'jazznet', 'rnn.onnx')) &&
  existsSync(join(ROOT, 'public', 'data', 'jazznet', 'lstm.onnx'))

const d = haveAssets ? describe : describe.skip

interface Fixture {
  kind: 'rnn' | 'lstm'
  contextTokens: number[]
  contextLogitsLast: number[]
  stepToken: number
  stepLogitsLast: number[]
}

d('ONNX graphs match Python-onnxruntime fixtures', () => {
  const fixtures = haveAssets
    ? (JSON.parse(readFileSync(fixturesPath, 'utf-8')) as { vocabSize: number; cases: Fixture[] })
    : { vocabSize: 0, cases: [] }
  const vocab = haveAssets ? (JSON.parse(readFileSync(vocabPath, 'utf-8')) as VocabJson) : null

  it('vocab.json has the expected ordering', () => {
    expect(vocab!.padIdx).toBe(0)
    expect(vocab!.bosIdx).toBe(1)
    expect(vocab!.eosIdx).toBe(2)
    expect(vocab!.tokens[0]).toBe('pad')
    expect(vocab!.vocabSize).toBe(vocab!.tokens.length)
  })

  const nLayers = () => vocab!.hyperparameters.n_layers
  const hiddenDim = () => vocab!.hyperparameters.hidden_dim

  function zeros(): Float32Array {
    return new Float32Array(nLayers() * 1 * hiddenDim())
  }

  async function run(session: ort.InferenceSession, kind: 'rnn' | 'lstm', tokens: number[], h?: Float32Array, c?: Float32Array) {
    const dims = [nLayers(), 1, hiddenDim()]
    const feeds: Record<string, ort.Tensor> = {
      tokens: new ort.Tensor('int64', BigInt64Array.from(tokens.map((t) => BigInt(t))), [1, tokens.length]),
      h0: new ort.Tensor('float32', h ?? zeros(), dims),
    }
    if (kind === 'lstm') feeds.c0 = new ort.Tensor('float32', c ?? zeros(), dims)
    const out = await session.run(feeds)
    const logits = out.logits
    const V = logits.dims[2] as number
    const data = logits.data as Float32Array
    const start = (tokens.length - 1) * V
    const logitsLast = Array.from(data.slice(start, start + V))
    const hn = Float32Array.from((out.hn as ort.Tensor).data as Float32Array)
    const cn = kind === 'lstm' ? Float32Array.from((out.cn as ort.Tensor).data as Float32Array) : undefined
    return { logitsLast, hn, cn }
  }

  for (const kind of ['rnn', 'lstm'] as const) {
    it(`${kind}: from-context and carried-hidden logits match fixtures`, async () => {
      const modelPath = join(ROOT, 'public', 'data', 'jazznet', `${kind}.onnx`)
      const session = await ort.InferenceSession.create(modelPath)
      const cases = fixtures.cases.filter((f) => f.kind === kind)
      expect(cases.length).toBeGreaterThan(0)

      for (const f of cases) {
        const ctx = await run(session, kind, f.contextTokens)
        for (let i = 0; i < f.contextLogitsLast.length; i++) {
          expect(ctx.logitsLast[i]).toBeCloseTo(f.contextLogitsLast[i], 3)
        }
        const step = await run(session, kind, [f.stepToken], ctx.hn, ctx.cn)
        for (let i = 0; i < f.stepLogitsLast.length; i++) {
          expect(step.logitsLast[i]).toBeCloseTo(f.stepLogitsLast[i], 3)
        }
      }
    })
  }
})
