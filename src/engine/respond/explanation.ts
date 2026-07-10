/** Deterministic chord explanations — reasons derived ONLY from the actual
 * score breakdown, roman-numeral function, and real engine state. No
 * fabricated confidences, no per-chord corpus claims the engine can't make. */

import { romanNumeral } from '../theory/romanNumeral'
import { parseChord } from '../voicing/chordParser'
import { ROOT_NAMES } from '../player/templates'
import type { ChordScoreBreakdown, MelodyAnalysis } from './types'

export function explainResponseChord(
  symbol: string,
  key: string,
  breakdown: ChordScoreBreakdown,
  analysis: MelodyAnalysis,
): string[] {
  const reasons: string[] = []
  const parsed = parseChord(symbol)
  const rn = romanNumeral(symbol, key)

  if (breakdown.melodyFit >= 0.65 && analysis.totalNotes > 0 && !parsed.error) {
    const supported = analysis.strongestPitchClasses
      .filter((pc) => parsed.pitchClasses.includes(pc))
      .map((pc) => ROOT_NAMES[pc])
    if (supported.length > 0) reasons.push(`Supports the important melody note${supported.length > 1 ? 's' : ''} ${supported.join(', ')}`)
    else reasons.push('Fits the melody without clashing')
  } else if (breakdown.melodyFit < 0.4 && analysis.totalNotes > 0) {
    reasons.push('Rubs against the melody — chosen for other strengths')
  }

  if (rn?.func === 'dominant') {
    const [tonic] = key.split(':')
    reasons.push(`Creates strong movement toward ${tonic}`)
  } else if (rn?.func === 'tonic' && breakdown.cadenceFit >= 0.6) {
    reasons.push('Settles the phrase at home')
  }

  if (breakdown.voiceLeadingFit >= 0.7) reasons.push('Requires little voice-leading movement')
  if (breakdown.modelPrior >= 0.6) reasons.push('Strongly suggested by the current model blend')
  if (breakdown.noveltyFit <= 0.5) reasons.push('A repeat — kept despite the repetition penalty')

  return reasons
}
