/** Bounded undo/redo for progression edits.
 *
 * Snapshot-based: operations are immutable, so history is just references.
 * Only meaningful progression edits belong here (generation, variation,
 * symbol/duration/lock changes, reorder, insert, delete) — never transport
 * or transient IO state. A new edit clears the redo branch.
 */

import type { Progression } from './types'

export class ProgressionHistory {
  private past: Progression[] = []
  private future: Progression[] = []

  constructor(private readonly limit = 100) {}

  /** Record the state that is ABOUT to be replaced by an edit. */
  push(state: Progression): void {
    this.past.push(state)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Step back; `current` moves onto the redo stack. Null when empty. */
  undo(current: Progression): Progression | null {
    const prev = this.past.pop()
    if (!prev) return null
    this.future.push(current)
    return prev
  }

  /** Step forward; `current` moves back onto the undo stack. Null when empty. */
  redo(current: Progression): Progression | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(current)
    return next
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
