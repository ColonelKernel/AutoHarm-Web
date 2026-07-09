/** Stateful (v3) and stateless JazzNet sampling.
 *
 * Port of `engines/neural_session.py` + `engines/neural_sampler.py`. The
 * session carries the recurrent hidden state and a token trace across chord
 * steps. Sampling is async because the forward pass runs in onnxruntime-web;
 * a `ForwardFn` is injected so the logic is unit-testable with a stub.
 *
 * v3 semantics preserved exactly:
 *   - exclude-input mask applies ONLY on the first step (hidden === null).
 *   - first step forwards [BOS, idx]; later steps forward [idx] with carried
 *     hidden.
 *   - auto-feed advances the hidden state by the sampled token before storing.
 *   - session auto-resets when userSteps reaches maxSteps.
 */

import type { Rng } from '../random'
import type { JazzNetVocab } from './vocab'
import type { Hidden, RunResult } from './ortRunner'
import { applySamplingDistribution, sampleFromProbabilities } from './inference'

export type ForwardFn = (tokens: number[], hidden: Hidden | null) => Promise<RunResult>

export interface NeuralSampleResult {
  output: string | null
  probability: number | null
  candidates: number
  fallbackUsed: boolean
  error?: string | null
}

const SPECIAL_LABELS = new Set(['pad', '<BOS>', '<EOS>'])

export class NeuralSessionState {
  hidden: Hidden | null = null
  tokenTrace: string[] = []
  userSteps = 0

  get step(): number {
    return this.userSteps
  }

  reset(): void {
    this.hidden = null
    this.tokenTrace = []
    this.userSteps = 0
  }

  historyDisplay(): string {
    return this.tokenTrace.join(',')
  }
}

/** Silently reset when the user step cap is reached. Returns true if reset. */
export function maybeResetForMaxSteps(session: NeuralSessionState, maxSteps: number): boolean {
  if (maxSteps <= 0) return false
  if (session.userSteps >= maxSteps) {
    session.reset()
    return true
  }
  return false
}

interface CommonArgs {
  forward: ForwardFn
  vocab: JazzNetVocab
  chord: string
  idx: number
  rng: Rng
  temperature: number
  excludeInput: boolean
  applyFallback: (chord: string) => NeuralSampleResult
}

export async function sampleStateless(args: CommonArgs): Promise<NeuralSampleResult> {
  const { forward, vocab, chord, idx, rng, temperature, excludeInput, applyFallback } = args
  const exclude = excludeInput ? [idx] : null
  let nextIdx: number
  let prob: number
  try {
    const { logitsLast } = await forward([vocab.bosIdx, idx], null)
    const probs = applySamplingDistribution(logitsLast, vocab, temperature, exclude)
    ;[nextIdx, prob] = sampleFromProbabilities(probs, vocab, rng)
  } catch (err) {
    return { output: null, probability: null, candidates: 0, fallbackUsed: true, error: String((err as Error)?.message || err) }
  }

  const output = vocab.indexChord(nextIdx)
  if (output === null || SPECIAL_LABELS.has(output)) return applyFallback(chord)

  return { output, probability: prob, candidates: vocab.vocabSize, fallbackUsed: false }
}

export async function sampleSession(
  args: CommonArgs & {
    session: NeuralSessionState
    maxSteps: number
    autoFeed: boolean
  },
): Promise<NeuralSampleResult> {
  const { forward, vocab, session, maxSteps, chord, idx, rng, temperature, excludeInput, autoFeed, applyFallback } = args

  maybeResetForMaxSteps(session, maxSteps)

  // Exclude-input mask applies ONLY on the very first step of a session.
  const exclude = excludeInput && session.hidden === null ? [idx] : null

  let nextIdx: number
  let prob: number
  let hidden: Hidden
  try {
    const tokens = session.hidden === null ? [vocab.bosIdx, idx] : [idx]
    const result = await forward(tokens, session.hidden)
    hidden = result.hidden
    const probs = applySamplingDistribution(result.logitsLast, vocab, temperature, exclude)
    ;[nextIdx, prob] = sampleFromProbabilities(probs, vocab, rng)
  } catch (err) {
    return { output: null, probability: null, candidates: 0, fallbackUsed: true, error: String((err as Error)?.message || err) }
  }

  const output = vocab.indexChord(nextIdx)
  if (output === null || SPECIAL_LABELS.has(output)) return applyFallback(chord)

  session.tokenTrace.push(chord)
  session.tokenTrace.push(output)
  session.userSteps += 1

  // Auto-feed: advance the hidden state by the sampled token before storing.
  let finalHidden = hidden
  if (autoFeed) {
    finalHidden = (await forward([nextIdx], hidden)).hidden
  }
  session.hidden = finalHidden

  return { output, probability: prob, candidates: vocab.vocabSize, fallbackUsed: false }
}
