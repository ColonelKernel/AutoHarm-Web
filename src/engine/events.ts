/** Typed event emitter — replaces Max.outlet in the ported player code. */

import type { Progression } from './progression/types'
import type { RespondPhase } from './respond/types'

export type PlayerEvent =
  | { type: 'status'; value: string }
  | { type: 'output'; symbol: string }
  | { type: 'chord'; symbol: string; at?: number }
  | { type: 'notes'; notes: number[]; velocity: number; at?: number }
  | { type: 'stop'; at?: number }
  | { type: 'playoff' }
  | { type: 'error'; code: string; detail?: string }
  | { type: 'notice'; message: string } // non-fatal, user-facing consequence
  | { type: 'readout'; key: string; value: string | number }
  | { type: 'tempo'; bpm: number } // external MIDI-clock tempo estimate
  | { type: 'log'; message: string }
  // V2 progression playback
  | { type: 'cycle'; index: number; step: number; at?: number } // phrase wrapped
  | { type: 'slotOnset'; slotId: string; at?: number } // a slot's chord struck
  // Once per beat (not per step) — cheap enough to drive a phrase-position UI.
  | { type: 'beat'; posSteps: number; totalSteps: number; cycleIndex: number }
  // `origin: 'auto'` = the machine replaced the progression during playback
  // (regen variation, a Respond answer). Those must not enter undo history.
  | { type: 'progressionApplied'; progression: Progression; origin: 'user' | 'auto' }
  | { type: 'staged'; pending: boolean } // a variation is queued for the boundary
  | { type: 'genProgress'; done: number; total: number } // offline generation
  | { type: 'respond'; phase: RespondPhase; progress: number; repsLeft: number }

export type PlayerEventListener = (e: PlayerEvent) => void

export class Emitter {
  private listeners = new Set<PlayerEventListener>()

  on(fn: PlayerEventListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(e: PlayerEvent): void {
    for (const fn of this.listeners) fn(e)
  }
}
