/** JazzNet RNN/LSTM chord engine (one class parameterized by kind).
 *
 * Port of `engines/rnn_engine.py` / `lstm_engine.py` (near-identical in the
 * source). Works entirely in JazzNet dash-flat spelling — the registry
 * translates to/from the project's flat spelling at the boundary. Out-of-vocab
 * labels are mapped through the MIREX-7 simplifier.
 */

import type { Rng } from '../random'
import { choice } from '../random'
import type { FallbackPolicy } from '../markov/config'
import type { CandidateChord } from '../markov/markovEngine'
import { JazzNetVocab } from './vocab'
import type { Hidden, RunResult } from './ortRunner'
import { INVALID_CHORD, simplifyChord } from '../theory/chordSimplifier'
import { applySamplingDistribution } from './inference'
import {
  NeuralSessionState,
  sampleSession,
  sampleStateless,
  type NeuralSampleResult,
} from './session'

/** Minimal forward source (OrtRunner satisfies this; tests can stub it). */
export interface ForwardSource {
  run(tokens: number[], hidden?: Hidden | null): Promise<RunResult>
}

export interface NeuralEngineOptions {
  fallback?: FallbackPolicy
  temperature?: number
  excludeInput?: boolean
  sessionMaxSteps?: number
  sessionAutoFeed?: boolean
  rng: Rng
}

export class NeuralEngine {
  readonly session = new NeuralSessionState()
  private fallback: FallbackPolicy
  private temperature: number
  private excludeInput: boolean
  private sessionMaxSteps: number
  private sessionAutoFeed: boolean
  private rng: Rng

  constructor(
    readonly kind: 'rnn' | 'lstm',
    private vocab: JazzNetVocab,
    private runner: ForwardSource,
    opts: NeuralEngineOptions,
  ) {
    this.fallback = opts.fallback ?? 'echo_input'
    this.temperature = opts.temperature ?? 1.5
    this.excludeInput = opts.excludeInput ?? true
    this.sessionMaxSteps = opts.sessionMaxSteps ?? 64
    this.sessionAutoFeed = opts.sessionAutoFeed ?? true
    this.rng = opts.rng
  }

  resetSession(): void {
    this.session.reset()
  }

  /** Update softmax temperature live (floored, as in the Python engine). */
  setTemperature(t: number): void {
    this.temperature = Math.max(0.05, t)
  }

  /** vocab lookup, then MIREX-7 simplifier fallback. Returns null if neither. */
  private resolveChord(chord: string): number | null {
    const idx = this.vocab.chordIndex(chord)
    if (idx !== null) return idx
    const simplified = simplifyChord(chord)
    if (simplified === INVALID_CHORD) return null
    return this.vocab.chordIndex(simplified)
  }

  /**
   * PEEK at the next-chord distribution without advancing the session: one
   * forward pass on the current hidden state (or [BOS, idx] from cold), the
   * same temperature/masking as sampling, top-`limit` of the softmax. The
   * session's hidden/trace/step are untouched, so scoring candidates never
   * perturbs the musical walk. Returns [] on unknown chords or runner errors.
   */
  async candidates(rawInput: string, session: boolean, limit = 24): Promise<CandidateChord[]> {
    const chord = rawInput.trim()
    if (!chord) return []
    const idx = this.resolveChord(chord)
    if (idx === null) return []
    const hidden = session ? this.session.hidden : null
    const exclude = this.excludeInput && hidden === null ? [idx] : null
    const tokens = hidden === null ? [this.vocab.bosIdx, idx] : [idx]
    try {
      const { logitsLast } = await this.runner.run(tokens, hidden)
      const probs = applySamplingDistribution(logitsLast, this.vocab, this.temperature, exclude)
      const pairs: Array<[number, number]> = []
      for (let i = 0; i < probs.length; i++) if (probs[i] > 0) pairs.push([i, probs[i]])
      pairs.sort((a, b) => b[1] - a[1])
      const out: CandidateChord[] = []
      for (const [i, p] of pairs.slice(0, limit)) {
        const symbol = this.vocab.indexChord(i)
        if (symbol) out.push({ symbol, prior: p }) // specials already masked to 0
      }
      return out
    } catch {
      return []
    }
  }

  async sample(rawInput: string, session: boolean): Promise<NeuralSampleResult> {
    const chord = rawInput.trim()
    if (!chord) {
      return { output: null, probability: null, candidates: 0, fallbackUsed: false, error: 'empty chord input' }
    }

    const idx = this.resolveChord(chord)
    if (idx === null) return this.applyFallback(chord)

    const forward = (tokens: number[], hidden: Hidden | null) => this.runner.run(tokens, hidden)
    const common = {
      forward,
      vocab: this.vocab,
      chord,
      idx,
      rng: this.rng,
      temperature: this.temperature,
      excludeInput: this.excludeInput,
      applyFallback: (c: string) => this.applyFallback(c),
    }

    if (session) {
      return sampleSession({
        ...common,
        session: this.session,
        maxSteps: this.sessionMaxSteps,
        autoFeed: this.sessionAutoFeed,
      })
    }
    return sampleStateless(common)
  }

  private applyFallback(chord: string): NeuralSampleResult {
    const error = `unknown chord: ${chord}`
    const policy = this.fallback

    if (policy === 'error_only') {
      return { output: null, probability: null, candidates: 0, fallbackUsed: true, error }
    }
    if (policy === 'echo_input') {
      return { output: chord, probability: null, candidates: 0, fallbackUsed: true, error }
    }
    const labels = this.vocab.tokens.filter((l) => l !== 'pad' && l !== '<BOS>' && l !== '<EOS>')
    if (policy === 'global_top') {
      // sorted(idx_to_chord.items()) first non-special == tokens are already in
      // index order, and the first non-special token is the sorted minimum.
      return { output: labels[0], probability: null, candidates: 0, fallbackUsed: true, error }
    }
    if (policy === 'random_source') {
      return { output: choice(this.rng, labels), probability: null, candidates: labels.length, fallbackUsed: true, error }
    }
    throw new Error(`Unsupported fallback policy: ${policy}`)
  }
}
