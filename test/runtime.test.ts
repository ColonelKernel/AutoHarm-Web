/** Runtime — the composition root, tested at its integration seams.
 *
 * Everything below runs the REAL engine graph (real Markov corpora, real
 * player, real respond engine, real scheduler). Only the browser is faked:
 * `AudioContext`, `Worker` and `fetch`. That is deliberate — every confirmed
 * bug in the V2 review lived in the wiring between these parts, not inside
 * any one of them, so a test that stubs the engine would have caught none of
 * them.
 *
 * Where a test drives `midi.onNoteIn` / `midi.onClockStep` directly it is
 * using the same entry point the real MIDI adapter calls, not a back door.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Runtime } from '../src/app/runtime'
import type { PlayerEvent } from '../src/engine/events'
import type { CandidateLike } from '../src/engine/progression/generator'
import { makeProgression, makeSlot, type Progression } from '../src/engine/progression/types'
import { STEPS_PER_BAR, type RhythmPattern } from '../src/engine/player/templates'
import type { MelodyAnalysis } from '../src/engine/respond/types'

/* --- browser fakes ----------------------------------------------------------- */

class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime() {
    return this
  }
  linearRampToValueAtTime() {
    return this
  }
  cancelScheduledValues() {
    return this
  }
}
class FakeGain {
  gain = new FakeParam(1)
  connect() {}
}
class FakeOsc {
  type = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  connect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  static last: FakeAudioContext | null = null
  currentTime = 0
  state: 'running' | 'suspended' = 'running'
  destination = {}
  constructor() {
    FakeAudioContext.last = this
  }
  createGain() {
    return new FakeGain()
  }
  createOscillator() {
    return new FakeOsc()
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
}

/** The LookaheadClock ticks from a Worker. Ours never ticks on its own, so
 * the internal clock advances only when a test says so — no wall-clock races. */
class FakeWorker {
  onmessage: (() => void) | null = null
  posted: string[] = []
  postMessage(m: string) {
    this.posted.push(m)
  }
  terminate() {}
}

const CORPORA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/data/markov_corpora_t.json', import.meta.url)), 'utf8'),
) as unknown

/** Let queued microtasks (and any resolved generation) settle. */
const flush = () => new Promise<void>((r) => setImmediate(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** A sampler whose `candidates()` blocks until the test releases it, so a
 * walk can be caught mid-flight and invalidated. `active: 'rnn'` skips the
 * markov blend-profile lookup. */
function gatedRegistry(gate: Promise<CandidateLike[]>) {
  return {
    active: 'rnn',
    sample: (chord: string) => ({ output: chord }),
    candidates: () => gate,
  }
}

interface Harness {
  rt: Runtime
  events: PlayerEvent[]
  origins: () => Array<'user' | 'auto'>
  notices: () => string[]
}

async function setup(): Promise<Harness> {
  const rt = new Runtime()
  const events: PlayerEvent[] = []
  rt.emitter.on((e) => events.push(e))
  await rt.load()
  return {
    rt,
    events,
    origins: () =>
      events.filter((e) => e.type === 'progressionApplied').map((e) => (e as { origin: 'user' | 'auto' }).origin),
    notices: () => events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message),
  }
}

let fetchCalls: string[] = []

beforeEach(() => {
  fetchCalls = []
  FakeAudioContext.last = null
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('fetch', async (url: string) => {
    fetchCalls.push(String(url))
    return { ok: true, json: async () => CORPORA }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/* --- load --------------------------------------------------------------------- */

describe('load', () => {
  it('generates a progression eagerly, because external MIDI Start plays immediately', async () => {
    const { rt } = await setup()
    const p = rt.player.activeProgression
    expect(p.slots.length).toBeGreaterThan(0)
    expect(p.totalSteps).toBe(rt.phraseSteps)
    expect(p.slots.every((s) => s.source === 'generated' && !s.locked)).toBe(true)
    expect(fetchCalls[0]).toMatch(/data\/markov_corpora_t\.json$/)
  })

  it('the slot durations tile the phrase exactly', async () => {
    const { rt } = await setup()
    const p = rt.player.activeProgression
    expect(p.slots.reduce((n, s) => n + s.durationSteps, 0)).toBe(p.totalSteps)
  })

  it('throws when the corpora fetch fails', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 }))
    await expect(new Runtime().load()).rejects.toThrow(/503/)
  })

  it('is idempotent — a second load does not regenerate', async () => {
    const { rt, origins } = await setup()
    const before = rt.player.activeProgression
    await rt.load()
    expect(rt.player.activeProgression).toBe(before)
    expect(origins()).toHaveLength(1)
  })
})

/* --- swap origin: the undo-history seam ---------------------------------------- */

describe('swap origin', () => {
  it('marks user-initiated generation "user"', async () => {
    const { rt, events, origins } = await setup()
    events.length = 0
    await rt.generateNew()
    expect(origins()).toEqual(['user'])
  })

  it('marks a rerolled slot "user"', async () => {
    const { rt, events, origins } = await setup()
    const id = rt.player.activeProgression.slots[1].id
    events.length = 0
    await rt.rerollSlot(id)
    expect(origins()).toEqual(['user'])
  })

  it('marks a direct edit "user"', async () => {
    const { rt, events, origins } = await setup()
    const edited = rt.player.activeProgression
    events.length = 0
    rt.applyEdit(edited, false)
    expect(origins()).toEqual(['user'])
  })

  it('marks an autonomous regeneration "auto" so it never enters undo history', async () => {
    const { rt, events, origins } = await setup()
    events.length = 0
    expect(rt.setTemplate(1)).toBe(true) // pristine -> regenerates itself
    await vi.waitFor(() => expect(origins()).toEqual(['auto']))
  })

  it('marks a regen-mode cycle variation "auto"', async () => {
    const { rt, events, origins } = await setup()
    rt.player.setMode('regen')
    events.length = 0
    rt.emitter.emit({ type: 'cycle', index: 1, step: 128 })
    await vi.waitFor(() => expect(origins()).toEqual(['auto']))
  })

  it('does not auto-vary over a response that is playing', async () => {
    const { rt, events, origins } = await setup()
    rt.player.setMode('regen')
    rt.respond.phase = 'ready'
    events.length = 0
    rt.emitter.emit({ type: 'cycle', index: 1, step: 128 })
    await flush()
    expect(origins()).toEqual([])
  })

  it('does not auto-vary while a chord is held', async () => {
    const { rt, events, origins } = await setup()
    rt.player.setMode('regen')
    rt.player.setHold(true)
    events.length = 0
    rt.emitter.emit({ type: 'cycle', index: 1, step: 128 })
    await flush()
    expect(origins()).toEqual([])
  })
})

/* --- locks across a phrase-length change --------------------------------------- */

/** A fixed grid: onsets every half bar, so a test can name an exact step.
 * Over a 128-step phrase this is 16 slots at 0, 8, 16 ... 120. */
const HALF_BAR_GRID: RhythmPattern = { name: 'half bars', spanBars: 1, onsets: [0, 8] }

const onsetsOf = (p: Progression): number[] => {
  const out: number[] = []
  let step = 0
  for (const s of p.slots) {
    out.push(step)
    step += s.durationSteps
  }
  return out
}

/** Install the deterministic grid and wait for the regeneration it triggers. */
async function useHalfBarGrid(rt: Runtime): Promise<void> {
  expect(rt.setCustomPattern(HALF_BAR_GRID)).toBe(true)
  await vi.waitFor(() => expect(rt.player.activeProgression.slots).toHaveLength(16))
}

describe('locks and phrase length', () => {
  it('a variation keeps locked chords at the same onsets', async () => {
    const { rt } = await setup()
    await useHalfBarGrid(rt)
    const before = rt.player.activeProgression
    const target = before.slots[2]
    rt.applyEdit(
      { ...before, slots: before.slots.map((s, i) => (i === 2 ? { ...s, locked: true } : s)) },
      false,
    )

    await rt.generateVariation()
    const after = rt.player.activeProgression
    expect(after.totalSteps).toBe(before.totalSteps)
    expect(after.slots[2].symbol).toBe(target.symbol)
    expect(after.slots[2].locked).toBe(true)
  })

  it('re-anchors surviving locks by onset STEP when the phrase shrinks, and reports the drop', async () => {
    const { rt, notices } = await setup()
    await useHalfBarGrid(rt)

    const before = rt.player.activeProgression
    const keptSymbol = before.slots[2].symbol // onset step 16 — survives a 64-step phrase
    const droppedSymbol = before.slots[15].symbol // onset step 120 — cannot survive
    rt.applyEdit(
      {
        ...before,
        slots: before.slots.map((s, i) => (i === 2 || i === 15 ? { ...s, locked: true } : s)),
      },
      false,
    )

    // Locks make the progression non-pristine, so the length change waits for
    // an explicit Variation rather than silently discarding them.
    expect(rt.setPhraseSteps(64)).toBe(false)
    await rt.generateVariation()

    const after = rt.player.activeProgression
    expect(after.totalSteps).toBe(64)
    expect(after.slots).toHaveLength(8)
    // What matters is that onset step 16 kept its chord — not that it kept its
    // index. Index-matching against the new grid is the bug this guards.
    const at16 = onsetsOf(after).indexOf(16)
    expect(after.slots[at16].symbol).toBe(keptSymbol)
    expect(after.slots[at16].locked).toBe(true)
    expect(after.slots.some((s) => s.locked && s.symbol === droppedSymbol && s !== after.slots[at16])).toBe(false)
    expect(notices()).toEqual([expect.stringMatching(/1 locked chord released/)])
  })

  it('says nothing when every lock survives the change', async () => {
    const { rt, notices } = await setup()
    await useHalfBarGrid(rt)
    const before = rt.player.activeProgression
    rt.applyEdit({ ...before, slots: before.slots.map((s, i) => (i === 1 ? { ...s, locked: true } : s)) }, false)

    expect(rt.setPhraseSteps(64)).toBe(false)
    await rt.generateVariation()
    expect(rt.player.activeProgression.totalSteps).toBe(64)
    expect(notices()).toEqual([])
  })
})

/* --- reroll one ---------------------------------------------------------------- */

describe('rerollSlot', () => {
  it('preserves every slot id, so the selection and explanation panel survive', async () => {
    const { rt } = await setup()
    const before = rt.player.activeProgression
    const ids = before.slots.map((s) => s.id)
    await rt.rerollSlot(ids[3])
    expect(rt.player.activeProgression.slots.map((s) => s.id)).toEqual(ids)
  })

  it('restores the real lock flags after the mask-locked walk', async () => {
    const { rt } = await setup()
    const before = rt.player.activeProgression
    rt.applyEdit({ ...before, slots: before.slots.map((s, i) => (i === 0 ? { ...s, locked: true } : s)) }, false)
    const locked = rt.player.activeProgression.slots[0]

    await rt.rerollSlot(rt.player.activeProgression.slots[2].id)
    const after = rt.player.activeProgression
    expect(after.slots[0].locked).toBe(true)
    expect(after.slots[0].symbol).toBe(locked.symbol)
    expect(after.slots.filter((s) => s.locked)).toHaveLength(1)
  })

  it('leaves the progression untouched for an unknown slot id', async () => {
    const { rt } = await setup()
    const before = rt.player.activeProgression
    await expect(rt.rerollSlot('nope')).resolves.toBeNull()
    expect(rt.player.activeProgression).toBe(before)
  })
})

/* --- the "performable dial" rule ------------------------------------------------ */

describe('pristine gating', () => {
  it('regenerates a pristine progression when the rhythm changes', async () => {
    const { rt } = await setup()
    expect(rt.setTemplate(1)).toBe(true)
    expect(rt.setCustomPattern(HALF_BAR_GRID)).toBe(true)
  })

  it('redraws the GRID on a rhythm change, not just the chords', async () => {
    const { rt } = await setup()
    // Regression: maybeRegenerate used to route through generateVariation,
    // which reuses the take's onsets. The chords changed, the rhythm never
    // did, and the editor's grid silently disagreed with playback.
    expect(rt.setCustomPattern(HALF_BAR_GRID)).toBe(true)
    await vi.waitFor(() =>
      expect(onsetsOf(rt.player.activeProgression)).toEqual(Array.from({ length: 16 }, (_, i) => i * 8)),
    )
  })

  it('redraws the grid when the phrase length changes', async () => {
    const { rt } = await setup()
    await useHalfBarGrid(rt)
    expect(rt.setPhraseSteps(64)).toBe(true)
    await vi.waitFor(() => expect(onsetsOf(rt.player.activeProgression)).toEqual([0, 8, 16, 24, 32, 40, 48, 56]))
  })

  it('refuses to regenerate over a lock', async () => {
    const { rt } = await setup()
    const p = rt.player.activeProgression
    rt.applyEdit({ ...p, slots: p.slots.map((s, i) => (i === 0 ? { ...s, locked: true } : s)) }, false)
    const before = rt.player.activeProgression
    expect(rt.setTemplate(1)).toBe(false)
    await flush()
    expect(rt.player.activeProgression).toBe(before)
  })

  it('refuses to regenerate over a hand-edited chord', async () => {
    const { rt } = await setup()
    const p = rt.player.activeProgression
    rt.applyEdit({ ...p, slots: p.slots.map((s, i) => (i === 1 ? { ...s, source: 'manual' as const } : s)) }, false)
    const before = rt.player.activeProgression
    expect(rt.setPhraseSteps(64)).toBe(false)
    await flush()
    expect(rt.player.activeProgression).toBe(before)
    expect(rt.phraseSteps).toBe(64) // the setting still takes, it just waits
  })
})

/* --- settings validation --------------------------------------------------------- */

describe('settings', () => {
  it('rejects a phrase shorter than half a bar, and non-numbers', async () => {
    const { rt } = await setup()
    const original = rt.phraseSteps
    expect(rt.setPhraseSteps(STEPS_PER_BAR / 2 - 1)).toBe(false)
    expect(rt.setPhraseSteps(Number.NaN)).toBe(false)
    expect(rt.setPhraseSteps(Number.POSITIVE_INFINITY)).toBe(false)
    expect(rt.phraseSteps).toBe(original)
  })

  it('mirrors the phrase length onto the respond window only while disengaged', async () => {
    const { rt } = await setup()
    rt.setPhraseSteps(32)
    expect(rt.respond.phraseSteps).toBe(32)

    rt.appMode = 'respond'
    rt.newListen() // freezes the window at 32
    rt.setPhraseSteps(64)
    expect(rt.phraseSteps).toBe(64)
    expect(rt.respond.phraseSteps).toBe(32)
  })

  it('ignores an unknown rhythm template rather than breaking the grid', async () => {
    const { rt } = await setup()
    const before = rt.templateId
    rt.setTemplate(9999)
    expect(rt.templateId).toBe(before)
  })

  it('clamps swing to 0..1 and treats a non-number as straight', async () => {
    const { rt } = await setup()
    rt.setSwing(2)
    expect(rt.swing).toBe(1)
    rt.setSwing(-1)
    expect(rt.swing).toBe(0)
    rt.setSwing(0.6)
    expect(rt.swing).toBeCloseTo(0.6)
    rt.setSwing(Number.NaN)
    expect(rt.swing).toBe(0)
  })

  it('clamps repetitions to 1..16', async () => {
    const { rt } = await setup()
    rt.setRepetitions(0)
    expect(rt.respond.repetitions).toBe(1)
    rt.setRepetitions(99)
    expect(rt.respond.repetitions).toBe(16)
    rt.setRepetitions(3.4)
    expect(rt.respond.repetitions).toBe(3)
  })

  it('ignores an empty seed', async () => {
    const { rt } = await setup()
    const before = rt.seed
    rt.setSeed('   ')
    expect(rt.seed).toBe(before)
    rt.setSeed(' F:min ')
    expect(rt.seed).toBe('F:min')
  })
})

/* --- edit staging ---------------------------------------------------------------- */

describe('applyEdit staging', () => {
  const edited = (p: Progression): Progression =>
    makeProgression([...p.slots.map((s) => ({ ...s })), makeSlot('C:maj', 8, 'manual')])

  it('applies immediately while stopped', async () => {
    const { rt } = await setup()
    const p = edited(rt.player.activeProgression)
    rt.applyEdit(p, true)
    expect(rt.player.activeProgression).toBe(p)
    expect(rt.player.hasStaged).toBe(false)
  })

  it('stages a structural edit for the next bar while playing', async () => {
    const { rt } = await setup()
    const before = rt.player.activeProgression
    rt.player.start()
    rt.applyEdit(edited(before), true)
    expect(rt.player.activeProgression).toBe(before)
    expect(rt.player.hasStaged).toBe(true)
  })

  it('applies a symbol-only edit immediately while playing', async () => {
    const { rt } = await setup()
    rt.player.start()
    const p = edited(rt.player.activeProgression)
    rt.applyEdit(p, false)
    expect(rt.player.activeProgression).toBe(p)
    expect(rt.player.hasStaged).toBe(false)
  })
})

/* --- staleness: an in-flight walk must never land on a moved-on player ----------- */

describe('generation staleness', () => {
  it('stopTransport drops a walk that was already in flight', async () => {
    const { rt } = await setup()
    const gate = deferred<CandidateLike[]>()
    rt.registry = gatedRegistry(gate.promise) as unknown as typeof rt.registry
    const before = rt.player.activeProgression

    const inFlight = rt.generateVariation()
    await flush() // the walk is now parked on candidates()
    rt.stopTransport()
    gate.resolve([{ symbol: 'F:maj', prior: 1 }])

    await expect(inFlight).resolves.toBeNull()
    expect(rt.player.activeProgression).toBe(before)
  })

  it('newListen drops an older walk, so it cannot answer the new phrase', async () => {
    const { rt } = await setup()
    const gate = deferred<CandidateLike[]>()
    rt.registry = gatedRegistry(gate.promise) as unknown as typeof rt.registry
    const before = rt.player.activeProgression

    const inFlight = rt.generateVariation()
    await flush()
    rt.appMode = 'respond'
    rt.newListen()
    gate.resolve([{ symbol: 'F:maj', prior: 1 }])

    await expect(inFlight).resolves.toBeNull()
    expect(rt.player.activeProgression).toBe(before)
  })

  it('cancelListen drops an in-flight response', async () => {
    const { rt } = await setup()
    const gate = deferred<CandidateLike[]>()
    rt.registry = gatedRegistry(gate.promise) as unknown as typeof rt.registry
    const before = rt.player.activeProgression

    const inFlight = rt.generateVariation()
    await flush()
    rt.cancelListen()
    gate.resolve([{ symbol: 'F:maj', prior: 1 }])

    await expect(inFlight).resolves.toBeNull()
    expect(rt.player.activeProgression).toBe(before)
  })
})

/* --- respond window -------------------------------------------------------------- */

describe('respond window', () => {
  it('answers the window that was captured, not the phrase length the user has since moved to', async () => {
    const { rt } = await setup()
    rt.setPhraseSteps(32)
    await flush()
    rt.appMode = 'respond'
    rt.newListen() // freezes the window at 32 steps

    rt.setPhraseSteps(128) // user drags the phrase-length control mid-listen
    await flush()

    // buildResponse is private: it is the RespondEngine's `generateResponse`
    // effect, reachable only through a capture we cannot fake at this layer.
    const build = (rt as unknown as {
      buildResponse: (n: never[], a: MelodyAnalysis) => Promise<Progression | null>
    }).buildResponse.bind(rt)
    const p = await build([], {} as MelodyAnalysis)

    expect(p).not.toBeNull()
    expect(p!.totalSteps).toBe(32)
  })

  it('newListen starts the transport so a phrase boundary will actually arrive', async () => {
    const { rt } = await setup()
    rt.appMode = 'respond'
    expect(rt.player.state.active).toBe(false)
    expect(rt.newListen()).toBe(true)
    expect(rt.player.state.active).toBe(true)
    expect(rt.respond.phase).toBe('armed')
  })

  it('refuses a second listen mid-commitment', async () => {
    const { rt } = await setup()
    rt.appMode = 'respond'
    rt.newListen()
    rt.respond.phase = 'responding'
    expect(rt.newListen()).toBe(false)
  })
})

/* --- MIDI note routing ------------------------------------------------------------ */

describe('MIDI note routing', () => {
  it('sends notes to the capture buffer while a window is armed or open', async () => {
    const { rt } = await setup()
    const on = vi.spyOn(rt.respond, 'noteOn')
    const off = vi.spyOn(rt.respond, 'noteOff')
    rt.appMode = 'respond'
    rt.newListen()

    rt.midi.onNoteIn!(60, 100, performance.now())
    rt.midi.onNoteIn!(60, 0, performance.now())
    expect(on).toHaveBeenCalledWith(60, 100, expect.any(Number), expect.any(Number))
    expect(off).toHaveBeenCalledWith(60, expect.any(Number), expect.any(Number))
  })

  it('ignores notes played in Respond mode outside a window', async () => {
    const { rt, events } = await setup()
    const on = vi.spyOn(rt.respond, 'noteOn')
    rt.appMode = 'respond'
    const seed = rt.seed
    events.length = 0

    rt.midi.onNoteIn!(60, 100, performance.now())
    await flush()
    expect(on).not.toHaveBeenCalled()
    expect(rt.seed).toBe(seed)
    expect(events.filter((e) => e.type === 'output')).toEqual([])
  })

  it('ignores note-offs when nothing is listening', async () => {
    const { rt, events } = await setup()
    events.length = 0
    rt.midi.onNoteIn!(60, 0, performance.now())
    await flush()
    expect(events.filter((e) => e.type === 'output' || e.type === 'progressionApplied')).toEqual([])
  })

  it('auditions a model reply when a note arrives while stopped', async () => {
    const { rt, events } = await setup()
    events.length = 0
    rt.midi.onNoteIn!(60, 100, performance.now())
    await vi.waitFor(() => expect(events.some((e) => e.type === 'output')).toBe(true))
    const out = events.find((e) => e.type === 'output') as { symbol: string }
    expect(rt.seed).toBe(out.symbol)
  })

  it('steers by QUEUEING a variation to the boundary when a note arrives while playing', async () => {
    const { rt, origins } = await setup()
    const before = rt.player.activeProgression
    rt.player.start()
    rt.midi.onNoteIn!(62, 100, performance.now())

    // V1 steered the very next onset; V2 stages the variation for the phrase
    // boundary, so nothing is applied — and no undo entry is created — yet.
    await vi.waitFor(() => expect(rt.player.hasStaged).toBe(true))
    expect(rt.player.activeProgression).toBe(before)
    expect(origins()).toEqual(['user']) // only the eager load-time generation
  })

  it('discards a stopped-state audition if the transport started meanwhile', async () => {
    const { rt, events } = await setup()
    events.length = 0
    rt.seedChord('C:maj')
    rt.player.start() // the race the guard exists for
    await flush()
    expect(events.filter((e) => e.type === 'output')).toEqual([])
  })
})

/* --- external MIDI clock ---------------------------------------------------------- */

describe('external clock', () => {
  it('ignores DAW transport messages while the clock source is internal', async () => {
    const { rt } = await setup()
    rt.midi.onClockStart!()
    expect(rt.player.state.active).toBe(false)
    rt.midi.onClockStep!()
    expect(rt.player.state.stepAbs).toBe(-1)
  })

  it('hands the transport to the DAW, stopping any local playback', async () => {
    const { rt } = await setup()
    rt.startTransport()
    expect(rt.player.state.active).toBe(true)
    rt.setClockSource('external')
    expect(rt.player.state.active).toBe(false)
    expect(rt.clock!.isRunning).toBe(false)
  })

  it('starts on 0xFA and advances one step per 6-pulse tick, leaving the internal clock idle', async () => {
    const { rt } = await setup()
    rt.setClockSource('external')
    rt.midi.onClockStart!()
    expect(rt.player.state.active).toBe(true)
    expect(rt.clock!.isRunning).toBe(false)

    rt.midi.onClockStep!()
    rt.midi.onClockStep!()
    expect(rt.player.state.stepAbs).toBe(1)
  })

  it('does not advance on a stray pulse while stopped', async () => {
    const { rt } = await setup()
    rt.setClockSource('external')
    rt.midi.onClockStep!()
    expect(rt.player.state.active).toBe(false)
    expect(rt.player.state.stepAbs).toBe(-1)
  })

  it('reports the DAW tempo and uses it for export', async () => {
    const { rt } = await setup()
    rt.setClockSource('external')
    rt.midi.onClockTempo!(90)
    expect(rt.externalTempo).toBe(90)
  })

  it('0xFB continue resumes only when not already running', async () => {
    const { rt } = await setup()
    rt.setClockSource('external')
    rt.midi.onClockStart!()
    rt.midi.onClockStep!()
    rt.midi.onClockContinue!() // must not restart the take
    expect(rt.player.state.stepAbs).toBe(0)
  })
})

/* --- transport / audio graph -------------------------------------------------------- */

describe('transport', () => {
  it('applies a tempo chosen before the first Play', async () => {
    const { rt } = await setup()
    rt.setBpm(96)
    expect(rt.clock).toBeNull()
    rt.ensureAudio()
    expect(rt.clock!.bpm).toBe(96)
  })

  it('starts and stops the internal clock', async () => {
    const { rt } = await setup()
    rt.startTransport()
    expect(rt.clock!.isRunning).toBe(true)
    rt.stopTransport()
    expect(rt.clock!.isRunning).toBe(false)
    expect(rt.player.state.active).toBe(false)
  })

  it('resumes a suspended AudioContext', async () => {
    const { rt } = await setup()
    rt.ensureAudio()
    const ctx = FakeAudioContext.last!
    ctx.state = 'suspended'
    rt.ensureAudio()
    expect(ctx.state).toBe('running')
  })

  it('stopTransport cancels an armed listen', async () => {
    const { rt } = await setup()
    rt.appMode = 'respond'
    rt.newListen()
    expect(rt.respond.phase).toBe('armed')
    rt.stopTransport()
    expect(rt.respond.phase).toBe('idle')
  })
})

/* --- recording and export ------------------------------------------------------------ */

/** The recorder is private by design; only its outputs are public. Reading it
 * directly is the only way to assert the take's beat positions. */
const recordedOf = (rt: Runtime) => (rt as unknown as { recorded: Array<{ startBeat: number; notes: number[] }> }).recorded

describe('recording', () => {
  it('captures auto-play chords but not manual auditions', async () => {
    const { rt } = await setup()
    rt.emitter.emit({ type: 'notes', notes: [60, 64, 67], velocity: 90 }) // audition, stopped
    expect(rt.hasRecording()).toBe(false)

    rt.player.start()
    rt.emitter.emit({ type: 'notes', notes: [60, 64, 67], velocity: 90 })
    expect(rt.hasRecording()).toBe(true)
  })

  it('exports nothing when the take is silent', async () => {
    const { rt } = await setup()
    expect(rt.exportMidi()).toBeNull()
    rt.player.start()
    rt.emitter.emit({ type: 'stop' }) // an N.C. silence boundary, not a chord
    expect(rt.hasRecording()).toBe(false)
    expect(rt.exportMidi()).toBeNull()
  })

  it('exports a Standard MIDI File once a chord has sounded', async () => {
    const { rt } = await setup()
    rt.player.start()
    rt.emitter.emit({ type: 'notes', notes: [60, 64, 67], velocity: 90 })
    const bytes = rt.exportMidi()!
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd')
  })

  it('starting a take clears the previous one', async () => {
    const { rt } = await setup()
    rt.player.start()
    rt.emitter.emit({ type: 'notes', notes: [60], velocity: 90 })
    expect(rt.hasRecording()).toBe(true)
    rt.startTransport()
    expect(rt.hasRecording()).toBe(false)
  })

  it('rebases a mid-playback clear so the take restarts at beat 0', async () => {
    const { rt } = await setup()
    rt.setClockSource('external')
    rt.midi.onClockStart!()
    for (let i = 0; i < 8; i++) rt.midi.onClockStep!() // currentStep = 7

    rt.clearRecording()
    expect(rt.hasRecording()).toBe(false)

    rt.midi.onClockStep!() // currentStep = 8, recordBase = 8
    rt.emitter.emit({ type: 'notes', notes: [60], velocity: 90 })
    expect(recordedOf(rt).at(-1)!.startBeat).toBe(0)
  })

  it('reports the chord count to the UI as it grows', async () => {
    const { rt } = await setup()
    const counts: number[] = []
    rt.onRecordingChanged = (n) => counts.push(n)
    rt.player.start()
    rt.emitter.emit({ type: 'notes', notes: [60], velocity: 90 })
    rt.emitter.emit({ type: 'stop' }) // silence — not a chord
    rt.emitter.emit({ type: 'notes', notes: [62], velocity: 90 })
    expect(counts.at(-1)).toBe(2)
  })
})

/* --- test connection ------------------------------------------------------------------- */

describe('testConnection', () => {
  it('reports the preview synth when no MIDI output is selected', async () => {
    const { rt } = await setup()
    expect(rt.testConnection(null)).toMatch(/preview synth/)
  })

  it('names the port it sent to', async () => {
    const { rt } = await setup()
    Object.defineProperty(rt.midi, 'hasOutput', { get: () => true })
    expect(rt.testConnection('IAC Bus 1')).toBe('Sent C major to IAC Bus 1')
    expect(rt.testConnection(null)).toMatch(/the selected MIDI output/)
  })

  it('always releases the test chord — no stuck-note gremlins', async () => {
    vi.useFakeTimers()
    const { rt } = await setup()
    const midiRelease = vi.spyOn(rt.midi, 'releaseAll')
    rt.testConnection(null)
    const synthRelease = vi.spyOn(rt.synth!, 'releaseAll')

    expect(midiRelease).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(midiRelease).toHaveBeenCalled()
    expect(synthRelease).toHaveBeenCalled()
  })
})

/* --- panic --------------------------------------------------------------------------- */

describe('panic', () => {
  it('silences the player, the MIDI port and the synth', async () => {
    const { rt } = await setup()
    rt.ensureAudio()
    const playerPanic = vi.spyOn(rt.player, 'panic')
    const allOff = vi.spyOn(rt.midi, 'allNotesOff')
    const synthOff = vi.spyOn(rt.synth!, 'releaseAll')
    rt.panic()
    expect(playerPanic).toHaveBeenCalled()
    expect(allOff).toHaveBeenCalled()
    expect(synthOff).toHaveBeenCalled()
  })
})
