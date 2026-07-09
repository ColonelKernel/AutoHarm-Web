/** Cross-corpus blending: Color (corpus morph) + Adventure (temperature).
 *
 * Port of `python/src/blend.py`. The two performable dials both act on the
 * per-corpus transition distributions:
 *
 * - Color c in [0,1] morphs a 1-D crossfade along an ordered path of
 *   single-corpus anchors (COLOR_PATH). Piecewise-linear, so anchor positions
 *   are pure single corpora and in-between positions are two-corpus blends.
 * - Adventure a in [0,1] sets a sampling temperature tau: low sharpens toward
 *   the likeliest chord, high flattens the tail.
 *
 * `blendedChoices` returns [target, prob][] ready for weighted sampling, or an
 * empty list when the source chord is absent from every weighted corpus (the
 * caller then falls back to the pooled "all" chain / fallback policy).
 */

import {
  ADVENTURE_TAU_MAX,
  ADVENTURE_TAU_MIN,
  CADENCE_DOMINANT_BOOST,
  CADENCE_TONIC_BOOST,
  COLOR_PATH,
  DOMINANT_PC,
  TONIC_PC,
} from './config'
import type { CorporaSet } from './corpusLoader'
import { PITCH_CLASSES, keyOffset, transposeChord, type Mode } from '../theory/chordVocab'

export type Choices = Array<[string, number]>

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Neumaier-compensated summation, matching CPython 3.12+'s builtin `sum()`
 * over floats. The golden fixtures were generated with that `sum()`, and a
 * naive accumulation diverges by 1 ulp — enough to flip sort order on
 * probability ties — so the port must sum the same way. */
function pySum(values: readonly number[]): number {
  let total = 0
  let c = 0
  for (const x of values) {
    const t = total + x
    if (Math.abs(total) >= Math.abs(x)) c += total - t + x
    else c += x - t + total
    total = t
  }
  return total + c
}

/** Corpus mix weights for Color position `c` along COLOR_PATH.
 *
 * Anchors not present in `available` are dropped from the path first, so the
 * dial still spans the corpora that actually loaded. Weights sum to 1;
 * insertion order follows the path (matters for float-accumulation parity).
 */
export function colorWeights(c: number, available?: readonly string[] | null): Map<string, number> {
  const path = COLOR_PATH.filter((name) => available == null || available.includes(name))
  const weights = new Map<string, number>()
  if (path.length === 0) return weights
  if (path.length === 1) {
    weights.set(path[0], 1.0)
    return weights
  }

  c = clamp01(c)
  const span = path.length - 1
  const pos = c * span
  const i = Math.min(Math.floor(pos), span - 1) // clamp so c==1 stays in last segment
  const frac = pos - i
  for (const name of path) weights.set(name, 0.0)
  weights.set(path[i], (weights.get(path[i]) ?? 0) + (1.0 - frac))
  weights.set(path[i + 1], (weights.get(path[i + 1]) ?? 0) + frac)
  for (const [k, v] of [...weights]) {
    if (v <= 0) weights.delete(k)
  }
  return weights
}

/** Adventure position -> sampling temperature tau (linear interpolation). */
export function temperature(a: number): number {
  a = clamp01(a)
  return ADVENTURE_TAU_MIN + a * (ADVENTURE_TAU_MAX - ADVENTURE_TAU_MIN)
}

export function applyTemperature(dist: Map<string, number>, tau: number): Choices {
  if (tau <= 0) tau = 1e-3
  const inv = 1.0 / tau
  const reshaped: Choices = []
  for (const [t, p] of dist) {
    if (p > 0) reshaped.push([t, Math.pow(p, inv)])
  }
  const total = pySum(reshaped.map(([, p]) => p))
  if (total <= 0) return []
  return reshaped
    .map(([t, p]): [string, number] => [t, p / total])
    .sort((a, b) => b[1] - a[1]) // stable: ties keep insertion order, like Python
}

/** Pitch class of a `Root:quality` symbol's root, or null for non-chords. */
function rootPc(chord: string): number | null {
  const root = chord.split(':', 1)[0]
  const pc = PITCH_CLASSES[root]
  return pc === undefined ? null : pc
}

/** Bias a [target, prob][] list toward the tonic/dominant of `mode`.
 *
 * `choices` is assumed to be in normalized (C/Am) key space, so the tonic and
 * dominant roots are fixed per mode. gravity 0 -> identity; 1 -> full boost.
 */
export function applyCadence(choices: Choices, mode: Mode, gravity: number): Choices {
  if (gravity <= 0 || choices.length === 0) return choices
  const tonic = TONIC_PC[mode] ?? TONIC_PC['maj']
  const dom = DOMINANT_PC[mode] ?? DOMINANT_PC['maj']
  const boosted: Choices = []
  for (const [target, prob] of choices) {
    let p = prob
    const pc = rootPc(target)
    if (pc === tonic) p *= 1.0 + gravity * CADENCE_TONIC_BOOST
    else if (pc === dom) p *= 1.0 + gravity * CADENCE_DOMINANT_BOOST
    boosted.push([target, p])
  }
  const total = pySum(boosted.map(([, p]) => p))
  if (total <= 0) return choices
  return boosted
    .map(([t, p]): [string, number] => [t, p / total])
    .sort((a, b) => b[1] - a[1])
}

/** Mix weighted corpora for `sourceChord`, temper, return [target, prob][].
 *
 * Empty list -> source chord unknown in all weighted corpora (caller falls
 * back). `sourceChord` must already be in normalized (C/Am) key space.
 */
export function blendedChoices(
  corpora: CorporaSet,
  weights: Map<string, number>,
  tau: number,
  sourceChord: string,
  mode: Mode = 'maj',
  gravity = 0.0,
): Choices {
  const mixed = new Map<string, number>()
  let totalWeight = 0
  for (const [name, w] of weights) {
    if (w <= 0) continue
    const table = corpora.corpora.get(name)
    if (!table) continue
    const dist = table.distBySource.get(sourceChord)
    if (!dist || dist.size === 0) continue
    totalWeight += w
    for (const [target, prob] of dist) {
      mixed.set(target, (mixed.get(target) ?? 0) + w * prob)
    }
  }

  if (mixed.size === 0 || totalWeight <= 0) return []

  // Renormalize the mixture (weights of absent corpora were dropped above).
  const norm = new Map<string, number>()
  for (const [t, p] of mixed) norm.set(t, p / totalWeight)
  return applyCadence(applyTemperature(norm, tau), mode, gravity)
}

/** Transpose an in-key chord into normalized (C/Am) space.
 * Returns [normalizedChord, offset]; apply -offset to get back to key. */
export function normalizeToKey(chord: string, key: string): [string, number] {
  const offset = keyOffset(key)
  return [transposeChord(chord, offset), offset]
}
