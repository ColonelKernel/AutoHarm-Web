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
    const status = data[0] & 0xf0
    if (status === NOTE_ON && data[2] > 0) this.onNoteIn?.(data[1], data[2])
    else if (status === NOTE_ON || status === NOTE_OFF) this.onNoteIn?.(data[1], 0)
    else if (status === PROGRAM_CHANGE) this.onProgramChange?.(data[1])
    else if (status === CC) this.onControlChange?.(data[1], data[2])
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
