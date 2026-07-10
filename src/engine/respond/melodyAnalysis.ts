/** Deterministic melody analysis over a captured phrase.
 *
 * Weighting: duration x metric accent x (modest) velocity. Long notes and
 * strong beats dominate; velocity nudges but never overrides. All constants
 * are explicit and tested.
 */

import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../player/templates'
import type { CapturedNote, MelodyAnalysis } from './types'

/** Metric accent by step position within the bar (4/4). */
export function metricWeight(stepInBar: number): number {
  const s = ((stepInBar % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR
  if (s === 0) return 2.0 // bar downbeat
  if (s % STEPS_PER_BEAT === 0) return 1.5 // beats 2/3/4
  if (s % 2 === 0) return 1.0 // eighth-note subdivisions
  return 0.7 // sixteenth-note subdivisions
}

/** Velocity is a MODEST modifier: 0.75 at silence-soft, 1.25 at max. */
export function velocityWeight(velocity: number): number {
  const v = Math.max(0, Math.min(127, velocity))
  return 0.75 + 0.5 * (v / 127)
}

export function analyzeMelody(notes: CapturedNote[], phraseSteps: number): MelodyAnalysis {
  const mass = new Array<number>(12).fill(0)
  let lastOnset = -1
  let terminal: number | null = null
  let pitchSum = 0
  let lo = Infinity
  let hi = -Infinity

  for (const n of notes) {
    const pc = ((Math.round(n.note) % 12) + 12) % 12
    const durationSteps = Math.max(0.25, (n.offStep ?? phraseSteps) - n.onStep)
    mass[pc] += durationSteps * metricWeight(n.onStep) * velocityWeight(n.velocity)
    if (n.onStep >= lastOnset) {
      // Later onset wins; at an equal onset (a dyad) the higher note is
      // heard as the melody — prefer it.
      if (n.onStep > lastOnset || terminal === null || n.note > (terminal ?? -1)) terminal = pc
      lastOnset = n.onStep
    }
    pitchSum += n.note
    lo = Math.min(lo, n.note)
    hi = Math.max(hi, n.note)
  }

  const total = mass.reduce((a, b) => a + b, 0)
  const weighted = total > 0 ? mass.map((m) => m / total) : mass
  const strongest = weighted
    .map((w, pc) => [pc, w] as const)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pc]) => pc)

  return {
    weightedPitchClasses: weighted,
    strongestPitchClasses: strongest,
    terminalPitchClass: terminal,
    noteDensity: notes.length / Math.max(1, phraseSteps / STEPS_PER_BAR),
    registerCenter: notes.length > 0 ? pitchSum / notes.length : null,
    range: notes.length > 0 ? hi - lo : null,
    totalNotes: notes.length,
  }
}
