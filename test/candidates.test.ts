/** candidates() — the next-chord distribution surface added in V2.
 *
 * Markov: must be the exact distribution sample() draws from (same blend /
 * temperature / cadence math), sorted, no RNG. Neural: a peek at the softmax
 * that never advances the session. Generator: lookahead picks chords that
 * lead into locked successors.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MarkovEngine } from '../src/engine/markov/markovEngine'
import { loadCorpora, type RawCorpora } from '../src/engine/markov/corpusLoader'
import { harmonizePhrase } from '../src/engine/respond/harmonizer'
import { makeProgression, makeSlot } from '../src/engine/progression/types'

const rawCorpora: RawCorpora = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'data', 'markov_corpora_t.json'), 'utf-8'),
)

function makeEngine(opts = {}) {
  return new MarkovEngine(loadCorpora(rawCorpora), { seed: 42, ...opts })
}

describe('MarkovEngine.candidates', () => {
  it('returns a sorted probability distribution over next chords', () => {
    const cands = makeEngine().candidates('C:maj')
    expect(cands.length).toBeGreaterThan(3)
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i].prior).toBeLessThanOrEqual(cands[i - 1].prior)
    }
    // Truncated at `limit`, but the untruncated mass must be a distribution:
    const all = makeEngine().candidates('C:maj', 10_000)
    const sum = all.reduce((n, c) => n + c.prior, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it("contains sample()'s output with the same probability", () => {
    const engine = makeEngine()
    const cands = engine.candidates('C:maj', 10_000)
    for (let i = 0; i < 10; i++) {
      const r = engine.sample('C:maj')
      const hit = cands.find((c) => c.symbol === r.output)
      expect(hit).toBeDefined()
      expect(hit!.prior).toBeCloseTo(r.probability!, 12)
    }
  })

  it('respects the key (transposed back out of C/Am space)', () => {
    const engine = makeEngine()
    engine.setKey('D:maj')
    const cands = engine.candidates('D:maj')
    expect(cands.length).toBeGreaterThan(0)
    // In D major the dominant is A — expect it near the top under gravity.
    engine.setGravity(1)
    const withGravity = engine.candidates('D:maj', 5)
    expect(withGravity.some((c) => c.symbol.startsWith('A:') || c.symbol.startsWith('D:'))).toBe(true)
  })

  it('returns [] for empty input and no RNG side effects on determinism', () => {
    const engine = makeEngine()
    expect(engine.candidates('  ')).toEqual([])
    // Interleaving candidates() must not perturb the seeded sample stream.
    const a = makeEngine()
    const b = makeEngine()
    b.candidates('C:maj')
    b.candidates('G:7')
    for (let i = 0; i < 5; i++) expect(a.sample('C:maj').output).toBe(b.sample('C:maj').output)
  })
})

describe('harmonizer lookahead toward locked successors', () => {
  /** Sampler where candidates are rigged: from START, options A (p .6) and
   * B (p .4); A never reaches LOCKED (floor), B always does (p .9). */
  const rigged = {
    sample: (chord: string) => ({ output: chord === 'START' ? 'A' : 'X', probability: 0.6 }),
    candidates: (chord: string) => {
      if (chord === 'START') return [
        { symbol: 'A', prior: 0.6 },
        { symbol: 'B', prior: 0.4 },
      ]
      if (chord === 'B') return [{ symbol: 'LOCKED', prior: 0.9 }]
      if (chord === 'A') return [{ symbol: 'ELSEWHERE', prior: 0.9 }]
      return []
    },
  }

  it('picks the candidate that leads into the locked chord', async () => {
    const prior = makeProgression([
      makeSlot('old', 8, 'generated'),
      makeSlot('LOCKED', 8, 'manual', { locked: true }),
    ])
    const p = await harmonizePhrase(rigged, { notes: [], seed: 'START', onsets: [0, 8], totalSteps: 16, prior, key: 'C:maj', tension: 0.5, recent: [], source: 'generated' })
    // Plain sampling would pick A (or 'A' from sample()); lookahead must pick
    // B because 0.4*0.9 > 0.6*1e-4.
    expect(p!.slots[0].symbol).toBe('B')
    expect(p!.slots[1].symbol).toBe('LOCKED')
    expect(p!.slots[0].explanation?.reasons[0]).toContain('LOCKED')
  })

  it('falls back to plain sampling when the model has no candidates()', async () => {
    const plain = { sample: () => ({ output: 'A', probability: 0.5 }) }
    const prior = makeProgression([
      makeSlot('old', 8, 'generated'),
      makeSlot('LOCKED', 8, 'manual', { locked: true }),
    ])
    const p = await harmonizePhrase(plain, { notes: [], seed: 'START', onsets: [0, 8], totalSteps: 16, prior, key: 'C:maj', tension: 0.5, recent: [], source: 'generated' })
    expect(p!.slots[0].symbol).toBe('A')
  })
})
