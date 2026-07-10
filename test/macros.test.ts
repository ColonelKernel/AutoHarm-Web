/** Macro mapping — ranges, monotonicity, endpoint behavior, V1-default
 * compatibility — and preset integrity. */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MACROS,
  mapMacrosToEngineParameters,
  NEURAL_TEMP_MAX,
  NEURAL_TEMP_MIN,
} from '../src/engine/macros/mapping'
import { PRESETS, presetById, surpriseMe, SURPRISE_ID } from '../src/engine/macros/presets'
import { mulberry32 } from '../src/engine/random'
import { rhythmToTemplate, DEFAULT_TEMPLATE_ID } from '../src/engine/player/templates'

const map = mapMacrosToEngineParameters

describe('macro mapping', () => {
  it('keeps every output in a valid range across the whole input cube', () => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      for (const t of [0, 0.5, 1]) {
        const p = map({ familiarity: f, harmonicColor: f, tension: t, motion: f })
        expect(p.color).toBeGreaterThanOrEqual(0)
        expect(p.color).toBeLessThanOrEqual(1)
        expect(p.adventure).toBeGreaterThanOrEqual(0)
        expect(p.adventure).toBeLessThanOrEqual(1)
        expect(p.gravity).toBeGreaterThanOrEqual(0)
        expect(p.gravity).toBeLessThanOrEqual(1)
        expect(p.color7th).toBeGreaterThanOrEqual(0)
        expect(p.color7th).toBeLessThanOrEqual(1)
        expect(p.neuralTemperature).toBeGreaterThanOrEqual(NEURAL_TEMP_MIN)
        expect(p.neuralTemperature).toBeLessThanOrEqual(NEURAL_TEMP_MAX)
      }
    }
  })

  it('is monotonic: familiarity raises adventure AND neural temperature', () => {
    let prevAdv = -1
    let prevTemp = -1
    for (let f = 0; f <= 1.001; f += 0.1) {
      const p = map({ ...DEFAULT_MACROS, familiarity: f })
      expect(p.adventure).toBeGreaterThanOrEqual(prevAdv)
      expect(p.neuralTemperature).toBeGreaterThanOrEqual(prevTemp)
      prevAdv = p.adventure
      prevTemp = p.neuralTemperature
    }
  })

  it('tension: gravity falls to 0 by the midpoint, sevenths rise past it', () => {
    let prevGravity = Infinity
    let prevSeventh = -1
    for (let t = 0; t <= 1.001; t += 0.1) {
      const p = map({ ...DEFAULT_MACROS, tension: t })
      expect(p.gravity).toBeLessThanOrEqual(prevGravity) // monotonic down
      expect(p.color7th).toBeGreaterThanOrEqual(prevSeventh) // monotonic up
      prevGravity = p.gravity
      prevSeventh = p.color7th
    }
    expect(map({ ...DEFAULT_MACROS, tension: 0 }).gravity).toBeCloseTo(0.7, 9)
    expect(map({ ...DEFAULT_MACROS, tension: 0.5 }).gravity).toBe(0)
    expect(map({ ...DEFAULT_MACROS, tension: 0.5 }).color7th).toBe(0)
    expect(map({ ...DEFAULT_MACROS, tension: 1 }).color7th).toBeCloseTo(0.7, 9)
  })

  it('the macro defaults reproduce the V1 default sound', () => {
    const p = map(DEFAULT_MACROS)
    expect(p.adventure).toBeCloseTo(0.35, 9) // V1 default adventure
    expect(p.color).toBeCloseTo(0.5, 9) // V1 default color
    expect(p.gravity).toBe(0) // V1 default gravity
    expect(p.color7th).toBe(0) // V1 default: no forced 7ths
    expect(rhythmToTemplate(p.rhythmDensity)).toBe(DEFAULT_TEMPLATE_ID) // half + half
  })

  it('motion maps straight onto rhythm density (never tempo)', () => {
    expect(rhythmToTemplate(map({ ...DEFAULT_MACROS, motion: 0 }).rhythmDensity)).toBe(1)
    expect(rhythmToTemplate(map({ ...DEFAULT_MACROS, motion: 1 }).rhythmDensity)).toBe(12)
  })

  it('clamps out-of-range macro input', () => {
    const p = map({ familiarity: 7, harmonicColor: -2, tension: 9, motion: -1 })
    expect(p.adventure).toBe(1)
    expect(p.color).toBe(0)
    expect(p.color7th).toBeCloseTo(0.7, 9)
    expect(p.rhythmDensity).toBe(0)
  })
})

describe('presets', () => {
  it('all presets carry in-range macros and unique ids', () => {
    const ids = new Set<string>()
    for (const p of PRESETS) {
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      for (const v of Object.values(p.macros)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      expect(p.description.length).toBeGreaterThan(10)
    }
    expect(PRESETS.length).toBe(7)
  })

  it('never changes the key root; keyMode only where declared', () => {
    for (const p of PRESETS) {
      expect((p.overrides as Record<string, unknown> | undefined)?.keyRoot).toBeUndefined()
    }
  })

  it('surpriseMe stays within bounds and derives from a real family', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = surpriseMe(mulberry32(seed))
      expect(s.id).toBe(SURPRISE_ID)
      for (const v of Object.values(s.macros)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      expect(s.description).toContain('twist')
    }
  })

  it('presetById round-trips and rejects unknowns', () => {
    expect(presetById('warm-neosoul')?.name).toBe('Warm Neo-Soul')
    expect(presetById('nope')).toBeNull()
  })
})
