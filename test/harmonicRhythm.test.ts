/** Generated harmonic rhythm — structural invariants, density response,
 * groove coherence, and cadential broadening. */

import { describe, expect, it } from 'vitest'
import { generateHarmonicRhythm } from '../src/engine/rhythm/harmonicRhythm'
import { RHYTHM_ORDER, STEPS_PER_BAR, TEMPLATES } from '../src/engine/player/templates'
import { mulberry32 } from '../src/engine/random'

const gen = (seed: number, templateId: number, totalSteps: number) =>
  generateHarmonicRhythm(mulberry32(seed), { templateId, totalSteps })

describe('structural invariants (all seeds, all feels)', () => {
  it('always starts at 0, ascending, unique, in range, on the 16th grid', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const id of [1, 3, 6, 12]) {
        const onsets = gen(seed, id, 64)
        expect(onsets[0]).toBe(0)
        for (let i = 1; i < onsets.length; i++) {
          expect(onsets[i]).toBeGreaterThan(onsets[i - 1])
          expect(onsets[i]).toBeLessThan(64)
          expect(Number.isInteger(onsets[i])).toBe(true)
        }
      }
    }
  })

  it('is deterministic under a seed and varies across seeds', () => {
    expect(gen(7, 3, 64)).toEqual(gen(7, 3, 64))
    const distinct = new Set([1, 2, 3, 4, 5, 6].map((s) => gen(s, 3, 64).join(',')))
    expect(distinct.size).toBeGreaterThan(1) // fresh rhythm per generation
  })

  it('every onset comes from the curated pattern vocabulary (bar-relative)', () => {
    const legal = new Set<number>()
    for (const id of RHYTHM_ORDER) {
      for (const o of TEMPLATES[id].onsets) legal.add(o % STEPS_PER_BAR)
    }
    for (let seed = 1; seed <= 25; seed++) {
      for (const step of gen(seed, 6, 64)) {
        expect(legal.has(step % STEPS_PER_BAR)).toBe(true)
      }
    }
  })

  it('handles fractional-bar phrases (1/2 bar) without escaping the window', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const onsets = gen(seed, 6, 8)
      expect(onsets[0]).toBe(0)
      expect(onsets.every((o) => o < 8)).toBe(true)
    }
  })
})

describe('musical shaping', () => {
  const density = (onsets: number[], totalSteps: number) => onsets.length / (totalSteps / STEPS_PER_BAR)

  it('density follows the selected feel (sparse feel -> fewer changes)', () => {
    let sparse = 0
    let dense = 0
    for (let seed = 1; seed <= 30; seed++) {
      sparse += density(gen(seed, 2, 128), 128) // whole-note feel
      dense += density(gen(seed, 11, 128), 128) // eighth-note feel
    }
    expect(dense / 30).toBeGreaterThan((sparse / 30) * 2)
  })

  it('the final bar broadens: on average fewer onsets than the mid bars', () => {
    let finalCount = 0
    let midCount = 0
    const bars = 8
    for (let seed = 1; seed <= 60; seed++) {
      const onsets = gen(seed, 6, bars * STEPS_PER_BAR) // quarters feel
      const inBar = (b: number) => onsets.filter((o) => o >= b * 16 && o < (b + 1) * 16).length
      finalCount += inBar(bars - 1)
      midCount += (inBar(2) + inBar(3) + inBar(4)) / 3
    }
    expect(finalCount / 60).toBeLessThan(midCount / 60)
  })

  it('grooves cohere: adjacent bars repeat their pattern more often than not', () => {
    let repeats = 0
    let pairs = 0
    for (let seed = 1; seed <= 40; seed++) {
      const onsets = gen(seed, 6, 128)
      const barPattern = (b: number) =>
        onsets.filter((o) => o >= b * 16 && o < (b + 1) * 16).map((o) => o % 16).join(',')
      for (let b = 0; b < 6; b++) {
        pairs++
        if (barPattern(b) === barPattern(b + 1)) repeats++
      }
    }
    expect(repeats / pairs).toBeGreaterThan(0.35) // well above independent draws
  })
})
