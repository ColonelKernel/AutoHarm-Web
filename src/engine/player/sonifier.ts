/** Sonifier — voicing state + chord -> note-event emission.
 *
 * Port of the sonification half of `max/markov_osc.js`: the `voicingOptions`
 * state object, `previousVoicing` voice-leading history, and `sonifyChord()`.
 * Emits events instead of Max.outlet messages; the io layer schedules them.
 */

import { chordToNotes, type VoicingOptions } from '../voicing/chordParser'
import { voicingLevelBands, voiceDistancePosition } from '../voicing/performanceMap'
import type { Emitter } from '../events'

export const DEFAULT_NOTE_VELOCITY = 90 // matches the patch's `makenote 90`

export class Sonifier {
  /** Mirrors markov_osc.js `voicingOptions` (same defaults). */
  readonly options: VoicingOptions & {
    voiceLeadingEnabled: boolean
    extensions: number[]
    drop2: boolean
    spreadCap: number
    voiceDistanceSteps: number[]
    currentKey: string
  } = {
    registerCenter: 60, // approx C4
    low: 48, // C3
    high: 72, // C5
    voiceLeadingEnabled: true,
    // PROJECT CONSTRAINT: only major/minor triads are sonified by default.
    triadsOnly: true,
    colorMajor: 0,
    colorMinor: 0,
    color7th: 0,
    extensions: [],
    drop2: false,
    spreadCap: 24,
    voiceDistanceSteps: [],
    currentKey: 'C:maj',
  }

  private previousVoicing: number[] | null = null

  constructor(
    private emitter: Emitter,
    rng?: () => number,
  ) {
    if (rng) this.options.rng = rng
  }

  /**
   * Parse a chord symbol, voice it, and emit the display + note events.
   * Never throws. `at` is the audio-clock time the notes should sound
   * (undefined = immediately).
   */
  sonifyChord(symbol: string, source: string, at?: number): void {
    let result
    try {
      result = chordToNotes(symbol, this.options, this.previousVoicing)
    } catch (err) {
      this.emitter.emit({ type: 'error', code: 'parser_exception', detail: String(symbol) })
      return
    }

    // Show the normalized symbol regardless of outcome (helps debugging).
    this.emitter.emit({ type: 'chord', symbol: result.normalizedSymbol, at })

    if (result.error) {
      // Do NOT emit notes, do NOT replay the previous chord.
      this.emitter.emit({ type: 'error', code: result.error.code, detail: result.error.detail })
      return
    }

    if (result.isNoChord) {
      // N.C. — stop currently sounding notes and generate nothing new.
      this.previousVoicing = null
      this.emitter.emit({ type: 'stop', at })
      this.emitter.emit({ type: 'log', message: `${source}: no-chord -> silence` })
      return
    }

    this.previousVoicing = result.notes
    this.emitter.emit({ type: 'notes', notes: result.notes, velocity: DEFAULT_NOTE_VELOCITY, at })
    this.emitter.emit({
      type: 'log',
      message: `${source}: ${result.normalizedSymbol} -> ${result.triadQuality} triad notes ${result.notes.join(' ')}`,
    })
  }

  /** Forget voice-leading history (panic / triadsOnly change / stop). */
  resetVoicingHistory(): void {
    this.previousVoicing = null
  }

  // --- dial handlers (mirror the markov_osc.js Max handlers) ---------------

  /** `register` — recentre the comfortable voicing window. */
  setRegister(value: number): void {
    if (!Number.isFinite(value)) return
    this.options.registerCenter = value
    this.options.low = Math.max(0, Math.round(value - 12))
    this.options.high = Math.min(127, Math.round(value + 12))
  }

  /** `voiceleading` toggle. */
  setVoiceLeading(on: boolean): void {
    this.options.voiceLeadingEnabled = on
  }

  /** `triadsonly` toggle — resets voice-leading history (voice count changes). */
  setTriadsOnly(on: boolean): void {
    this.options.triadsOnly = on
    this.previousVoicing = null
  }

  setColorMajor(v: number): void {
    this.options.colorMajor = clamp01(v)
  }

  setColorMinor(v: number): void {
    this.options.colorMinor = clamp01(v)
  }

  setColor7th(v: number): void {
    this.options.color7th = clamp01(v)
  }

  /** `voicing` dial — functional-harmony ladder (see performanceMap). */
  setVoicingLevel(v: number): void {
    const b = voicingLevelBands(v)
    this.options.triadsOnly = b.triadsOnly
    this.options.voiceLeadingEnabled = b.voiceLeading
    this.options.extensions = b.extensions
    this.options.drop2 = b.drop2
    this.options.spreadCap = b.spreadCap
    this.previousVoicing = null // voice count can change -> reset VL history
  }

  /** `voicedistance` dial — Harmony-Singer added voices. Returns the name. */
  setVoiceDistance(v: number): string {
    const pos = voiceDistancePosition(v)
    this.options.voiceDistanceSteps = pos.steps
    return pos.name
  }

  /** Scale context for the added-harmony voices. */
  setCurrentKey(key: string): void {
    this.options.currentKey = key
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
