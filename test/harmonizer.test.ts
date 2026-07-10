/** Per-slot phrase harmonization — segmentation clipping and the core
 * contour-awareness claim: each slot picks the candidate that fits ITS
 * melody segment, not just the phrase average. */

import { describe, expect, it } from 'vitest'
import { harmonizePhrase, segmentPhrase } from '../src/engine/respond/harmonizer'
import type { CapturedNote } from '../src/engine/respond/types'
import { makeProgression, makeSlot } from '../src/engine/progression/types'
import { mulberry32 } from '../src/engine/random'

const note = (n: number, on: number, off: number, vel = 90): CapturedNote => ({
  note: n, velocity: vel, onStep: on, onMs: 0, offStep: off, offMs: 0,
})

describe('segmentPhrase', () => {
  it('assigns notes to their slots and keeps steps phrase-relative', () => {
    const segs = segmentPhrase([note(60, 0, 6), note(62, 8, 14)], [0, 8], 16)
    expect(segs).toHaveLength(2)
    expect(segs[0].map((n) => n.note)).toEqual([60])
    expect(segs[1].map((n) => n.note)).toEqual([62])
    expect(segs[1][0].onStep).toBe(8) // NOT rebased — bar position preserved
  })

  it('clips a held note into every slot it sounds in', () => {
    const segs = segmentPhrase([note(64, 2, 14)], [0, 8], 16)
    expect(segs[0][0]).toMatchObject({ onStep: 2, offStep: 8 })
    expect(segs[1][0]).toMatchObject({ onStep: 8, offStep: 14 })
  })

  it('produces empty segments for rests and drops zero-overlap notes', () => {
    const segs = segmentPhrase([note(60, 0, 4)], [0, 4, 8, 12], 16)
    expect(segs[0]).toHaveLength(1)
    expect(segs[1]).toHaveLength(0) // note ends exactly at the boundary
    expect(segs[2]).toHaveLength(0)
    expect(segs[3]).toHaveLength(0)
  })

  it('treats a still-held note (null off) as sounding to the phrase end', () => {
    const held: CapturedNote = { note: 67, velocity: 90, onStep: 4, onMs: 0, offStep: null, offMs: 0 }
    const segs = segmentPhrase([held], [0, 8], 16)
    expect(segs[0][0].offStep).toBe(8)
    expect(segs[1][0].offStep).toBe(16)
  })
})

describe('harmonizePhrase', () => {
  /** Equal priors — melody fit must be the tiebreaker. */
  const triads = [
    { symbol: 'C:maj', prior: 0.34 },
    { symbol: 'D:min', prior: 0.33 },
    { symbol: 'B:maj', prior: 0.33 },
  ]
  const sampler = {
    sample: () => ({ output: 'C:maj', probability: 0.5 }),
    candidates: () => triads,
  }

  it('each slot picks the chord fitting ITS melody segment', async () => {
    // Slot 1: C-E-G arpeggio; slot 2: D-F-A arpeggio.
    const notes = [
      note(60, 0, 3), note(64, 3, 6), note(67, 6, 8),
      note(62, 8, 11), note(65, 11, 14), note(69, 14, 16),
    ]
    const p = await harmonizePhrase(sampler, {
      notes, onsets: [0, 8], totalSteps: 16,
      seed: 'G:7', key: 'C:maj', tension: 0.5, recent: [],
    })
    expect(p!.slots.map((s) => s.symbol)).toEqual(['C:maj', 'D:min'])
    expect(p!.slots.every((s) => s.source === 'response')).toBe(true)
  })

  it('stamps a full score breakdown + reasons on EVERY slot', async () => {
    const notes = [note(60, 0, 8), note(62, 8, 16)]
    const p = await harmonizePhrase(sampler, {
      notes, onsets: [0, 8], totalSteps: 16,
      seed: 'C:maj', key: 'C:maj', tension: 0.3, recent: [],
      blendProfile: [['nottingham', 0.5], ['pop909', 0.5]],
    })
    for (const s of p!.slots) {
      expect(s.explanation?.breakdown?.total).toBeGreaterThan(0)
      expect(s.explanation?.prior).toBeGreaterThan(0)
      expect(s.explanation?.blendProfile).toHaveLength(2)
      expect(Array.isArray(s.explanation?.reasons)).toBe(true)
    }
  })

  it('empty segments are melody-neutral: the model prior decides', async () => {
    const skewed = {
      sample: () => ({ output: 'X', probability: 1 }),
      candidates: () => [
        { symbol: 'G:7', prior: 0.9 },
        { symbol: 'B:maj', prior: 0.1 },
      ],
    }
    const p = await harmonizePhrase(skewed, {
      notes: [], onsets: [0, 8], totalSteps: 16,
      seed: 'C:maj', key: 'C:maj', tension: 0.5, recent: [],
    })
    expect(p!.slots.map((s) => s.symbol)).toEqual(['G:7', 'G:7'])
  })

  it('the walk is serial: each pick becomes the next chain context', async () => {
    const contexts: string[] = []
    const tracking = {
      sample: () => ({ output: 'Z', probability: 1 }),
      candidates: (chord: string) => {
        contexts.push(chord)
        return triads
      },
    }
    await harmonizePhrase(tracking, {
      notes: [note(60, 0, 8), note(62, 8, 16)], onsets: [0, 8], totalSteps: 16,
      seed: 'G:7', key: 'C:maj', tension: 0.5, recent: [],
    })
    expect(contexts).toEqual(['G:7', 'C:maj']) // slot 2's context = slot 1's pick
  })

  it('falls back to plain sampling when candidates are empty', async () => {
    const noCands = {
      sample: (chord: string) => ({ output: chord === 'SEED' ? 'A:min' : 'F:maj', probability: 0.4 }),
      candidates: () => [],
    }
    const p = await harmonizePhrase(noCands, {
      notes: [], onsets: [0, 8], totalSteps: 16,
      seed: 'SEED', key: 'C:maj', tension: 0.5, recent: [],
    })
    expect(p!.slots.map((s) => s.symbol)).toEqual(['A:min', 'F:maj'])
    expect(p!.slots[0].explanation?.prior).toBe(0.4)
  })

  it('aborts to null when cancelled mid-walk', async () => {
    let calls = 0
    const slow = {
      sample: () => ({ output: 'C:maj' }),
      candidates: () => {
        calls++
        return triads
      },
    }
    const p = await harmonizePhrase(slow, {
      notes: [], onsets: [0, 4, 8, 12], totalSteps: 16,
      seed: 'C:maj', key: 'C:maj', tension: 0.5, recent: [],
      isCancelled: () => calls >= 2,
    })
    expect(p).toBeNull()
    expect(calls).toBeLessThan(4)
  })

  it('novelty threads through the walk: repeats are discouraged across slots', async () => {
    // C melody in BOTH slots, but a near-tied alternative exists: after the
    // first C:maj pick, novelty should tip slot 2 toward the alternative.
    const nearTie = {
      sample: () => ({ output: 'C:maj' }),
      candidates: () => [
        { symbol: 'C:maj', prior: 0.5 },
        { symbol: 'A:min', prior: 0.5 }, // shares C/E — fits a C melody too
      ],
    }
    const notes = [note(60, 0, 8), note(60, 8, 16)]
    const p = await harmonizePhrase(nearTie, {
      notes, onsets: [0, 8], totalSteps: 16,
      seed: 'G:7', key: 'C:maj', tension: 0.5, recent: [],
    })
    // Both candidates hold the melody note equally; whichever wins slot 1
    // (voice leading decides), the repetition penalty must flip slot 2.
    expect(['C:maj', 'A:min']).toContain(p!.slots[0].symbol)
    expect(p!.slots[1].symbol).not.toBe(p!.slots[0].symbol)
  })
})

describe('generation via harmonizePhrase (empty melody)', () => {
  const chainSampler = {
    sample: (c: string) => ({ output: ({ 'C:maj': 'G:7', 'G:7': 'A:min' } as Record<string, string>)[c] ?? 'C:maj', probability: 0.5 }),
    candidates: (c: string) => {
      const table: Record<string, Array<{ symbol: string; prior: number }>> = {
        'C:maj': [{ symbol: 'G:7', prior: 0.6 }, { symbol: 'F:maj', prior: 0.4 }],
        'G:7': [{ symbol: 'C:maj', prior: 0.8 }, { symbol: 'A:min', prior: 0.2 }],
        'E:min7': [{ symbol: 'A:min', prior: 0.7 }, { symbol: 'F:maj', prior: 0.3 }],
        'F:maj': [{ symbol: 'C:maj', prior: 0.5 }, { symbol: 'G:7', prior: 0.5 }],
        'A:min': [{ symbol: 'F:maj', prior: 0.6 }, { symbol: 'D:min', prior: 0.4 }],
      }
      return table[c] ?? []
    },
  }
  const { makeProgression: mp, makeSlot: ms } = { makeProgression, makeSlot }

  it('locked slots pass through by order, keep identity, and steer the chain', async () => {
    const seen: string[] = []
    const tracking = { ...chainSampler, candidates: (c: string) => { seen.push(c); return chainSampler.candidates(c) } }
    const prior = mp([
      ms('C:maj', 8, 'generated'),
      ms('E:min7', 8, 'manual', { locked: true }),
      ms('G:7', 8, 'generated'),
      ms('C:maj', 8, 'generated', { locked: true }),
    ])
    const p = await harmonizePhrase(tracking, {
      notes: [], onsets: [0, 8, 16, 24], totalSteps: 32,
      seed: 'C:maj', key: 'C:maj', tension: 0.5, recent: [], prior, source: 'generated',
    })
    expect(p!.slots[1].symbol).toBe('E:min7')
    expect(p!.slots[1].locked).toBe(true)
    expect(p!.slots[1].id).toBe(prior.slots[1].id) // identity preserved
    expect(p!.slots[3].symbol).toBe('C:maj')
    // Slot 3's chain context was the locked E:min7, not slot 1's pick.
    expect(seen).toContain('E:min7')
  })

  it('generated slots are labeled and carry breakdowns (no melody = neutral fit)', async () => {
    const p = await harmonizePhrase(chainSampler, {
      notes: [], onsets: [0, 8], totalSteps: 16,
      seed: 'C:maj', key: 'C:maj', tension: 0.5, recent: [], source: 'generated',
    })
    for (const s of p!.slots) {
      expect(s.source).toBe('generated')
      expect(s.explanation?.breakdown?.melodyFit).toBe(0.5)
      expect(s.explanation?.breakdown?.total).toBeGreaterThan(0)
    }
  })

  it('scored sampling: deterministic under a seed, varied across seeds', async () => {
    const walk = (seed: number) =>
      harmonizePhrase(chainSampler, {
        notes: [], onsets: [0, 4, 8, 12], totalSteps: 16,
        seed: 'C:maj', key: 'C:maj', tension: 0.5, recent: [], source: 'generated',
        pick: { mode: 'sample', rng: mulberry32(seed) },
      }).then((p) => p!.slots.map((s) => s.symbol).join(' '))
    expect(await walk(3)).toBe(await walk(3))
    const outcomes = new Set(await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(walk)))
    expect(outcomes.size).toBeGreaterThan(1) // variety across generations
  })

  it('degrades by keeping the chain chord when the sampler fails everywhere', async () => {
    const broken = {
      sample: () => { throw new Error('detonated') },
      candidates: () => { throw new Error('detonated') },
    }
    const p = await harmonizePhrase(broken, {
      notes: [], onsets: [0, 8], totalSteps: 16,
      seed: 'D:min', key: 'C:maj', tension: 0.5, recent: [], source: 'generated',
    })
    expect(p!.slots.map((s) => s.symbol)).toEqual(['D:min', 'D:min'])
  })
})
