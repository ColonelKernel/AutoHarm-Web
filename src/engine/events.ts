/** Typed event emitter — replaces Max.outlet in the ported player code. */

export type PlayerEvent =
  | { type: 'status'; value: string }
  | { type: 'output'; symbol: string }
  | { type: 'chord'; symbol: string; at?: number }
  | { type: 'notes'; notes: number[]; velocity: number; at?: number }
  | { type: 'stop'; at?: number }
  | { type: 'playoff' }
  | { type: 'error'; code: string; detail?: string }
  | { type: 'readout'; key: string; value: string | number }
  | { type: 'log'; message: string }

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
