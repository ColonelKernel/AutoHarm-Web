/** Composition root — wires the pure engine to the browser IO adapters.
 *
 * Everything here is a module-level singleton created outside React. The UI
 * (zustand store) calls methods on the Runtime; engine events flow back into
 * the store via the emitter subscription set up in `store.ts`.
 *
 * V2: the Runtime owns the generation session (seed, rhythm, phrase length)
 * and produces progressions OFFLINE via the generator; the ProgressionPlayer
 * only performs the canonical progression. A progression always exists before
 * playback (eager generation at load) because external MIDI Start plays
 * immediately.
 */

import { Emitter } from '../engine/events'
import { MarkovEngine } from '../engine/markov/markovEngine'
import { loadCorpora, type RawCorpora } from '../engine/markov/corpusLoader'
import { colorWeights } from '../engine/markov/blend'
import { Sonifier } from '../engine/player/sonifier'
import { ProgressionPlayer } from '../engine/player/progressionPlayer'
import {
  DEFAULT_TEMPLATE_ID,
  ROOT_NAMES,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  TEMPLATES,
  tileOnsets,
  type RhythmPattern,
} from '../engine/player/templates'
import { generateProgression, chainTail } from '../engine/progression/generator'
import { GenerationScheduler } from '../engine/progression/scheduler'
import type { Progression } from '../engine/progression/types'
import { swingDelaySteps, DEFAULT_SWING_UNIT, type SwingUnit } from '../engine/player/swing'
import { ModelRegistry } from '../engine/registry'
import { mulberry32, randomSeed } from '../engine/random'
import { LookaheadClock } from '../io/clock'
import { PreviewSynth } from '../io/synth'
import { MidiIO } from '../io/midi'
import { writeSmf, hasNotes, type ChordEvent } from '../io/smf'

const MAX_RECORDED_EVENTS = 8192 // backstop for very long loop takes

export type SwapTiming = 'now' | 'bar' | 'cycle'

export class Runtime {
  readonly emitter = new Emitter()
  markov!: MarkovEngine
  registry!: ModelRegistry
  sonifier!: Sonifier
  player!: ProgressionPlayer
  midi = new MidiIO()

  private ctx: AudioContext | null = null
  clock: LookaheadClock | null = null
  synth: PreviewSynth | null = null
  private loaded = false
  private bpm = 120 // last requested tempo, applied to the clock when it exists
  clockSource: 'internal' | 'external' = 'internal'
  private externalBpm: number | null = null

  // --- generation session ---
  private scheduler = new GenerationScheduler()
  seed = 'C:maj' // chord the chain (re)starts from = latest chord handled
  templateId = DEFAULT_TEMPLATE_ID
  /** Custom rhythm pattern (editor) overriding the template when set. */
  customPattern: RhythmPattern | null = null
  phraseSteps = 8 * STEPS_PER_BAR // 8 bars, V1's default phrase length

  // --- groove ---
  swing = 0 // 0 = straight .. 1 = hard shuffle (75:25)
  swingUnit: SwingUnit = DEFAULT_SWING_UNIT

  // --- MIDI recording (for .mid export) ---
  private currentStep = -1 // monotonic 16th-step counter within the current take
  private currentStepSwing = 0 // this step's swing delay, in steps
  private recordBase = 0 // step offset so a cleared/rebased take starts at 0
  private recorded: ChordEvent[] = [] // voiced chords captured while playing
  /** Called when the recording gains its first chord (UI enables Export). */
  onRecordingChanged: ((count: number) => void) | null = null

  /** Fetch corpora, build the engine graph, generate the initial progression. */
  async load(): Promise<void> {
    if (this.loaded) return
    const res = await fetch(`${import.meta.env.BASE_URL}data/markov_corpora_t.json`)
    if (!res.ok) throw new Error(`corpora fetch failed: ${res.status}`)
    const raw = (await res.json()) as RawCorpora
    const corpora = loadCorpora(raw)

    this.markov = new MarkovEngine(corpora, { seed: randomSeed() })
    this.registry = new ModelRegistry(this.markov, { seed: randomSeed() })
    this.sonifier = new Sonifier(this.emitter, mulberry32(randomSeed()))
    this.player = new ProgressionPlayer(this.sonifier, this.emitter)
    this.player.onKeyChange = (k) => this.markov.setKey(k)

    // Engine note/stop events -> audio + MIDI sinks (+ the recorder).
    this.emitter.on((e) => {
      if (e.type === 'notes') {
        this.synth?.playChord(e.notes, e.velocity, e.at)
        this.midi.playChord(e.notes, e.velocity, this.audioTimeToMidiTs(e.at))
        // Capture only auto-play notes (not manual auditions) at the take beat.
        if (this.player.state.active) this.record(e.notes, e.velocity)
      } else if (e.type === 'stop') {
        this.synth?.releaseAll(e.at)
        this.midi.releaseAll(this.audioTimeToMidiTs(e.at))
        // A 'stop' while still active is an N.C. silence boundary; a transport
        // stop fires 'stop' AFTER active is cleared, so it is (correctly) skipped.
        if (this.player.state.active) this.record([], 0)
      } else if (e.type === 'playoff') {
        this.clock?.stop()
      } else if (e.type === 'cycle') {
        this.onCycle()
      }
    })

    // MIDI input: notes route by app mode; pads/CC drive the performance map.
    this.midi.onNoteIn = (note, vel) => this.routeNoteIn(note, vel)

    // External MIDI clock: when the clock source is 'external', the DAW's
    // transport drives everything — Start begins playback, each 6th pulse is a
    // step, Stop halts. The internal lookahead clock is idle in this mode.
    this.midi.onClockStart = () => {
      if (this.clockSource !== 'external') return
      this.ensureAudio()
      this.beginTake()
      this.player.start()
    }
    this.midi.onClockContinue = () => {
      if (this.clockSource !== 'external') return
      this.ensureAudio()
      if (!this.player.state.active) {
        this.beginTake()
        this.player.start()
      }
    }
    this.midi.onClockStop = () => {
      if (this.clockSource !== 'external') return
      this.player.stop('stopped')
      this.midi.allNotesOff()
    }
    this.midi.onClockStep = () => {
      if (this.clockSource !== 'external' || !this.player.state.active) return
      // Reactive clock: schedule the chord a hair ahead of now so Web Audio /
      // Web MIDI don't get a start-in-the-past. Swing pushes it later still.
      const grid = this.ctx ? this.ctx.currentTime + 0.005 : undefined
      this.player.onStep(this.advanceStep(grid))
    }
    this.midi.onClockTempo = (bpm) => {
      if (this.clockSource !== 'external') return
      this.externalBpm = bpm
      this.emitter.emit({ type: 'tempo', bpm })
    }

    this.loaded = true
    // A progression must exist before the first Play / external Start.
    await this.generateNew()
  }

  /* --- generation session ----------------------------------------------------- */

  /** Onsets across the current phrase from the custom pattern or template. */
  private phraseOnsets(): number[] {
    const pattern = this.customPattern ?? TEMPLATES[this.templateId] ?? TEMPLATES[DEFAULT_TEMPLATE_ID]
    return tileOnsets(pattern, this.phraseSteps)
  }

  /** Blend profile in effect (markov only) — stamped into explanations. */
  private blendProfile(): Array<[string, number]> | undefined {
    if (this.registry.active !== 'markov') return undefined
    return [...colorWeights(this.markov.getState().color, null).entries()]
  }

  /** Generate a fresh progression (locked slots NOT preserved). */
  async generateNew(): Promise<Progression | null> {
    return this.runGeneration(undefined, this.seed)
  }

  /** Regenerate unlocked slots; locked slots survive (matched by order). */
  async generateVariation(): Promise<Progression | null> {
    const prior = this.player.activeProgression
    if (prior.slots.length === 0) return this.generateNew()
    return this.runGeneration(prior, chainTail(prior, this.seed))
  }

  /** Regenerate ONE slot: everything else is mask-locked for the walk, then
   * the user's real lock flags are restored. The slot's chain input is its
   * predecessor, so the reroll is context-aware by construction. */
  async rerollSlot(slotId: string): Promise<Progression | null> {
    const cur = this.player.activeProgression
    const idx = cur.slots.findIndex((s) => s.id === slotId)
    if (idx < 0) return null
    const masked: Progression = {
      slots: cur.slots.map((s, i) => ({ ...s, locked: i !== idx })),
      totalSteps: cur.totalSteps,
    }
    const explain = { blendProfile: this.blendProfile() }
    const onsets: number[] = []
    let step = 0
    for (const s of cur.slots) {
      onsets.push(step)
      step += s.durationSteps
    }
    const p = await this.scheduler.run((isCancelled) =>
      generateProgression(
        this.registry,
        { seed: chainTail(cur, this.seed), onsets, totalSteps: cur.totalSteps, prior: masked, explain, isCancelled },
        this.emitter,
      ),
    )
    if (!p) return null
    const locks = new Map(cur.slots.map((s) => [s.id, s.locked]))
    const fixed: Progression = {
      slots: p.slots.map((s) => ({ ...s, locked: locks.get(s.id) ?? false })),
      totalSteps: p.totalSteps,
    }
    this.player.setProgression(fixed, this.player.state.active ? 'cycle' : 'now')
    return fixed
  }

  private async runGeneration(prior: Progression | undefined, seed: string): Promise<Progression | null> {
    if (!this.loaded) return null
    const explain = { blendProfile: this.blendProfile() }
    const p = await this.scheduler.run((isCancelled) =>
      generateProgression(
        this.registry,
        { seed, onsets: this.phraseOnsets(), totalSteps: this.phraseSteps, prior, explain, isCancelled },
        this.emitter,
      ),
    )
    if (p) {
      this.player.setProgression(p, this.player.state.active ? 'cycle' : 'now')
      this.seed = chainTail(p, this.seed)
    }
    return p
  }

  /** Apply a user EDIT (already computed by the progression ops) to playback.
   * Structural edits land on the next bar downbeat while playing. */
  applyEdit(p: Progression, structural: boolean): void {
    this.player.setProgression(p, this.player.state.active && structural ? 'bar' : 'now')
  }

  /** True when every slot is untouched generator output — the "performable
   * dial" rule: rhythm/length changes may regenerate a pristine progression
   * live, but never silently discard manual edits or locks. */
  private pristine(): boolean {
    return this.player.activeProgression.slots.every((s) => s.source === 'generated' && !s.locked)
  }

  /** Rhythm template change. Returns true if it regenerated immediately. */
  setTemplate(id: number): boolean {
    this.templateId = TEMPLATES[id] ? id : this.templateId
    this.customPattern = null
    return this.maybeRegenerate()
  }

  setCustomPattern(pattern: RhythmPattern | null): boolean {
    this.customPattern = pattern
    return this.maybeRegenerate()
  }

  /** Phrase length in 16th steps. Returns true if it regenerated immediately. */
  setPhraseSteps(steps: number): boolean {
    const v = Math.round(steps)
    if (!Number.isFinite(v) || v < STEPS_PER_BAR / 2) return false
    this.phraseSteps = v
    return this.maybeRegenerate()
  }

  private maybeRegenerate(): boolean {
    if (!this.loaded) return false
    if (this.pristine()) {
      void this.generateVariation()
      return true
    }
    return false // takes effect on the next explicit Generate/Variation
  }

  setSeed(symbol: string): void {
    const v = symbol.trim()
    if (v) this.seed = v
  }

  /** Regen phrase mode: auto-variation kicked at cycle START so the walk has
   * a full cycle to finish before the boundary it lands on. */
  private onCycle(): void {
    if (this.player.state.mode !== 'regen' || this.player.state.hold) return
    void this.generateVariation()
  }

  /* --- MIDI input routing ------------------------------------------------------ */

  /** App-mode aware note routing (the MIDI adapter only reports events). */
  private routeNoteIn(note: number, velocity: number): void {
    if (velocity === 0) return // ignore note-offs for seeding
    const n = Math.round(Number(note))
    if (!Number.isFinite(n)) return
    const symbol = `${ROOT_NAMES[((n % 12) + 12) % 12]}:maj`
    if (this.player.state.active) {
      // V2: a played note steers by seeding a variation at the boundary
      // (V1 steered the very next onset; documented behavior change).
      this.seed = symbol
      void this.generateVariation()
    } else {
      this.seedChord(symbol)
    }
  }

  /** Stopped-state seeding: ask the model for a reply and audition it (V1). */
  seedChord(symbol: string): void {
    Promise.resolve(this.registry.sample(symbol)).then(
      (res) => {
        if (this.player.state.active) return // transport started meanwhile
        const out = res.output
        if (!out || res.error) {
          if (res.error) this.emitter.emit({ type: 'error', code: String(res.error) })
          return
        }
        this.seed = out
        this.emitter.emit({ type: 'output', symbol: out })
        this.sonifier.sonifyChord(out, 'seed')
      },
      (err) => this.emitter.emit({ type: 'error', code: String((err as Error)?.message || err) }),
    )
  }

  /* --- transport ---------------------------------------------------------------- */

  /** Follow the DAW's MIDI clock ('external') or the internal clock. */
  setClockSource(src: 'internal' | 'external'): void {
    this.clockSource = src
    if (src === 'external') {
      // Hand transport to the DAW: stop the internal clock and any in-flight
      // playback so a clean Start/step stream takes over.
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

  /** Swing amount 0..1. Takes effect on the next step — no boundary wait,
   * because swing shifts when chords sound, not which chords are chosen. */
  setSwing(amount: number): void {
    this.swing = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0
  }

  setSwingUnit(unit: SwingUnit): void {
    this.swingUnit = unit
  }

  /** Tempo actually governing the grid right now. */
  private get activeBpm(): number {
    return this.clockSource === 'external' ? (this.externalBpm ?? this.bpm) : this.bpm
  }

  private stepSeconds(): number {
    return 60 / (this.activeBpm * STEPS_PER_BEAT)
  }

  /**
   * Advance the take's step counter and turn the step's straight grid time into
   * the time it should actually sound, with swing applied. Both clock sources
   * funnel through here, so the synth, the MIDI port and the .mid export all
   * inherit the same groove.
   */
  private advanceStep(gridTime?: number): number | undefined {
    this.currentStep += 1
    this.currentStepSwing = swingDelaySteps(this.currentStep, this.swing, this.swingUnit)
    if (gridTime === undefined) return undefined
    return gridTime + this.currentStepSwing * this.stepSeconds()
  }

  /** Create the audio graph + clock. Must be called from a user gesture. */
  ensureAudio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.synth = new PreviewSynth(this.ctx)
      this.clock = new LookaheadClock(this.ctx, (_step, atTime) => {
        this.player.onStep(this.advanceStep(atTime))
      })
      this.clock.stepsPerBeat = STEPS_PER_BEAT // 16th-note grid
      this.clock.bpm = this.bpm // apply any tempo chosen before first Play
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  startTransport(): void {
    this.ensureAudio()
    this.beginTake()
    this.player.start()
    // In external mode the DAW's MIDI clock drives steps; leave the internal
    // clock idle so the two don't compete.
    if (this.clockSource === 'internal') this.clock!.start()
  }

  stopTransport(): void {
    this.scheduler.invalidate() // drop in-flight walks aimed at old playback
    this.player.stop('stopped')
    this.clock?.stop()
    this.midi.allNotesOff()
  }

  panic(): void {
    this.player.panic()
    this.midi.allNotesOff()
    this.synth?.releaseAll()
  }

  // --- recording / export ---------------------------------------------------

  /** Reset the step counter + recording at the start of a take. */
  private beginTake(): void {
    this.currentStep = -1
    this.currentStepSwing = 0
    this.recordBase = 0
    this.recorded = []
    this.onRecordingChanged?.(0)
  }

  /** Record a voiced chord (or a silence boundary) at the current take step.
   * The SMF writer positions events in quarter-note beats, so convert the
   * 16th-note step index (step / STEPS_PER_BEAT) — sub-beat onsets land as
   * fractional beats. The step's swing delay is folded in, so an exported
   * take is phrased exactly as it sounded rather than snapping back to
   * straight time. */
  private record(notes: number[], velocity: number): void {
    if (this.recorded.length >= MAX_RECORDED_EVENTS) return
    const step = Math.max(0, this.currentStep - this.recordBase) + this.currentStepSwing
    this.recorded.push({ startBeat: step / STEPS_PER_BEAT, notes: [...notes], velocity })
    this.onRecordingChanged?.(this.recorded.filter((c) => c.notes.length > 0).length)
  }

  /** Discard the captured take. If cleared mid-playback, rebase so the take
   * continues cleanly from beat 0 rather than leaving a long leading gap. */
  clearRecording(): void {
    this.recorded = []
    this.recordBase = this.currentStep + 1
    this.onRecordingChanged?.(0)
  }

  /** Whether there's a sounding progression available to export. */
  hasRecording(): boolean {
    return hasNotes(this.recorded)
  }

  /** Serialize the current recording to Standard MIDI File bytes (or null). */
  exportMidi(): Uint8Array | null {
    if (!hasNotes(this.recorded)) return null
    const bpm = this.clockSource === 'external' ? (this.externalBpm ?? 120) : this.bpm
    return writeSmf(this.recorded, { bpm })
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
