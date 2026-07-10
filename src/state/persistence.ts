/** Versioned localStorage persistence for user preferences.
 *
 * Persists only stable preferences — never playback state, transient MIDI
 * device ids, or half-captured phrases. Malformed/old data is discarded
 * silently (the app must never crash on localStorage contents).
 */

import type { MacroState } from '../engine/macros/mapping'

export const STORAGE_KEY = 'autoharm.v2.settings'
const VERSION = 2

export interface PersistedSettings {
  version: number
  appMode?: 'generate' | 'respond' | 'perform'
  viewMode?: 'quick' | 'lab'
  displayMode?: 'symbols' | 'roman' | 'both'
  macros?: MacroState
  activePresetId?: string | null
  keyRoot?: number
  keyMode?: 'maj' | 'min'
  bpm?: number
  phraseSteps?: number
  repetitions?: number
  synthOn?: boolean
  synthVolume?: number
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function loadSettings(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PersistedSettings
    if (!data || typeof data !== 'object' || data.version !== VERSION) return null
    // Schema-check the fields we intend to trust; drop anything malformed.
    const m = data.macros
    if (m && !(num(m.familiarity) && num(m.harmonicColor) && num(m.tension) && num(m.motion))) {
      delete data.macros
    }
    if (data.bpm !== undefined && (!num(data.bpm) || data.bpm < 40 || data.bpm > 240)) delete data.bpm
    if (data.phraseSteps !== undefined && (!num(data.phraseSteps) || data.phraseSteps < 8)) delete data.phraseSteps
    if (data.keyRoot !== undefined && (!num(data.keyRoot) || data.keyRoot < 0 || data.keyRoot > 11)) delete data.keyRoot
    return data
  } catch {
    return null
  }
}

export function saveSettings(s: Omit<PersistedSettings, 'version'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...s }))
  } catch {
    /* storage full / private mode — preferences just don't persist */
  }
}
