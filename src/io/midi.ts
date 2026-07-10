/** Web MIDI adapter — DAW-agnostic note output + controller input.
 *
 * Output: sends the generated chords out a user-selected MIDI port (an IAC
 * bus on macOS / loopMIDI on Windows), which any DAW records as an ordinary
 * MIDI device. Notes sustain until the next chord onset; note-offs for held
 * notes are timestamped together with the new note-ons (Web MIDI honors
 * future DOMHighResTimeStamps, keeping jitter at the lookahead's mercy).
 *
 * Input: note-ons seed the chord chain (the patch's `midiin -> notein` path);
 * program changes and CCs feed the MPK-style performance mapping.
 */

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0
const PROGRAM_CHANGE = 0xc0

// System real-time (single-byte) messages — matched on the FULL status byte,
// not `& 0xf0`. A DAW sending MIDI clock emits 0xF8 at 24 pulses per quarter
// note (PPQN) and 0xFA/0xFB/0xFC for start/continue/stop.
const CLOCK = 0xf8
const START = 0xfa
const CONTINUE = 0xfb
const STOP = 0xfc

const PPQN = 24 // MIDI-clock pulses per quarter note
// Fire a sequencer step every 6 pulses = a 16th note (matches the engine's
// STEPS_PER_BEAT = 4; kept local so io/ stays decoupled from engine/).
const PULSES_PER_STEP = PPQN / 4

export interface MidiPortInfo {
  id: string
  name: string
}

export class MidiIO {
  private access: MIDIAccess | null = null
  private output: MIDIOutput | null = null
  private input: MIDIInput | null = null
  private heldNotes = new Set<number>()
  channel = 0 // 0-based (channel 1)

  onNoteIn: ((note: number, velocity: number) => void) | null = null
  onProgramChange: ((program: number) => void) | null = null
  onControlChange: ((num: number, value: number) => void) | null = null
  onPortsChanged: (() => void) | null = null

  // MIDI-clock (external transport) callbacks — driven by the selected input.
  onClockStep: (() => void) | null = null // every 6th pulse (a 16th note)
  onClockStart: (() => void) | null = null // 0xFA
  onClockContinue: (() => void) | null = null // 0xFB
  onClockStop: (() => void) | null = null // 0xFC
  onClockTempo: ((bpm: number) => void) | null = null // periodic tempo estimate

  private clockPulses = 0
  private pulseTimes: number[] = [] // recent pulse timestamps (ms) for BPM

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async init(): Promise<void> {
    if (this.access) return
    this.access = await navigator.requestMIDIAccess({ sysex: false })
    this.access.onstatechange = () => this.onPortsChanged?.()
  }

  outputs(): MidiPortInfo[] {
    if (!this.access) return []
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }))
  }

  inputs(): MidiPortInfo[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id }))
  }

  selectOutput(id: string | null): void {
    this.allNotesOff() // never leave notes hanging on the old port
    this.output = id && this.access ? (this.access.outputs.get(id) ?? null) : null
  }

  selectInput(id: string | null): void {
    if (this.input) this.input.onmidimessage = null
    this.input = id && this.access ? (this.access.inputs.get(id) ?? null) : null
    if (this.input) {
      this.input.onmidimessage = (e: MIDIMessageEvent) => this.handleMessage(e)
    }
  }

  get hasOutput(): boolean {
    return this.output !== null
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data
    if (!data || data.length === 0) return
    const b0 = data[0]

    // System real-time messages are single-byte (0xF8..0xFF) and can interleave
    // anywhere; handle them on the full status byte before channel-voice masking.
    if (b0 >= 0xf8) {
      if (b0 === CLOCK) this.onClockPulse(e.timeStamp)
      else if (b0 === START) this.startClock(true)
      else if (b0 === CONTINUE) this.startClock(false)
      else if (b0 === STOP) this.onClockStop?.()
      return
    }

    const status = b0 & 0xf0
    if (status === NOTE_ON && data[2] > 0) this.onNoteIn?.(data[1], data[2])
    else if (status === NOTE_ON || status === NOTE_OFF) this.onNoteIn?.(data[1], 0)
    else if (status === PROGRAM_CHANGE) this.onProgramChange?.(data[1])
    else if (status === CC) this.onControlChange?.(data[1], data[2])
  }

  /** 0xFA (start=true, reset to bar 0) / 0xFB (continue=false, resume). */
  private startClock(reset: boolean): void {
    if (reset) {
      this.clockPulses = 0
      this.pulseTimes = []
      this.onClockStart?.()
    } else {
      this.onClockContinue?.()
    }
  }

  /** One 0xF8 pulse. Fires a step every 6 pulses (on the pulse itself, so step
   * 0 aligns with Start) and periodically estimates tempo from pulse spacing. */
  private onClockPulse(timeStamp: number): void {
    this.pulseTimes.push(timeStamp)
    if (this.pulseTimes.length > PPQN + 1) this.pulseTimes.shift()

    // Fire the step BEFORE incrementing so pulse 0 == step 0 (aligned to Start).
    // Tempo is published first: the step handler needs an up-to-date BPM to size
    // its swing delay, which is a fraction of a step.
    if (this.clockPulses % PULSES_PER_STEP === 0) {
      const bpm = this.estimateBpm()
      if (bpm !== null) this.onClockTempo?.(bpm)
      this.onClockStep?.()
    }
    this.clockPulses += 1
  }

  /** Estimate BPM from the mean spacing of recent 0xF8 pulses (null if too few). */
  private estimateBpm(): number | null {
    if (this.pulseTimes.length < 2) return null
    const span = this.pulseTimes[this.pulseTimes.length - 1] - this.pulseTimes[0]
    const intervals = this.pulseTimes.length - 1
    if (span <= 0) return null
    const msPerPulse = span / intervals
    const bpm = 60000 / (msPerPulse * PPQN)
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) return null
    return bpm
  }

  /**
   * Send a chord at `atMs` (DOMHighResTimeStamp; undefined = now): note-offs
   * for currently-held notes, then note-ons for the new chord, same timestamp.
   */
  playChord(notes: number[], velocity: number, atMs?: number): void {
    if (!this.output) return
    const ts = atMs
    for (const n of this.heldNotes) {
      this.send([NOTE_OFF | this.channel, n, 0], ts)
    }
    this.heldNotes.clear()
    for (const n of notes) {
      this.send([NOTE_ON | this.channel, n, velocity], ts)
      this.heldNotes.add(n)
    }
  }

  /** Release held notes at `atMs` (or now). */
  releaseAll(atMs?: number): void {
    if (!this.output) return
    for (const n of this.heldNotes) {
      this.send([NOTE_OFF | this.channel, n, 0], atMs)
    }
    this.heldNotes.clear()
  }

  /** Immediate flush — cancel queued future sends, then held note-offs + CC123.
   *
   * The lookahead clock queues NOTE_ONs up to ~0.15 s in the future via
   * timestamped send(). A note-off at `now` would be delivered BEFORE such a
   * queued NOTE_ON, leaving it stuck. `MIDIOutput.clear()` is the only Web MIDI
   * way to cancel those pending sends, so we clear FIRST (before re-sending the
   * offs, so our own offs aren't cancelled). CC123 is the safety net for any
   * note that already sounded. Used on stop / panic / output switch. */
  allNotesOff(): void {
    if (!this.output) return
    // `clear()` is in the Web MIDI spec but missing from the DOM lib types.
    const out = this.output as MIDIOutput & { clear?: () => void }
    if (typeof out.clear === 'function') out.clear()
    for (const n of this.heldNotes) {
      this.send([NOTE_OFF | this.channel, n, 0])
    }
    this.heldNotes.clear()
    this.send([CC | this.channel, 123, 0])
  }

  private send(msg: number[], atMs?: number): void {
    try {
      if (atMs !== undefined) this.output!.send(msg, atMs)
      else this.output!.send(msg)
    } catch {
      // port may have vanished; state-change handler will refresh the UI
    }
  }
}
