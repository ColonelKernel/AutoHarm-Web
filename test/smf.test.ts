/** SMF writer tests — encode a progression, then re-parse the bytes to verify
 * ticks, note on/off ordering, tempo, and header structure. */

import { describe, expect, it } from 'vitest'
import { writeSmf, hasNotes, type ChordEvent } from '../src/io/smf'

/** Minimal SMF reader for tests: returns header info + a flat event list. */
function parseSmf(bytes: Uint8Array) {
  let p = 0
  const str = (n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++])
    return s
  }
  const u32 = () => ((bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]) >>> 0
  const u16 = () => (bytes[p++] << 8) | bytes[p++]

  expect(str(4)).toBe('MThd')
  expect(u32()).toBe(6)
  const format = u16()
  const ntrks = u16()
  const division = u16()

  expect(str(4)).toBe('MTrk')
  const trackLen = u32()
  const end = p + trackLen

  const events: Array<{ tick: number; type: string; note?: number; vel?: number; usPerQuarter?: number }> = []
  let tick = 0
  const readVlq = () => {
    let v = 0
    for (;;) {
      const b = bytes[p++]
      v = (v << 7) | (b & 0x7f)
      if ((b & 0x80) === 0) break
    }
    return v
  }
  while (p < end) {
    tick += readVlq()
    const status = bytes[p++]
    if (status === 0xff) {
      const meta = bytes[p++]
      const len = readVlq()
      if (meta === 0x51) {
        const usPerQuarter = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]
        events.push({ tick, type: 'tempo', usPerQuarter })
      } else if (meta === 0x2f) {
        events.push({ tick, type: 'end' })
      }
      p += len
    } else if ((status & 0xf0) === 0x90) {
      events.push({ tick, type: 'on', note: bytes[p++], vel: bytes[p++] })
    } else if ((status & 0xf0) === 0x80) {
      events.push({ tick, type: 'off', note: bytes[p++], vel: bytes[p++] })
    } else {
      throw new Error(`unexpected status 0x${status.toString(16)} at ${p}`)
    }
  }
  return { format, ntrks, division, events, trackLenOk: p === end }
}

describe('writeSmf', () => {
  it('writes a valid format-0 header with the requested division', () => {
    const smf = writeSmf([{ startBeat: 0, notes: [60], velocity: 90 }], { bpm: 120, ppq: 480 })
    const { format, ntrks, division, trackLenOk } = parseSmf(smf)
    expect(format).toBe(0)
    expect(ntrks).toBe(1)
    expect(division).toBe(480)
    expect(trackLenOk).toBe(true)
  })

  it('encodes tempo as microseconds per quarter note', () => {
    const smf = writeSmf([{ startBeat: 0, notes: [60], velocity: 90 }], { bpm: 120 })
    const tempo = parseSmf(smf).events.find((e) => e.type === 'tempo')!
    expect(tempo.usPerQuarter).toBe(500000) // 60_000_000 / 120
  })

  it('places chords at beat*ppq and holds until the next onset', () => {
    const chords: ChordEvent[] = [
      { startBeat: 0, notes: [48, 52, 55], velocity: 90 }, // C major
      { startBeat: 2, notes: [50, 53, 57], velocity: 90 }, // D minor at beat 2
    ]
    const { events } = parseSmf(writeSmf(chords, { bpm: 120, ppq: 480, tailBeats: 2 }))
    const ons = events.filter((e) => e.type === 'on')
    const offs = events.filter((e) => e.type === 'off')
    expect(ons.filter((e) => e.tick === 0).map((e) => e.note).sort()).toEqual([48, 52, 55])
    // C major turns off exactly when D minor turns on (beat 2 = tick 960).
    expect(offs.filter((e) => e.tick === 960).map((e) => e.note).sort()).toEqual([48, 52, 55])
    expect(ons.filter((e) => e.tick === 960).map((e) => e.note).sort()).toEqual([50, 53, 57])
    // final chord tail = 2 beats -> off at tick 960 + 960 = 1920.
    expect(offs.filter((e) => e.tick === 1920).map((e) => e.note).sort()).toEqual([50, 53, 57])
  })

  it('emits note-offs before note-ons at the same tick (clean retrigger)', () => {
    const chords: ChordEvent[] = [
      { startBeat: 0, notes: [60], velocity: 90 },
      { startBeat: 1, notes: [60], velocity: 90 }, // same note repeats
    ]
    const { events } = parseSmf(writeSmf(chords, { bpm: 120, ppq: 480 }))
    const atOnset = events.filter((e) => e.tick === 480 && (e.type === 'on' || e.type === 'off'))
    expect(atOnset[0].type).toBe('off') // release precedes retrigger
    expect(atOnset[1].type).toBe('on')
  })

  it('treats an empty-notes event as a silence boundary', () => {
    const chords: ChordEvent[] = [
      { startBeat: 0, notes: [60], velocity: 90 },
      { startBeat: 2, notes: [], velocity: 0 }, // N.C. at beat 2
      { startBeat: 4, notes: [67], velocity: 90 },
    ]
    const { events } = parseSmf(writeSmf(chords, { bpm: 120, ppq: 480 }))
    // The first chord ends at the silence boundary (tick 960), not at beat 4.
    expect(events.find((e) => e.type === 'off' && e.note === 60)!.tick).toBe(960)
    // Nothing sounds between the boundary and the next chord.
    const between = events.filter((e) => e.type === 'on' && e.tick > 960 && e.tick < 1920)
    expect(between.length).toBe(0)
  })

  it('handles large deltas via multi-byte VLQ', () => {
    const smf = writeSmf([{ startBeat: 1000, notes: [60], velocity: 90 }], { bpm: 120, ppq: 480 })
    const on = parseSmf(smf).events.find((e) => e.type === 'on')!
    expect(on.tick).toBe(480000) // 1000 * 480, needs 3 VLQ bytes
  })

  it('hasNotes reflects whether anything sounds', () => {
    expect(hasNotes([{ startBeat: 0, notes: [], velocity: 0 }])).toBe(false)
    expect(hasNotes([{ startBeat: 0, notes: [60], velocity: 90 }])).toBe(true)
  })
})
