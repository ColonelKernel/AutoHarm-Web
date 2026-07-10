/** Response chord scoring — decomposable, deterministic.
 *
 * Score(chord) = w·melodyFit + w·modelPrior + w·voiceLeadingFit
 *              + w·cadenceFit + w·noveltyFit          (weights in types.ts)
 *
 * The same breakdown that picks the chord is stored on the slot and shown in
 * the explanation panel — the explanation IS the decision, never a story
 * written after the fact. Chord pitch content comes from the existing
 * parseChord; no second parser.
 */

import { parseChord } from '../voicing/chordParser'
import { romanNumeral } from '../theory/romanNumeral'
import type { ChordScoreBreakdown, MelodyAnalysis } from './types'
import { SCORE_WEIGHTS } from './types'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Consonance of a melody pitch class against a chord's pitch classes:
 * chord tone 1.0; whole-step tension above a chord tone (9/13 color) 0.35;
 * semitone clash -0.7; unrelated 0.1. */
export function pcConsonance(pc: number, chordPcs: number[]): number {
  if (chordPcs.includes(pc)) return 1.0
  const semitoneClash = chordPcs.some((c) => (pc - c + 12) % 12 === 1 || (c - pc + 12) % 12 === 1)
  if (semitoneClash) return -0.7
  const wholeStepAbove = chordPcs.some((c) => (pc - c + 12) % 12 === 2)
  if (wholeStepAbove) return 0.35
  return 0.1
}

/** How well the chord supports the weighted melody (0..1). Chords the parser
 * rejects score 0. Empty melodies are neutral (0.5). */
export function melodyFit(symbol: string, analysis: MelodyAnalysis): number {
  const parsed = parseChord(symbol)
  if (parsed.error || parsed.isNoChord || parsed.pitchClasses.length === 0) return 0
  if (analysis.totalNotes === 0) return 0.5
  let raw = 0
  for (let pc = 0; pc < 12; pc++) {
    const w = analysis.weightedPitchClasses[pc]
    if (w > 0) raw += w * pcConsonance(pc, parsed.pitchClasses)
  }
  return clamp01((raw + 0.7) / 1.7) // raw ∈ [-0.7, 1] -> 0..1
}

/** Voice-leading: mean absolute movement from the previous voicing, mapped so
 * common-tone moves score high and leaps score low. No prior voicing = 0.5. */
export function voiceLeadingFit(candidateNotes: number[] | null, prevVoicing: number[] | null): number {
  if (!candidateNotes || candidateNotes.length === 0 || !prevVoicing || prevVoicing.length === 0) return 0.5
  const n = Math.min(candidateNotes.length, prevVoicing.length)
  const a = [...candidateNotes].sort((x, y) => x - y)
  const b = [...prevVoicing].sort((x, y) => x - y)
  let move = 0
  for (let i = 0; i < n; i++) move += Math.abs(a[i] - b[i])
  return clamp01(1 - move / n / 7)
}

/**
 * Cadence fit at the phrase boundary, tension-aware: low Tension prefers
 * stable/resolving functions that hold the terminal melody note; high
 * Tension tolerates (and mildly prefers) unresolved color.
 */
export function cadenceFit(symbol: string, analysis: MelodyAnalysis, key: string, tension: number): number {
  const parsed = parseChord(symbol)
  if (parsed.error || parsed.isNoChord) return 0
  const t = clamp01(tension)
  let fit = 0.5
  if (analysis.terminalPitchClass !== null) {
    fit = parsed.pitchClasses.includes(analysis.terminalPitchClass) ? 0.8 : 0.3
  }
  const rn = romanNumeral(symbol, key)
  if (rn) {
    if (rn.func === 'tonic') fit += 0.2 * (1 - t)
    else if (rn.func === 'dominant') fit += 0.1 * (1 - t) + 0.05 * t
    else fit += 0.2 * t // predominant/color reads as suspension
  }
  return clamp01(fit)
}

/** Anti-pathological-repetition, Hold-respecting (callers skip when holding):
 * same as the immediately previous chord 0.3; within the recent window 0.7;
 * fresh 1.0. Repeats are DISCOURAGED, never banned. */
export function noveltyFit(symbol: string, recent: string[]): number {
  if (recent.length === 0) return 1
  if (recent[recent.length - 1] === symbol) return 0.3
  return recent.slice(-4).includes(symbol) ? 0.7 : 1
}

export interface ScoreContext {
  analysis: MelodyAnalysis
  key: string
  tension: number
  prior: number // model prior, normalized by the caller to the candidate max
  candidateNotes: number[] | null
  prevVoicing: number[] | null
  recent: string[]
}

export function scoreChord(symbol: string, ctx: ScoreContext): ChordScoreBreakdown {
  const parts = {
    melodyFit: melodyFit(symbol, ctx.analysis),
    modelPrior: clamp01(ctx.prior),
    voiceLeadingFit: voiceLeadingFit(ctx.candidateNotes, ctx.prevVoicing),
    cadenceFit: cadenceFit(symbol, ctx.analysis, ctx.key, ctx.tension),
    noveltyFit: noveltyFit(symbol, ctx.recent),
  }
  const total =
    parts.melodyFit * SCORE_WEIGHTS.melodyFit +
    parts.modelPrior * SCORE_WEIGHTS.modelPrior +
    parts.voiceLeadingFit * SCORE_WEIGHTS.voiceLeadingFit +
    parts.cadenceFit * SCORE_WEIGHTS.cadenceFit +
    parts.noveltyFit * SCORE_WEIGHTS.noveltyFit
  return { ...parts, total }
}
