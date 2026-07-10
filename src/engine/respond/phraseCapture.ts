/** Phrase capture — pairing raw note on/off events on the step grid.
 *
 * Handles overlapping notes (same pitch retriggered while held), notes held
 * across the window close (synthesized offs), and a half-step grace before
 * the window start (early pickup notes snap to step 0).
 */

import type { CapturedNote } from './types'

export class PhraseCapture {
  private notes: CapturedNote[] = []
  private open = new Map<number, CapturedNote>()

  clear(): void {
    this.notes = []
    this.open.clear()
  }

  noteOn(note: number, velocity: number, step: number, msWithin: number): void {
    // Retrigger of a held pitch: close the old instance at the new onset.
    const held = this.open.get(note)
    if (held) {
      held.offStep = step
      held.offMs = msWithin
      this.open.delete(note)
    }
    const ev: CapturedNote = { note, velocity, onStep: step, onMs: msWithin, offStep: null, offMs: 0 }
    this.notes.push(ev)
    this.open.set(note, ev)
  }

  noteOff(note: number, step: number, msWithin: number): void {
    const held = this.open.get(note)
    if (!held) return // off without on (started before capture) — ignore
    held.offStep = step
    held.offMs = msWithin
    this.open.delete(note)
  }

  /**
   * View the window [startStep, startStep + phraseSteps) WITHOUT consuming
   * the buffer: rebase to window-relative steps, snap one-step-early pickups
   * to 0, drop notes outside the window, clip durations to the window end,
   * and synthesize note-offs for anything still held.
   */
  snapshot(startStep: number, phraseSteps: number): CapturedNote[] {
    const out: CapturedNote[] = []
    for (const n of this.notes) {
      let on = n.onStep - startStep
      if (on === -1) on = 0 // grace: up to one step early counts as the downbeat
      if (on < 0 || on >= phraseSteps) continue
      let offStep = n.offStep === null ? null : n.offStep - startStep
      let offMs = n.offMs
      if (offStep === null || offStep >= phraseSteps) {
        offStep = phraseSteps // clip / synthesize the off at the window close
        offMs = 0
      }
      if (offStep < on || (offStep === on && offMs <= n.onMs)) offStep = on + 1 // never zero-length
      out.push({ ...n, onStep: on, offStep, offMs })
    }
    return out
  }

  /** Close the window: snapshot, then clear the buffer. */
  finalize(startStep: number, phraseSteps: number): CapturedNote[] {
    const out = this.snapshot(startStep, phraseSteps)
    this.clear()
    return out
  }
}
