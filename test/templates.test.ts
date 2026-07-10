/** Rhythm template + grid math (V2: generation-density presets). */

import { describe, expect, it } from 'vitest'
import {
  TEMPLATES,
  RHYTHM_ORDER,
  isSlotOnset,
  rhythmToTemplate,
  tileOnsets,
  templateCycleSteps,
} from '../src/engine/player/templates'

describe('templates', () => {
  it('places onsets on the 16th-note grid', () => {
    // 'half + half' = onsets on beats 1 and 3 (steps 0 and 8).
    expect(TEMPLATES[3].onsets).toEqual([0, 8])
    expect(isSlotOnset(3, 0)).toBe(true)
    expect(isSlotOnset(3, 4)).toBe(false)
    expect(isSlotOnset(3, 8)).toBe(true)
    // 'quarters' = a chord on every beat.
    expect(TEMPLATES[6].onsets).toEqual([0, 4, 8, 12])
    // 'offbeats' = all the "ands" — genuine syncopation.
    expect(TEMPLATES[8].onsets).toEqual([2, 6, 10, 14])
    expect(isSlotOnset(8, 0)).toBe(false)
    expect(isSlotOnset(8, 2)).toBe(true)
    // 'static (2 bars)' spans 32 steps with a single onset.
    expect(TEMPLATES[1].spanBars).toBe(2)
    expect(templateCycleSteps(1)).toBe(32)
    expect(isSlotOnset(1, 16)).toBe(false)
  })

  it('rhythm dial sweeps sparse -> dense', () => {
    expect(rhythmToTemplate(0)).toBe(RHYTHM_ORDER[0]) // static — sparsest
    expect(rhythmToTemplate(1)).toBe(RHYTHM_ORDER[RHYTHM_ORDER.length - 1]) // sixteenths
  })
})

describe('tileOnsets', () => {
  it('tiles a 1-bar pattern across the phrase', () => {
    expect(tileOnsets(TEMPLATES[3], 32)).toEqual([0, 8, 16, 24])
    expect(tileOnsets(TEMPLATES[6], 16)).toEqual([0, 4, 8, 12])
  })

  it('tiles a 2-bar pattern and truncates at the phrase end', () => {
    expect(tileOnsets(TEMPLATES[9], 32)).toEqual([0, 6, 12, 20, 24])
    expect(tileOnsets(TEMPLATES[9], 16)).toEqual([0, 6, 12]) // half the clave
  })

  it('always includes step 0 so the phrase sounds from the top', () => {
    expect(tileOnsets(TEMPLATES[8], 16)[0]).toBe(0) // offbeats start at step 2
    expect(tileOnsets(TEMPLATES[8], 16)).toEqual([0, 2, 6, 10, 14])
  })

  it('handles fractional-bar phrases (1/2 bar = 8 steps)', () => {
    expect(tileOnsets(TEMPLATES[6], 8)).toEqual([0, 4])
    expect(tileOnsets(TEMPLATES[2], 8)).toEqual([0]) // whole note clipped
  })
})
