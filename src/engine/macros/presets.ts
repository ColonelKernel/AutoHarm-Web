/** Musical presets — explicit data, applied through the macro mapping.
 *
 * A preset sets the four macros and may override voicing/groove/register.
 * Presets never change the key ROOT (the user's tonal center is theirs);
 * `keyMode` is set only where the character genuinely implies it.
 * "Surprise Me" picks a curated family and jitters within bounds — a
 * musical direction, not parameter soup.
 */

import type { MacroState } from './mapping'

export interface PresetOverrides {
  voicingLevel?: number
  voiceDistance?: number
  register?: number
  swing?: number
  swingUnit?: '8th' | '16th'
  keyMode?: 'maj' | 'min'
}

export interface MusicalPreset {
  id: string
  name: string
  description: string
  macros: MacroState
  overrides?: PresetOverrides
}

export const PRESETS: MusicalPreset[] = [
  {
    id: 'warm-neosoul',
    name: 'Warm Neo-Soul',
    description: 'Rich sevenths, lazy 16th swing, pop–jazz colors that resolve gently.',
    macros: { familiarity: 0.45, harmonicColor: 0.72, tension: 0.62, motion: 0.28 },
    overrides: { voicingLevel: 0.75, register: 58, swing: 0.4, swingUnit: '16th' },
  },
  {
    id: 'restless-jazz',
    name: 'Restless Jazz',
    description: 'Deep in the jazz corpus, adventurous moves, little urge to resolve.',
    macros: { familiarity: 0.8, harmonicColor: 0.95, tension: 0.85, motion: 0.55 },
    overrides: { voicingLevel: 0.9, swing: 0.55, swingUnit: '8th' },
  },
  {
    id: 'dreamy-ambient',
    name: 'Dreamy Ambient',
    description: 'Slow-drifting harmony, wide open voicings, almost no motion.',
    macros: { familiarity: 0.55, harmonicColor: 0.55, tension: 0.7, motion: 0.05 },
    overrides: { voicingLevel: 0.55, register: 64, swing: 0 },
  },
  {
    id: 'classic-pop',
    name: 'Classic Pop',
    description: 'Familiar changes, clear triads, an honest backbeat pulse.',
    macros: { familiarity: 0.2, harmonicColor: 0.33, tension: 0.35, motion: 0.4 },
    overrides: { voicingLevel: 0.3, swing: 0 },
  },
  {
    id: 'modal-drift',
    name: 'Modal Drift',
    description: 'Minor-mode wandering that avoids cadences and stays aloft.',
    macros: { familiarity: 0.7, harmonicColor: 0.6, tension: 0.75, motion: 0.2 },
    overrides: { keyMode: 'min', voicingLevel: 0.5 },
  },
  {
    id: 'dark-cinematic',
    name: 'Dark Cinematic',
    description: 'Low, slow, minor — long unresolved shadows.',
    macros: { familiarity: 0.6, harmonicColor: 0.5, tension: 0.9, motion: 0.12 },
    overrides: { keyMode: 'min', register: 52, voicingLevel: 0.45, swing: 0 },
  },
  {
    id: 'gentle-folk',
    name: 'Gentle Folk',
    description: 'Plain triads from the folk corpus, grounded and warm.',
    macros: { familiarity: 0.15, harmonicColor: 0.05, tension: 0.25, motion: 0.25 },
    overrides: { voicingLevel: 0.15, swing: 0.2, swingUnit: '8th' },
  },
]

export const SURPRISE_ID = 'surprise-me'
const JITTER = 0.12

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Pick a curated family and jitter its macros within ±JITTER. */
export function surpriseMe(rng: () => number): MusicalPreset {
  const base = PRESETS[Math.floor(rng() * PRESETS.length) % PRESETS.length]
  const j = (v: number) => clamp01(v + (rng() * 2 - 1) * JITTER)
  return {
    ...base,
    id: SURPRISE_ID,
    name: 'Surprise Me',
    description: `A twist on ${base.name}.`,
    macros: {
      familiarity: j(base.macros.familiarity),
      harmonicColor: j(base.macros.harmonicColor),
      tension: j(base.macros.tension),
      motion: j(base.macros.motion),
    },
  }
}

export function presetById(id: string): MusicalPreset | null {
  return PRESETS.find((p) => p.id === id) ?? null
}
