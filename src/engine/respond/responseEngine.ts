/** Respond engine — the Listen -> Analyze -> Respond -> Commit state machine.
 *
 * Pure and clock-agnostic: the runtime feeds it step/cycle events and routed
 * note events; effects (mute, generate+stage a response) are injected. The
 * non-negotiable invariant lives here: NO response is generated before the
 * full phrase has been heard (generation kicks off at most one bar early,
 * only ever from notes already played, and the committed response never
 * mutates during its repetitions).
 *
 * Timeline (cycle = one phrase of `phraseSteps`):
 *   armed      New Listen pressed; capture starts at the next boundary
 *   listening  window open, player muted, notes recorded
 *              (one bar before close: early generation kickoff so the
 *               response is staged BEFORE the boundary it must land on)
 *   analyzing  window closed; waiting for the staged response to land
 *   responding response playing, committed for N repetitions
 *   ready      commitment served; response keeps playing until New Listen
 */

import { STEPS_PER_BAR } from '../player/templates'
import { PhraseCapture } from './phraseCapture'
import { analyzeMelody } from './melodyAnalysis'
import type { MelodyAnalysis, RespondPhase } from './types'
import type { Progression } from '../progression/types'

export interface RespondEffects {
  /** Mute/unmute playback (grid keeps running). */
  mute(on: boolean): void
  /** Generate a response from the analysis and STAGE it at the next
   * boundary. Resolves when staged (null = failed/cancelled). */
  generateResponse(analysis: MelodyAnalysis): Promise<Progression | null>
  onPhaseChange?(phase: RespondPhase, engine: RespondEngine): void
}

export class RespondEngine {
  phase: RespondPhase = 'idle'
  phraseSteps = 2 * STEPS_PER_BAR
  repetitions = 2

  /** Steps into the capture window (UI progress); -1 outside listening. */
  progressSteps = -1
  repsLeft = 0
  lastAnalysis: MelodyAnalysis | null = null

  private capture = new PhraseCapture()
  private windowStart = -1 // absolute step of the window's first step
  private kicked = false
  private generationDone = false

  constructor(private effects: RespondEffects) {}

  private setPhase(p: RespondPhase): void {
    if (this.phase === p) return
    this.phase = p
    this.effects.onPhaseChange?.(p, this)
  }

  get engaged(): boolean {
    return this.phase !== 'idle' && this.phase !== 'ready'
  }

  /** Arm capture. Allowed from idle/ready — never mid-commitment. */
  newListen(): boolean {
    if (this.phase !== 'idle' && this.phase !== 'ready') return false
    this.capture.clear()
    this.windowStart = -1
    this.kicked = false
    this.generationDone = false
    this.progressSteps = -1
    this.setPhase('armed')
    return true
  }

  /** Abort listening/analysis; playback resumes as it was. */
  cancel(): void {
    this.capture.clear()
    this.progressSteps = -1
    if (this.phase === 'listening' || this.phase === 'armed' || this.phase === 'analyzing') {
      this.effects.mute(false)
    }
    this.setPhase('idle')
  }

  /** Phrase boundary from the player (fires with the wrap step). */
  onCycle(stepAbs: number): void {
    switch (this.phase) {
      case 'armed':
        this.windowStart = stepAbs
        this.progressSteps = 0
        this.effects.mute(true)
        this.setPhase('listening')
        break
      case 'listening':
        // Window closes exactly one cycle after it opened. In the normal
        // case the early-kicked response resolved DURING listening and was
        // staged, so the player already swapped to it before emitting this
        // cycle — unmute now and the answer starts on this very downbeat.
        this.closeWindow()
        if (this.generationDone) this.beginResponding()
        break
      case 'analyzing':
        // Fallback: generation missed the close boundary; its staged swap
        // lands here instead (one graceful muted cycle, never mid-phrase).
        if (this.generationDone) this.beginResponding()
        break
      case 'responding':
        this.repsLeft -= 1
        if (this.repsLeft <= 0) this.setPhase('ready') // response keeps playing
        break
      default:
        break
    }
  }

  /** Per-step tick (absolute take step) — drives progress + early kickoff. */
  onStep(stepAbs: number): void {
    if (this.phase !== 'listening' || this.windowStart < 0) return
    this.progressSteps = Math.min(this.phraseSteps, stepAbs - this.windowStart + 1)
    // Early kickoff: one bar before the close (clamped for short phrases),
    // from the notes played SO FAR — never ahead of what has been heard.
    const kickAt = this.windowStart + Math.max(this.phraseSteps - STEPS_PER_BAR, Math.ceil(this.phraseSteps / 2))
    if (!this.kicked && stepAbs >= kickAt) {
      this.kicked = true
      this.kickGeneration(this.peekAnalysis())
    }
  }

  noteOn(note: number, velocity: number, stepAbs: number, msWithin: number): void {
    if (this.phase !== 'armed' && this.phase !== 'listening') return
    this.capture.noteOn(note, velocity, stepAbs, msWithin)
  }

  noteOff(note: number, stepAbs: number, msWithin: number): void {
    if (this.phase !== 'armed' && this.phase !== 'listening') return
    this.capture.noteOff(note, stepAbs, msWithin)
  }

  /** Analysis of the notes played so far, without consuming the buffer. */
  private peekAnalysis(): MelodyAnalysis {
    return analyzeMelody(this.capture.snapshot(this.windowStart, this.phraseSteps), this.phraseSteps)
  }

  private beginResponding(): void {
    this.effects.mute(false)
    this.repsLeft = this.repetitions
    this.setPhase('responding')
  }

  private closeWindow(): void {
    const notes = this.capture.finalize(this.windowStart, this.phraseSteps)
    this.lastAnalysis = analyzeMelody(notes, this.phraseSteps)
    this.progressSteps = -1
    this.setPhase('analyzing')
    if (!this.kicked) {
      // Very short phrase or missed kick — generate now from the full take.
      this.kicked = true
      this.kickGeneration(this.lastAnalysis)
    } else {
      // The early kick used a partial analysis; keep the full one for the
      // explanation panel. (The harmonic response is committed as staged.)
    }
  }

  private kickGeneration(analysis: MelodyAnalysis): void {
    void this.effects.generateResponse(analysis).then((p) => {
      if (this.phase !== 'listening' && this.phase !== 'analyzing') return // cancelled
      if (p) {
        this.generationDone = true
        this.lastAnalysis = this.lastAnalysis ?? analysis
      } else if (this.phase === 'analyzing') {
        // Generation failed — resume prior playback rather than hang muted.
        this.effects.mute(false)
        this.setPhase('idle')
      }
    })
  }
}
