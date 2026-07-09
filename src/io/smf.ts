/** Standard MIDI File (SMF) writer — pure, no DOM.
 *
 * Serializes a beat-timed chord progression to a format-0 (single-track) .mid
 * file that drags into any DAW. Chords sustain until the next chord's onset
 * (a `notes: []` event marks a silence boundary, e.g. from N.C.); the final
 * chord gets a short tail. Positions are in beats (quarter notes); the tempo
 * is written once as a meta event, so re-timing in the DAW just works.
 */

export interface ChordEvent {
  /** onset position in quarter-note beats from the take start */
  startBeat: number
  /** MIDI note numbers to sound (empty = a silence boundary) */
  notes: number[]
  velocity: number
}

export interface SmfOptions {
  bpm: number
  ppq?: number // ticks per quarter note (division)
  channel?: number // 0-based
  /** beats to hold the final chord (defaults to the last inter-onset gap) */
  tailBeats?: number
}

/** Variable-length quantity (big-endian, 7 bits/byte, high bit = continue). */
function vlq(value: number): number[] {
  let n = Math.max(0, Math.floor(value))
  const out = [n & 0x7f]
  n = Math.floor(n / 128)
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  return out
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff]
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

interface RawEvent {
  tick: number
  kind: 'off' | 'on'
  note: number
  vel: number
}

/** Serialize a chord progression to SMF bytes. */
export function writeSmf(chords: ChordEvent[], opts: SmfOptions): Uint8Array {
  const ppq = opts.ppq ?? 480
  const channel = (opts.channel ?? 0) & 0x0f

  // Default final-chord tail = the last inter-onset gap (clamped), else 4 beats.
  let tailBeats = opts.tailBeats
  if (tailBeats == null) {
    const withNotes = chords.filter((c) => c.notes.length > 0)
    if (withNotes.length >= 2) {
      const gap = withNotes[withNotes.length - 1].startBeat - withNotes[withNotes.length - 2].startBeat
      tailBeats = Math.min(8, Math.max(1, gap))
    } else {
      tailBeats = 4
    }
  }

  // Build note on/off pairs. Each chord holds until the NEXT event's onset
  // (chord or silence boundary); the last chord uses the tail.
  const raw: RawEvent[] = []
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i]
    if (c.notes.length === 0) continue // silence boundary contributes no notes
    const onTick = Math.round(c.startBeat * ppq)
    let offBeat: number
    if (i + 1 < chords.length) offBeat = chords[i + 1].startBeat
    else offBeat = c.startBeat + tailBeats
    let offTick = Math.round(offBeat * ppq)
    if (offTick <= onTick) offTick = onTick + 1 // never zero-length
    for (const note of c.notes) {
      const n = Math.max(0, Math.min(127, Math.round(note)))
      raw.push({ tick: onTick, kind: 'on', note: n, vel: Math.max(1, Math.min(127, c.velocity)) })
      raw.push({ tick: offTick, kind: 'off', note: n, vel: 0 })
    }
  }

  // Sort by tick; at equal ticks, note-offs precede note-ons so a repeated note
  // is released before it retriggers.
  raw.sort((a, b) => a.tick - b.tick || (a.kind === b.kind ? 0 : a.kind === 'off' ? -1 : 1))

  const track: number[] = []
  // Tempo meta at tick 0: FF 51 03 <usPerQuarter (24-bit)>
  const usPerQuarter = Math.round(60000000 / opts.bpm)
  track.push(...vlq(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff)

  let prevTick = 0
  for (const e of raw) {
    track.push(...vlq(e.tick - prevTick))
    prevTick = e.tick
    if (e.kind === 'on') track.push(0x90 | channel, e.note, e.vel)
    else track.push(0x80 | channel, e.note, 0)
  }
  // End of track: FF 2F 00
  track.push(...vlq(0), 0xff, 0x2f, 0x00)

  const header = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ppq)]
  const trackChunk = [...ascii('MTrk'), ...u32(track.length), ...track]
  return Uint8Array.from([...header, ...trackChunk])
}

/** True if the progression has at least one sounding chord. */
export function hasNotes(chords: ChordEvent[]): boolean {
  return chords.some((c) => c.notes.length > 0)
}
