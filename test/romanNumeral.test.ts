/** Roman-numeral analysis — representative major and minor key cases. */

import { describe, expect, it } from 'vitest'
import { romanNumeral } from '../src/engine/theory/romanNumeral'

const rn = (symbol: string, key: string) => romanNumeral(symbol, key)

describe('major keys', () => {
  it('diatonic triads in C major', () => {
    expect(rn('C:maj', 'C:maj')?.numeral).toBe('I')
    expect(rn('D:min', 'C:maj')?.numeral).toBe('ii')
    expect(rn('E:min', 'C:maj')?.numeral).toBe('iii')
    expect(rn('F:maj', 'C:maj')?.numeral).toBe('IV')
    expect(rn('G:maj', 'C:maj')?.numeral).toBe('V')
    expect(rn('A:min', 'C:maj')?.numeral).toBe('vi')
  })

  it('sevenths and functions', () => {
    const v7 = rn('G:7', 'C:maj')!
    expect(v7.numeral).toBe('V7')
    expect(v7.degreeLabel).toBe('Dominant')
    expect(v7.func).toBe('dominant')
    expect(rn('C:maj7', 'C:maj')?.numeral).toBe('Imaj7')
    expect(rn('D:min7', 'C:maj')?.numeral).toBe('ii7')
    expect(rn('B:hdim7', 'C:maj')?.numeral).toBe('viiø7')
  })

  it('non-diatonic roots get accidentals and read as chromatic', () => {
    const bVII = rn('Bb:maj', 'C:maj')!
    expect(bVII.numeral).toBe('bVII')
    expect(bVII.diatonic).toBe(false)
    expect(bVII.degreeLabel).toBe('Chromatic')
    expect(rn('Eb:maj', 'C:maj')?.numeral).toBe('bIII')
    expect(rn('F#:dim', 'C:maj')?.numeral).toBe('#iv°')
  })

  it('works in transposed keys', () => {
    expect(rn('A:7', 'D:maj')?.numeral).toBe('V7')
    expect(rn('E:min', 'D:maj')?.numeral).toBe('ii')
    expect(rn('Db:maj', 'Ab:maj')?.numeral).toBe('IV')
  })
})

describe('minor keys', () => {
  it('natural-minor diatonic chords in A minor', () => {
    expect(rn('A:min', 'A:min')?.numeral).toBe('i')
    expect(rn('C:maj', 'A:min')?.numeral).toBe('III')
    expect(rn('D:min', 'A:min')?.numeral).toBe('iv')
    expect(rn('F:maj', 'A:min')?.numeral).toBe('VI')
    expect(rn('G:maj', 'A:min')?.numeral).toBe('VII')
  })

  it('dominant function from the raised leading tone', () => {
    expect(rn('E:7', 'A:min')?.numeral).toBe('V7')
    expect(rn('E:7', 'A:min')?.func).toBe('dominant')
    // Conventional spelling: the leading-tone chord is vii°, and the natural
    // subtonic triad is VII — quality, not an accidental, distinguishes them.
    const dim = rn('G#:dim', 'A:min')!
    expect(dim.numeral).toBe('vii°')
    expect(dim.diatonic).toBe(true)
    expect(rn('G:maj', 'A:min')?.numeral).toBe('VII')
  })
})

describe('edge cases', () => {
  it('returns null for N.C., garbage, and unknown keys', () => {
    expect(rn('N.C.', 'C:maj')).toBeNull()
    expect(rn('???', 'C:maj')).toBeNull()
    expect(rn('C:maj', 'H:maj')).toBeNull()
  })

  it('augmented and diminished suffixes', () => {
    expect(rn('C:aug', 'C:maj')?.numeral).toBe('I+')
    expect(rn('B:dim', 'C:maj')?.numeral).toBe('vii°')
  })
})
