/** Canonical editable progression model — the central musical object of V2.
 *
 * A progression is an ordered list of slots; each slot is a chord ONSET with a
 * duration in 16th-note steps. The sum of durations is the phrase length, so
 * the progression fully determines the harmonic timeline: playback strikes
 * slot k's chord at step sum(durations[0..k-1]) and sustains to the next onset.
 * Pure data — no DOM, no engines. All editing lives in `operations.ts`.
 */

export type SlotSource = 'generated' | 'manual' | 'response'

/** Decomposed selection score — the same numbers that chose the chord are the
 * explanation shown to the user (never fabricated post-hoc). */
export interface ScoreBreakdown {
  melodyFit: number
  modelPrior: number
  voiceLeadingFit: number
  cadenceFit: number
  noveltyFit: number
  total: number
}

export interface ChordExplanation {
  /** Deterministic reasons derived from actual engine state / score parts. */
  reasons: string[]
  breakdown?: ScoreBreakdown
  /** Corpus blend weights in effect when this chord was generated
   * (the selected blend profile — not a per-chord contribution claim). */
  blendProfile?: Array<[string, number]>
  /** Model probability of this chord at selection time, when known. */
  prior?: number
}

export interface ProgressionSlot {
  id: string
  symbol: string
  durationSteps: number
  locked: boolean
  source: SlotSource
  explanation?: ChordExplanation
}

export interface Progression {
  slots: ProgressionSlot[]
  /** Invariant: equals the sum of slot durations (see `assertInvariant`). */
  totalSteps: number
}

/** Compiled per-step lookup used by the player. Recomputed on any change. */
export interface PlaybackPlan {
  /** Ascending step index of each slot's onset within the phrase. */
  onsetSteps: number[]
  /** stepInPhrase -> slot index, only for onset steps. */
  onsetToSlot: Map<number, number>
  totalSteps: number
}

let idCounter = 0

/** Stable unique slot id (session-scoped; deterministic order, no Date/random). */
export function newSlotId(): string {
  idCounter += 1
  return `s${idCounter}`
}

export function makeSlot(
  symbol: string,
  durationSteps: number,
  source: SlotSource,
  opts: Partial<Pick<ProgressionSlot, 'locked' | 'explanation' | 'id'>> = {},
): ProgressionSlot {
  return {
    id: opts.id ?? newSlotId(),
    symbol,
    durationSteps: Math.max(1, Math.round(durationSteps)),
    locked: opts.locked ?? false,
    source,
    ...(opts.explanation ? { explanation: opts.explanation } : {}),
  }
}

export function makeProgression(slots: ProgressionSlot[]): Progression {
  return { slots, totalSteps: slots.reduce((n, s) => n + s.durationSteps, 0) }
}
