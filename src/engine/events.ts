/** Typed event emitter — replaces Max.outlet in the ported player code. */

import type { Progression } from './progression/types'

export type PlayerEvent =
  | { type: 'status'; value: string }
  | { type: 'output'; symbol: string }
  | { type: 'chord'; symbol: string; at?: number }
  | { type: 'notes'; notes: number[]; velocity: number; at?: number }
  | { type: 'stop'; at?: number }
  | { type: 'playoff' }
  | { type: 'error'; code: string; detail?: string }
  | { type: 'readout'; key: string; value: string | number }
  | { type: 'tempo'; bpm: number } // external MIDI-clock tempo estimate
  | { type: 'log'; message: string }
  // V2 progression playback
  | { type: 'cycle'; index: number; step: number; at?: number } // phrase wrapped
  | { type: 'slotOnset'; slotId: string; at?: number } // a slot's chord struck
  | { type: 'progressionApplied'; progression: Progression } // staged swap landed
  | { type: 'staged'; pending: boolean } // a variation is queued for the boundary
  | { type: 'genProgress'; done: number; total: number } // offline generation

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
