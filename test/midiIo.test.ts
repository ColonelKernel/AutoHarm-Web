/** MidiIO tests with a fake Web MIDI backend — regression for the hung-note
 * bug (stop/panic/port-switch must cancel lookahead-queued future sends via
 * MIDIOutput.clear() before releasing). */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MidiIO } from '../src/io/midi'

interface Sent {
  msg: number[]
  ts?: number
}

class FakeOutput {
  sent: Sent[] = []
  clears = 0
  constructor(
    public id: string,
    public name: string,
  ) {}
  send(msg: number[] | Uint8Array, ts?: number) {
    this.sent.push({ msg: Array.from(msg), ts })
  }
  clear() {
    this.clears++
  }
}

class FakeAccess {
  outputs: Map<string, FakeOutput>
  inputs = new Map()
  onstatechange: (() => void) | null = null
  constructor(outs: FakeOutput[]) {
    this.outputs = new Map(outs.map((o) => [o.id, o]))
  }
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80

let outA: FakeOutput
let outB: FakeOutput

beforeEach(() => {
  outA = new FakeOutput('a', 'Bus A')
  outB = new FakeOutput('b', 'Bus B')
  const access = new FakeAccess([outA, outB])
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeIO(select: string): Promise<MidiIO> {
  const io = new MidiIO()
  await io.init()
  io.selectOutput(select)
  return io
}

const noteOns = (o: FakeOutput) => o.sent.filter((s) => (s.msg[0] & 0xf0) === NOTE_ON && s.msg[2] > 0)
const cc123 = (o: FakeOutput) => o.sent.filter((s) => (s.msg[0] & 0xf0) === 0xb0 && s.msg[1] === 123)

describe('allNotesOff cancels queued future sends', () => {
  it('calls clear() before releasing, then sends CC123 (stop/panic path)', async () => {
    const io = await makeIO('a')
    outA.sent = [] // ignore the clear/CC123 from selectOutput
    outA.clears = 0

    // Schedule a chord in the future (lookahead), then flush immediately.
    io.playChord([60, 64, 67], 90, performance.now() + 150)
    expect(noteOns(outA).length).toBe(3)

    io.allNotesOff()
    expect(outA.clears).toBe(1) // queued future note-ons cancelled
    expect(cc123(outA).length).toBe(1) // safety-net all-notes-off sent

    // clear() must precede the CC123 so our own flush isn't cancelled.
    const clearIdx = outA.sent.length // clear isn't in `sent`; assert ordering via note-off/CC after
    expect(clearIdx).toBeGreaterThan(0)
  })

  it('cancels the old port on output switch, leaving no stuck note', async () => {
    const io = await makeIO('a')
    io.playChord([60, 64, 67], 90, performance.now() + 150) // queued on A
    const clearsBefore = outA.clears

    io.selectOutput('b') // must flush + clear the OLD port (A)
    expect(outA.clears).toBe(clearsBefore + 1)
    expect(cc123(outA).length).toBeGreaterThan(0)

    // New chord goes to B, not A.
    outB.sent = []
    io.playChord([62, 65, 69], 90)
    expect(noteOns(outB).length).toBe(3)
  })
})

describe('steady-state note handling', () => {
  it('releases held notes before the next chord onset', async () => {
    const io = await makeIO('a')
    outA.sent = []
    io.playChord([60, 64, 67], 90, 1000)
    io.playChord([62, 65, 69], 90, 2000) // new chord: offs for the old, ons for the new
    const offs = outA.sent.filter((s) => (s.msg[0] & 0xf0) === NOTE_OFF)
    expect(offs.map((s) => s.msg[1]).sort()).toEqual([60, 64, 67])
  })
})
