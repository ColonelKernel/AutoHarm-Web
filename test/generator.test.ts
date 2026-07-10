/** Offline progression generator — chain walk, locked pass-through,
 * cancellation, and error degradation. */

import { describe, expect, it } from 'vitest'
import { generateProgression, chainTail } from '../src/engine/progression/generator'
import { makeProgression, makeSlot } from '../src/engine/progression/types'
import { Emitter } from '../src/engine/events'

/** Deterministic sampler: C -> G7 -> Am -> F -> C ... */
class MockSampler {
  calls: string[] = []
  chain: Record<string, string> = {
    'C:maj': 'G:7',
    'G:7': 'A:min',
    'A:min': 'F:maj',
    'F:maj': 'C:maj',
  }
  sample(chord: string) {
    this.calls.push(chord)
    return { output: this.chain[chord] ?? 'C:maj', probability: 0.5 }
  }
}

describe('generateProgression', () => {
  it('walks the chain across the onsets with correct durations', async () => {
    const s = new MockSampler()
    const p = await generateProgression(s, { seed: 'C:maj', onsets: [0, 4, 8, 12], totalSteps: 16 })
    expect(p).not.toBeNull()
    expect(p!.slots.map((x) => x.symbol)).toEqual(['G:7', 'A:min', 'F:maj', 'C:maj'])
    expect(p!.slots.every((x) => x.durationSteps === 4)).toBe(true)
    expect(p!.totalSteps).toBe(16)
    expect(s.calls).toEqual(['C:maj', 'G:7', 'A:min', 'F:maj']) // serial chain
    expect(p!.slots[0].source).toBe('generated')
    expect(p!.slots[0].explanation?.prior).toBe(0.5)
  })

  it('sustains the last slot to the phrase end', async () => {
    const p = await generateProgression(new MockSampler(), { seed: 'C:maj', onsets: [0, 6], totalSteps: 16 })
    expect(p!.slots.map((x) => x.durationSteps)).toEqual([6, 10])
  })

  it('locked slots pass through by order and steer the chain', async () => {
    const s = new MockSampler()
    const prior = makeProgression([
      makeSlot('C:maj', 4, 'generated'),
      makeSlot('E:min7', 4, 'manual', { locked: true }),
      makeSlot('G:7', 4, 'generated'),
      makeSlot('C:maj', 4, 'generated', { locked: true }),
    ])
    const p = await generateProgression(s, { seed: 'C:maj', onsets: [0, 4, 8, 12], totalSteps: 16, prior })
    expect(p!.slots[1].symbol).toBe('E:min7') // locked survives
    expect(p!.slots[1].locked).toBe(true)
    expect(p!.slots[1].id).toBe(prior.slots[1].id) // identity preserved
    expect(p!.slots[3].symbol).toBe('C:maj')
    // Slot 2's input was the locked chord, not the previous generated output.
    expect(s.calls[1]).toBe('E:min7')
  })

  it('degrades by repeating the chain input on sampler error', async () => {
    const bad = { sample: () => ({ output: null, error: 'model detonated' }) }
    const em = new Emitter()
    const errors: string[] = []
    em.on((e) => e.type === 'error' && errors.push(e.code))
    const p = await generateProgression(bad, { seed: 'D:min', onsets: [0, 8], totalSteps: 16 }, em)
    expect(p!.slots.map((x) => x.symbol)).toEqual(['D:min', 'D:min'])
    expect(errors.length).toBe(2)
  })

  it('aborts between samples when cancelled', async () => {
    const s = new MockSampler()
    let cancelled = false
    const p = generateProgression(s, {
      seed: 'C:maj',
      onsets: [0, 4, 8, 12],
      totalSteps: 16,
      isCancelled: () => cancelled,
    })
    cancelled = true // flips before the first await resolves
    expect(await p).toBeNull()
    expect(s.calls.length).toBeLessThan(4)
  })

  it('emits output + progress events during the walk', async () => {
    const em = new Emitter()
    const types: string[] = []
    em.on((e) => types.push(e.type))
    await generateProgression(new MockSampler(), { seed: 'C:maj', onsets: [0, 8], totalSteps: 16 }, em)
    expect(types.filter((t) => t === 'output').length).toBe(2)
    expect(types.filter((t) => t === 'genProgress').length).toBe(2)
  })
})

describe('chainTail', () => {
  it('returns the last slot symbol, or the fallback when empty', () => {
    const p = makeProgression([makeSlot('C:maj', 8, 'generated'), makeSlot('G:7', 8, 'generated')])
    expect(chainTail(p, 'X')).toBe('G:7')
    expect(chainTail(null, 'X')).toBe('X')
    expect(chainTail(makeProgression([]), 'X')).toBe('X')
  })
})
