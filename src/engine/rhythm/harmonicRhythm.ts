/** Generated harmonic rhythm — musical onset placement, not uniform tiling.
 *
 * Every bar draws a pattern from the curated template vocabulary, centered on
 * the user's selected rhythm feel (the dial / Motion macro), so onsets are
 * sensible by construction — they're all patterns a musician chose. Three
 * shaping rules:
 *
 *   coherence   a bar usually repeats the previous bar's pattern (grooves
 *               persist), occasionally drifting to a neighboring density
 *   broadening  the final bar of a phrase draws one notch SPARSER — the
 *               classic cadential slow-down of harmonic rhythm
 *   anchoring   the phrase always sounds from step 0
 *
 * Deterministic under an injected rng. A custom-edited grid bypasses all of
 * this (explicit intent tiles verbatim — see runtime.phraseOnsets).
 */

import { RHYTHM_ORDER, STEPS_PER_BAR, TEMPLATES, type RhythmPattern } from '../player/templates'

/** Chance a bar keeps the previous bar's pattern (groove coherence). */
export const REPEAT_BIAS = 0.55
/** Neighbor-drift weights around the selected feel: [-2, -1, 0, +1, +2]. */
export const DRIFT_WEIGHTS = [0.06, 0.17, 0.54, 0.17, 0.06]

export interface HarmonicRhythmOptions {
  /** RHYTHM_ORDER template id at the center of the draw (the user's feel). */
  templateId: number
  totalSteps: number
}

function clampIndex(i: number): number {
  return Math.max(0, Math.min(RHYTHM_ORDER.length - 1, i))
}

/** Weighted draw of a template index around `center`. */
function driftIndex(rng: () => number, center: number): number {
  let r = rng()
  for (let k = 0; k < DRIFT_WEIGHTS.length; k++) {
    r -= DRIFT_WEIGHTS[k]
    if (r <= 0) return clampIndex(center + k - 2)
  }
  return clampIndex(center)
}

/**
 * Generate onsets for a phrase. Walks bar by bar: each segment draws a
 * pattern (repeat-biased, density-drifting) from the template vocabulary;
 * 2-bar patterns occupy two bars when they fit. The last full bar draws one
 * notch sparser. Result is ascending, unique, in-range, and starts at 0.
 */
export function generateHarmonicRhythm(rng: () => number, opts: HarmonicRhythmOptions): number[] {
  const total = Math.max(1, Math.round(opts.totalSteps))
  const center = clampIndex(RHYTHM_ORDER.indexOf(opts.templateId))
  const onsets = new Set<number>([0])

  let bar = 0
  let prevIndex: number | null = null
  const totalBars = total / STEPS_PER_BAR
  while (bar * STEPS_PER_BAR < total) {
    const barStart = bar * STEPS_PER_BAR
    const isFinalBar = bar + 1 >= Math.ceil(totalBars)
    let index: number
    if (prevIndex !== null && !isFinalBar && rng() < REPEAT_BIAS) {
      index = prevIndex // groove coherence
    } else {
      index = driftIndex(rng, center)
      if (isFinalBar && totalBars >= 2) index = clampIndex(index - 1) // cadential broadening
    }
    const pattern: RhythmPattern = TEMPLATES[RHYTHM_ORDER[index]]
    // A 2-bar pattern occupies two bars when it fits; otherwise its onsets
    // are clipped to the single remaining bar (same rule as tileOnsets).
    const barsUsed = barStart + pattern.spanBars * STEPS_PER_BAR <= total ? pattern.spanBars : 1
    const limit = Math.min(total, barStart + barsUsed * STEPS_PER_BAR)
    for (const o of pattern.onsets) {
      const step = barStart + o
      if (step < limit) onsets.add(step)
    }
    prevIndex = index
    bar += barsUsed
  }

  return [...onsets].sort((a, b) => a - b)
}
