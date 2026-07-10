/** Model registry — dispatches sampling to Markov / RNN / LSTM, handles lazy
 * neural loading with rollback, session modes, and the JazzNet notation
 * bridge.
 *
 * Port of `engines/registry.py` (reference repo, v3) fused with the canonical
 * Desktop repo's notation translation at the neural boundary: input chords are
 * `toJazznet`-ed before the neural engine sees them and the output is
 * `fromJazznet`-ed back, so flat-root chords (Bb) round-trip correctly.
 */

import type { CandidateChord, MarkovEngine } from './markov/markovEngine'
import { DEFAULT_MODEL, DEFAULT_SESSION_MODE, MODELS, SESSION_MODES, type ModelName, type SessionMode } from './markov/config'
import { NeuralEngine } from './neural/neuralEngine'
import { JazzNetVocab, type VocabJson } from './neural/vocab'
import { OrtRunner } from './neural/ortRunner'
import { fromJazznet, toJazznet } from './theory/notation'
import { mulberry32, randomSeed, type Rng } from './random'

export interface SampleResultLike {
  output: string | null
  probability?: number | null
  candidates?: number
  fallbackUsed?: boolean
  error?: string | null
}

/** Builds a loaded neural engine for a kind. Overridable in tests. */
export type NeuralLoader = (kind: 'rnn' | 'lstm') => Promise<NeuralEngine>

export interface RegistryOptions {
  rng?: Rng
  seed?: number
  neuralTemperature?: number
  neuralExcludeInput?: boolean
  sessionMode?: SessionMode
  sessionMaxSteps?: number
  sessionAutoFeed?: boolean
  loader?: NeuralLoader
}

export class ModelRegistry {
  private activeName: ModelName = DEFAULT_MODEL
  private sessionModeValue: SessionMode
  private rnn: NeuralEngine | null = null
  private lstm: NeuralEngine | null = null
  private neuralTemperature: number
  private loader: NeuralLoader
  private rng: Rng

  constructor(
    private markov: MarkovEngine,
    opts: RegistryOptions = {},
  ) {
    this.rng = opts.rng ?? mulberry32(opts.seed ?? randomSeed())
    this.neuralTemperature = opts.neuralTemperature ?? 1.5
    this.sessionModeValue = opts.sessionMode ?? DEFAULT_SESSION_MODE
    this.loader =
      opts.loader ??
      ((kind) =>
        defaultNeuralLoader(kind, this.rng, {
          temperature: this.neuralTemperature,
          excludeInput: opts.neuralExcludeInput ?? true,
          sessionMaxSteps: opts.sessionMaxSteps ?? 64,
          sessionAutoFeed: opts.sessionAutoFeed ?? true,
        }))
  }

  get active(): ModelName {
    return this.activeName
  }

  get sessionMode(): SessionMode {
    return this.sessionModeValue
  }

  private engineFor(name: ModelName): NeuralEngine | null {
    if (name === 'rnn') return this.rnn
    if (name === 'lstm') return this.lstm
    return null
  }

  private effectiveSession(name: ModelName, mode: SessionMode): boolean {
    if (name === 'markov') return false
    if (mode === 'stateless') return false
    return true
  }

  /** Switch model. Loads neural weights lazily; rolls back on failure.
   * Returns null on success or an error message. */
  async setModel(name: ModelName): Promise<string | null> {
    if (!MODELS.includes(name)) return `invalid model: ${name}`
    if (name === 'markov') {
      this.activeName = 'markov'
      return null
    }

    const previous = this.activeName
    try {
      if (name === 'rnn' && !this.rnn) this.rnn = await this.loader('rnn')
      if (name === 'lstm' && !this.lstm) this.lstm = await this.loader('lstm')
      this.activeName = name
    } catch (exc) {
      this.activeName = previous // rollback — Markov keeps working
      return `failed to load ${name}: ${String((exc as Error)?.message || exc)}`
    }
    this.resetSession()
    return null
  }

  setSessionMode(mode: SessionMode | 'reset'): string | null {
    const normalized = mode.trim().toLowerCase()
    if (normalized === 'reset') {
      this.resetSession()
      return null
    }
    if (!SESSION_MODES.includes(normalized as SessionMode)) return `invalid session mode: ${mode}`
    this.sessionModeValue = normalized as SessionMode
    if (normalized === 'stateless') this.resetSession()
    return null
  }

  resetSession(): void {
    this.rnn?.resetSession()
    this.lstm?.resetSession()
  }

  /** Effective session label + current step count (for the UI). */
  sessionStatus(): { label: 'session' | 'stateless'; step: number } {
    if (!this.effectiveSession(this.activeName, this.sessionModeValue)) {
      return { label: 'stateless', step: 0 }
    }
    const engine = this.engineFor(this.activeName)
    return { label: 'session', step: engine ? engine.session.step : 0 }
  }

  setNeuralTemperature(t: number): void {
    this.neuralTemperature = Math.max(0.05, t)
    this.rnn?.setTemperature(this.neuralTemperature)
    this.lstm?.setTemperature(this.neuralTemperature)
  }

  sample(rawInput: string): SampleResultLike | Promise<SampleResultLike> {
    const name = this.activeName
    if (name === 'markov') return this.markov.sample(rawInput)

    const engine = this.engineFor(name)
    if (!engine) return { output: null, error: `${name} not loaded` }
    const session = this.effectiveSession(name, this.sessionModeValue)
    const jn = toJazznet(rawInput.trim())
    return engine.sample(jn, session).then((res) => ({
      ...res,
      output: res.output ? fromJazznet(res.output) : res.output,
    }))
  }

  /** Next-chord distribution from the ACTIVE model (notation bridged for the
   * neural engines; a peek — never advances session state). */
  candidates(rawInput: string, limit = 24): CandidateChord[] | Promise<CandidateChord[]> {
    const name = this.activeName
    if (name === 'markov') return this.markov.candidates(rawInput, limit)
    const engine = this.engineFor(name)
    if (!engine) return []
    const session = this.effectiveSession(name, this.sessionModeValue)
    return engine
      .candidates(toJazznet(rawInput.trim()), session, limit)
      .then((cs) => cs.map((c) => ({ ...c, symbol: fromJazznet(c.symbol) })))
  }
}

export type { CandidateChord }

/** Default browser loader: fetch vocab.json, compile the ONNX graph. */
async function defaultNeuralLoader(
  kind: 'rnn' | 'lstm',
  rng: Rng,
  opts: { temperature: number; excludeInput: boolean; sessionMaxSteps: number; sessionAutoFeed: boolean },
): Promise<NeuralEngine> {
  const vocab = await loadVocab()
  const runner = new OrtRunner(kind, vocab.nLayers, vocab.hiddenDim)
  await runner.load()
  return new NeuralEngine(kind, vocab, runner, {
    temperature: opts.temperature,
    excludeInput: opts.excludeInput,
    sessionMaxSteps: opts.sessionMaxSteps,
    sessionAutoFeed: opts.sessionAutoFeed,
    rng,
  })
}

let vocabCache: JazzNetVocab | null = null
async function loadVocab(): Promise<JazzNetVocab> {
  if (vocabCache) return vocabCache
  const res = await fetch(`${import.meta.env.BASE_URL}data/jazznet/vocab.json`)
  if (!res.ok) throw new Error(`vocab fetch failed: ${res.status}`)
  vocabCache = new JazzNetVocab((await res.json()) as VocabJson)
  return vocabCache
}
