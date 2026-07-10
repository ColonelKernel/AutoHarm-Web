/** Progression player — performs the canonical editable progression.
 *
 * V2 successor to the V1 auto-player. The player never generates: it walks a
 * compiled PlaybackPlan of the active Progression, striking each slot's chord
 * at its onset step. Generation/variation happens offline (generator.ts) and
 * lands here via `setProgression` with explicit timing:
 *
 *   'now'   — replace immediately (edits while stopped, symbol edits)
 *   'bar'   — swap at the next bar downbeat, preserving phrase position
 *             (structural edits mid-playback)
 *   'cycle' — swap when the phrase wraps (variations, responses)
 *
 * The swap happens INSIDE onStep before the 'cycle' event is emitted, so a
 * staged progression's first slot plays on the boundary it lands on and
 * observers (respond engine, variation scheduler, UI) never race the swap.
 * Clock contract is unchanged from V1: `onStep(at?)` per 16th-note step,
 * swing applied downstream by the runtime.
 */

import type { Emitter } from '../events'
import type { Sonifier } from './sonifier'
import { compilePlan } from '../progression/operations'
import type { PlaybackPlan, Progression } from '../progression/types'
import { STEPS_PER_BAR, STEPS_PER_BEAT, ROOT_NAMES } from './templates'
import { modeFromValue, nextMode, keyRootFromDial, type PlayerMode } from '../voicing/performanceMap'

export type SwapTiming = 'now' | 'bar' | 'cycle'
/** Who caused a progression replacement — decides whether it is undoable. */
export type SwapOrigin = 'user' | 'auto'

export interface ProgressionPlayerState {
  active: boolean
  /** Position within the phrase, 0..totalSteps-1 (-1 before the first step). */
  pos: number
  /** Absolute step counter since start (for observers). */
  stepAbs: number
  cycleIndex: number
  mode: PlayerMode
  hold: boolean
  heldSlotIndex: number
  muted: boolean
  currentSlotIndex: number
  keyRoot: number
  keyMode: 'maj' | 'min'
}

export class ProgressionPlayer {
  readonly state: ProgressionPlayerState = {
    active: false,
    pos: -1,
    stepAbs: -1,
    cycleIndex: -1,
    mode: 'loop',
    hold: false,
    heldSlotIndex: 0,
    muted: false,
    currentSlotIndex: 0,
    keyRoot: 0,
    keyMode: 'maj',
  }

  private progression: Progression = { slots: [], totalSteps: 0 }
  private plan: PlaybackPlan = { onsetSteps: [], onsetToSlot: new Map(), totalSteps: 0 }
  private staged: { p: Progression; when: 'bar' | 'cycle'; origin: SwapOrigin } | null = null

  /** Called when the current key changes (root or mode dials/pads). */
  onKeyChange: ((key: string) => void) | null = null

  constructor(
    private sonifier: Sonifier,
    private emitter: Emitter,
  ) {}

  get activeProgression(): Progression {
    return this.progression
  }

  get hasStaged(): boolean {
    return this.staged !== null
  }

  /* --- progression handoff -------------------------------------------------- */

  setProgression(p: Progression, when: SwapTiming = 'now', origin: SwapOrigin = 'user'): void {
    if (p.slots.length === 0 || p.totalSteps <= 0) return
    if (when === 'now' || !this.state.active) {
      this.setStaged(null)
      this.apply(p, origin)
      // Keep the phrase position meaningful under the new length.
      if (this.state.pos >= 0) this.state.pos = this.state.pos % p.totalSteps
      return
    }
    this.setStaged({ p, when, origin })
  }

  /** Stage a progression to land at the next phrase wrap (variation/response). */
  stageNext(p: Progression, origin: SwapOrigin = 'user'): void {
    this.setProgression(p, 'cycle', origin)
  }

  clearStaged(): void {
    this.setStaged(null)
  }

  /** Track staging + tell the UI ("Variation queued"). */
  private setStaged(v: { p: Progression; when: 'bar' | 'cycle'; origin: SwapOrigin } | null): void {
    const had = this.staged !== null
    this.staged = v
    if (had !== (v !== null)) this.emitter.emit({ type: 'staged', pending: v !== null })
  }

  private apply(p: Progression, origin: SwapOrigin): void {
    this.progression = p
    this.plan = compilePlan(p)
    // A replacement can be shorter; keep the slot cursors in range so hold
    // and the next onset lookup never index a removed slot.
    const last = Math.max(0, p.slots.length - 1)
    this.state.currentSlotIndex = Math.min(this.state.currentSlotIndex, last)
    this.state.heldSlotIndex = Math.min(this.state.heldSlotIndex, last)
    this.emitter.emit({ type: 'progressionApplied', progression: p, origin })
  }

  /* --- transport ------------------------------------------------------------ */

  start(): void {
    const s = this.state
    s.active = true
    s.pos = -1
    s.stepAbs = -1
    s.cycleIndex = -1
    s.currentSlotIndex = 0
    s.heldSlotIndex = 0
    this.emitter.emit({ type: 'status', value: 'playing' })
    this.emitter.emit({
      type: 'log',
      message: `player: start ${s.mode}, ${this.progression.slots.length} slots / ${this.progression.totalSteps} steps`,
    })
  }

  stop(reason?: string, at?: number): void {
    const s = this.state
    if (!s.active) return // idempotent — avoids playoff/toggle feedback loops
    s.active = false
    // A 'bar'-staged progression is a USER EDIT the store already shows
    // optimistically. Dropping it on stop would leave the timeline and the
    // engine permanently disagreeing, so commit it. A 'cycle'-staged one is
    // an autonomous variation the store never adopted — discard it.
    if (this.staged?.when === 'bar') this.apply(this.staged.p, this.staged.origin)
    this.setStaged(null)
    this.sonifier.resetVoicingHistory()
    this.emitter.emit({ type: 'stop', at }) // silence held notes
    this.emitter.emit({ type: 'playoff' }) // stop the transport clock
    this.emitter.emit({ type: 'status', value: reason || 'stopped' })
  }

  /** One 16th-note grid step from the clock; `at` = audio time (swung). */
  onStep(at?: number): void {
    const s = this.state
    if (!s.active || this.plan.totalSteps === 0) return
    s.stepAbs += 1
    let pos = s.pos + 1

    // Structural edits land on the next bar downbeat, position preserved.
    if (this.staged?.when === 'bar' && pos % STEPS_PER_BAR === 0 && pos < this.plan.totalSteps) {
      const { p, origin } = this.staged
      this.setStaged(null)
      this.apply(p, origin)
      pos = pos % this.plan.totalSteps
    }

    // Phrase boundary: oneshot ends; loop/regen wrap (staged swap lands first).
    if (pos >= this.plan.totalSteps) {
      if (s.mode === 'oneshot') {
        this.stop('done', at)
        return
      }
      if (this.staged) {
        const { p, origin } = this.staged
        this.setStaged(null)
        this.apply(p, origin)
      }
      pos = 0
    }
    if (pos === 0) {
      s.cycleIndex += 1
      this.emitter.emit({ type: 'cycle', index: s.cycleIndex, step: s.stepAbs, at })
    }
    s.pos = pos

    // Phrase position for the UI, once per beat rather than once per step.
    if (pos % STEPS_PER_BEAT === 0) {
      this.emitter.emit({
        type: 'beat',
        posSteps: pos,
        totalSteps: this.plan.totalSteps,
        cycleIndex: s.cycleIndex,
      })
    }

    const slotIdx = this.plan.onsetToSlot.get(pos)
    if (slotIdx === undefined) return // not an onset step
    if (s.muted) return // respond-listening: time advances, nothing sounds

    if (s.hold) {
      // Vamp: re-strike the latched chord at every onset; position advances.
      const held = this.progression.slots[s.heldSlotIndex] ?? this.progression.slots[slotIdx]
      if (!held) return
      // Announce the LATCHED slot so the timeline highlights the chord that is
      // actually sounding, not the one the playhead happens to be passing.
      this.emitter.emit({ type: 'slotOnset', slotId: held.id, at })
      this.sonifier.sonifyChord(held.symbol, 'hold', at)
      return
    }

    s.currentSlotIndex = slotIdx
    const slot = this.progression.slots[slotIdx]
    this.emitter.emit({ type: 'slotOnset', slotId: slot.id, at })
    this.sonifier.sonifyChord(slot.symbol, 'player', at)
  }

  /* --- performance controls -------------------------------------------------- */

  setHold(on: boolean): void {
    if (on && !this.state.hold) this.state.heldSlotIndex = this.state.currentSlotIndex
    this.state.hold = on
  }

  /** Mute playback while keeping the grid running (respond listening). */
  setMuted(on: boolean, at?: number): void {
    if (on && !this.state.muted) this.emitter.emit({ type: 'stop', at })
    this.state.muted = on
  }

  setMode(v: number | string): PlayerMode {
    this.state.mode = modeFromValue(v)
    this.emitter.emit({ type: 'readout', key: 'phrasemodename', value: this.state.mode })
    return this.state.mode
  }

  cycleMode(): PlayerMode {
    this.state.mode = nextMode(this.state.mode)
    this.emitter.emit({ type: 'readout', key: 'phrasemodename', value: this.state.mode })
    return this.state.mode
  }

  /** Audition a chord directly (seed button, chord-card preview). */
  audition(symbol: string, at?: number): void {
    this.sonifier.sonifyChord(symbol, 'audition', at)
  }

  /* --- key handling (unchanged from V1) --------------------------------------- */

  setKeyRootDial(v: number): void {
    this.state.keyRoot = keyRootFromDial(v)
    this.sendKey()
  }

  setKeyRoot(pc: number): void {
    this.state.keyRoot = ((Math.round(pc) % 12) + 12) % 12
    this.sendKey()
  }

  setKeyMode(mode: string | boolean): void {
    if (typeof mode === 'boolean') this.state.keyMode = mode ? 'min' : 'maj'
    else this.state.keyMode = String(mode).toLowerCase().startsWith('min') ? 'min' : 'maj'
    this.sendKey()
  }

  currentKey(): string {
    return `${ROOT_NAMES[((this.state.keyRoot % 12) + 12) % 12]}:${this.state.keyMode}`
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
