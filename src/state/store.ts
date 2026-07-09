/** zustand store — serializable UI state only. Engine instances live in the
 * Runtime singleton; UI events call runtime methods, engine events patch the
 * store through the emitter subscription in `initApp()`. */

import { create } from 'zustand'
import { getRuntime } from '../app/runtime'
import { decodePgm, ccToParam, MODES, SEED_LIST, KEY_ROOTS, type PlayerMode } from '../engine/voicing/performanceMap'
import { MidiIO, type MidiPortInfo } from '../io/midi'
import { downloadBytes } from '../io/download'
import type { ModelName, SessionMode } from '../engine/markov/config'

export interface HistoryEntry {
  symbol: string
  at: number // sequence number
}

interface AppState {
  loaded: boolean
  loadError: string | null
  status: string
  lastError: string | null
  currentChord: string
  currentNotes: number[]
  history: HistoryEntry[]
  playing: boolean
  bpm: number
  clockSource: 'internal' | 'external'
  externalBpm: number | null
  recordedCount: number // sounding chords captured in the current take

  // generator dials
  color: number
  adventure: number
  spice: number
  gravity: number
  model: ModelName
  modelError: string | null
  modelLoading: boolean
  sessionMode: SessionMode
  sessionStep: number
  neuralTemp: number
  seedIndex: number
  keyRoot: number
  keyMode: 'maj' | 'min'

  // player
  mode: PlayerMode
  hold: boolean
  phraseBars: number
  rhythm: number
  rhythmName: string

  // voicing dials
  voicingLevel: number
  voiceDistance: number
  voiceDistName: string
  colorMajor: number
  colorMinor: number
  color7th: number
  register: number

  // io
  midiSupported: boolean
  midiEnabled: boolean
  midiOutputs: MidiPortInfo[]
  midiInputs: MidiPortInfo[]
  midiOutId: string | null
  midiInId: string | null
  synthOn: boolean
  synthVolume: number

  // actions
  init(): Promise<void>
  enableMidi(): Promise<void>
  togglePlay(): void
  reroll(): void
  panic(): void
  audition(): void
  exportMidi(): void
  clearTake(): void
  setBpm(v: number): void
  setClockSource(src: 'internal' | 'external'): void
  setColor(v: number): void
  setAdventure(v: number): void
  setSpice(v: number): void
  setGravity(v: number): void
  setModel(m: ModelName): Promise<void>
  setSessionMode(m: SessionMode): void
  resetSession(): void
  setNeuralTemp(v: number): void
  setSeedIndex(i: number): void
  setKeyRoot(pc: number): void
  setKeyMode(m: 'maj' | 'min'): void
  setMode(m: PlayerMode): void
  setHold(on: boolean): void
  setPhraseBars(bars: number): void
  setRhythm(v: number): void
  setVoicingLevel(v: number): void
  setVoiceDistance(v: number): void
  setColorMajor(v: number): void
  setColorMinor(v: number): void
  setColor7th(v: number): void
  setRegister(v: number): void
  selectMidiOut(id: string | null): void
  selectMidiIn(id: string | null): void
  setSynthOn(on: boolean): void
  setSynthVolume(v: number): void
}

let historySeq = 0
let initStarted = false

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  loadError: null,
  status: 'loading',
  lastError: null,
  currentChord: '—',
  currentNotes: [],
  history: [],
  playing: false,
  bpm: 120,
  clockSource: 'internal',
  externalBpm: null,
  recordedCount: 0,

  color: 0.5,
  adventure: 0.35,
  spice: 0.5,
  gravity: 0,
  model: 'markov',
  modelError: null,
  modelLoading: false,
  sessionMode: 'auto',
  sessionStep: 0,
  neuralTemp: 1.5,
  seedIndex: 0,
  keyRoot: 0,
  keyMode: 'maj',

  mode: 'loop',
  hold: false,
  phraseBars: 8,
  rhythm: 2 / 6, // index 2 of RHYTHM_ORDER -> template 2 (half_half default)
  rhythmName: 'half_half',

  voicingLevel: 0,
  voiceDistance: 0,
  voiceDistName: 'off',
  colorMajor: 0,
  colorMinor: 0,
  color7th: 0,
  register: 60,

  midiSupported: MidiIO.supported(),
  midiEnabled: false,
  midiOutputs: [],
  midiInputs: [],
  midiOutId: null,
  midiInId: null,
  synthOn: true,
  synthVolume: 0.5,

  async init() {
    if (initStarted) return // React StrictMode double-mounts; subscribe once
    initStarted = true
    const rt = getRuntime()
    try {
      await rt.load()
    } catch (err) {
      set({ loadError: String((err as Error)?.message || err), status: 'load failed' })
      return
    }

    rt.emitter.on((e) => {
      switch (e.type) {
        case 'status':
          set({ status: e.value, playing: e.value === 'playing' || (get().playing && e.value === 'reroll') })
          break
        case 'chord':
          set((s) => ({
            currentChord: e.symbol,
            history: [...s.history.slice(-63), { symbol: e.symbol, at: historySeq++ }],
            sessionStep: s.model === 'markov' ? s.sessionStep : rt.registry.sessionStatus().step,
          }))
          break
        case 'notes':
          set({ currentNotes: e.notes })
          break
        case 'stop':
          set({ currentNotes: [] })
          break
        case 'playoff':
          set({ playing: false })
          break
        case 'error':
          set({ lastError: e.detail ? `${e.code}: ${e.detail}` : e.code })
          break
        case 'tempo':
          set({ externalBpm: e.bpm })
          break
      }
    })

    rt.onRecordingChanged = (count) => set({ recordedCount: count })

    rt.midi.onPortsChanged = () => {
      set({ midiOutputs: rt.midi.outputs(), midiInputs: rt.midi.inputs() })
    }
    rt.midi.onProgramChange = (n) => {
      const a = decodePgm(n)
      const s = get()
      switch (a.action) {
        case 'playtoggle': s.togglePlay(); break
        case 'reroll': s.reroll(); break
        case 'holdtoggle': s.setHold(!get().hold); break
        case 'modecycle': {
          const next = MODES[(MODES.indexOf(get().mode) + 1) % MODES.length]
          s.setMode(next)
          break
        }
        case 'length': s.setPhraseBars(a.arg as number); break
        case 'keyroot': s.setKeyRoot(a.arg as number); break
        case 'keymode': s.setKeyMode(a.arg as 'maj' | 'min'); break
      }
    }
    rt.midi.onControlChange = (num, val) => {
      const m = ccToParam(num, val)
      if (m && m.param === 'adventure') get().setAdventure(m.value)
    }

    // Apply store defaults to the engine (mode differs from the port default).
    rt.player.setMode(get().mode)
    rt.player.setLengthBars(get().phraseBars)
    set({ loaded: true, status: 'ready' })
  },

  async enableMidi() {
    const rt = getRuntime()
    rt.ensureAudio() // same gesture unlocks audio
    try {
      await rt.midi.init()
      set({
        midiEnabled: true,
        midiOutputs: rt.midi.outputs(),
        midiInputs: rt.midi.inputs(),
      })
    } catch (err) {
      set({ lastError: `MIDI access failed: ${String((err as Error)?.message || err)}` })
    }
  },

  togglePlay() {
    const rt = getRuntime()
    if (get().playing) {
      rt.stopTransport()
      set({ playing: false })
    } else {
      rt.startTransport()
      set({ playing: true })
    }
  },

  reroll() {
    getRuntime().player.reroll()
  },

  panic() {
    getRuntime().panic()
    set({ currentNotes: [] })
  },

  audition() {
    const rt = getRuntime()
    rt.ensureAudio()
    rt.player.audition()
  },

  exportMidi() {
    const bytes = getRuntime().exportMidi()
    if (!bytes) {
      set({ lastError: 'nothing to export yet — play a progression first' })
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadBytes(bytes, `autoharm-${stamp}.mid`, 'audio/midi')
  },

  clearTake() {
    getRuntime().clearRecording()
    set({ recordedCount: 0, history: [], lastError: null })
  },

  setBpm(v) {
    const bpm = Math.max(40, Math.min(240, Math.round(v)))
    getRuntime().setBpm(bpm) // applied now, or when the clock is first created
    set({ bpm })
  },

  setClockSource(src) {
    getRuntime().setClockSource(src)
    // Leaving external mode stops the DAW-driven walk; reflect that.
    set({ clockSource: src, playing: false, externalBpm: src === 'external' ? get().externalBpm : null })
  },

  setColor(v) {
    getRuntime().markov.setColor(v)
    set({ color: v })
  },
  setAdventure(v) {
    getRuntime().markov.setAdventure(v)
    set({ adventure: v })
  },
  setSpice(v) {
    getRuntime().markov.setSpice(v)
    set({ spice: v, color: v, adventure: v })
  },
  setGravity(v) {
    getRuntime().markov.setGravity(v)
    set({ gravity: v })
  },

  async setModel(m) {
    if (m !== 'markov') set({ modelLoading: true, modelError: null })
    const err = await getRuntime().registry.setModel(m)
    set({ modelLoading: false })
    if (err) set({ modelError: err })
    else {
      const st = getRuntime().registry.sessionStatus()
      set({ model: m, modelError: null, sessionStep: st.step })
    }
  },

  setSessionMode(m) {
    getRuntime().registry.setSessionMode(m)
    set({ sessionMode: m, sessionStep: getRuntime().registry.sessionStatus().step })
  },
  resetSession() {
    getRuntime().registry.resetSession()
    set({ sessionStep: 0 })
  },
  setNeuralTemp(v) {
    getRuntime().registry.setNeuralTemperature(v)
    set({ neuralTemp: v })
  },

  setSeedIndex(i) {
    const idx = Math.max(0, Math.min(SEED_LIST.length - 1, i))
    getRuntime().player.setSeed(SEED_LIST[idx])
    set({ seedIndex: idx })
  },
  setKeyRoot(pc) {
    getRuntime().player.setKeyRoot(pc)
    set({ keyRoot: ((Math.round(pc) % 12) + 12) % 12 })
  },
  setKeyMode(m) {
    getRuntime().player.setKeyMode(m)
    set({ keyMode: m })
  },

  setMode(m) {
    getRuntime().player.setMode(m)
    set({ mode: m })
  },
  setHold(on) {
    getRuntime().player.setHold(on)
    set({ hold: on })
  },
  setPhraseBars(bars) {
    getRuntime().player.setLengthBars(bars)
    set({ phraseBars: bars })
  },
  setRhythm(v) {
    const name = getRuntime().player.setRhythm(v)
    set({ rhythm: v, rhythmName: name })
  },

  setVoicingLevel(v) {
    getRuntime().sonifier.setVoicingLevel(v)
    set({ voicingLevel: v })
  },
  setVoiceDistance(v) {
    const name = getRuntime().sonifier.setVoiceDistance(v)
    set({ voiceDistance: v, voiceDistName: name })
  },
  setColorMajor(v) {
    getRuntime().sonifier.setColorMajor(v)
    set({ colorMajor: v })
  },
  setColorMinor(v) {
    getRuntime().sonifier.setColorMinor(v)
    set({ colorMinor: v })
  },
  setColor7th(v) {
    getRuntime().sonifier.setColor7th(v)
    set({ color7th: v })
  },
  setRegister(v) {
    getRuntime().sonifier.setRegister(v)
    set({ register: v })
  },

  selectMidiOut(id) {
    getRuntime().midi.selectOutput(id)
    set({ midiOutId: id })
  },
  selectMidiIn(id) {
    getRuntime().midi.selectInput(id)
    set({ midiInId: id })
  },
  setSynthOn(on) {
    const rt = getRuntime()
    if (rt.synth) {
      rt.synth.enabled = on
      if (!on) rt.synth.releaseAll()
    }
    set({ synthOn: on })
  },
  setSynthVolume(v) {
    getRuntime().synth?.setVolume(v)
    set({ synthVolume: v })
  },
}))

export { SEED_LIST, KEY_ROOTS, MODES }
