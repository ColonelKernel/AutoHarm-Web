/**
 * performanceMap.ts — pure mapping tables for the performable device.
 *
 * TypeScript port of `max/performance_map.js` (UPF Autoharmonizer).
 * Centralizes every "dial/pad value -> meaning" decision:
 *
 *   - barsFromDial(v)        Phrase Length dial 0..1 -> stepped bars
 *   - modeFromValue / nextMode / MODES   Phrase Mode
 *   - decodePgm(n)           MPK pad Program Change -> action
 *   - ccToParam(num, val)    MPK CC (e.g. joystick mod) -> {param, value}
 *   - voicingLevelBands(v)   Voicing dial 0..1 -> voicing option flags
 *   - voiceDistancePosition(v)  Voice-Distance dial 0..1 -> harmony steps
 */

export function clamp01(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/* --- Phrase length ------------------------------------------------------ */
// Stepped phrase lengths, sparse->long. A 0..1 dial lands on the nearest step.
export const PHRASE_LENGTHS = [8, 16, 24, 32] as const
export function barsFromDial(v: unknown): number {
  const idx = Math.round(clamp01(v) * (PHRASE_LENGTHS.length - 1))
  return PHRASE_LENGTHS[idx]
}

/* --- List selection from a 0..1 dial (Seed / Key root / Model) ---------- */
export function pickFromList<T>(list: readonly T[], v: unknown): T {
  const idx = Math.round(clamp01(v) * (list.length - 1))
  return list[Math.max(0, Math.min(list.length - 1, idx))]
}

// Curated seed chords: common triads + the dominant/jazz shapes that make good
// phrase starting points. Index 0 (dial fully left) = C:maj.
export const SEED_LIST = [
  'C:maj', 'A:min', 'G:maj', 'F:maj', 'D:min', 'E:min', 'G:7', 'D:min7',
  'A:min7', 'C:maj7', 'F:maj7', 'E:min7', 'E:7', 'A:7', 'D:7', 'B:hdim7',
] as const
export function seedFromDial(v: unknown): string {
  return pickFromList(SEED_LIST, v)
}

// Key ROOT selector (12 chromatic roots, canonical spellings = pitch-class order).
export const KEY_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const
export function keyRootFromDial(v: unknown): number {
  return Math.round(clamp01(v) * (KEY_ROOTS.length - 1))
}

// Generative model selector.
export const MODEL_LIST = ['markov', 'rnn', 'lstm'] as const
export function modelFromDial(v: unknown): string {
  return pickFromList(MODEL_LIST, v)
}

/* --- Phrase mode -------------------------------------------------------- */
export const MODES = ['loop', 'regen', 'oneshot'] as const
export type PlayerMode = (typeof MODES)[number]
export function modeFromValue(v: unknown): PlayerMode {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return MODES[((Math.round(v) % MODES.length) + MODES.length) % MODES.length]
  }
  const s = String(v == null ? '' : v).toLowerCase()
  return (MODES as readonly string[]).indexOf(s) !== -1 ? (s as PlayerMode) : 'loop'
}
export function nextMode(cur: string): PlayerMode {
  const i = (MODES as readonly string[]).indexOf(cur)
  return MODES[(i + 1) % MODES.length]
}

/* --- MPK pads: Program Change -> action --------------------------------- */
export interface PadAction {
  action: string
  arg?: number | string
}
export function decodePgm(n: unknown): PadAction {
  const p = Math.round(Number(n))
  switch (p) {
    case 0: return { action: 'playtoggle' }
    case 1: return { action: 'reroll' }
    case 2: return { action: 'holdtoggle' }
    case 3: return { action: 'modecycle' }
    case 4: return { action: 'length', arg: 8 }
    case 5: return { action: 'length', arg: 16 }
    case 6: return { action: 'length', arg: 24 }
    case 7: return { action: 'length', arg: 32 }
    case 28: return { action: 'keymode', arg: 'maj' }
    case 29: return { action: 'keymode', arg: 'min' }
    default:
      if (p >= 16 && p <= 27) return { action: 'keyroot', arg: p - 16 }
      return { action: 'none' }
  }
}

/* --- MPK CC -> parameter ------------------------------------------------ */
export const CC_MAP: Readonly<Record<number, string>> = { 1: 'adventure' }
export function ccToParam(num: unknown, val: unknown): { param: string; value: number } | null {
  const param = CC_MAP[Math.round(Number(num))]
  if (!param) return null
  return { param, value: clamp01(Number(val) / 127) }
}

/* --- Voicing dial: 0..1 -> voicing option flags ------------------------- */
export interface VoicingBand {
  triadsOnly: boolean
  voiceLeading: boolean
  extensions: number[]
  drop2: boolean
  spreadCap: number
}
export function voicingLevelBands(v: unknown): VoicingBand {
  const x = clamp01(v)
  if (x < 0.2) {
    return { triadsOnly: true, voiceLeading: false, extensions: [], drop2: false, spreadCap: 24 }
  }
  if (x < 0.45) {
    return { triadsOnly: true, voiceLeading: true, extensions: [], drop2: false, spreadCap: 24 }
  }
  if (x < 0.7) {
    // Voice the chord AS chosen — the blend's own jazz 7ths now sound.
    return { triadsOnly: false, voiceLeading: true, extensions: [], drop2: false, spreadCap: 26 }
  }
  if (x < 0.88) {
    return { triadsOnly: false, voiceLeading: true, extensions: [14], drop2: true, spreadCap: 32 }
  }
  return { triadsOnly: false, voiceLeading: true, extensions: [14, 21], drop2: true, spreadCap: 36 }
}

/* --- Voice-Distance dial: 0..1 -> diatonic harmony steps ---------------- *
 * Mirrors the TC-Helicon Harmony Singer 2 HARMONY knob. Steps are DIATONIC
 * scale-degree offsets from the reference (chord's top) note. */
export interface VoiceDistancePosition {
  name: string
  steps: number[]
}
export const VOICE_DISTANCE_POSITIONS: readonly VoiceDistancePosition[] = [
  { name: 'off', steps: [] },
  { name: 'High', steps: [2] }, // 3rd above
  { name: 'Higher', steps: [4] }, // 5th above
  { name: 'High+Higher', steps: [2, 4] }, // 3rd + 5th above
  { name: 'Low', steps: [-3] }, // 4th below
  { name: 'Lower', steps: [-5] }, // 6th below
  { name: 'Low+Lower', steps: [-3, -5] }, // 4th + 6th below
  { name: 'Higher+Lower', steps: [4, -5] }, // 5th above + 6th below
  { name: 'High+Low', steps: [2, -3] }, // 3rd above + 4th below
]
export function voiceDistancePosition(v: unknown): VoiceDistancePosition {
  const idx = Math.round(clamp01(v) * (VOICE_DISTANCE_POSITIONS.length - 1))
  return VOICE_DISTANCE_POSITIONS[idx]
}
