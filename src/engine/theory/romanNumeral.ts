/** Roman-numeral analysis — chord symbol + key -> numeral, degree, function.
 *
 * Derived, never stored: the key can change after a progression exists, so
 * numerals are computed at render time. Built on the two existing parsers
 * (`parseChord` for the symbol, `parseKey` for the key) — no third parser.
 * Spelling favors flats for non-diatonic degrees (bII, bIII, bVI, bVII; #IV
 * for the tritone), the common lead-sheet convention.
 */

import { parseChord } from '../voicing/chordParser'
import { parseKey } from './chordVocab'

export type HarmonicFunction = 'tonic' | 'predominant' | 'dominant' | 'color'

export interface RomanAnalysis {
  /** e.g. "I", "ii7", "V7", "bVII", "viiø7" */
  numeral: string
  /** Scale-degree name, e.g. "Dominant", "Submediant", or "Chromatic". */
  degreeLabel: string
  func: HarmonicFunction
  diatonic: boolean
}

// Degree spelling by semitone distance from the tonic.
const MAJ_NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII']
// In minor, degree 10 is the natural subtonic (VII) and degree 11 the raised
// leading tone. Both spell "VII"; the chord quality tells them apart in the
// usual way — subtonic VII is major, the leading-tone chord is vii° / viiø7.
const MIN_NUMERALS = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', 'VII']

const MAJ_DIATONIC = new Set([0, 2, 4, 5, 7, 9, 11])
const MIN_DIATONIC = new Set([0, 2, 3, 5, 7, 8, 10, 11]) // natural + raised leading tone

const MAJ_DEGREE_LABELS: Record<number, string> = {
  0: 'Tonic', 2: 'Supertonic', 4: 'Mediant', 5: 'Subdominant',
  7: 'Dominant', 9: 'Submediant', 11: 'Leading tone',
}
const MIN_DEGREE_LABELS: Record<number, string> = {
  0: 'Tonic', 2: 'Supertonic', 3: 'Mediant', 5: 'Subdominant',
  7: 'Dominant', 8: 'Submediant', 10: 'Subtonic', 11: 'Leading tone',
}

function funcForDegree(deg: number): HarmonicFunction {
  if (deg === 0) return 'tonic'
  if (deg === 7 || deg === 11) return 'dominant'
  if (deg === 5 || deg === 2) return 'predominant'
  return 'color'
}

/** Quality suffix appended to the numeral (case already carries maj/min). */
function qualitySuffix(intervals: number[], quality: string | null): string {
  const has = (i: number) => intervals.includes(i)
  const dim = has(3) && has(6)
  const halfDim = dim && has(10)
  const dim7 = dim && has(9)
  if (halfDim) return 'ø7'
  if (dim7) return '°7'
  if (dim) return '°'
  if (has(4) && has(8) && !has(7)) return '+'
  const q = (quality ?? '').toLowerCase()
  if (q.includes('sus')) return q.includes('sus2') ? 'sus2' : 'sus4'
  if (has(11)) return has(2) || has(14) ? 'maj9' : 'maj7'
  if (has(10)) return has(2) || has(14) ? '9' : '7'
  if (has(9) && q.includes('6')) return '6'
  return ''
}

/**
 * Analyze `symbol` in `key` (e.g. "G:7" in "C:maj" -> V7 / Dominant).
 * Returns null for N.C., unparseable chords, or unknown keys.
 */
export function romanNumeral(symbol: string, key: string): RomanAnalysis | null {
  const parsed = parseChord(symbol)
  if (parsed.error || parsed.isNoChord || parsed.rootPitchClass === null) return null
  const [tonicPc, mode] = parseKey(key)
  if (tonicPc === null) return null

  const deg = ((parsed.rootPitchClass - tonicPc) % 12 + 12) % 12
  const minor = mode === 'min'
  const table = minor ? MIN_NUMERALS : MAJ_NUMERALS
  const diatonicSet = minor ? MIN_DIATONIC : MAJ_DIATONIC
  const labels = minor ? MIN_DEGREE_LABELS : MAJ_DEGREE_LABELS

  // Chord quality decides the case: minor/dim thirds -> lowercase.
  const minorish = parsed.intervals.includes(3)
  let base = table[deg]
  base = minorish ? base.replace(/[IV]+/g, (m) => m.toLowerCase()) : base

  return {
    numeral: base + qualitySuffix(parsed.intervals, parsed.quality),
    degreeLabel: labels[deg] ?? 'Chromatic',
    func: funcForDegree(deg),
    diatonic: diatonicSet.has(deg),
  }
}
