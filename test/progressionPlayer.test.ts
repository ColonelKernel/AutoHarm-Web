/** ProgressionPlayer — performs the canonical progression. Deterministic:
 * manual step pumping, no clock/audio/MIDI (same idiom as the V1 player
 * tests). Playback must never generate; the progression is stable data. */

import { beforeEach, describe, expect, it } from 'vitest'
import { ProgressionPlayer } from '../src/engine/player/progressionPlayer'
import { Sonifier } from '../src/engine/player/sonifier'
import { Emitter, type PlayerEvent } from '../src/engine/events'
import { makeProgression, makeSlot, type Progression } from '../src/engine/progression/types'

let emitter: Emitter
let sonifier: Sonifier
let player: ProgressionPlayer
let events: PlayerEvent[]

beforeEach(() => {
  emitter = new Emitter()
  sonifier = new Sonifier(emitter, () => 0.5)
  player = new ProgressionPlayer(sonifier, emitter)
  events = []
  emitter.on((e) => events.push(e))
})

const chordEvents = () => events.filter((e) => e.type === 'chord') as Array<{ type: 'chord'; symbol: string }>
const cycleEvents = () => events.filter((e) => e.type === 'cycle') as Array<{ type: 'cycle'; index: number }>

/** C | F | G | C over one bar (4 quarter-note slots). */
function oneBar(): Progression {
  return makeProgression([
    makeSlot('C:maj', 4, 'generated'),
    makeSlot('F:maj', 4, 'generated'),
    makeSlot('G:maj', 4, 'generated'),
    makeSlot('C:maj', 4, 'generated'),
  ])
}

function pump(n: number) {
  for (let i = 0; i < n; i++) player.onStep()
}

describe('slot walk', () => {
  it('strikes each slot at its onset step and wraps in loop mode', () => {
    player.setProgression(oneBar())
    player.setMode('loop')
    player.start()
    pump(16)
    expect(chordEvents().map((e) => e.symbol)).toEqual(['C:maj', 'F:maj', 'G:maj', 'C:maj'])
    pump(16) // second cycle: identical replay, no generation involved
    expect(chordEvents().map((e) => e.symbol).slice(4)).toEqual(['C:maj', 'F:maj', 'G:maj', 'C:maj'])
    expect(cycleEvents().map((e) => e.index)).toEqual([0, 1])
  })

  it('respects uneven durations (charleston: 10 + 6)', () => {
    const p = makeProgression([makeSlot('C:maj', 10, 'generated'), makeSlot('G:7', 6, 'generated')])
    player.setProgression(p)
    player.start()
    pump(10)
    expect(chordEvents().length).toBe(1) // only step 0 struck so far
    pump(1) // step 10
    expect(chordEvents().map((e) => e.symbol)).toEqual(['C:maj', 'G:7'])
  })

  it('oneshot stops with playoff and "done" at the phrase end', () => {
    player.setProgression(oneBar())
    player.setMode('oneshot')
    player.start()
    pump(17) // one bar + the boundary tick
    expect(player.state.active).toBe(false)
    expect(events.some((e) => e.type === 'playoff')).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.value === 'done')).toBe(true)
  })

  it('does nothing when no progression is set', () => {
    player.start()
    pump(8)
    expect(chordEvents().length).toBe(0)
  })
})

describe('staged swaps', () => {
  it('a cycle-staged progression lands exactly at the wrap, first slot intact', () => {
    player.setProgression(oneBar())
    player.start()
    pump(8) // mid-phrase
    const next = makeProgression([makeSlot('D:min', 8, 'generated'), makeSlot('A:7', 8, 'generated')])
    player.stageNext(next)
    pump(8) // finish cycle 0 — old chords still sounding
    expect(chordEvents().map((e) => e.symbol)).toEqual(['C:maj', 'F:maj', 'G:maj', 'C:maj'])
    pump(1) // boundary: swap THEN play new slot 0
    expect(chordEvents().at(-1)?.symbol).toBe('D:min')
    expect(player.activeProgression).toBe(next)
  })

  it('a bar-staged progression lands at the next bar downbeat, position preserved', () => {
    const twoBars = makeProgression([
      makeSlot('C:maj', 16, 'generated'),
      makeSlot('F:maj', 16, 'generated'),
    ])
    player.setProgression(twoBars)
    player.start()
    pump(8) // inside bar 1
    const edited = makeProgression([
      makeSlot('C:maj', 16, 'generated'),
      makeSlot('D:min7', 16, 'generated'),
    ])
    player.setProgression(edited, 'bar')
    expect(player.activeProgression).toBe(twoBars) // not yet
    pump(9) // position 8 -> 16 = bar 2 downbeat
    expect(player.activeProgression).toBe(edited)
    expect(chordEvents().at(-1)?.symbol).toBe('D:min7') // bar-2 onset from the new plan
  })

  it('replaces immediately when stopped', () => {
    player.setProgression(oneBar())
    const next = makeProgression([makeSlot('E:min', 16, 'generated')])
    player.setProgression(next, 'cycle') // stopped -> immediate anyway
    expect(player.activeProgression).toBe(next)
  })
})

describe('hold and mute', () => {
  it('hold vamps the latched slot at every onset while position advances', () => {
    player.setProgression(oneBar())
    player.start()
    pump(5) // slot 1 (F) is current
    player.setHold(true)
    pump(8) // onsets at steps 8, 12 -> vamp F, not G/C
    const symbols = chordEvents().map((e) => e.symbol)
    expect(symbols.slice(-2)).toEqual(['F:maj', 'F:maj'])
    player.setHold(false)
    pump(4) // wraps to step 0+ -> normal walk resumes
    expect(chordEvents().at(-1)?.symbol).toBe('C:maj')
  })

  it('mute silences onsets but keeps the grid and cycles running', () => {
    player.setProgression(oneBar())
    player.start()
    player.setMuted(true)
    pump(17)
    expect(chordEvents().length).toBe(0)
    expect(cycleEvents().length).toBe(2) // boundaries still observed
    expect(events.some((e) => e.type === 'stop')).toBe(true) // silenced on mute
    player.setMuted(false)
    pump(4) // position 0 -> 4, the next onset of cycle 1
    expect(chordEvents().length).toBeGreaterThan(0)
  })
})

describe('key + mode handlers (carried from V1)', () => {
  it('composes the key from root + mode and notifies', () => {
    const keys: string[] = []
    player.onKeyChange = (k) => keys.push(k)
    player.setKeyRoot(9)
    player.setKeyMode('min')
    expect(player.currentKey()).toBe('A:min')
    expect(keys).toEqual(['A:maj', 'A:min'])
  })

  it('cycleMode walks loop -> regen -> oneshot', () => {
    player.setMode('loop')
    expect(player.cycleMode()).toBe('regen')
    expect(player.cycleMode()).toBe('oneshot')
    expect(player.cycleMode()).toBe('loop')
  })
})
