/** Listen & Respond — capture pairing/clipping, melody analysis weighting,
 * score behavior, and the state machine's non-negotiable invariants
 * (no response before the full phrase; N-repetition commitment). */

import { describe, expect, it } from 'vitest'
import { PhraseCapture } from '../src/engine/respond/phraseCapture'
import { analyzeMelody, metricWeight, velocityWeight } from '../src/engine/respond/melodyAnalysis'
import { cadenceFit, melodyFit, noveltyFit, pcConsonance, scoreChord, voiceLeadingFit } from '../src/engine/respond/scoring'
import { RespondEngine } from '../src/engine/respond/responseEngine'
import { SCORE_WEIGHTS, type MelodyAnalysis } from '../src/engine/respond/types'
import { makeProgression, makeSlot } from '../src/engine/progression/types'

describe('PhraseCapture', () => {
  it('pairs note-on/off and rebases onto the window', () => {
    const c = new PhraseCapture()
    c.noteOn(60, 100, 100, 5)
    c.noteOff(60, 104, 2)
    const notes = c.finalize(100, 32)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ note: 60, onStep: 0, offStep: 4 })
  })

  it('synthesizes offs for held notes and clips beyond the window', () => {
    const c = new PhraseCapture()
    c.noteOn(64, 90, 130, 0) // held forever
    c.noteOn(62, 90, 128, 0)
    c.noteOff(62, 170, 0) // released after the close
    const notes = c.finalize(128, 32)
    expect(notes.find((n) => n.note === 64)?.offStep).toBe(32)
    expect(notes.find((n) => n.note === 62)?.offStep).toBe(32)
  })

  it('handles retriggered (overlapping same-pitch) notes', () => {
    const c = new PhraseCapture()
    c.noteOn(60, 80, 10, 0)
    c.noteOn(60, 90, 14, 0) // retrigger closes the first instance
    c.noteOff(60, 18, 0)
    const notes = c.finalize(8, 32)
    expect(notes).toHaveLength(2)
    expect(notes[0].offStep).toBe(6) // closed at the retrigger (14-8)
    expect(notes[1]).toMatchObject({ onStep: 6, offStep: 10 })
  })

  it('grace: a one-step-early pickup snaps to the downbeat; earlier is dropped', () => {
    const c = new PhraseCapture()
    c.noteOn(60, 80, 99, 20) // one step before a window starting at 100
    c.noteOn(55, 80, 90, 0) // way early — dropped
    c.noteOff(60, 102, 0)
    const notes = c.finalize(100, 16)
    expect(notes).toHaveLength(1)
    expect(notes[0].onStep).toBe(0)
  })

  it('ignores an off with no matching on and never yields zero length', () => {
    const c = new PhraseCapture()
    c.noteOff(60, 5, 0)
    c.noteOn(62, 80, 6, 10)
    c.noteOff(62, 6, 12) // same step, later ms — fine but rounds to min length
    const notes = c.finalize(0, 16)
    expect(notes).toHaveLength(1)
    expect(notes[0].offStep! > notes[0].onStep || notes[0].offMs > notes[0].onMs).toBe(true)
  })
})

describe('melody analysis', () => {
  const note = (n: number, on: number, off: number, vel = 90) => ({
    note: n, velocity: vel, onStep: on, onMs: 0, offStep: off, offMs: 0,
  })

  it('duration-weights: long notes dominate', () => {
    const a = analyzeMelody([note(60, 0, 12), note(62, 12, 13)], 16)
    expect(a.weightedPitchClasses[0]).toBeGreaterThan(a.weightedPitchClasses[2] * 3)
    expect(a.strongestPitchClasses[0]).toBe(0)
  })

  it('metric-weights: the downbeat beats the offbeat at equal duration', () => {
    const a = analyzeMelody([note(60, 0, 4), note(62, 5, 9)], 16)
    expect(a.weightedPitchClasses[0]).toBeGreaterThan(a.weightedPitchClasses[2])
    expect(metricWeight(0)).toBe(2)
    expect(metricWeight(4)).toBe(1.5)
    expect(metricWeight(2)).toBe(1)
    expect(metricWeight(3)).toBe(0.7)
  })

  it('velocity is a modest modifier', () => {
    expect(velocityWeight(127) / velocityWeight(0)).toBeLessThan(1.7)
  })

  it('finds the terminal pitch class and phrase stats', () => {
    const a = analyzeMelody([note(60, 0, 8), note(67, 8, 15), note(64, 15, 16)], 16)
    expect(a.terminalPitchClass).toBe(4) // E
    expect(a.totalNotes).toBe(3)
    expect(a.range).toBe(7)
    expect(a.noteDensity).toBe(3)
  })

  it('empty phrase -> zeroed analysis, no NaNs', () => {
    const a = analyzeMelody([], 32)
    expect(a.weightedPitchClasses.every((w) => w === 0)).toBe(true)
    expect(a.terminalPitchClass).toBeNull()
    expect(a.registerCenter).toBeNull()
    expect(a.totalNotes).toBe(0)
  })

  it('polyphonic dyad: the higher simultaneous note reads as the melody end', () => {
    const a = analyzeMelody([note(60, 8, 16), note(67, 8, 16)], 16)
    expect(a.terminalPitchClass).toBe(7)
  })
})

describe('scoring', () => {
  const cMelody: MelodyAnalysis = {
    weightedPitchClasses: (() => { const w = new Array(12).fill(0); w[0] = 0.5; w[4] = 0.3; w[7] = 0.2; return w })(),
    strongestPitchClasses: [0, 4, 7],
    terminalPitchClass: 0,
    noteDensity: 2,
    registerCenter: 64,
    range: 7,
    totalNotes: 4,
  }

  it('chord tones raise melody fit; clashes lower it', () => {
    expect(melodyFit('C:maj', cMelody)).toBeGreaterThan(melodyFit('B:maj', cMelody))
    expect(pcConsonance(0, [0, 4, 7])).toBe(1)
    expect(pcConsonance(1, [0, 4, 7])).toBe(-0.7)
    expect(pcConsonance(2, [0, 4, 7])).toBe(0.35)
  })

  it('voice leading prefers small movement', () => {
    expect(voiceLeadingFit([60, 64, 67], [60, 64, 67])).toBe(1)
    expect(voiceLeadingFit([60, 64, 67], [62, 65, 69])).toBeGreaterThan(voiceLeadingFit([60, 64, 67], [72, 76, 79]))
    expect(voiceLeadingFit(null, [60])).toBe(0.5)
  })

  it('cadence fit follows tension: tonic wins resolved, color wins suspended', () => {
    const tonicLow = cadenceFit('C:maj', cMelody, 'C:maj', 0)
    const tonicHigh = cadenceFit('C:maj', cMelody, 'C:maj', 1)
    expect(tonicLow).toBeGreaterThan(tonicHigh)
    const colorLow = cadenceFit('A:min', cMelody, 'C:maj', 0)
    const colorHigh = cadenceFit('A:min', cMelody, 'C:maj', 1)
    expect(colorHigh).toBeGreaterThan(colorLow)
  })

  it('novelty discourages but never bans repeats', () => {
    expect(noveltyFit('C:maj', [])).toBe(1)
    expect(noveltyFit('C:maj', ['G:7', 'C:maj'])).toBe(0.3)
    expect(noveltyFit('C:maj', ['C:maj', 'G:7'])).toBe(0.7)
    expect(noveltyFit('C:maj', ['D:min'])).toBe(1)
  })

  it('breakdown total is the exact weighted sum (explanation = decision)', () => {
    const b = scoreChord('C:maj', {
      analysis: cMelody, key: 'C:maj', tension: 0.3, prior: 0.8,
      candidateNotes: [60, 64, 67], prevVoicing: [59, 64, 67], recent: ['G:7'],
    })
    const expected =
      b.melodyFit * SCORE_WEIGHTS.melodyFit +
      b.modelPrior * SCORE_WEIGHTS.modelPrior +
      b.voiceLeadingFit * SCORE_WEIGHTS.voiceLeadingFit +
      b.cadenceFit * SCORE_WEIGHTS.cadenceFit +
      b.noveltyFit * SCORE_WEIGHTS.noveltyFit
    expect(b.total).toBeCloseTo(expected, 12)
    expect(b.total).toBeGreaterThan(0.5) // C over a C-major melody scores well
  })
})

describe('RespondEngine state machine', () => {
  function harness(phraseSteps = 32, repetitions = 2) {
    const calls: string[] = []
    let resolveGen: ((p: ReturnType<typeof makeProgression> | null) => void) | null = null
    const engine = new RespondEngine({
      mute: (on) => calls.push(`mute:${on}`),
      generateResponse: () => {
        calls.push('generate')
        return new Promise((r) => (resolveGen = r))
      },
    })
    engine.phraseSteps = phraseSteps
    engine.repetitions = repetitions
    const resolve = () => resolveGen!(makeProgression([makeSlot('C:maj', phraseSteps, 'response')]))
    return { engine, calls, resolve }
  }

  it('never generates before the phrase window has been heard', async () => {
    const { engine, calls } = harness(32)
    engine.newListen()
    expect(engine.phase).toBe('armed')
    expect(calls).not.toContain('generate')
    engine.onCycle(0) // window opens
    expect(engine.phase).toBe('listening')
    expect(calls).toContain('mute:true')
    // Steps up to (but not past) the early-kick threshold: no generation.
    for (let s = 0; s < 15; s++) engine.onStep(s)
    expect(calls).not.toContain('generate')
    // The kick happens at close - 16 (step 16 of 32) — from notes SO FAR.
    engine.onStep(16)
    expect(calls).toContain('generate')
  })

  it('commits the response for N repetitions, then READY (still playing)', async () => {
    const { engine, calls, resolve } = harness(32, 2)
    engine.newListen()
    engine.onCycle(0)
    engine.noteOn(60, 90, 4, 0)
    engine.noteOff(60, 12, 0)
    for (let s = 0; s <= 31; s++) engine.onStep(s)
    resolve() // staged before the boundary
    await new Promise((r) => setTimeout(r, 0))
    engine.onCycle(32) // window closes
    expect(engine.phase).toBe('analyzing')
    engine.onCycle(64) // response lands + plays
    expect(engine.phase).toBe('responding')
    expect(calls.filter((c) => c === 'mute:false').length).toBe(1)
    expect(engine.repsLeft).toBe(2)
    engine.onCycle(96) // rep 1 done
    expect(engine.phase).toBe('responding')
    engine.onCycle(128) // rep 2 done
    expect(engine.phase).toBe('ready') // never silently overwritten
    expect(engine.lastAnalysis?.totalNotes).toBe(1)
  })

  it('New Listen is refused mid-commitment and accepted from ready', () => {
    const { engine } = harness()
    engine.newListen()
    engine.onCycle(0)
    expect(engine.newListen()).toBe(false) // listening
    engine.phase = 'responding'
    expect(engine.newListen()).toBe(false)
    engine.phase = 'ready'
    expect(engine.newListen()).toBe(true)
  })

  it('cancel unmutes and resets; late generation results are dropped', async () => {
    const { engine, calls, resolve } = harness(16)
    engine.newListen()
    engine.onCycle(0)
    for (let s = 0; s <= 8; s++) engine.onStep(s) // triggers early kick (8 = half)
    expect(calls).toContain('generate')
    engine.cancel()
    expect(engine.phase).toBe('idle')
    expect(calls).toContain('mute:false')
    resolve() // stale result arrives after cancel
    await new Promise((r) => setTimeout(r, 0))
    expect(engine.phase).toBe('idle')
  })

  it('generation failure recovers to idle instead of hanging muted', async () => {
    const calls: string[] = []
    const engine = new RespondEngine({
      mute: (on) => calls.push(`mute:${on}`),
      generateResponse: () => Promise.resolve(null),
    })
    engine.phraseSteps = 16
    engine.newListen()
    engine.onCycle(0)
    for (let s = 0; s <= 15; s++) engine.onStep(s)
    engine.onCycle(16)
    await new Promise((r) => setTimeout(r, 0))
    expect(engine.phase).toBe('idle')
    expect(calls[calls.length - 1]).toBe('mute:false')
  })
})
