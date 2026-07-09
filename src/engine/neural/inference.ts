/** Single-step next-chord inference math.
 *
 * Port of `engines/jazznet_inference.py` (temperature-scaled masked softmax +
 * multinomial-with-resample). Torch's multinomial can't be reproduced
 * bit-exactly, so sampling parity with Python is distributional; the
 * probability vectors themselves are asserted against ONNX-parity fixtures.
 */

import type { Rng } from '../random'
import type { JazzNetVocab } from './vocab'

/**
 * Temperature-scale raw logits, softmax, mask specials + excluded indices,
 * renormalize. Returns a probability vector. Throws if nothing is left.
 */
export function applySamplingDistribution(
  logits: Float32Array | number[],
  vocab: JazzNetVocab,
  temperature: number,
  excludeIndices?: Iterable<number> | null,
): Float64Array {
  if (temperature <= 0) throw new Error(`temperature must be > 0, got ${temperature}`)

  const n = logits.length
  // Numerically stable softmax over scaled logits (subtract the max).
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = logits[i] / temperature
    if (v > max) max = v
  }
  const probs = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i] / temperature - max)
    probs[i] = e
    sum += e
  }
  for (let i = 0; i < n; i++) probs[i] /= sum

  // Mask specials + any excluded indices, then renormalize.
  const mask = new Set<number>(excludeIndices ?? [])
  mask.add(vocab.padIdx)
  mask.add(vocab.bosIdx)
  mask.add(vocab.eosIdx)
  let total = 0
  for (const idx of mask) {
    if (idx >= 0 && idx < n) probs[idx] = 0
  }
  for (let i = 0; i < n; i++) total += probs[i]
  if (total <= 0) throw new Error('no valid next token after applying sampling constraints')
  for (let i = 0; i < n; i++) probs[i] /= total

  return probs
}

/** Multinomial draw skipping special tokens, argmax fallback (port of
 * `_sample_from_probabilities`). Returns [index, probability]. */
export function sampleFromProbabilities(
  probs: Float64Array,
  vocab: JazzNetVocab,
  rng: Rng,
  maxResample = 10,
): [number, number] {
  for (let attempt = 0; attempt < maxResample; attempt++) {
    const idx = multinomial(probs, rng)
    if (!vocab.isSpecial(idx)) return [idx, probs[idx]]
  }
  // argmax fallback
  let best = 0
  let bestP = -Infinity
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > bestP) {
      bestP = probs[i]
      best = i
    }
  }
  if (vocab.isSpecial(best)) throw new Error('no valid next token in model output')
  return [best, probs[best]]
}

/** Single weighted draw over a probability vector (assumed to sum to ~1). */
function multinomial(probs: Float64Array, rng: Rng): number {
  let r = rng()
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i]
    if (r <= 0) return i
  }
  // floating-point slack: return the last positive-probability index
  for (let i = probs.length - 1; i >= 0; i--) {
    if (probs[i] > 0) return i
  }
  return 0
}
