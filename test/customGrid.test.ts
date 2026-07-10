/** Custom rhythm grid — invariants and operations. */

import { describe, expect, it } from 'vitest'
import { CUSTOM_NAME, isCustom, randomize, rotate, toggleOnset } from '../src/engine/rhythm/customGrid'
import { TEMPLATES, tileOnsets } from '../src/engine/player/templates'
import { mulberry32 } from '../src/engine/random'

describe('toggleOnset', () => {
  it('adds and removes onsets, marking the pattern custom', () => {
    const p1 = toggleOnset(TEMPLATES[3], 4) // half+half + beat 2
    expect(p1.onsets).toEqual([0, 4, 8])
    expect(p1.name).toBe(CUSTOM_NAME)
    const p2 = toggleOnset(p1, 8)
    expect(p2.onsets).toEqual([0, 4])
  })

  it('refuses to remove the last onset (>=1 invariant)', () => {
    const solo = { name: CUSTOM_NAME, spanBars: 1, onsets: [5] }
    expect(toggleOnset(solo, 5)).toBe(solo)
  })

  it('ignores out-of-range steps', () => {
    expect(toggleOnset(TEMPLATES[3], 16)).toBe(TEMPLATES[3])
    expect(toggleOnset(TEMPLATES[3], -1)).toBe(TEMPLATES[3])
  })
})

describe('rotate', () => {
  it('rotates with wrap in both directions', () => {
    const p = { name: CUSTOM_NAME, spanBars: 1, onsets: [0, 8] }
    expect(rotate(p, 1).onsets).toEqual([1, 9])
    expect(rotate(p, -1).onsets).toEqual([7, 15]) // 0 wraps to 15
  })

  it('round-trips left-then-right', () => {
    const p = { name: CUSTOM_NAME, spanBars: 1, onsets: [2, 6, 10, 14] }
    expect(rotate(rotate(p, 1), -1).onsets).toEqual(p.onsets)
  })
})

describe('randomize', () => {
  it('is bounded: 3..6 onsets, always includes the downbeat, in range', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const p = randomize(mulberry32(seed))
      expect(p.onsets.length).toBeGreaterThanOrEqual(3)
      expect(p.onsets.length).toBeLessThanOrEqual(6)
      expect(p.onsets[0]).toBe(0)
      expect(p.onsets.every((o) => o >= 0 && o < 16)).toBe(true)
      expect(isCustom(p)).toBe(true)
    }
  })

  it('is deterministic under a seed', () => {
    expect(randomize(mulberry32(7)).onsets).toEqual(randomize(mulberry32(7)).onsets)
  })
})

describe('playback parity', () => {
  it('an edited grid tiles into generation onsets exactly like a template', () => {
    const p = toggleOnset(TEMPLATES[3], 12)
    expect(tileOnsets(p, 32)).toEqual([0, 8, 12, 16, 24, 28])
  })
})
