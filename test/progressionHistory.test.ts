/** Bounded undo/redo for progression edits. */

import { describe, expect, it } from 'vitest'
import { ProgressionHistory } from '../src/engine/progression/history'
import { makeProgression, makeSlot, type Progression } from '../src/engine/progression/types'
import { replaceSymbol } from '../src/engine/progression/operations'

const prog = (symbol: string): Progression => makeProgression([makeSlot(symbol, 16, 'manual')])

describe('ProgressionHistory', () => {
  it('undoes and redoes an edit', () => {
    const h = new ProgressionHistory()
    const a = prog('C:maj')
    const b = replaceSymbol(a, a.slots[0].id, 'F:maj')
    h.push(a) // record pre-edit state
    expect(h.canUndo).toBe(true)

    const undone = h.undo(b)
    expect(undone?.slots[0].symbol).toBe('C:maj')
    expect(h.canRedo).toBe(true)

    const redone = h.redo(undone!)
    expect(redone?.slots[0].symbol).toBe('F:maj')
  })

  it('a new edit clears the redo branch', () => {
    const h = new ProgressionHistory()
    const a = prog('C:maj')
    const b = prog('F:maj')
    h.push(a)
    const undone = h.undo(b)! // redo stack now holds b
    h.push(undone) // new edit from the undone state
    expect(h.canRedo).toBe(false)
    expect(h.redo(prog('X'))).toBeNull()
  })

  it('undo/redo on empty stacks return null', () => {
    const h = new ProgressionHistory()
    expect(h.undo(prog('C:maj'))).toBeNull()
    expect(h.redo(prog('C:maj'))).toBeNull()
  })

  it('is bounded: oldest snapshots fall off', () => {
    const h = new ProgressionHistory(3)
    const states = ['a', 'b', 'c', 'd', 'e'].map(prog)
    for (const s of states) h.push(s)
    // Only the 3 most recent (c, d, e) survive.
    let cur = prog('now')
    const recovered: string[] = []
    for (let i = 0; i < 5; i++) {
      const u = h.undo(cur)
      if (!u) break
      recovered.push(u.slots[0].symbol)
      cur = u
    }
    expect(recovered).toEqual(['e:16', 'd:16', 'c:16'].map((s) => s.split(':')[0]))
  })

  it('clear() empties both stacks', () => {
    const h = new ProgressionHistory()
    h.push(prog('C:maj'))
    h.undo(prog('F:maj'))
    h.clear()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })
})
