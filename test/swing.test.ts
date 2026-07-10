/** Swing math — the delay applied to each 16th-note step.
 *
 * The load-bearing property is MONOTONICITY: a swung step can never overtake
 * the following step, at any swing amount. If it could, chords would sound out
 * of order and the MIDI note-off / note-on pairing in io/midi.ts would invert.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_RATIO,
  STRAIGHT_RATIO,
  SWING_UNITS,
  pairSteps,
  swingDelaySteps,
  swingLabel,
  swingRatio,
  type SwingUnit,
} from '../src/engine/player/swing'

const bar = (amount: number, unit: SwingUnit) =>
  Array.from({ length: 16 }, (_, i) => swingDelaySteps(i, amount, unit))

describe('swingRatio', () => {
  it('maps the dial onto 50% .. 75%', () => {
    expect(swingRatio(0)).toBe(STRAIGHT_RATIO)
    expect(swingRatio(1)).toBe(MAX_RATIO)
    expect(swingRatio(2 / 3)).toBeCloseTo(2 / 3, 10) // triplet feel sits at 2/3 of the dial
  })

  it('clamps out-of-range and non-finite input to straight', () => {
    expect(swingRatio(-1)).toBe(STRAIGHT_RATIO)
    expect(swingRatio(5)).toBe(MAX_RATIO)
    expect(swingRatio(NaN)).toBe(STRAIGHT_RATIO)
  })
})

describe('swingDelaySteps', () => {
  it('is a no-op at zero swing (bit-identical straight time)', () => {
    for (const unit of SWING_UNITS) {
      expect(bar(0, unit).every((d) => d === 0)).toBe(true)
    }
  })

  it("8th swing delays only the offbeat 8ths (step % 4 === 2)", () => {
    const d = bar(1, '8th')
    expect(d.filter((x) => x > 0).length).toBe(4)
    expect([2, 6, 10, 14].every((i) => d[i] > 0)).toBe(true)
    expect([0, 1, 3, 4, 5, 7].every((i) => d[i] === 0)).toBe(true)
  })

  it('16th swing delays every odd 16th', () => {
    const d = bar(1, '16th')
    expect(d.filter((x) => x > 0).length).toBe(8)
    expect(d.every((x, i) => (i % 2 === 1 ? x > 0 : x === 0))).toBe(true)
  })

  it('places the triplet offbeat two-thirds through its pair', () => {
    // 8th swing: the pair is one beat (4 steps); the offbeat moves 2 -> 2.667.
    expect(2 + swingDelaySteps(2, 2 / 3, '8th')).toBeCloseTo(8 / 3, 10)
    // 16th swing: the pair is one 8th (2 steps); the odd 16th moves 1 -> 1.333.
    expect(1 + swingDelaySteps(1, 2 / 3, '16th')).toBeCloseTo(4 / 3, 10)
  })

  it('never delays a beat — beats stay anchored to the grid', () => {
    for (const unit of SWING_UNITS) {
      for (const amount of [0.25, 0.5, 1]) {
        for (const beat of [0, 4, 8, 12]) expect(swingDelaySteps(beat, amount, unit)).toBe(0)
      }
    }
  })

  it('caps the delay at the next on-subdivision (max ratio = hard shuffle)', () => {
    expect(swingDelaySteps(2, 1, '8th')).toBeCloseTo(pairSteps('8th') / 4, 10) // 1 step
    expect(swingDelaySteps(1, 1, '16th')).toBeCloseTo(pairSteps('16th') / 4, 10) // 0.5 steps
  })

  it('keeps swung step times non-decreasing at every amount (no reordering)', () => {
    for (const unit of SWING_UNITS) {
      for (const amount of [0, 0.1, 0.33, 2 / 3, 0.9, 1]) {
        const times = Array.from({ length: 64 }, (_, i) => i + swingDelaySteps(i, amount, unit))
        for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1])
      }
    }
  })

  it('is periodic, so a wrapped phrase keeps the same feel', () => {
    for (const unit of SWING_UNITS) {
      for (let i = 0; i < 32; i++) {
        expect(swingDelaySteps(i + 16, 0.7, unit)).toBe(swingDelaySteps(i, 0.7, unit))
      }
    }
  })
})

describe('swingLabel', () => {
  it('reads as straight until the ratio actually leaves 50%', () => {
    expect(swingLabel(0)).toBe('straight')
    expect(swingLabel(0.01)).toBe('straight') // 50.25% rounds back to 50
  })

  it('names the triplet and shows a percentage otherwise', () => {
    expect(swingLabel(2 / 3)).toBe('67% · triplet')
    expect(swingLabel(1)).toBe('75%')
    expect(swingLabel(0.5)).toBe('63%')
  })
})
