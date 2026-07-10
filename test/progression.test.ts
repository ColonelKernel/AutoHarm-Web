/** Progression domain — pure edit operations. Every op is immutable (input
 * untouched), invalid ops return the input unchanged, and the totalSteps
 * invariant (= sum of durations) survives every edit. */

import { describe, expect, it } from 'vitest'
import { makeProgression, makeSlot, type Progression } from '../src/engine/progression/types'
import {
  compilePlan,
  duplicate,
  insertAfter,
  move,
  remove,
  replaceSymbol,
  setDuration,
  slotAtStep,
  toggleLock,
} from '../src/engine/progression/operations'

/** C | Am | F | G, one bar (16 steps) each. */
function fourChords(): Progression {
  return makeProgression([
    makeSlot('C:maj', 16, 'generated'),
    makeSlot('A:min', 16, 'generated'),
    makeSlot('F:maj', 16, 'generated'),
    makeSlot('G:maj', 16, 'generated'),
  ])
}

const symbols = (p: Progression) => p.slots.map((s) => s.symbol)
const invariantHolds = (p: Progression) =>
  p.totalSteps === p.slots.reduce((n, s) => n + s.durationSteps, 0)

describe('replaceSymbol', () => {
  it('replaces the chord, marks the slot manual, drops stale explanation', () => {
    const p = makeProgression([
      makeSlot('C:maj', 16, 'generated', { explanation: { reasons: ['x'] } }),
    ])
    const q = replaceSymbol(p, p.slots[0].id, 'D:min7')
    expect(q.slots[0].symbol).toBe('D:min7')
    expect(q.slots[0].source).toBe('manual')
    expect(q.slots[0].explanation).toBeUndefined()
    expect(p.slots[0].symbol).toBe('C:maj') // input untouched
  })

  it('ignores unknown ids and empty symbols', () => {
    const p = fourChords()
    expect(replaceSymbol(p, 'nope', 'D:min')).toBe(p)
    expect(replaceSymbol(p, p.slots[0].id, '   ')).toBe(p)
  })
})

describe('toggleLock', () => {
  it('flips lock without touching anything else', () => {
    const p = fourChords()
    const q = toggleLock(p, p.slots[2].id)
    expect(q.slots[2].locked).toBe(true)
    expect(toggleLock(q, q.slots[2].id).slots[2].locked).toBe(false)
    expect(q.slots[2].symbol).toBe('F:maj')
    expect(p.slots[2].locked).toBe(false)
  })
})

describe('setDuration', () => {
  it('changes duration and the total length with it', () => {
    const p = fourChords()
    const q = setDuration(p, p.slots[1].id, 8)
    expect(q.slots[1].durationSteps).toBe(8)
    expect(q.totalSteps).toBe(56)
    expect(invariantHolds(q)).toBe(true)
  })

  it('rejects sub-1 and non-finite durations', () => {
    const p = fourChords()
    expect(setDuration(p, p.slots[0].id, 0)).toBe(p)
    expect(setDuration(p, p.slots[0].id, NaN)).toBe(p)
  })
})

describe('move (accessible reorder)', () => {
  it('moves a slot left and right', () => {
    const p = fourChords()
    expect(symbols(move(p, p.slots[2].id, -1))).toEqual(['C:maj', 'F:maj', 'A:min', 'G:maj'])
    expect(symbols(move(p, p.slots[2].id, 1))).toEqual(['C:maj', 'A:min', 'G:maj', 'F:maj'])
  })

  it('is a no-op at the edges', () => {
    const p = fourChords()
    expect(move(p, p.slots[0].id, -1)).toBe(p)
    expect(move(p, p.slots[3].id, 1)).toBe(p)
  })
})

describe('insert / remove / duplicate', () => {
  it('inserts after an anchor and at the start', () => {
    const p = fourChords()
    const q = insertAfter(p, p.slots[0].id, makeSlot('E:min', 16, 'manual'))
    expect(symbols(q)).toEqual(['C:maj', 'E:min', 'A:min', 'F:maj', 'G:maj'])
    expect(q.totalSteps).toBe(80)
    const r = insertAfter(p, null, makeSlot('D:7', 8, 'manual'))
    expect(symbols(r)[0]).toBe('D:7')
    expect(invariantHolds(r)).toBe(true)
  })

  it('removes a slot but never the last one', () => {
    const p = fourChords()
    const q = remove(p, p.slots[1].id)
    expect(symbols(q)).toEqual(['C:maj', 'F:maj', 'G:maj'])
    expect(q.totalSteps).toBe(48)
    let solo = makeProgression([makeSlot('C:maj', 16, 'generated')])
    expect(remove(solo, solo.slots[0].id)).toBe(solo)
  })

  it('duplicates with a fresh id and cleared lock', () => {
    const p = toggleLock(fourChords(), fourChords().slots[0].id) // lock nothing real; build locked slot directly
    const locked = makeProgression([makeSlot('C:maj', 16, 'generated', { locked: true })])
    const q = duplicate(locked, locked.slots[0].id)
    expect(symbols(q)).toEqual(['C:maj', 'C:maj'])
    expect(q.slots[1].id).not.toBe(q.slots[0].id)
    expect(q.slots[1].locked).toBe(false)
    expect(q.totalSteps).toBe(32)
    expect(p.totalSteps).toBe(64) // sanity: unrelated progression untouched
  })
})

describe('compilePlan / slotAtStep', () => {
  it('places onsets at cumulative durations', () => {
    const p = makeProgression([
      makeSlot('C:maj', 8, 'generated'),
      makeSlot('F:maj', 4, 'generated'),
      makeSlot('G:7', 4, 'generated'),
    ])
    const plan = compilePlan(p)
    expect(plan.onsetSteps).toEqual([0, 8, 12])
    expect(plan.totalSteps).toBe(16)
    expect(plan.onsetToSlot.get(8)).toBe(1)
    expect(plan.onsetToSlot.get(9)).toBeUndefined()
  })

  it('finds the sounding slot between onsets', () => {
    const p = makeProgression([
      makeSlot('C:maj', 8, 'generated'),
      makeSlot('F:maj', 8, 'generated'),
    ])
    const plan = compilePlan(p)
    expect(slotAtStep(plan, p, 0)?.symbol).toBe('C:maj')
    expect(slotAtStep(plan, p, 7)?.symbol).toBe('C:maj')
    expect(slotAtStep(plan, p, 8)?.symbol).toBe('F:maj')
    expect(slotAtStep(plan, p, 15)?.symbol).toBe('F:maj')
  })
})
