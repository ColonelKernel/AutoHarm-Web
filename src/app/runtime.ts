/** Composition root — wires the pure engine to the browser IO adapters.
 *
 * Everything here is a module-level singleton created outside React. The UI
 * (zustand store) calls methods on the Runtime; engine events flow back into
 * the store via the emitter subscription set up in `store.ts`.
 */

import { Emitter } from '../engine/events'
import { MarkovEngine } from '../engine/markov/markovEngine'
import { loadCorpora, type RawCorpora } from '../engine/markov/corpusLoader'
import { Sonifier } from '../engine/player/sonifier'
import { AutoPlayer } from '../engine/player/autoPlayer'
import { ModelRegistry } from '../engine/registry'
import { mulberry32, randomSeed } from '../engine/random'
import { LookaheadClock } from '../io/clock'
import { PreviewSynth } from '../io/synth'
import { MidiIO } from '../io/midi'

export class Runtime {
  readonly emitter = new Emitter()
  markov!: MarkovEngine
  registry!: ModelRegistry
  sonifier!: Sonifier
  player!: AutoPlayer
  midi = new MidiIO()

  private ctx: AudioContext | null = null
  clock: LookaheadClock | null = null
  synth: PreviewSynth | null = null
  private loaded = false
  private bpm = 120 // last requested tempo, applied to the clock when it exists
  clockSource: 'internal' | 'external' = 'internal'
  private externalBpm: number | null = null

  /** Fetch corpora and build the engine graph (no AudioContext needed). */
  async load(): Promise<void> {
    if (this.loaded) return
    const res = await fetch(`${import.meta.env.BASE_URL}data/markov_corpora_t.json`)
    if (!res.ok) throw new Error(`corpora fetch failed: ${res.status}`)
    const raw = (await res.json()) as RawCorpora
    const corpora = loadCorpora(raw)

    this.markov = new MarkovEngine(corpora, { seed: randomSeed() })
    this.registry = new ModelRegistry(this.markov, { seed: randomSeed() })
    this.sonifier = new Sonifier(this.emitter, mulberry32(randomSeed()))
    this.player = new AutoPlayer(this.registry, this.sonifier, this.emitter)
    this.player.onKeyChange = (k) => this.markov.setKey(k)

    // Engine note/stop events -> audio + MIDI sinks.
    this.emitter.on((e) => {
      if (e.type === 'notes') {
        this.synth?.playChord(e.notes, e.velocity, e.at)
        this.midi.playChord(e.notes, e.velocity, this.audioTimeToMidiTs(e.at))
      } else if (e.type === 'stop') {
        this.synth?.releaseAll(e.at)
        this.midi.releaseAll(this.audioTimeToMidiTs(e.at))
      } else if (e.type === 'playoff') {
        this.clock?.stop()
      }
    })

    // MIDI input: notes seed the chain; pads/CC drive the performance map.
    this.midi.onNoteIn = (note, vel) => this.player.noteIn(note, vel)

    // External MIDI clock: when the clock source is 'external', the DAW's
    // transport drives everything — Start begins the walk, each 24th pulse is a
    // beat, Stop halts. The internal lookahead clock is idle in this mode.
    this.midi.onClockStart = () => {
      if (this.clockSource !== 'external') return
      this.ensureAudio()
      this.player.start()
    }
    this.midi.onClockContinue = () => {
      if (this.clockSource !== 'external') return
      this.ensureAudio()
      if (!this.player.player.active) this.player.start()
    }
    this.midi.onClockStop = () => {
      if (this.clockSource !== 'external') return
      this.player.stop('stopped')
      this.midi.allNotesOff()
    }
    this.midi.onClockBeat = () => {
      if (this.clockSource !== 'external' || !this.player.player.active) return
      // Reactive clock: schedule the chord a hair ahead of now so Web Audio /
      // Web MIDI don't get a start-in-the-past.
      const at = this.ctx ? this.ctx.currentTime + 0.005 : undefined
      this.player.onBeat(at)
    }
    this.midi.onClockTempo = (bpm) => {
      if (this.clockSource !== 'external') return
      this.externalBpm = bpm
      this.emitter.emit({ type: 'tempo', bpm })
    }

    this.loaded = true
  }

  /** Follow the DAW's MIDI clock ('external') or the internal clock. */
  setClockSource(src: 'internal' | 'external'): void {
    this.clockSource = src
    if (src === 'external') {
      // Hand transport to the DAW: stop the internal clock and any in-flight
      // playback so a clean Start/beat stream takes over.
      this.clock?.stop()
      this.stopTransport()
    }
  }

  get externalTempo(): number | null {
    return this.externalBpm
  }

  /** Set the transport tempo. Remembered even before the clock exists, so a
   * BPM chosen before the first Play is applied when the clock is created. */
  setBpm(bpm: number): void {
    this.bpm = bpm
    if (this.clock) this.clock.bpm = bpm
  }

  /** Create the audio graph + clock. Must be called from a user gesture. */
  ensureAudio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.synth = new PreviewSynth(this.ctx)
      this.clock = new LookaheadClock(this.ctx, (_beat, atTime) => {
        this.player.onBeat(atTime)
      })
      this.clock.bpm = this.bpm // apply any tempo chosen before first Play
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  startTransport(): void {
    this.ensureAudio()
    this.player.start()
    // In external mode the DAW's MIDI clock drives beats; leave the internal
    // clock idle so the two don't compete.
    if (this.clockSource === 'internal') this.clock!.start()
  }

  stopTransport(): void {
    this.player.stop('stopped')
    this.clock?.stop()
    this.midi.allNotesOff()
  }

  panic(): void {
    this.player.panic()
    this.midi.allNotesOff()
    this.synth?.releaseAll()
  }

  /** AudioContext seconds -> Web MIDI DOMHighResTimeStamp (ms). */
  private audioTimeToMidiTs(at?: number): number | undefined {
    if (at === undefined || !this.ctx) return undefined
    const offsetMs = performance.now() - this.ctx.currentTime * 1000
    return at * 1000 + offsetMs
  }
}

let runtime: Runtime | null = null

export function getRuntime(): Runtime {
  if (!runtime) runtime = new Runtime()
  return runtime
}
