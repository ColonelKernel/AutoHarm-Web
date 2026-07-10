/** Offline progression generation — the chain walk, decoupled from playback.
 *
 * Walks the active model (Markov or neural) chord-by-chord to fill a phrase.
 * The chain is inherently SERIAL: each sample's input is the previous output,
 * and stateful neural sessions require in-order calls. Locked slots from a
 * prior progression pass through untouched (matched by slot order) and feed
 * the chain, so regenerated neighbors connect to them naturally.
 *
 * Dense worst case (8 bars of sixteenths = 128 neural samples) takes real
 * time, so callers kick generation EARLY (cycle start, user action) and check
 * `isCancelled` — a stale walk aborts between samples and resolves null.
 */

import type { Emitter } from '../events'
import { makeProgression, makeSlot, type ChordExplanation, type Progression, type ProgressionSlot } from './types'

export interface SampleResultLike {
  output: string | null
  probability?: number | null
  error?: string | null
}

/** What generation needs from a model (matches ModelRegistry.sample). */
export interface ChordSampler {
  sample(chord: string): Promise<SampleResultLike> | SampleResultLike
}

export interface GenerateOptions {
  /** Chord the chain starts from (last handled chord / selected seed). */
  seed: string
  /** Onset steps across the whole phrase, ascending, starting at 0. */
  onsets: number[]
  /** Phrase length in 16th steps (last slot sustains to here). */
  totalSteps: number
  /** Variation source: locked slots (by order) survive; others regenerate. */
  prior?: Progression
  /** Explanation context stamped onto generated slots. */
  explain?: Pick<ChordExplanation, 'blendProfile'>
  isCancelled?: () => boolean
}

/**
 * Generate a progression. Returns null when cancelled mid-walk. On a sample
 * error the chain degrades by repeating its input (V1's reply-timeout rule).
 */
export async function generateProgression(
  sampler: ChordSampler,
  opts: GenerateOptions,
  emitter?: Emitter,
): Promise<Progression | null> {
  const onsets = opts.onsets.length > 0 ? opts.onsets : [0]
  const total = Math.max(1, Math.round(opts.totalSteps))
  const slots: ProgressionSlot[] = []
  let chain = opts.seed

  for (let i = 0; i < onsets.length; i++) {
    if (opts.isCancelled?.()) return null
    const duration = (i + 1 < onsets.length ? onsets[i + 1] : total) - onsets[i]
    if (duration <= 0) continue

    const locked = opts.prior?.slots[i]?.locked ? opts.prior.slots[i] : null
    if (locked) {
      slots.push({ ...locked, durationSteps: duration })
      chain = locked.symbol // locked chords steer the walk through them
      continue
    }

    let symbol = chain
    let prior: number | null | undefined
    try {
      const res = await sampler.sample(chain)
      if (opts.isCancelled?.()) return null
      if (res.output && !res.error) {
        symbol = res.output
        prior = res.probability
      } else if (res.error) {
        emitter?.emit({ type: 'error', code: String(res.error) })
      }
    } catch (err) {
      emitter?.emit({ type: 'error', code: String((err as Error)?.message || err) })
    }

    const explanation: ChordExplanation = {
      reasons: [],
      ...(opts.explain?.blendProfile ? { blendProfile: opts.explain.blendProfile } : {}),
      ...(prior != null ? { prior } : {}),
    }
    slots.push(makeSlot(symbol, duration, 'generated', { explanation }))
    chain = symbol
    emitter?.emit({ type: 'output', symbol }) // keep the chord readout alive
    emitter?.emit({ type: 'genProgress', done: i + 1, total: onsets.length })
  }

  if (slots.length === 0) return null
  return makeProgression(slots)
}

/** The chord the next generation should continue from: the last slot. */
export function chainTail(p: Progression | null, fallback: string): string {
  const last = p?.slots[p.slots.length - 1]
  return last?.symbol ?? fallback
}
