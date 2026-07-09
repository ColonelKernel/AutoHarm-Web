/** Behavioral tests for the MarkovEngine wrapper (sampling is seeded, so these
 * assert structure/determinism rather than Python bit-parity). */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MarkovEngine } from '../src/engine/markov/markovEngine'
import { loadCorpora, type RawCorpora } from '../src/engine/markov/corpusLoader'

const rawCorpora: RawCorpora = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'data', 'markov_corpora_t.json'), 'utf-8'),
)

function makeEngine(opts = {}) {
  return new MarkovEngine(loadCorpora(rawCorpora), { seed: 42, ...opts })
}

describe('MarkovEngine', () => {
  it('samples a known chord without fallback', () => {
    const engine = makeEngine()
    const r = engine.sample('C:maj')
    expect(r.output).toBeTruthy()
    expect(r.fallbackUsed).toBe(false)
    expect(r.candidates).toBeGreaterThan(0)
    expect(r.probability).toBeGreaterThan(0)
  })

  it('is deterministic under a fixed seed', () => {
    const a = makeEngine()
    const b = makeEngine()
    for (let i = 0; i < 20; i++) {
      expect(a.sample('C:maj').output).toBe(b.sample('C:maj').output)
    }
  })

  it('rejects empty input', () => {
    const r = makeEngine().sample('   ')
    expect(r.output).toBeNull()
    expect(r.error).toBe('empty chord input')
  })

  it('echoes unknown chords by default (after "all" corpus miss)', () => {
    const r = makeEngine().sample('Z:xx')
    expect(r.output).toBe('Z:xx')
    expect(r.fallbackUsed).toBe(true)
    expect(r.error).toContain('unknown chord')
  })

  it('error_only policy yields no output for unknown chords', () => {
    const r = makeEngine({ fallback: 'error_only' }).sample('Z:xx')
    expect(r.output).toBeNull()
    expect(r.fallbackUsed).toBe(true)
  })

  it('walks a 32-step chain staying key-consistent in C:maj', () => {
    const engine = makeEngine({ key: 'C:maj', gravity: 0.4 })
    let chord = 'C:maj'
    const seen: string[] = []
    for (let i = 0; i < 32; i++) {
      const r = engine.sample(chord)
      expect(r.output).toBeTruthy()
      chord = r.output!
      seen.push(chord)
      expect(chord).toMatch(/^[A-G][b#]?:/)
    }
    // A gravity-biased C-major walk should revisit the tonic root.
    expect(seen.some((c) => c.startsWith('C:'))).toBe(true)
  })

  it('transposes sampling through a non-C key', () => {
    const engine = makeEngine({ key: 'E:maj' })
    let chord = 'E:maj'
    for (let i = 0; i < 16; i++) {
      const r = engine.sample(chord)
      expect(r.output).toBeTruthy()
      expect(r.fallbackUsed, `fallback at step ${i} for ${chord}`).toBe(false)
      chord = r.output!
    }
  })

  it('spice macro drives both color and adventure', () => {
    const engine = makeEngine()
    engine.setSpice(0.9)
    const s = engine.getState()
    expect(s.color).toBe(0.9)
    expect(s.adventure).toBe(0.9)
  })
})
