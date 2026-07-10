/** Custom rhythm grid — the editable onset pattern behind the rhythm editor.
 *
 * The same shape playback generation consumes (a RhythmPattern), so an edited
 * grid IS the musical truth, never a UI-only drawing. Invariant: at least one
 * onset always remains (a pattern with no onsets has no playable phrase).
 * All operations are pure.
 */

import { STEPS_PER_BAR, type RhythmPattern } from '../player/templates'

export const CUSTOM_NAME = 'custom'

/** Toggle a step. Removing the LAST onset is refused (invariant). */
export function toggleOnset(pattern: RhythmPattern, step: number): RhythmPattern {
  const span = pattern.spanBars * STEPS_PER_BAR
  const s = Math.round(step)
  if (s < 0 || s >= span) return pattern
  const has = pattern.onsets.includes(s)
  if (has && pattern.onsets.length <= 1) return pattern
  const onsets = has ? pattern.onsets.filter((o) => o !== s) : [...pattern.onsets, s].sort((a, b) => a - b)
  return { name: CUSTOM_NAME, spanBars: pattern.spanBars, onsets }
}

/** Rotate the whole pattern left (-1) or right (+1) by one step, wrapping. */
export function rotate(pattern: RhythmPattern, dir: -1 | 1): RhythmPattern {
  const span = pattern.spanBars * STEPS_PER_BAR
  const onsets = pattern.onsets.map((o) => (((o + dir) % span) + span) % span).sort((a, b) => a - b)
  return { name: CUSTOM_NAME, spanBars: pattern.spanBars, onsets }
}

/**
 * Musically bounded randomize: always a downbeat onset; 3..6 total onsets;
 * beats preferred over off-beats over sixteenth positions (weighted draw).
 * Deterministic under an injected rng.
 */
export function randomize(rng: () => number, spanBars = 1): RhythmPattern {
  const span = spanBars * STEPS_PER_BAR
  const count = 3 + Math.floor(rng() * 4) // 3..6
  const onsets = new Set<number>([0])
  const weightFor = (s: number) => (s % 4 === 0 ? 4 : s % 2 === 0 ? 2 : 1)
  const pool: number[] = []
  for (let s = 1; s < span; s++) for (let w = 0; w < weightFor(s); w++) pool.push(s)
  let guard = 64
  while (onsets.size < count && guard-- > 0) {
    onsets.add(pool[Math.floor(rng() * pool.length) % pool.length])
  }
  return { name: CUSTOM_NAME, spanBars, onsets: [...onsets].sort((a, b) => a - b) }
}

export function isCustom(pattern: RhythmPattern): boolean {
  return pattern.name === CUSTOM_NAME
}
