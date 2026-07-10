/** zustand store — serializable UI state only. Engine instances live in the
 * Runtime singleton; UI events call runtime methods, engine events patch the
 * store through the emitter subscription in `initApp()`. */

import { create } from 'zustand'
import { getRuntime } from '../app/runtime'
import { decodePgm, ccToParam, MODES, SEED_LIST, KEY_ROOTS, type PlayerMode } from '../engine/voicing/performanceMap'
import {
  TEMPLATES,
  RHYTHM_ORDER,
  DEFAULT_TEMPLATE_ID,
  STEPS_PER_BAR,
  rhythmToTemplate,
} from '../engine/player/templates'
import { swingLabel, DEFAULT_SWING_UNIT, type SwingUnit } from '../engine/player/swing'
import { makeProgression, type Progression } from '../engine/progression/types'
import {
  duplicate as opDuplicate,
  move as opMove,
  remove as opRemove,
  replaceSymbol as opReplaceSymbol,
  setDuration as opSetDuration,
  toggleLock as opToggleLock,
} from '../engine/progression/operations'
import { ProgressionHistory } from '../engine/progression/history'

export type AppMode = 'generate' | 'respond' | 'perform'
export type ViewMode = 'quick' | 'lab'
export type DisplayMode = 'symbols' | 'roman' | 'both'
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

  // V2 canonical progression (mirror of the player's active progression)
  progression: Progression
  playingSlotId: string | null // slot currently sounding (timeline highlight)
  generating: boolean
  appMode: AppMode
  viewMode: ViewMode
  displayMode: DisplayMode
  selectedSlotId: string | null
  canUndo: boolean
  canRedo: boolean

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
  rhythmOnsets: number[] // step indices of chord onsets (for the grid display)
  rhythmSteps: number // grid length in steps (spanBars * STEPS_PER_BAR)
  swing: number // 0 = straight .. 1 = hard shuffle
  swingUnit: SwingUnit // which subdivision swings
  swingName: string

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
  generateNew(): Promise<void>
  reroll(): void
  setAppMode(m: AppMode): void
  setViewMode(v: ViewMode): void
  setDisplayMode(d: DisplayMode): void
  selectSlot(id: string | null): void
  editSlotSymbol(id: string, symbol: string): void
  toggleSlotLock(id: string): void
  setSlotDuration(id: string, steps: number): void
  moveSlot(id: string, dir: -1 | 1): void
  deleteSlot(id: string): void
  duplicateSlot(id: string): void
  rerollSlot(id: string): Promise<void>
  auditionSlot(id: string): void
  undo(): void
  redo(): void
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
  setSwing(v: number): void
  setSwingUnit(u: SwingUnit): void
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

/** Bounded undo history for progression edits (never transport/IO state). */
const editHistory = new ProgressionHistory(100)

type SetFn = (partial: Partial<AppState>) => void
type GetFn = () => AppState

/** Apply a pure progression op: record history, update the store NOW (the
 * user sees their edit immediately), and hand it to playback — structural
 * edits land on the next bar downbeat while playing. */
function applyEdit(set: SetFn, get: GetFn, op: (p: Progression) => Progression, structural: boolean): void {
  const cur = get().progression
  const next = op(cur)
  if (next === cur) return // invalid/no-op edits don't pollute history
  editHistory.push(cur)
  // Store FIRST: the runtime echoes progressionApplied synchronously, and the
  // event handler must see the same object (identity) to know it's an echo.
  set({ progression: next, canUndo: editHistory.canUndo, canRedo: editHistory.canRedo })
  getRuntime().applyEdit(next, structural)
}

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

  progression: makeProgression([]),
  playingSlotId: null,
  generating: false,
  appMode: 'generate',
  viewMode: 'quick',
  displayMode: 'both',
  selectedSlotId: null,
  canUndo: false,
  canRedo: false,

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
  // dial position that selects the default template (half + half)
  rhythm: RHYTHM_ORDER.indexOf(DEFAULT_TEMPLATE_ID) / (RHYTHM_ORDER.length - 1),
  rhythmName: TEMPLATES[DEFAULT_TEMPLATE_ID].name,
  rhythmOnsets: TEMPLATES[DEFAULT_TEMPLATE_ID].onsets,
  rhythmSteps: TEMPLATES[DEFAULT_TEMPLATE_ID].spanBars * STEPS_PER_BAR,
  swing: 0,
  swingUnit: DEFAULT_SWING_UNIT,
  swingName: swingLabel(0),

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
        case 'progressionApplied': {
          // Generation results / staged variations arrive here. User edits
          // set the store synchronously and echo back the SAME object, so
          // an identity match means nothing to record.
          const cur = get().progression
          if (e.progression !== cur) {
            if (cur.slots.length > 0) editHistory.push(cur)
            set({
              progression: e.progression,
              canUndo: editHistory.canUndo,
              canRedo: editHistory.canRedo,
            })
          }
          break
        }
        case 'slotOnset':
          set({ playingSlotId: e.slotId })
          break
      }
    })
    // The initial progression was generated inside load(), before this
    // subscription existed — read it directly.
    set({ progression: rt.player.activeProgression })

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

  async generateNew() {
    set({ generating: true })
    await getRuntime().generateNew()
    set({ generating: false })
  },

  setAppMode(m) {
    set({ appMode: m })
  },
  setViewMode(v) {
    set({ viewMode: v })
  },
  setDisplayMode(d) {
    set({ displayMode: d })
  },
  selectSlot(id) {
    set({ selectedSlotId: id })
  },

  editSlotSymbol(id, symbol) {
    applyEdit(set, get, (p) => opReplaceSymbol(p, id, symbol), false)
  },
  toggleSlotLock(id) {
    applyEdit(set, get, (p) => opToggleLock(p, id), false)
  },
  setSlotDuration(id, steps) {
    applyEdit(set, get, (p) => opSetDuration(p, id, steps), true)
  },
  moveSlot(id, dir) {
    applyEdit(set, get, (p) => opMove(p, id, dir), true)
  },
  deleteSlot(id) {
    if (get().selectedSlotId === id) set({ selectedSlotId: null })
    applyEdit(set, get, (p) => opRemove(p, id), true)
  },
  duplicateSlot(id) {
    applyEdit(set, get, (p) => opDuplicate(p, id), true)
  },
  async rerollSlot(id) {
    set({ generating: true })
    await getRuntime().rerollSlot(id)
    set({ generating: false })
  },
  auditionSlot(id) {
    const rt = getRuntime()
    const slot = get().progression.slots.find((s) => s.id === id)
    if (!slot) return
    rt.ensureAudio()
    rt.player.audition(slot.symbol)
  },

  undo() {
    const prev = editHistory.undo(get().progression)
    if (!prev) return
    // Store first — the runtime's synchronous echo must match by identity.
    set({ progression: prev, canUndo: editHistory.canUndo, canRedo: editHistory.canRedo })
    getRuntime().applyEdit(prev, true)
  },
  redo() {
    const next = editHistory.redo(get().progression)
    if (!next) return
    set({ progression: next, canUndo: editHistory.canUndo, canRedo: editHistory.canRedo })
    getRuntime().applyEdit(next, true)
  },

  reroll() {
    // Variation semantics: locked slots survive; queued to the boundary
    // while playing, immediate when stopped.
    void getRuntime().generateVariation()
  },

  panic() {
    getRuntime().panic()
    set({ currentNotes: [] })
  },

  audition() {
    const rt = getRuntime()
    rt.ensureAudio()
    rt.player.audition(rt.seed)
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
    getRuntime().setSeed(SEED_LIST[idx])
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
    getRuntime().setPhraseSteps(bars * STEPS_PER_BAR)
    set({ phraseBars: bars })
  },
  setRhythm(v) {
    const t = TEMPLATES[rhythmToTemplate(v)]
    getRuntime().setTemplate(rhythmToTemplate(v))
    set({ rhythm: v, rhythmName: t.name, rhythmOnsets: t.onsets, rhythmSteps: t.spanBars * STEPS_PER_BAR })
  },
  setSwing(v) {
    getRuntime().setSwing(v)
    set({ swing: v, swingName: swingLabel(v) })
  },
  setSwingUnit(u) {
    getRuntime().setSwingUnit(u)
    set({ swingUnit: u })
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
