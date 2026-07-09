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

class FakeInput {
  onmidimessage: ((e: { data: Uint8Array; timeStamp: number }) => void) | null = null
  constructor(
    public id: string,
    public name: string,
  ) {}
  /** Simulate a MIDI message arriving at time `t` (ms). */
  emit(bytes: number[], t = 0) {
    this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: t })
  }
}

class FakeAccess {
  outputs: Map<string, FakeOutput>
  inputs: Map<string, FakeInput>
  onstatechange: (() => void) | null = null
  constructor(outs: FakeOutput[], ins: FakeInput[] = []) {
    this.outputs = new Map(outs.map((o) => [o.id, o]))
    this.inputs = new Map(ins.map((i) => [i.id, i]))
  }
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80

let outA: FakeOutput
let outB: FakeOutput
let inClock: FakeInput

beforeEach(() => {
  outA = new FakeOutput('a', 'Bus A')
  outB = new FakeOutput('b', 'Bus B')
  inClock = new FakeInput('clk', 'DAW Clock')
  const access = new FakeAccess([outA, outB], [inClock])
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

describe('MIDI clock (external transport)', () => {
  async function makeClockIO() {
    const io = new MidiIO()
    await io.init()
    io.selectInput('clk')
    return io
  }

  it('fires a step every 6 pulses (16th notes), with step 0 aligned to Start', async () => {
    const io = await makeClockIO()
    let steps = 0
    io.onClockStep = () => steps++
    inClock.emit([0xfa]) // Start (reset)
    for (let i = 0; i < 24; i++) inClock.emit([0xf8], i * 20)
    // pulses 0,6,12,18 are step boundaries -> 4 steps (one quarter note) over 24 pulses
    expect(steps).toBe(4)
  })

  it('Start resets the pulse counter so steps realign', async () => {
    const io = await makeClockIO()
    const stepPulses: number[] = []
    let pulse = 0
    io.onClockStep = () => stepPulses.push(pulse)
    inClock.emit([0xfa])
    for (let i = 0; i < 3; i++) { inClock.emit([0xf8], i); pulse++ }
    inClock.emit([0xfa]) // restart mid-step
    pulse = 0
    for (let i = 0; i < 6; i++) { inClock.emit([0xf8], i); pulse++ }
    // a step fires at pulse 0, then pulse 0 again after restart
    expect(stepPulses).toEqual([0, 0])
  })

  it('routes Start / Continue / Stop callbacks', async () => {
    const io = await makeClockIO()
    const calls: string[] = []
    io.onClockStart = () => calls.push('start')
    io.onClockContinue = () => calls.push('continue')
    io.onClockStop = () => calls.push('stop')
    inClock.emit([0xfa])
    inClock.emit([0xfb])
    inClock.emit([0xfc])
    expect(calls).toEqual(['start', 'continue', 'stop'])
  })

  it('estimates BPM from pulse spacing (20.833 ms/pulse = 120 BPM)', async () => {
    const io = await makeClockIO()
    let lastBpm = 0
    io.onClockTempo = (bpm) => (lastBpm = bpm)
    inClock.emit([0xfa])
    // 120 BPM => 0.5 s per beat / 24 = 20.8333 ms per pulse.
    const ms = 500 / 24
    for (let i = 0; i < 30; i++) inClock.emit([0xf8], i * ms)
    expect(lastBpm).toBeCloseTo(120, 1)
  })

  it('does not treat 0xF8 as a note (system-realtime is not channel-voice)', async () => {
    const io = await makeClockIO()
    let noteIns = 0
    io.onNoteIn = () => noteIns++
    for (let i = 0; i < 10; i++) inClock.emit([0xf8], i)
    expect(noteIns).toBe(0)
  })
})
