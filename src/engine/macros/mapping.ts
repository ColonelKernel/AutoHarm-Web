/** The four musical macros and their mapping onto engine parameters.
 *
 * One musical concept per dial, even where engines implement it differently:
 *
 *   Familiarity  (Common -> Unusual)     sampling adventure + neural temp
 *   HarmonicColor(Folk -> Jazz)          corpus blend position
 *   Tension      (Resolved -> Suspended) tonic/dominant gravity + 7th color
 *   Motion       (Still -> Active)       harmonic-rhythm density (NOT tempo)
 *
 * All mappings are monotonic and pinned so the V1 defaults fall out of the
 * macro defaults: familiarity .35 -> adventure .35 / neural temp 1.5*;
 * tension .5 -> gravity 0, no added 7ths; motion default -> "half + half".
 * (*at familiarity .5; the .35 default gives 1.28 — close to V1's 1.5.)
 */

import { DEFAULT_TEMPLATE_ID, RHYTHM_ORDER } from '../player/templates'

export interface MacroState {
  familiarity: number
  harmonicColor: number
  tension: number
  motion: number
}

export interface EngineParameterPatch {
  color: number
  adventure: number
  gravity: number
  neuralTemperature: number
  color7th: number
  /** 0..1 rhythm-dial value (sparse -> dense), fed to rhythmToTemplate. */
  rhythmDensity: number
}

export const DEFAULT_MACROS: MacroState = {
  familiarity: 0.35,
  harmonicColor: 0.5,
  tension: 0.5,
  motion: RHYTHM_ORDER.indexOf(DEFAULT_TEMPLATE_ID) / (RHYTHM_ORDER.length - 1),
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Neural softmax temperature range driven by Familiarity. */
export const NEURAL_TEMP_MIN = 0.75
export const NEURAL_TEMP_MAX = 2.25

/** Tension below the midpoint pulls home; above it colors with sevenths. */
export const TENSION_GRAVITY_MAX = 0.7
export const TENSION_SEVENTH_MAX = 0.7

export function mapMacrosToEngineParameters(m: MacroState): EngineParameterPatch {
  const familiarity = clamp01(m.familiarity)
  const harmonicColor = clamp01(m.harmonicColor)
  const tension = clamp01(m.tension)
  const motion = clamp01(m.motion)
  return {
    color: harmonicColor,
    adventure: familiarity,
    neuralTemperature: NEURAL_TEMP_MIN + familiarity * (NEURAL_TEMP_MAX - NEURAL_TEMP_MIN),
    // Resolved half: gravity ramps 0.7 -> 0 as tension rises to the midpoint.
    gravity: Math.max(0, TENSION_GRAVITY_MAX * (1 - tension / 0.5)),
    // Suspended half: sevenths fade in past the midpoint.
    color7th: clamp01(((tension - 0.5) / 0.5) * TENSION_SEVENTH_MAX),
    rhythmDensity: motion,
  }
}
