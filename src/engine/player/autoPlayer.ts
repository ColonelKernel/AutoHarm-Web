/** Auto-player — walks the generative chord chain over harmonic-rhythm
 * templates, with phrase capture/replay, hold and reroll.
 *
 * Port of the player state machine in `max/markov_osc.js`. The OSC round-trip
 * (`submitChord` -> `/chord/output` reply) becomes an async `sampler.sample()`
 * call whose result lands in `player.pending`, guarded by a generation token;
 * if a reply hasn't resolved by the next slot onset the current chord is
 * reused (same degradation as the original 500 ms reply-timeout design).
 */

import type { Emitter } from '../events'
import type { Sonifier } from './sonifier'
import { barsFromDial, modeFromValue, nextMode, seedFromDial, keyRootFromDial, type PlayerMode } from '../voicing/performanceMap'

export interface SampleResultLike {
  output: string | null
  error?: string | null
}

/** What the player needs from a generative engine (Markov or neural). */
export interface ChordSampler {
  sample(chord: string): Promise<SampleResultLike> | SampleResultLike
}

// Harmonic-rhythm templates: slot ONSETS in quarter-note beats within a
// 1- or 2-bar (4/4) cycle. Chords change at each onset and sustain until the
// next (the io layer flushes held notes before each new chord).
export const TEMPLATES: Record<number, { name: string; spanBars: number; onsets: number[] }> = {
  1: { name: 'whole_bar', spanBars: 1, onsets: [0] },
  2: { name: 'half_half', spanBars: 1, onsets: [0, 2] },
  3: { name: 'four_quarters', spanBars: 1, onsets: [0, 1, 2, 3] },
  4: { name: 'half_qtr_qtr', spanBars: 1, onsets: [0, 2, 3] },
  5: { name: 'qtr_qtr_half', spanBars: 1, onsets: [0, 1, 2] },
  6: { name: 'qtr_half_qtr', spanBars: 1, onsets: [0, 1, 3] },
  7: { name: 'static_2bar', spanBars: 2, onsets: [0] },
}

// Templates ordered SPARSE -> DENSE for the performable "rhythm" dial.
export const RHYTHM_ORDER = [7, 1, 2, 4, 6, 5, 3]

export const ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function templateCycleBeats(id: number): number {
  return (TEMPLATES[id] || TEMPLATES[3]).spanBars * 4
}

export function isSlotOnset(id: number, beatInCycle: number): boolean {
  return (TEMPLATES[id] || TEMPLATES[3]).onsets.indexOf(beatInCycle) !== -1
}

export function rhythmToTemplate(v: number): number {
  const x = Math.max(0, Math.min(1, Number(v) || 0))
  const idx = Math.round(x * (RHYTHM_ORDER.length - 1))
  return RHYTHM_ORDER[idx]
}

export interface PlayerState {
  active: boolean
  templateId: number
  pendingTemplateId: number | null
  lengthBars: number
  beat: number
  pending: string | null
  seed: string
  keyRoot: number
  keyMode: 'maj' | 'min'
  mode: PlayerMode
  phrase: Map<number, string>
  capturing: boolean
  hold: boolean
  dirty: boolean
}

export class AutoPlayer {
  readonly player: PlayerState = {
    active: false,
    templateId: 2, // half_half (matches the rhythm dial's default)
    pendingTemplateId: null,
    lengthBars: 8, // the Spice device's Phrase Length dial default
    beat: -1, // first clock tick advances to 0
    pending: null, // next chord to sonify on the beat
    seed: 'C:maj', // chord the chain (re)starts from = latest chord handled
    keyRoot: 0,
    keyMode: 'maj',
    mode: 'loop', // the Spice patch default (base device used oneshot)
    phrase: new Map(),
    capturing: true,
    hold: false,
    dirty: false,
  }

  /** Bumped on start/stop/reroll so stale sample replies are dropped. */
  private generation = 0

  /** Called when the current key changes (root or mode dials/pads). */
  onKeyChange: ((key: string) => void) | null = null

  constructor(
    private sampler: ChordSampler,
    private sonifier: Sonifier,
    private emitter: Emitter,
  ) {}

  /* --- chain feeding ------------------------------------------------------ */

  /**
   * Ask the engine for the successor of `chord`. The reply updates the seed
   * and either becomes the player's pending chord (auto-play) or is sonified
   * immediately (manual / MIDI-seed mode) — mirroring the OSC reply handler.
   */
  submitChord(value: string, at?: number): void {
    const v = String(value ?? '').trim()
    if (!v) {
      this.emitter.emit({ type: 'error', code: 'empty chord input' })
      return
    }
    const gen = this.generation
    Promise.resolve(this.sampler.sample(v)).then(
      (result) => {
        if (gen !== this.generation) return // stale (player restarted/stopped)
        if (result.error && !result.output) {
          this.emitter.emit({ type: 'error', code: String(result.error) })
          return
        }
        const symbol = String(result.output ?? '')
        if (!symbol) return
        // 1) raw symbol out for the rest of the system
        this.emitter.emit({ type: 'output', symbol })
        // 2) remember the latest chord so the auto-player can (re)seed from it
        this.player.seed = symbol
        if (this.player.active) {
          // In auto-play the reply is the NEXT slot's chord; the player
          // sonifies on the beat, so just stash it — do not sound it now.
          this.player.pending = symbol
        } else {
          // manual / MIDI mode: interpret -> voice -> sonify immediately
          this.sonifier.sonifyChord(symbol, 'markov', at)
        }
      },
      (err) => {
        if (gen !== this.generation) return
        this.emitter.emit({ type: 'error', code: String((err as Error)?.message || err) })
      },
    )
  }

  /** MIDI note-in seeds the chain: pitch class -> "<Root>:maj". */
  noteIn(note: number, velocity?: number): void {
    const n = Number(note)
    if (!Number.isFinite(n)) return
    if (velocity !== undefined && Number(velocity) === 0) return // ignore note-offs
    const pc = ((Math.round(n) % 12) + 12) % 12
    this.submitChord(ROOT_NAMES[pc] + ':maj')
  }

  /* --- transport ----------------------------------------------------------- */

  start(): void {
    const p = this.player
    p.active = true
    p.beat = -1
    p.pending = null
    p.phrase.clear()
    p.capturing = true // first pass always captures
    p.dirty = false
    this.generation++
    const t = TEMPLATES[p.templateId] || TEMPLATES[3]
    this.emitter.emit({
      type: 'log',
      message: `player: start ${p.mode} ${p.lengthBars} bars, template ${t.name}, seed ${p.seed}`,
    })
    this.emitter.emit({ type: 'status', value: 'playing' })
    this.submitChord(p.seed) // fetch the first chord to play on beat 0
  }

  stop(reason?: string, at?: number): void {
    const p = this.player
    if (!p.active) return // idempotent — avoids playoff/toggle feedback loops
    p.active = false
    this.generation++
    this.sonifier.resetVoicingHistory()
    this.emitter.emit({ type: 'stop', at }) // silence held notes
    this.emitter.emit({ type: 'playoff' }) // stop the transport clock
    this.emitter.emit({ type: 'status', value: reason || 'stopped' })
    this.emitter.emit({ type: 'log', message: `player: ${reason || 'stopped'}` })
  }

  /** Reroll: discard the captured phrase and walk a fresh one from the seed. */
  reroll(): void {
    const p = this.player
    if (!p.active) return
    p.phrase.clear()
    p.capturing = true
    p.beat = -1
    p.pending = null
    p.dirty = false
    this.generation++
    this.emitter.emit({ type: 'status', value: 'reroll' })
    this.emitter.emit({ type: 'log', message: 'player: reroll' })
    this.submitChord(p.seed)
  }

  /** Begin a new phrase cycle at a boundary, honoring the current mode. */
  private beginCycle(): void {
    const p = this.player
    // Queued rhythm change lands cleanly at the phrase boundary.
    if (p.pendingTemplateId != null) {
      p.templateId = p.pendingTemplateId
      p.pendingTemplateId = null
    }
    if (p.mode === 'loop' && !p.dirty) {
      p.capturing = false // replay the phrase we just captured
    } else {
      // REGEN, or LOOP after a param change: capture a fresh phrase.
      p.phrase.clear()
      p.capturing = true
      p.seed = p.pending || p.seed
    }
    p.dirty = false
  }

  /** Quarter-note clock tick. `at` = audio-clock time for scheduled events. */
  onBeat(at?: number): void {
    const p = this.player
    if (!p.active) return
    p.beat += 1

    // Cycle boundary: one-shot stops; loop/regen wrap into a new cycle.
    if (p.beat >= p.lengthBars * 4) {
      if (p.mode === 'oneshot') {
        this.stop('done', at)
        return
      }
      p.beat = 0
      this.beginCycle()
    }
    const b = p.beat

    // Hold / vamp: keep sounding the current chord, don't advance the walk.
    if (p.hold) {
      if (isSlotOnset(p.templateId, b % templateCycleBeats(p.templateId))) {
        const c = p.phrase.get(b) || p.pending || p.seed
        this.sonifier.sonifyChord(c, 'hold', at)
      }
      return
    }

    // Mid-cycle rhythm change on the bar downbeat (during LOOP replay the
    // template is frozen so the loop stays coherent).
    if (b % 4 === 0 && p.capturing && p.pendingTemplateId != null) {
      p.templateId = p.pendingTemplateId
      p.pendingTemplateId = null
    }

    if (!isSlotOnset(p.templateId, b % templateCycleBeats(p.templateId))) return

    if (p.capturing) {
      const chord = p.pending || p.seed
      this.sonifier.sonifyChord(chord, 'player', at) // play the current chord
      p.phrase.set(b, chord) // record it for LOOP replay
      this.submitChord(chord) // ask the engine for its successor -> pending
    } else {
      // LOOP replay — deterministic, no engine round-trip.
      const chord = p.phrase.get(b) || p.seed
      this.sonifier.sonifyChord(chord, 'loop', at)
    }
  }

  /* --- control handlers (mirror the markov_osc.js Max handlers) ------------ */

  /** `template <1..7>` — choose the harmonic-rhythm template directly. */
  setTemplate(id: number): void {
    const t = Math.round(id)
    if (TEMPLATES[t]) {
      this.player.templateId = t
      this.player.pendingTemplateId = null
    }
  }

  /** `rhythm` dial 0..1 — queued while playing, immediate when stopped. */
  setRhythm(v: number): string {
    const id = rhythmToTemplate(v)
    this.player.pendingTemplateId = id
    if (!this.player.active) this.player.templateId = id // apply now when stopped
    this.player.dirty = true // a LOOP re-captures with the new rhythm next cycle
    const name = TEMPLATES[id].name
    this.emitter.emit({ type: 'readout', key: 'rhythmname', value: name })
    return name
  }

  /** `length <bars>` — explicit phrase length. */
  setLengthBars(n: number): void {
    const v = Math.round(n)
    if (Number.isFinite(v) && v > 0) {
      this.player.lengthBars = v
      this.player.dirty = true
    }
  }

  /** `phraselen` dial 0..1 -> 8/16/24/32 bars. */
  setPhraseLenDial(v: number): number {
    this.player.lengthBars = barsFromDial(v)
    this.player.dirty = true
    this.emitter.emit({ type: 'readout', key: 'phraselenbars', value: this.player.lengthBars })
    return this.player.lengthBars
  }

  /** `phrasemode` — loop / regen / oneshot. */
  setMode(v: number | string): PlayerMode {
    this.player.mode = modeFromValue(v)
    this.player.dirty = true
    this.emitter.emit({ type: 'readout', key: 'phrasemodename', value: this.player.mode })
    return this.player.mode
  }

  cycleMode(): PlayerMode {
    this.player.mode = nextMode(this.player.mode)
    this.player.dirty = true
    this.emitter.emit({ type: 'readout', key: 'phrasemodename', value: this.player.mode })
    return this.player.mode
  }

  setHold(on: boolean): void {
    this.player.hold = on
  }

  /** `seed <chord>` — explicit seed override. */
  setSeed(s: string): void {
    const v = s.trim()
    if (v) this.player.seed = v
  }

  /** `seedsel` dial 0..1 — scroll the curated seed list. */
  setSeedDial(v: number): string {
    this.player.seed = seedFromDial(v)
    this.emitter.emit({ type: 'readout', key: 'seedname', value: this.player.seed })
    return this.player.seed
  }

  /** Audition the currently-selected seed directly (bypasses the chain). */
  audition(at?: number): void {
    this.sonifier.sonifyChord(this.player.seed, 'audition', at)
  }

  /** `keysel` dial 0..1 -> key root pitch class. */
  setKeyRootDial(v: number): void {
    this.player.keyRoot = keyRootFromDial(v)
    this.sendKey()
  }

  /** `keyroot <0..11>` (MPK key-set pads). */
  setKeyRoot(pc: number): void {
    this.player.keyRoot = ((Math.round(pc) % 12) + 12) % 12
    this.sendKey()
  }

  /** `keymode maj|min` / `keymin 0|1`. */
  setKeyMode(mode: string | boolean): void {
    if (typeof mode === 'boolean') this.player.keyMode = mode ? 'min' : 'maj'
    else this.player.keyMode = String(mode).toLowerCase().startsWith('min') ? 'min' : 'maj'
    this.sendKey()
  }

  currentKey(): string {
    return `${ROOT_NAMES[((this.player.keyRoot % 12) + 12) % 12]}:${this.player.keyMode}`
  }

  private sendKey(): void {
    const k = this.currentKey()
    this.sonifier.setCurrentKey(k)
    if (this.onKeyChange) this.onKeyChange(k)
    this.emitter.emit({ type: 'readout', key: 'keyname', value: k })
  }

  /** Manual panic: forget history and stop sounding notes. */
  panic(): void {
    this.sonifier.resetVoicingHistory()
    this.emitter.emit({ type: 'stop' })
  }
}
