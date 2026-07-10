/** Shared generation helpers. The walk itself lives in the harmonizer
 * (see harmonizer.test.ts for locked pass-through, steering, lookahead,
 * scored sampling, cancellation, and error degradation). */

import { describe, expect, it } from 'vitest'
import { chainTail } from '../src/engine/progression/generator'
import { makeProgression, makeSlot } from '../src/engine/progression/types'

describe('chainTail', () => {
  it('returns the last slot symbol, or the fallback when empty', () => {
    const p = makeProgression([makeSlot('C:maj', 8, 'generated'), makeSlot('G:7', 8, 'generated')])
    expect(chainTail(p, 'X')).toBe('G:7')
    expect(chainTail(null, 'X')).toBe('X')
    expect(chainTail(makeProgression([]), 'X')).toBe('X')
  })
})
