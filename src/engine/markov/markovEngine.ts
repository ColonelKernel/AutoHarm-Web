/** Weighted Markov sampling over the multi-corpus Spice blend.
 *
 * Port of `python/src/markov_engine.py` (blend mode only; the legacy
 * single-CSV path is dropped). The input chord is transposed into normalized
 * (C/Am) key space, the Color dial mixes the per-corpus distributions, the
 * Adventure dial tempers the result, one target is sampled, and it is
 * transposed back into the current key.
 */

import {
  applyCadence,
  applyTemperature,
  blendedChoices,
  colorWeights,
  normalizeToKey,
  temperature,
  type Choices,
} from './blend'
import { parseKey, transposeChord } from '../theory/chordVocab'
import {
  DEFAULT_ADVENTURE,
  DEFAULT_COLOR,
  DEFAULT_FALLBACK,
  DEFAULT_GRAVITY,
  DEFAULT_KEY,
  type FallbackPolicy,
} from './config'
import { corpusNames, type CorporaSet } from './corpusLoader'
import { choice, mulberry32, randomSeed, weightedChoice, type Rng } from '../random'

export interface SampleResult {
  output: string | null
  probability: number | null
  candidates: number
  fallbackUsed: boolean
  error?: string | null
  /** effective corpus weights (for debug display) */
  mix?: string | null
}

export interface MarkovEngineOptions {
  fallback?: FallbackPolicy
  seed?: number
  color?: number
  adventure?: number
  key?: string
  gravity?: number
}

export class MarkovEngine {
  private corpora: CorporaSet
  private fallback: FallbackPolicy
  private rng: Rng
  private color: number
  private adventure: number
  private key: string
  private gravity: number

  constructor(corpora: CorporaSet, opts: MarkovEngineOptions = {}) {
    this.corpora = corpora
    this.fallback = opts.fallback ?? DEFAULT_FALLBACK
    this.rng = mulberry32(opts.seed ?? randomSeed())
    this.color = opts.color ?? DEFAULT_COLOR
    this.adventure = opts.adventure ?? DEFAULT_ADVENTURE
    this.key = opts.key || DEFAULT_KEY
    this.gravity = opts.gravity ?? DEFAULT_GRAVITY
  }

  // --- performable dial setters -------------------------------------------
  setColor(value: number): void {
    this.color = value
  }

  setAdventure(value: number): void {
    this.adventure = value
  }

  /** Macro: one dial drives both Color and Adventure together. */
  setSpice(value: number): void {
    this.color = value
    this.adventure = value
  }

  setKey(value: string): void {
    this.key = value.trim() || DEFAULT_KEY
  }

  /** Cadence pull 0..1 toward the tonic/dominant (0 = no bias). */
  setGravity(value: number): void {
    this.gravity = value
  }

  setFallback(policy: FallbackPolicy): void {
    this.fallback = policy
  }

  getState(): { color: number; adventure: number; key: string; gravity: number } {
    return { color: this.color, adventure: this.adventure, key: this.key, gravity: this.gravity }
  }

  // --- sampling -------------------------------------------------------------
  sample(rawInput: string): SampleResult {
    const chord = rawInput.trim()
    if (!chord) {
      return { output: null, probability: null, candidates: 0, fallbackUsed: false, error: 'empty chord input' }
    }
    return this.blendSample(chord)
  }

  private choose(choices: Choices): [string, number] {
    const chosen = weightedChoice(this.rng, choices)
    const found = choices.find(([t]) => t === chosen)
    return [chosen, found ? found[1] : 0]
  }

  private blendSample(chord: string): SampleResult {
    const [normIn, offset] = normalizeToKey(chord, this.key)
    const weights = colorWeights(this.color, corpusNames(this.corpora))
    const tau = temperature(this.adventure)
    const [, mode] = parseKey(this.key)
    const mix = [...weights.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([n, w]) => `${n}:${w.toFixed(2)}`)
      .join(' ')

    const choices = blendedChoices(this.corpora, weights, tau, normIn, mode, this.gravity)
    if (choices.length > 0) {
      const [chosenNorm, prob] = this.choose(choices)
      return {
        output: transposeChord(chosenNorm, -offset),
        probability: prob,
        candidates: choices.length,
        fallbackUsed: false,
        mix,
      }
    }
    return this.blendFallback(chord, normIn, offset, tau, mix)
  }

  private blendFallback(chord: string, normIn: string, offset: number, tau: number, mix: string): SampleResult {
    const error = `unknown chord: ${chord}`

    // 1) Try the pooled "all" corpus so we stay musical when the source chord
    //    simply isn't in the current color window.
    const pooled = this.corpora.corpora.get('all')
    if (pooled) {
      const dist = pooled.distBySource.get(normIn)
      if (dist && dist.size > 0) {
        const [, mode] = parseKey(this.key)
        const choices = applyCadence(applyTemperature(dist, tau), mode, this.gravity)
        const [chosenNorm, prob] = this.choose(choices)
        return {
          output: transposeChord(chosenNorm, -offset),
          probability: prob,
          candidates: choices.length,
          fallbackUsed: true,
          error,
          mix: mix + ' +all',
        }
      }
    }

    // 2) Configured fallback policy.
    const policy = this.fallback
    if (policy === 'error_only') {
      return { output: null, probability: null, candidates: 0, fallbackUsed: true, error, mix }
    }
    if (policy === 'echo_input') {
      return { output: chord, probability: null, candidates: 0, fallbackUsed: true, error, mix }
    }
    if (policy === 'global_top' && this.corpora.globalFallback.length > 0) {
      const topNorm = this.corpora.globalFallback[0][0]
      return {
        output: transposeChord(topNorm, -offset),
        probability: null,
        candidates: 0,
        fallbackUsed: true,
        error,
        mix,
      }
    }
    if (policy === 'random_source') {
      const pooledAll = this.corpora.corpora.get('all')
      const sources = pooledAll ? [...pooledAll.distBySource.keys()] : []
      if (sources.length > 0 && pooledAll) {
        const src = choice(this.rng, sources)
        const choices = applyTemperature(pooledAll.distBySource.get(src)!, tau)
        const [chosenNorm, prob] = this.choose(choices)
        return {
          output: transposeChord(chosenNorm, -offset),
          probability: prob,
          candidates: choices.length,
          fallbackUsed: true,
          error,
          mix,
        }
      }
    }
    // Safe default: echo the input chord.
    return { output: chord, probability: null, candidates: 0, fallbackUsed: true, error, mix }
  }
}
