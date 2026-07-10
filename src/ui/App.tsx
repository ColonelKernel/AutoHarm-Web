import { useEffect, useState } from 'react'
import { useStore, SEED_LIST, KEY_ROOTS, MODES } from '../state/store'
import type { AppMode, DisplayMode, ViewMode } from '../state/store'
import { MODEL_LIST } from '../engine/voicing/performanceMap'
import { SESSION_MODES, type ModelName, type SessionMode } from '../engine/markov/config'
import { swingDelaySteps, swingLabel, SWING_UNITS, type SwingUnit } from '../engine/player/swing'
import type { PlayerMode } from '../engine/voicing/performanceMap'
import { ChordTimeline } from './ChordTimeline'
import { MODEL_DISPLAY } from './modelNames'

function Dial(props: {
  label: string
  value: number
  onChange: (v: number) => void
  display?: string
}) {
  return (
    <div className="dial">
      <label>
        <span>{props.label}</span>
        <span className="value">{props.display ?? props.value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  )
}

const CELL_PX = 15
const GAP_PX = 3
const PITCH_PX = CELL_PX + GAP_PX

/** Rhythm pattern on its 16th-note grid, cells at their swung positions. */
function RhythmGrid({
  steps,
  onsets,
  swing,
  swingUnit,
}: {
  steps: number
  onsets: number[]
  swing: number
  swingUnit: SwingUnit
}) {
  const set = new Set(onsets)
  return (
    <div
      className="rhythm-grid"
      style={{ width: steps * PITCH_PX + PITCH_PX, height: CELL_PX }}
      aria-label={`rhythm pattern, ${onsets.length} chords per ${steps / 16} bar(s), swing ${swingLabel(swing)}`}
    >
      {Array.from({ length: steps }, (_, i) => {
        const delay = swingDelaySteps(i, swing, swingUnit)
        return (
          <span
            key={i}
            style={{ left: (i + delay) * PITCH_PX }}
            className={
              'rg-cell' +
              (set.has(i) ? ' on' : '') +
              (i % 4 === 0 ? ' beat' : '') +
              (i % 16 === 0 ? ' bar' : '') +
              (delay > 0 ? ' swung' : '')
            }
          />
        )
      })}
    </div>
  )
}

function IntroCard() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('autoharm.introDismissed') === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  const dismiss = () => {
    try {
      localStorage.setItem('autoharm.introDismissed', '1')
    } catch {
      /* private mode: just hide for the session */
    }
    setDismissed(true)
  }
  return (
    <div className="intro">
      <button className="intro-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      <p className="intro-lead">
        <strong>AutoHarm invents chord progressions you can edit, lock, and perform</strong> —
        through its built-in sound, or as live MIDI into any DAW. Generate a progression, reshape
        it chord by chord, and regenerate only the parts you haven't locked.
      </p>
      <ol className="intro-steps">
        <li>
          <span className="step-n">1</span>
          <span>
            <b>Generate.</b> Pick a Key and turn the dials, then hit Generate — the progression
            appears as editable chord cards.
          </span>
        </li>
        <li>
          <span className="step-n">2</span>
          <span>
            <b>Shape it.</b> Edit any chord, 🔒 lock the ones you love, then Variation rerolls
            only the rest. Undo/redo works throughout.
          </span>
        </li>
        <li>
          <span className="step-n">3</span>
          <span>
            <b>Play &amp; send.</b> Press Play to hear it, route MIDI to your DAW, or Export .mid.
          </span>
        </li>
      </ol>
    </div>
  )
}

function ModeTabs() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const tabs: Array<{ id: AppMode; label: string }> = [
    { id: 'generate', label: 'Generate' },
    { id: 'respond', label: 'Respond' },
    { id: 'perform', label: 'Perform' },
  ]
  return (
    <div className="mode-tabs" role="tablist" aria-label="App mode">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={appMode === t.id}
          className={'mode-tab' + (appMode === t.id ? ' active' : '')}
          onClick={() => setAppMode(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Header strip: identity, mode tabs, key/tempo at a glance. */
function HeaderBar() {
  const s = useStore()
  return (
    <header className="app-header">
      <h1>AutoHarm</h1>
      <ModeTabs />
      <div className="header-status">
        <div className="control compact">
          <label>Key</label>
          <select value={s.keyRoot} onChange={(e) => s.setKeyRoot(Number(e.target.value))}>
            {KEY_ROOTS.map((r, pc) => (
              <option key={r} value={pc}>{r}</option>
            ))}
          </select>
        </div>
        <div className="control compact">
          <label>Mode</label>
          <select value={s.keyMode} onChange={(e) => s.setKeyMode(e.target.value as 'maj' | 'min')}>
            <option value="maj">major</option>
            <option value="min">minor</option>
          </select>
        </div>
        <div className="control compact">
          <label>BPM{s.clockSource === 'external' ? ' (DAW)' : ''}</label>
          {s.clockSource === 'external' ? (
            <input type="text" readOnly value={s.externalBpm ? s.externalBpm.toFixed(1) : '…'} />
          ) : (
            <input
              type="number"
              min={40}
              max={240}
              value={s.bpm}
              onChange={(e) => s.setBpm(Number(e.target.value))}
            />
          )}
        </div>
        <span className={`status-badge${s.playing ? ' playing' : ''}`}>{s.status}</span>
      </div>
    </header>
  )
}

function ViewToggle() {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  return (
    <div className="view-toggle" role="group" aria-label="Detail level">
      {(['quick', 'lab'] as ViewMode[]).map((v) => (
        <button
          key={v}
          className={viewMode === v ? 'active' : ''}
          aria-pressed={viewMode === v}
          onClick={() => setViewMode(v)}
        >
          {v === 'quick' ? 'Quick' : 'Lab'}
        </button>
      ))}
    </div>
  )
}

/** Primary generation + edit actions above the timeline. */
function ActionBar() {
  const s = useStore()
  return (
    <div className="action-bar">
      <button className="primary" disabled={!s.loaded || s.generating} onClick={() => void s.generateNew()}>
        ✨ Generate new
      </button>
      <button
        disabled={!s.loaded || s.generating}
        title="Regenerate unlocked chords; locked ones survive"
        onClick={s.reroll}
      >
        ⟳ Variation
      </button>
      <button disabled={!s.canUndo} onClick={s.undo} title="Undo (Cmd/Ctrl+Z)">
        ↩ Undo
      </button>
      <button disabled={!s.canRedo} onClick={s.redo} title="Redo (Cmd/Ctrl+Shift+Z)">
        ↪ Redo
      </button>
      {s.variationQueued && <span className="queued-badge">Variation queued ⏳</span>}
      <div className="control compact" style={{ marginLeft: 'auto' }}>
        <label>Display</label>
        <select value={s.displayMode} onChange={(e) => s.setDisplayMode(e.target.value as DisplayMode)}>
          <option value="symbols">Chord symbols</option>
          <option value="roman">Roman numerals</option>
          <option value="both">Both</option>
        </select>
      </div>
    </div>
  )
}

function TransportBar() {
  const s = useStore()
  return (
    <div className="transport">
      <button
        className="primary"
        onClick={s.togglePlay}
        disabled={!s.loaded || s.clockSource === 'external'}
        title={s.clockSource === 'external' ? 'Driven by the DAW’s MIDI clock' : undefined}
      >
        {s.playing ? '■ Stop' : '▶ Play'}
      </button>
      <button className={s.hold ? 'active' : ''} onClick={() => s.setHold(!s.hold)} aria-pressed={s.hold}>
        Hold
      </button>
      <button className="danger" onClick={s.panic}>Panic</button>
      <div className="control">
        <label>Phrase mode</label>
        <select value={s.mode} onChange={(e) => s.setMode(e.target.value as PlayerMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="control">
        <label>Phrase length</label>
        <select value={s.phraseBars} onChange={(e) => s.setPhraseBars(Number(e.target.value))}>
          {[8, 16, 24, 32].map((b) => (
            <option key={b} value={b}>{b} bars</option>
          ))}
        </select>
      </div>
      <Dial label="Rhythm" value={s.rhythm} onChange={s.setRhythm} display={s.rhythmName} />
      <Dial label="Swing" value={s.swing} onChange={s.setSwing} display={s.swingName} />
    </div>
  )
}

function GeneratorDials() {
  const s = useStore()
  return (
    <div className="row">
      <div className="control">
        <label>Seed chord</label>
        <select value={s.seedIndex} onChange={(e) => s.setSeedIndex(Number(e.target.value))}>
          {SEED_LIST.map((c, i) => (
            <option key={c} value={i}>{c}</option>
          ))}
        </select>
      </div>
      <button onClick={s.audition}>Audition seed</button>
      <Dial label="Color (folk→jazz)" value={s.color} onChange={s.setColor} />
      <Dial label="Adventure" value={s.adventure} onChange={s.setAdventure} />
      <Dial label="Spice (macro)" value={s.spice} onChange={s.setSpice} />
      <Dial label="Gravity" value={s.gravity} onChange={s.setGravity} />
    </div>
  )
}

/** Lab-only: model choice, neural session, voicing, groove detail, clock. */
function LabPanels() {
  const s = useStore()
  return (
    <>
      <section className="panel">
        <h2>Model</h2>
        <p className="panel-sub">Which generative engine proposes the next chord.</p>
        <div className="row">
          <div className="control">
            <label>Engine</label>
            <select
              value={s.model}
              disabled={s.modelLoading}
              onChange={(e) => void s.setModel(e.target.value as ModelName)}
            >
              {MODEL_LIST.map((m) => (
                <option key={m} value={m}>{MODEL_DISPLAY[m as ModelName]?.name ?? m}</option>
              ))}
            </select>
            <span className="readout">
              {s.modelLoading ? 'loading…' : (s.modelError ?? MODEL_DISPLAY[s.model]?.detail ?? '')}
            </span>
          </div>
          {s.model !== 'markov' && (
            <>
              <div className="control">
                <label>Session mode</label>
                <select value={s.sessionMode} onChange={(e) => s.setSessionMode(e.target.value as SessionMode)}>
                  {SESSION_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="control">
                <label>Session step</label>
                <span className="readout">{s.sessionStep} / 64</span>
              </div>
              <button onClick={s.resetSession}>Reset session</button>
              <Dial
                label="Neural temp"
                value={(s.neuralTemp - 0.05) / (3 - 0.05)}
                onChange={(v) => s.setNeuralTemp(0.05 + v * (3 - 0.05))}
                display={s.neuralTemp.toFixed(2)}
              />
            </>
          )}
          <div className="control">
            <label>Clock</label>
            <select
              value={s.clockSource}
              onChange={(e) => s.setClockSource(e.target.value as 'internal' | 'external')}
            >
              <option value="internal">Internal</option>
              <option value="external">External (MIDI)</option>
            </select>
          </div>
          <div className="control">
            <label>Swing feel</label>
            <select value={s.swingUnit} onChange={(e) => s.setSwingUnit(e.target.value as SwingUnit)}>
              {SWING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u === '8th' ? '8th (jazz)' : '16th (funk)'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <RhythmGrid steps={s.rhythmSteps} onsets={s.rhythmOnsets} swing={s.swing} swingUnit={s.swingUnit} />
      </section>

      <section className="panel">
        <h2>Voicing</h2>
        <p className="panel-sub">Shapes <em>how</em> each chord is played — register, richness, added harmony.</p>
        <div className="row">
          <Dial label="Voicing ladder" value={s.voicingLevel} onChange={s.setVoicingLevel} />
          <Dial
            label="Voice distance"
            value={s.voiceDistance}
            onChange={s.setVoiceDistance}
            display={s.voiceDistName}
          />
          <Dial label="Force major" value={s.colorMajor} onChange={s.setColorMajor} />
          <Dial label="Force minor" value={s.colorMinor} onChange={s.setColorMinor} />
          <Dial label="Add 7th" value={s.color7th} onChange={s.setColor7th} />
          <div className="control">
            <label>Register (center)</label>
            <input
              type="number"
              min={36}
              max={84}
              value={s.register}
              onChange={(e) => s.setRegister(Number(e.target.value))}
            />
          </div>
        </div>
      </section>
    </>
  )
}

function OutputPanel() {
  const s = useStore()
  return (
    <section className="panel">
      <h2>Now playing</h2>
      <div className="chord-display">
        <span className="symbol">{s.currentChord}</span>
        <span className="notes">
          {s.currentNotes.length > 0 ? `MIDI ${s.currentNotes.join(' ')}` : ''}
        </span>
      </div>
      <div className="transport" style={{ marginTop: 12 }}>
        <button onClick={s.exportMidi} disabled={s.recordedCount === 0}>
          ⬇ Export .mid
        </button>
        <button onClick={s.clearTake} disabled={s.recordedCount === 0}>
          Clear take
        </button>
        <span className="readout">
          {s.recordedCount > 0
            ? `${s.recordedCount} chord${s.recordedCount === 1 ? '' : 's'} captured this take`
            : 'press Play to capture a take'}
        </span>
      </div>
    </section>
  )
}

function ConnectionsPanel() {
  const s = useStore()
  return (
    <section className="panel">
      <h2>Connections</h2>
      <p className="panel-sub">Route MIDI to your DAW (via an IAC / loopMIDI port) and toggle the preview synth.</p>
      <div className="row">
        {!s.midiEnabled && s.midiSupported && (
          <button className="primary" onClick={() => void s.enableMidi()}>
            Enable MIDI + Audio
          </button>
        )}
        {s.midiEnabled && (
          <>
            <div className="control">
              <label>MIDI out (→ DAW via IAC/loopMIDI)</label>
              <select
                value={s.midiOutId ?? ''}
                onChange={(e) => s.selectMidiOut(e.target.value || null)}
              >
                <option value="">— none —</option>
                {s.midiOutputs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="control">
              <label>MIDI in (keyboard seeds &amp; responds)</label>
              <select
                value={s.midiInId ?? ''}
                onChange={(e) => s.selectMidiIn(e.target.value || null)}
              >
                <option value="">— none —</option>
                {s.midiInputs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="control">
          <label>Preview synth</label>
          <button className={s.synthOn ? 'active' : ''} onClick={() => s.setSynthOn(!s.synthOn)}>
            {s.synthOn ? 'On' : 'Off'}
          </button>
        </div>
        <Dial label="Synth volume" value={s.synthVolume} onChange={s.setSynthVolume} />
      </div>
    </section>
  )
}

function GenerateView() {
  const viewMode = useStore((s) => s.viewMode)
  return (
    <>
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>Progression</h2>
          <ViewToggle />
        </div>
        <ActionBar />
        <ChordTimeline />
      </section>
      <section className="panel">
        <h2>Transport</h2>
        <TransportBar />
      </section>
      <section className="panel">
        <h2>Direction</h2>
        <p className="panel-sub">Chooses <em>which</em> chord comes next — seed, key (in the header), and the dials.</p>
        <GeneratorDials />
      </section>
      {viewMode === 'lab' && <LabPanels />}
      <OutputPanel />
      <ConnectionsPanel />
    </>
  )
}

function RespondView() {
  return (
    <section className="panel">
      <h2>Respond</h2>
      <p className="panel-sub">
        Play a phrase on a MIDI keyboard; AutoHarm listens for the full phrase, then answers with
        harmony that fits it. <em>Landing in this build — coming online in the next milestones.</em>
      </p>
    </section>
  )
}

function PerformView() {
  return (
    <section className="panel">
      <h2>Perform</h2>
      <p className="panel-sub">
        A large-target live layout for the same instrument.{' '}
        <em>Landing in this build — coming online in the next milestones.</em>
      </p>
    </section>
  )
}

export default function App() {
  const s = useStore()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  // Global undo/redo shortcuts; never hijack typing in form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      const st = useStore.getState()
      if (e.shiftKey) st.redo()
      else st.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (s.loadError) {
    return (
      <main className="app">
        <h1>AutoHarm</h1>
        <div className="banner">Failed to load corpora: {s.loadError}</div>
      </main>
    )
  }

  return (
    <main className="app">
      <HeaderBar />
      <IntroCard />
      {s.lastError && (
        <div className="status-line">
          <span className="error-text">{s.lastError}</span>
        </div>
      )}
      {!s.midiSupported && (
        <div className="banner">
          This browser has no Web MIDI (Safari doesn't support it). The built-in synth still works —
          use Chrome, Edge or Firefox to route MIDI into your DAW.
        </div>
      )}
      {s.appMode === 'generate' && <GenerateView />}
      {s.appMode === 'respond' && <RespondView />}
      {s.appMode === 'perform' && <PerformView />}
    </main>
  )
}
