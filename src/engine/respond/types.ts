/** Listen & Respond — shared types. Pure data, no browser dependencies. */

export type RespondPhase = 'idle' | 'armed' | 'listening' | 'analyzing' | 'responding' | 'ready'

/** A note event captured against the step grid. Steps are ABSOLUTE take
 * steps at capture time; finalizePhrase() rebases them onto the window. */
export interface CapturedNote {
  note: number
  velocity: number
  onStep: number
  /** ms past the (unswung) start of onStep — kept raw; analysis quantizes. */
  onMs: number
  /** null while the note is still held (finalize synthesizes the off). */
  offStep: number | null
  offMs: number
}

export interface MelodyAnalysis {
  /** Duration x metric x velocity weighted pitch-class mass, sum = 1
   * (all zeros for an empty phrase). */
  weightedPitchClasses: number[]
  /** Up to 3 strongest pitch classes, descending. */
  strongestPitchClasses: number[]
  terminalPitchClass: number | null
  /** Note onsets per bar. */
  noteDensity: number
  registerCenter: number | null
  range: number | null
  totalNotes: number
}

export interface ChordScoreBreakdown {
  melodyFit: number
  modelPrior: number
  voiceLeadingFit: number
  cadenceFit: number
  noveltyFit: number
  total: number
}

/** Weights of the response score — the same numbers shown to the user. */
export const SCORE_WEIGHTS = {
  melodyFit: 0.35,
  modelPrior: 0.25,
  voiceLeadingFit: 0.15,
  cadenceFit: 0.15,
  noveltyFit: 0.1,
} as const
