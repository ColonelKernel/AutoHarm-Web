/** Swing / groove — displaces the "off" subdivisions of the 16th-note grid.
 *
 * A swing pair is one on-subdivision followed by one off-subdivision. Straight
 * time splits the pair 50:50; swing gives the first half a larger share, up to
 * a hard 75:25 shuffle. The classic jazz feel is 2/3 (triplet), where the
 * offbeat lands two-thirds of the way through the pair.
 *
 *   unit '8th'  — pair = one beat (4 steps); the offbeat 8th (step % 4 == 2)
 *                 slides late. Jazz / shuffle feel.
 *   unit '16th' — pair = one 8th (2 steps); every odd 16th slides late.
 *                 Funk / hip-hop / MPC feel.
 *
 * The delay is expressed in 16th-note STEPS so it is tempo-independent; the
 * caller multiplies by seconds-per-step. Nothing here knows about audio, MIDI
 * or the player's state machine — this is only where each step sits in time.
 */

import { STEPS_PER_BEAT } from './templates'

export type SwingUnit = '8th' | '16th'

export const SWING_UNITS: readonly SwingUnit[] = ['8th', '16th']
export const DEFAULT_SWING_UNIT: SwingUnit = '8th'

/** Share of the pair given to its first half: 0.5 = straight, 0.75 = hard shuffle. */
export const STRAIGHT_RATIO = 0.5
export const MAX_RATIO = 0.75

/** Steps spanned by one swing pair. */
export function pairSteps(unit: SwingUnit): number {
  return unit === '8th' ? STEPS_PER_BEAT : STEPS_PER_BEAT / 2
}

/** Dial 0..1 -> the pair's first-half share (0.5 .. 0.75). */
export function swingRatio(amount: number): number {
  return STRAIGHT_RATIO + clamp01(amount) * (MAX_RATIO - STRAIGHT_RATIO)
}

/**
 * How late `step` should sound, in 16th-note steps (0 .. 0.5 for 16th swing,
 * 0 .. 1 for 8th swing). Only off-subdivisions move; on-subdivisions — which
 * include every beat — stay anchored to the grid.
 *
 * The maximum delay of an off-subdivision exactly reaches the next
 * on-subdivision, so swung step times are always non-decreasing: chords can
 * never sound out of order, at any swing amount.
 */
export function swingDelaySteps(
  step: number,
  amount: number,
  unit: SwingUnit = DEFAULT_SWING_UNIT,
): number {
  const a = clamp01(amount)
  if (a === 0) return 0
  const span = pairSteps(unit)
  const half = span / 2
  const pos = ((Math.round(step) % span) + span) % span
  if (pos !== half) return 0
  return (swingRatio(a) - STRAIGHT_RATIO) * span
}

/** Human-readable dial value: "straight", "58%", "67% · triplet". */
export function swingLabel(amount: number): string {
  const pct = Math.round(swingRatio(amount) * 100)
  if (pct <= 50) return 'straight'
  return pct === 67 ? `${pct}% · triplet` : `${pct}%`
}

function clamp01(v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}
