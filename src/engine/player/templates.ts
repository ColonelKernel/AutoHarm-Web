/** The 16th-note grid and harmonic-rhythm templates.
 *
 * Extracted from the V1 auto-player: in V2 templates are GENERATION-density
 * presets — they decide how many slots (chord onsets) a generated progression
 * has and where they sit. Playback walks the progression itself; it never
 * consults a template. The custom rhythm editor produces the same shape.
 */

// STEPS_PER_BEAT steps per quarter note, STEPS_PER_BAR per 4/4 bar. V2 is
// explicitly 4/4-only; fractional-bar phrase lengths stay exact in steps.
export const STEPS_PER_BEAT = 4
export const STEPS_PER_BAR = STEPS_PER_BEAT * 4 // 16

/** Onset pattern within a 1- or 2-bar (4/4) span, tiled across the phrase. */
export interface RhythmPattern {
  name: string
  spanBars: number
  onsets: number[]
}

export const TEMPLATES: Record<number, RhythmPattern> = {
  1: { name: 'static (2 bars)', spanBars: 2, onsets: [0] },
  2: { name: 'whole note', spanBars: 1, onsets: [0] },
  3: { name: 'half + half', spanBars: 1, onsets: [0, 8] },
  4: { name: 'charleston', spanBars: 1, onsets: [0, 10] }, // 1 & the "and of 3"
  5: { name: 'dotted quarters', spanBars: 1, onsets: [0, 6, 12] }, // 3-against-4
  6: { name: 'quarters', spanBars: 1, onsets: [0, 4, 8, 12] },
  7: { name: 'quarters + push', spanBars: 1, onsets: [0, 4, 8, 14] }, // anticipated
  8: { name: 'offbeats', spanBars: 1, onsets: [2, 6, 10, 14] }, // all the "ands"
  9: { name: 'son clave', spanBars: 2, onsets: [0, 6, 12, 20, 24] }, // 3-2 clave
  10: { name: 'gallop', spanBars: 1, onsets: [0, 4, 6, 8, 12, 14] },
  11: { name: 'eighth notes', spanBars: 1, onsets: [0, 2, 4, 6, 8, 10, 12, 14] },
  12: { name: 'sixteenths', spanBars: 1, onsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
}

/** Default = "half + half" (a chord every two beats), V1's default feel. */
export const DEFAULT_TEMPLATE_ID = 3

// Templates ordered SPARSE -> DENSE for the performable "rhythm" dial.
export const RHYTHM_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function templateCycleSteps(id: number): number {
  return (TEMPLATES[id] || TEMPLATES[DEFAULT_TEMPLATE_ID]).spanBars * STEPS_PER_BAR
}

export function isSlotOnset(id: number, stepInCycle: number): boolean {
  return (TEMPLATES[id] || TEMPLATES[DEFAULT_TEMPLATE_ID]).onsets.indexOf(stepInCycle) !== -1
}

/** Rhythm dial 0..1 -> template id, sparse to dense. */
export function rhythmToTemplate(v: number): number {
  const x = Math.max(0, Math.min(1, Number(v) || 0))
  const idx = Math.round(x * (RHYTHM_ORDER.length - 1))
  return RHYTHM_ORDER[idx]
}

export const ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

/** Tile a rhythm pattern's onsets across `totalSteps`, ascending, deduped. */
export function tileOnsets(pattern: RhythmPattern, totalSteps: number): number[] {
  const span = pattern.spanBars * STEPS_PER_BAR
  const out: number[] = []
  for (let base = 0; base < totalSteps; base += span) {
    for (const o of pattern.onsets) {
      const step = base + o
      if (step < totalSteps) out.push(step)
    }
  }
  // A playable phrase always sounds from its first step.
  if (out.length === 0 || out[0] !== 0) out.unshift(0)
  return out
}
