/** Shared generation contracts.
 *
 * The model-facing sampler shape every walk consumes, plus small helpers.
 * The actual progression walks live in `engine/respond/harmonizer.ts` —
 * ONE scored, explainable path for Generate, Variation, Reroll-one and
 * Respond alike (with an empty melody, scoring runs on model prior,
 * voice leading, cadence and novelty).
 */

import type { Progression } from './types'

export interface SampleResultLike {
  output: string | null
  probability?: number | null
  error?: string | null
}

export interface CandidateLike {
  symbol: string
  prior: number
}

/** What generation needs from a model (matches ModelRegistry). `candidates`
 * powers scoring and locked-neighbor lookahead; without it walks fall back
 * to plain sampling. */
export interface ChordSampler {
  sample(chord: string): Promise<SampleResultLike> | SampleResultLike
  candidates?(chord: string, limit?: number): Promise<CandidateLike[]> | CandidateLike[]
}

/** The chord the next generation should continue from: the last slot. */
export function chainTail(p: Progression | null, fallback: string): string {
  const last = p?.slots[p.slots.length - 1]
  return last?.symbol ?? fallback
}
