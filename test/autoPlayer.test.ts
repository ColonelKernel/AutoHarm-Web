/** AutoPlayer state-machine tests — deterministic mock engine + manual beat
 * pumping (no real clock, no audio, no MIDI). */

import { beforeEach, describe, expect, it } from 'vitest'
import { AutoPlayer, TEMPLATES, isSlotOnset, rhythmToTemplate } from '../src/engine/player/autoPlayer'
import { Sonifier } from '../src/engine/player/sonifier'
import { Emitter, type PlayerEvent } from '../src/engine/events'

/** Deterministic sampler: C:maj -> G:7 -> C:maj -> ... via a lookup chain. */
class MockSampler {
  calls: string[] = []
  chain: Record<string, string> = {
    'C:maj': 'G:7',
    'G:7': 'A:min',
    'A:min': 'F:maj',
    'F:maj': 'C:maj',
  }
  sample(chord: string) {
    this.calls.push(chord)
    return { output: this.chain[chord] ?? 'C:maj', error: null }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

let sampler: MockSampler
let emitter: Emitter
let sonifier: Sonifier
let player: AutoPlayer
let events: PlayerEvent[]

beforeEach(() => {
  sampler = new MockSampler()
  emitter = new Emitter()
  sonifier = new Sonifier(emitter, () => 0.5)
  player = new AutoPlayer(sampler, sonifier, emitter)
  events = []
  emitter.on((e) => events.push(e))
})

const chordEvents = () => events.filter((e) => e.type === 'chord') as Array<{ type: 'chord'; symbol: string }>
const notesEvents = () => events.filter((e) => e.type === 'notes')

// One bar = 16 sixteenth-note steps. 'quarters' (id 6) has an onset every beat.
const STEPS_PER_BAR = 16
const QUARTERS = 6 // onsets at steps 0,4,8,12

async function pumpSteps(n: number) {
  for (let i = 0; i < n; i++) {
    player.onStep()
    await flush()
  }
}

describe('templates', () => {
  it('places onsets on the 16th-note grid', () => {
    // 'half + half' = onsets on beats 1 and 3 (steps 0 and 8).
    expect(TEMPLATES[3].onsets).toEqual([0, 8])
    expect(isSlotOnset(3, 0)).toBe(true)
    expect(isSlotOnset(3, 4)).toBe(false)
    expect(isSlotOnset(3, 8)).toBe(true)
    // 'quarters' = a chord on every beat.
    expect(TEMPLATES[QUARTERS].onsets).toEqual([0, 4, 8, 12])
    // 'offbeats' = all the "ands" — genuine syncopation the old grid couldn't do.
    expect(TEMPLATES[8].onsets).toEqual([2, 6, 10, 14])
    expect(isSlotOnset(8, 0)).toBe(false)
    expect(isSlotOnset(8, 2)).toBe(true)
    // 'static (2 bars)' spans 32 steps with a single onset.
    expect(TEMPLATES[1].spanBars).toBe(2)
    expect(isSlotOnset(1, 16)).toBe(false)
  })

  it('rhythm dial sweeps sparse -> dense', () => {
    expect(rhythmToTemplate(0)).toBe(1) // static (2 bars) — sparsest
    expect(rhythmToTemplate(1)).toBe(12) // sixteenths — densest
  })
})

describe('capture and loop replay', () => {
  it('captures a phrase then replays it without engine calls', async () => {
    player.player.lengthBars = 1 // 16 steps per cycle
    player.setTemplate(QUARTERS) // a chord every beat -> 4 onsets per bar
    player.player.mode = 'loop'
    player.start()
    await flush() // resolve the initial seed fetch

    await pumpSteps(STEPS_PER_BAR) // capture cycle
    const captured = chordEvents().map((e) => e.symbol)
    expect(captured.length).toBe(4)
    const callsAfterCapture = sampler.calls.length

    await pumpSteps(STEPS_PER_BAR) // replay cycle
    const replayed = chordEvents().slice(4).map((e) => e.symbol)
    expect(replayed).toEqual(captured) // deterministic replay
    expect(sampler.calls.length).toBe(callsAfterCapture) // no new engine calls
  })

  it('regen mode re-walks the chain each cycle', async () => {
    player.player.lengthBars = 1
    player.setTemplate(QUARTERS)
    player.player.mode = 'regen'
    player.start()
    await flush()

    await pumpSteps(STEPS_PER_BAR)
    const callsAfterFirst = sampler.calls.length
    await pumpSteps(STEPS_PER_BAR)
    expect(sampler.calls.length).toBeGreaterThan(callsAfterFirst) // kept sampling
  })

  it('oneshot stops with playoff at the cycle end', async () => {
    player.player.lengthBars = 1
    player.setTemplate(QUARTERS)
    player.player.mode = 'oneshot'
    player.start()
    await flush()

    await pumpSteps(STEPS_PER_BAR + 1) // one bar + the boundary tick
    expect(player.player.active).toBe(false)
    expect(events.some((e) => e.type === 'playoff')).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.value === 'done')).toBe(true)
  })

  it('plays a syncopated (offbeat) template only on the ands', async () => {
    player.player.lengthBars = 1
    player.setTemplate(8) // offbeats: steps 2,6,10,14
    player.player.mode = 'regen'
    player.start()
    await flush()
    // First 2 steps (0,1) have no onset; nothing should have sounded yet.
    await pumpSteps(2)
    expect(notesEvents().length).toBe(0)
    await pumpSteps(1) // step 2 -> first onset
    expect(notesEvents().length).toBe(1)
  })
})

describe('hold and reroll', () => {
  it('hold vamps without advancing the walk', async () => {
    player.player.lengthBars = 1
    player.setTemplate(QUARTERS)
    player.player.mode = 'loop'
    player.start()
    await flush()
    await pumpSteps(5) // past the first onset (step 0) and into the bar
    const callsBeforeHold = sampler.calls.length

    player.setHold(true)
    await pumpSteps(STEPS_PER_BAR)
    expect(sampler.calls.length).toBe(callsBeforeHold) // walk frozen
    expect(notesEvents().length).toBeGreaterThan(1) // but still sounding
  })

  it('reroll restarts capture from the seed', async () => {
    player.player.lengthBars = 1
    player.setTemplate(QUARTERS)
    player.player.mode = 'loop'
    player.start()
    await flush()
    await pumpSteps(STEPS_PER_BAR)

    player.reroll()
    await flush()
    expect(player.player.capturing).toBe(true)
    expect(player.player.phrase.size).toBe(0)
    expect(player.player.step).toBe(-1)
  })
})

describe('seeding', () => {
  it('noteIn converts pitch class to Root:maj and feeds the chain', async () => {
    player.noteIn(66, 100) // F#
    await flush()
    expect(sampler.calls).toContain('F#:maj')
    // Not playing -> reply sonified immediately
    expect(notesEvents().length).toBe(1)
  })

  it('noteIn ignores note-offs (velocity 0)', async () => {
    player.noteIn(60, 0)
    await flush()
    expect(sampler.calls.length).toBe(0)
  })

  it('manual submit updates the seed from the reply', async () => {
    player.submitChord('C:maj')
    await flush()
    expect(player.player.seed).toBe('G:7')
  })

  it('stale replies from a previous generation are dropped', async () => {
    const resolvers: Array<(v: { output: string }) => void> = []
    const slow = {
      sample: () => new Promise<{ output: string }>((r) => resolvers.push(r)),
    }
    const p2 = new AutoPlayer(slow, sonifier, emitter)
    p2.submitChord('C:maj') // in-flight request #1
    p2.start() // bumps generation (request #1 now stale) and issues request #2
    resolvers[0]({ output: 'Z:zz' }) // late reply to the stale request
    await flush()
    expect(p2.player.seed).not.toBe('Z:zz')
    resolvers[1]({ output: 'G:7' }) // current-generation reply still lands
    await flush()
    expect(p2.player.seed).toBe('G:7')
  })
})

describe('key + dial handlers', () => {
  it('composes the key from root + mode and notifies', () => {
    const keys: string[] = []
    player.onKeyChange = (k) => keys.push(k)
    player.setKeyRoot(9)
    player.setKeyMode('min')
    expect(player.currentKey()).toBe('A:min')
    expect(keys).toEqual(['A:maj', 'A:min'])
  })

  it('phrase length dial steps 8/16/24/32', () => {
    expect(player.setPhraseLenDial(0)).toBe(8)
    expect(player.setPhraseLenDial(1)).toBe(32)
  })

  it('rhythm change while playing is queued, immediate when stopped', () => {
    player.setRhythm(0) // stopped -> immediate (sparsest = template 1)
    expect(player.player.templateId).toBe(1)
    player.player.active = true
    player.setRhythm(1) // densest = template 12
    expect(player.player.templateId).toBe(1) // unchanged until boundary
    expect(player.player.pendingTemplateId).toBe(12)
  })
})
