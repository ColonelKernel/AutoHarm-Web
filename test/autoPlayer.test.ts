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

async function pumpBeats(n: number) {
  for (let i = 0; i < n; i++) {
    player.onBeat()
    await flush()
  }
}

describe('templates', () => {
  it('slot onsets match the original tables', () => {
    expect(TEMPLATES[2].onsets).toEqual([0, 2])
    expect(isSlotOnset(2, 0)).toBe(true)
    expect(isSlotOnset(2, 1)).toBe(false)
    expect(isSlotOnset(2, 2)).toBe(true)
    expect(isSlotOnset(7, 0)).toBe(true)
    expect(isSlotOnset(7, 4)).toBe(false) // 2-bar template: only beat 0 of 8
  })

  it('rhythm dial sweeps sparse -> dense', () => {
    expect(rhythmToTemplate(0)).toBe(7) // static_2bar
    expect(rhythmToTemplate(1)).toBe(3) // four_quarters
  })
})

describe('capture and loop replay', () => {
  it('captures a phrase then replays it without engine calls', async () => {
    player.player.lengthBars = 1 // 4 beats per cycle
    player.setTemplate(3) // four_quarters: onset every beat
    player.player.mode = 'loop'
    player.start()
    await flush() // resolve the initial seed fetch

    await pumpBeats(4) // capture cycle
    const captured = chordEvents().map((e) => e.symbol)
    expect(captured.length).toBe(4)
    const callsAfterCapture = sampler.calls.length

    await pumpBeats(4) // replay cycle
    const replayed = chordEvents().slice(4).map((e) => e.symbol)
    expect(replayed).toEqual(captured) // deterministic replay
    expect(sampler.calls.length).toBe(callsAfterCapture) // no new engine calls
  })

  it('regen mode re-walks the chain each cycle', async () => {
    player.player.lengthBars = 1
    player.setTemplate(3)
    player.player.mode = 'regen'
    player.start()
    await flush()

    await pumpBeats(4)
    const callsAfterFirst = sampler.calls.length
    await pumpBeats(4)
    expect(sampler.calls.length).toBeGreaterThan(callsAfterFirst) // kept sampling
  })

  it('oneshot stops with playoff at the cycle end', async () => {
    player.player.lengthBars = 1
    player.setTemplate(3)
    player.player.mode = 'oneshot'
    player.start()
    await flush()

    await pumpBeats(5) // 4 beats + the boundary tick
    expect(player.player.active).toBe(false)
    expect(events.some((e) => e.type === 'playoff')).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.value === 'done')).toBe(true)
  })
})

describe('hold and reroll', () => {
  it('hold vamps without advancing the walk', async () => {
    player.player.lengthBars = 1
    player.setTemplate(3)
    player.player.mode = 'loop'
    player.start()
    await flush()
    await pumpBeats(2)
    const callsBeforeHold = sampler.calls.length

    player.setHold(true)
    await pumpBeats(4)
    expect(sampler.calls.length).toBe(callsBeforeHold) // walk frozen
    expect(notesEvents().length).toBeGreaterThan(2) // but still sounding
  })

  it('reroll restarts capture from the seed', async () => {
    player.player.lengthBars = 1
    player.setTemplate(3)
    player.player.mode = 'loop'
    player.start()
    await flush()
    await pumpBeats(4)

    player.reroll()
    await flush()
    expect(player.player.capturing).toBe(true)
    expect(player.player.phrase.size).toBe(0)
    expect(player.player.beat).toBe(-1)
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
    player.setRhythm(0) // stopped -> immediate
    expect(player.player.templateId).toBe(7)
    player.player.active = true
    player.setRhythm(1)
    expect(player.player.templateId).toBe(7) // unchanged until boundary
    expect(player.player.pendingTemplateId).toBe(3)
  })
})
