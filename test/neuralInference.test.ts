/** Unit tests for the neural inference math + v3 session/stateless sampling,
 * using a stub forward (no ORT). Plus the notation bridge + simplifier. */

import { describe, expect, it } from 'vitest'
import { applySamplingDistribution, sampleFromProbabilities } from '../src/engine/neural/inference'
import { JazzNetVocab, type VocabJson } from '../src/engine/neural/vocab'
import {
  NeuralSessionState,
  maybeResetForMaxSteps,
  sampleSession,
  sampleStateless,
  type ForwardFn,
} from '../src/engine/neural/session'
import type { Hidden, RunResult } from '../src/engine/neural/ortRunner'
import { mulberry32 } from '../src/engine/random'
import { fromJazznet, toJazznet } from '../src/engine/theory/notation'
import { simplifyChord, INVALID_CHORD } from '../src/engine/theory/chordSimplifier'

// A tiny 6-token vocab: pad=0, <BOS>=1, <EOS>=2, then three chords.
function makeVocab(): JazzNetVocab {
  const json: VocabJson = {
    tokens: ['pad', '<BOS>', '<EOS>', 'C:maj', 'G:7', 'A:min'],
    bosIdx: 1,
    eosIdx: 2,
    padIdx: 0,
    vocabSize: 6,
    hyperparameters: { embedding_dim: 4, hidden_dim: 4, n_layers: 1 },
  }
  return new JazzNetVocab(json)
}

const vocab = makeVocab()

describe('applySamplingDistribution', () => {
  it('masks specials and renormalizes', () => {
    const logits = [5, 5, 5, 1, 0, 0] // specials have the largest logits
    const p = applySamplingDistribution(logits, vocab, 1.0)
    // pad/BOS/EOS must be zeroed
    expect(p[0]).toBe(0)
    expect(p[1]).toBe(0)
    expect(p[2]).toBe(0)
    const sum = p.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 12)
    // among the chords, index 3 (logit 1) beats 4 and 5 (logit 0)
    expect(p[3]).toBeGreaterThan(p[4])
    expect(p[4]).toBeCloseTo(p[5], 12)
  })

  it('excludes the input index when asked', () => {
    const logits = [0, 0, 0, 10, 1, 1]
    const p = applySamplingDistribution(logits, vocab, 1.0, [3])
    expect(p[3]).toBe(0) // excluded despite the highest logit
    expect(p[4]).toBeCloseTo(0.5, 12)
    expect(p[5]).toBeCloseTo(0.5, 12)
  })

  it('temperature < 1 sharpens toward the top', () => {
    const logits = [0, 0, 0, 2, 1, 0]
    const hot = applySamplingDistribution(logits, vocab, 2.0)
    const cold = applySamplingDistribution(logits, vocab, 0.5)
    expect(cold[3]).toBeGreaterThan(hot[3]) // colder => peakier
  })

  it('throws when everything is masked away', () => {
    const logits = [1, 1, 1, 0, 0, 0]
    expect(() => applySamplingDistribution(logits, vocab, 1.0, [3, 4, 5])).toThrow()
  })

  it('rejects non-positive temperature', () => {
    expect(() => applySamplingDistribution([1, 1, 1, 1, 1, 1], vocab, 0)).toThrow()
  })
})

describe('sampleFromProbabilities', () => {
  it('never returns a special token', () => {
    const probs = new Float64Array([0, 0, 0, 0.5, 0.3, 0.2])
    const rng = mulberry32(1)
    for (let i = 0; i < 100; i++) {
      const [idx] = sampleFromProbabilities(probs, vocab, rng)
      expect(vocab.isSpecial(idx)).toBe(false)
    }
  })

  it('is deterministic under a fixed seed', () => {
    const probs = new Float64Array([0, 0, 0, 0.4, 0.4, 0.2])
    const a = sampleFromProbabilities(probs, vocab, mulberry32(7))
    const b = sampleFromProbabilities(probs, vocab, mulberry32(7))
    expect(a).toEqual(b)
  })
})

// --- session/stateless with a stub forward -------------------------------

/** Stub forward returning fixed logits; records the token/hidden it saw. */
function stubForward(logitsByCall: number[][]): { fn: ForwardFn; calls: Array<{ tokens: number[]; hidden: Hidden | null }> } {
  const calls: Array<{ tokens: number[]; hidden: Hidden | null }> = []
  let i = 0
  const fn: ForwardFn = async (tokens, hidden) => {
    calls.push({ tokens, hidden })
    const logits = logitsByCall[Math.min(i, logitsByCall.length - 1)]
    i++
    const result: RunResult = {
      logitsLast: Float32Array.from(logits),
      hidden: { h: Float32Array.from([i]) }, // distinct per call so we can track advancement
    }
    return result
  }
  return { fn, calls }
}

describe('sampleStateless', () => {
  it('forwards [BOS, idx] and returns the top chord', async () => {
    const { fn, calls } = stubForward([[0, 0, 0, 0, 9, 0]]) // idx 4 = G:7
    const res = await sampleStateless({
      forward: fn,
      vocab,
      chord: 'C:maj',
      idx: 3,
      rng: mulberry32(1),
      temperature: 1.0,
      excludeInput: true,
      applyFallback: () => ({ output: 'FALLBACK', probability: null, candidates: 0, fallbackUsed: true }),
    })
    expect(calls[0].tokens).toEqual([1, 3]) // [BOS, idx]
    expect(res.output).toBe('G:7')
    expect(res.fallbackUsed).toBe(false)
  })
})

describe('sampleSession (v3)', () => {
  it('first step forwards [BOS, idx]; later steps carry hidden and forward [idx]', async () => {
    // logits: step1 picks idx4 (G:7); auto-feed call; step2 picks idx5 (A:min)
    const { fn, calls } = stubForward([
      [0, 0, 0, 0, 9, 0], // step 1 sample
      [0, 0, 0, 0, 0, 0], // step 1 auto-feed (logits unused)
      [0, 0, 0, 0, 0, 9], // step 2 sample
      [0, 0, 0, 0, 0, 0], // step 2 auto-feed
    ])
    const session = new NeuralSessionState()
    const common = {
      forward: fn,
      vocab,
      rng: mulberry32(1),
      temperature: 1.0,
      excludeInput: true,
      autoFeed: true,
      maxSteps: 64,
      session,
      applyFallback: () => ({ output: 'FB', probability: null, candidates: 0, fallbackUsed: true }),
    }

    const r1 = await sampleSession({ ...common, chord: 'C:maj', idx: 3 })
    expect(r1.output).toBe('G:7')
    expect(calls[0].tokens).toEqual([1, 3]) // [BOS, idx] on the first step
    expect(calls[0].hidden).toBeNull()
    expect(session.userSteps).toBe(1)
    expect(session.hidden).not.toBeNull() // hidden carried after auto-feed

    const r2 = await sampleSession({ ...common, chord: 'G:7', idx: 4 })
    expect(r2.output).toBe('A:min')
    // step 2 forwards a single token with carried hidden (call index 2)
    expect(calls[2].tokens).toEqual([4])
    expect(calls[2].hidden).not.toBeNull()
    expect(session.userSteps).toBe(2)
    expect(session.tokenTrace).toEqual(['C:maj', 'G:7', 'G:7', 'A:min'])
  })

  it('excludes the input only on the first step', async () => {
    // Step 1 logits favor the input idx (3); exclusion must force a different pick.
    const { fn } = stubForward([
      [0, 0, 0, 9, 1, 0], // step1: idx3 highest but excluded -> idx4
      [0, 0, 0, 0, 0, 0], // auto-feed
      [0, 0, 0, 9, 0, 0], // step2: idx3 NOT excluded -> idx3
      [0, 0, 0, 0, 0, 0],
    ])
    const session = new NeuralSessionState()
    const common = {
      forward: fn,
      vocab,
      rng: mulberry32(1),
      temperature: 1.0,
      excludeInput: true,
      autoFeed: true,
      maxSteps: 64,
      session,
      applyFallback: () => ({ output: 'FB', probability: null, candidates: 0, fallbackUsed: true }),
    }
    const r1 = await sampleSession({ ...common, chord: 'C:maj', idx: 3 })
    expect(r1.output).toBe('G:7') // idx3 excluded on first step
    const r2 = await sampleSession({ ...common, chord: 'C:maj', idx: 3 })
    expect(r2.output).toBe('C:maj') // idx3 allowed after hidden exists
  })

  it('auto-resets at maxSteps', () => {
    const session = new NeuralSessionState()
    session.userSteps = 5
    expect(maybeResetForMaxSteps(session, 5)).toBe(true)
    expect(session.userSteps).toBe(0)
    session.userSteps = 3
    expect(maybeResetForMaxSteps(session, 5)).toBe(false)
  })
})

describe('notation bridge + simplifier', () => {
  it('round-trips flat roots', () => {
    expect(toJazznet('Bb:maj7')).toBe('B-:maj7')
    expect(fromJazznet('B-:maj7')).toBe('Bb:maj7')
    expect(toJazznet('F#:min7')).toBe('F#:min7') // sharps unchanged
    expect(fromJazznet('C:maj')).toBe('C:maj')
  })

  it('simplifies to MIREX-7 qualities (matching the Python simplifier)', () => {
    expect(simplifyChord('C:maj7')).toBe('C:maj7')
    expect(simplifyChord('B-:maj7')).toBe('B-:maj7') // dash-flat root preserved
    expect(simplifyChord('G:7')).toBe('G:7') // literal '7' detected
    expect(simplifyChord('A:hdim7')).toBe('A:hdim7') // 'h' -> hdim7
    expect(simplifyChord('C:9')).toBe('C:maj') // no maj7/min7/7 substring -> maj fallback
    expect(simplifyChord('r')).toBe(INVALID_CHORD)
    expect(simplifyChord('C')).toBe(INVALID_CHORD) // bare root note
  })
})

describe('NeuralEngine.candidates (peek)', () => {
  async function makeEngine(logitsByCall: number[][]) {
    const { NeuralEngine } = await import('../src/engine/neural/neuralEngine')
    const { fn, calls } = stubForward(logitsByCall)
    const engine = new NeuralEngine('rnn', vocab, { run: (t, h) => fn(t, h ?? null) }, {
      rng: mulberry32(3),
      temperature: 1.0,
      excludeInput: true,
    })
    return { engine, calls }
  }

  it('returns the top-k softmax without specials, sorted desc', async () => {
    // chords: C:maj(idx3) logit 2, G:7(4) logit 3, A:min(5) logit 1
    const { engine } = await makeEngine([[9, 9, 9, 2, 3, 1]])
    const cands = await engine.candidates('C:maj', false, 24)
    // C:maj excluded (cold start excludeInput), so: G:7 then A:min
    expect(cands.map((c) => c.symbol)).toEqual(['G:7', 'A:min'])
    expect(cands[0].prior).toBeGreaterThan(cands[1].prior)
    const sum = cands.reduce((n, c) => n + c.prior, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('does not advance session state (pure peek)', async () => {
    const { engine, calls } = await makeEngine([[0, 0, 0, 1, 2, 3]])
    await engine.candidates('C:maj', true)
    expect(engine.session.hidden).toBeNull() // untouched
    expect(engine.session.userSteps).toBe(0)
    expect(engine.session.tokenTrace).toEqual([])
    expect(calls.length).toBe(1) // exactly one forward, no auto-feed
  })

  it('uses the carried hidden mid-session and forwards only [idx]', async () => {
    const { engine, calls } = await makeEngine([
      [0, 0, 0, 5, 1, 1], // sample step 1
      [0, 0, 0, 1, 5, 1], // auto-feed
      [0, 0, 0, 1, 1, 5], // the peek
    ])
    await engine.sample('C:maj', true) // establishes hidden
    const before = engine.session.hidden
    const cands = await engine.candidates('G:7', true)
    expect(cands.length).toBeGreaterThan(0)
    expect(engine.session.hidden).toBe(before) // still the same object
    const peek = calls[calls.length - 1]
    expect(peek.tokens.length).toBe(1) // [idx] only — hidden carries context
    expect(peek.hidden).toBe(before)
  })

  it('returns [] for unknown chords and on runner failure', async () => {
    const { engine } = await makeEngine([[0, 0, 0, 1, 1, 1]])
    expect(await engine.candidates('Zz:wat', false)).toEqual([])
    const broken = new (await import('../src/engine/neural/neuralEngine')).NeuralEngine(
      'rnn', vocab, { run: () => Promise.reject(new Error('boom')) }, { rng: mulberry32(1) },
    )
    expect(await broken.candidates('C:maj', false)).toEqual([])
  })
})
