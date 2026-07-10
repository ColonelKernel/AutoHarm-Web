import { useEffect, useState } from 'react'
import { useStore, SEED_LIST, KEY_ROOTS, MODES } from '../state/store'
import type { AppMode, DisplayMode, MacroName, ViewMode } from '../state/store'
import { PRESETS, SURPRISE_ID } from '../engine/macros/presets'
import { STEPS_PER_BAR } from '../engine/player/templates'
import { MODEL_LIST } from '../engine/voicing/performanceMap'
import { SESSION_MODES, type ModelName, type SessionMode } from '../engine/markov/config'
import { swingDelaySteps, swingLabel, SWING_UNITS, type SwingUnit } from '../engine/player/swing'
import type { PlayerMode } from '../engine/voicing/performanceMap'
import { ChordTimeline } from './ChordTimeline'
import { MODEL_DISPLAY } from './modelNames'
import { romanNumeral } from '../engine/theory/romanNumeral'

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

/** Rhythm pattern on its 16th-note grid, cells at their swung positions.
 * With `onToggle` the grid is an EDITOR: each cell is a real button
 * (keyboard + screen-reader operable), and the pattern it edits is the same
 * one generation consumes. */
function RhythmGrid({
  steps,
  onsets,
  swing,
  swingUnit,
  onToggle,
}: {
  steps: number
  onsets: number[]
  swing: number
  swingUnit: SwingUnit
  onToggle?: (step: number) => void
}) {
  const set = new Set(onsets)
  return (
    <div
      className="rhythm-grid"
      role={onToggle ? 'group' : undefined}
      style={{ width: steps * PITCH_PX + PITCH_PX, height: CELL_PX + (onToggle ? 4 : 0) }}
      aria-label={`rhythm pattern, ${onsets.length} chords per ${steps / 16} bar(s), swing ${swingLabel(swing)}`}
    >
      {Array.from({ length: steps }, (_, i) => {
        const delay = swingDelaySteps(i, swing, swingUnit)
        const cls =
          'rg-cell' +
          (set.has(i) ? ' on' : '') +
          (i % 4 === 0 ? ' beat' : '') +
          (i % 16 === 0 ? ' bar' : '') +
          (delay > 0 ? ' swung' : '')
        return onToggle ? (
          <button
            key={i}
            type="button"
            style={{ left: (i + delay) * PITCH_PX }}
            className={cls}
            aria-pressed={set.has(i)}
            aria-label={`Step ${i + 1}${set.has(i) ? ', chord onset' : ''}`}
            onClick={() => onToggle(i)}
          />
        ) : (
          <span key={i} style={{ left: (i + delay) * PITCH_PX }} className={cls} />
        )
      })}
    </div>
  )
}

/** Lab rhythm editor: the clickable grid plus pattern operations. */
function RhythmEditor() {
  const s = useStore()
  return (
    <div>
      <p className="panel-sub">
        Harmonic rhythm is <em>generated</em> around this feel — bars mostly groove together, the
        final bar broadens. Click cells to fix an exact pattern (generation then uses it verbatim).
      </p>
      <div className="row" style={{ marginBottom: 6, alignItems: 'center' }}>
        <span className="readout" style={{ minWidth: 110 }}>
          {s.rhythmName}{s.rhythmName === 'custom' ? ' pattern' : ''}
        </span>
        <button onClick={() => s.rotateRhythm(-1)} aria-label="Rotate pattern left">⟲ Rotate</button>
        <button onClick={() => s.rotateRhythm(1)} aria-label="Rotate pattern right">Rotate ⟳</button>
        <button onClick={s.randomizeRhythm}>🎲 Randomize</button>
        <button onClick={s.resetRhythm} disabled={s.rhythmName !== 'custom'}>Reset to preset</button>
      </div>
      <RhythmGrid
        steps={s.rhythmSteps}
        onsets={s.rhythmOnsets}
        swing={s.swing}
        swingUnit={s.swingUnit}
        onToggle={s.toggleRhythmStep}
      />
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
  // Primitive selectors only: an object-returning selector would allocate a new
  // snapshot every render and trip React's getSnapshot caching check.
  const keyRoot = useStore((st) => st.keyRoot)
  const keyMode = useStore((st) => st.keyMode)
  const bpm = useStore((st) => st.bpm)
  const clockSource = useStore((st) => st.clockSource)
  const externalBpm = useStore((st) => st.externalBpm)
  const playing = useStore((st) => st.playing)
  const status = useStore((st) => st.status)
  const setKeyRoot = useStore((st) => st.setKeyRoot)
  const setKeyMode = useStore((st) => st.setKeyMode)
  const setBpm = useStore((st) => st.setBpm)
  return (
    <header className="app-header">
      <h1>AutoHarm</h1>
      <ModeTabs />
      <div className="header-status">
        <div className="control compact">
          <label>Key</label>
          <select value={keyRoot} onChange={(e) => setKeyRoot(Number(e.target.value))}>
            {KEY_ROOTS.map((r, pc) => (
              <option key={r} value={pc}>{r}</option>
            ))}
          </select>
        </div>
        <div className="control compact">
          <label>Mode</label>
          <select value={keyMode} onChange={(e) => setKeyMode(e.target.value as 'maj' | 'min')}>
            <option value="maj">major</option>
            <option value="min">minor</option>
          </select>
        </div>
        <div className="control compact">
          <label>BPM{clockSource === 'external' ? ' (DAW)' : ''}</label>
          {clockSource === 'external' ? (
            <input type="text" readOnly value={externalBpm ? externalBpm.toFixed(1) : '…'} />
          ) : (
            <input
              type="number"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          )}
        </div>
        <span className={`status-badge${playing ? ' playing' : ''}`}>{status}</span>
        <ConnectionChip />
        <ViewToggle />
      </div>
    </header>
  )
}

/** At-a-glance connection state; clicking jumps to the Connections panel. */
function ConnectionChip() {
  const s = useStore()
  const daw = s.midiEnabled && s.midiOutId
  const label = daw
    ? `● ${s.midiOutputs.find((p) => p.id === s.midiOutId)?.name ?? 'MIDI out'}`
    : s.midiEnabled
      ? '○ no MIDI out'
      : '○ DAW not connected'
  const reveal = () => {
    // The Connections panel does not exist in every view; switch to one that
    // has it, then scroll after React has committed the new tree.
    if (!document.getElementById('connections-panel')) s.setAppMode('generate')
    requestAnimationFrame(() =>
      document.getElementById('connections-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }
  return (
    <button
      className={'conn-chip' + (daw ? ' ok' : '')}
      title={daw ? 'MIDI routed — click for connection settings' : 'Click to set up MIDI routing'}
      onClick={reveal}
    >
      {label}
    </button>
  )
}

/** Slim phrase-position bar: where the playhead is inside the current phrase. */
function PhrasePosition() {
  const playing = useStore((st) => st.playing)
  const pos = useStore((st) => st.playPosSteps)
  const total = useStore((st) => st.playTotalSteps)
  const cycle = useStore((st) => st.playCycle)
  if (!playing || pos < 0 || total <= 0) return null
  const bars = Math.max(1, Math.ceil(total / 16))
  const bar = Math.floor(pos / 16) + 1
  const beat = Math.floor((pos % 16) / 4) + 1
  return (
    <div className="phrase-pos" aria-hidden="true">
      <div className="pp-track">
        <div className="pp-fill" style={{ width: `${((pos + 1) / total) * 100}%` }} />
      </div>
      <span className="pp-text">
        bar {bar}/{bars} · beat {beat} · pass {cycle + 1}
      </span>
    </div>
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
        onClick={() => void s.reroll()}
      >
        ⟳ Variation
      </button>
      <button disabled={!s.canUndo} onClick={s.undo} title="Undo (Cmd/Ctrl+Z)">
        ↩ Undo
      </button>
      <button disabled={!s.canRedo} onClick={s.redo} title="Redo (Cmd/Ctrl+Shift+Z)">
        ↪ Redo
      </button>
      <span className="live-slot" role="status">
        {s.generating && <span className="gen-badge">Generating…</span>}
        {!s.generating && s.variationQueued && (
          <span className="queued-badge">Variation queued — lands at the next phrase</span>
        )}
      </span>
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

const PHRASE_CHOICES: Array<{ steps: number; label: string }> = [
  { steps: STEPS_PER_BAR / 2, label: '1/2 bar' },
  { steps: STEPS_PER_BAR, label: '1 bar' },
  { steps: 2 * STEPS_PER_BAR, label: '2 bars' },
  { steps: 4 * STEPS_PER_BAR, label: '4 bars' },
  { steps: 8 * STEPS_PER_BAR, label: '8 bars' },
  { steps: 16 * STEPS_PER_BAR, label: '16 bars' },
]

/** Phrase length in musical units, step-exact internally (4/4 only). */
function PhraseLengthControl() {
  const phraseSteps = useStore((s) => s.phraseSteps)
  const setPhraseSteps = useStore((s) => s.setPhraseSteps)
  const listed = PHRASE_CHOICES.some((c) => c.steps === phraseSteps)
  return (
    <>
      <div className="control">
        <label>Phrase length</label>
        <select
          value={listed ? phraseSteps : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') setPhraseSteps(3 * STEPS_PER_BAR) // non-listed -> shows the bars input
            else setPhraseSteps(Number(e.target.value))
          }}
        >
          {PHRASE_CHOICES.map((c) => (
            <option key={c.steps} value={c.steps}>{c.label}</option>
          ))}
          <option value="custom">custom…</option>
        </select>
      </div>
      {!listed && (
        <div className="control">
          <label>Custom (bars)</label>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={phraseSteps / STEPS_PER_BAR}
            onChange={(e) => setPhraseSteps(Number(e.target.value) * STEPS_PER_BAR)}
          />
        </div>
      )}
    </>
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
      <PhraseLengthControl />
      <Dial label="Rhythm" value={s.rhythm} onChange={s.setRhythm} display={s.rhythmName} />
      <Dial label="Swing" value={s.swing} onChange={s.setSwing} display={s.swingName} />
    </div>
  )
}

/** One of the four signature macros: endpoint hints + Custom state. */
function MacroDial(props: { name: MacroName; label: string; left: string; right: string }) {
  const value = useStore((s) => s.macros[props.name])
  const custom = useStore((s) => s.customMacros[props.name] === true)
  const setMacro = useStore((s) => s.setMacro)
  return (
    <div className="macro-dial">
      <label>
        <span>{props.label}</span>
        <span className="value">{custom ? 'Custom' : value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={`${props.label}: ${props.left} to ${props.right}`}
        onChange={(e) => setMacro(props.name, Number(e.target.value))}
      />
      <div className="macro-ends" aria-hidden="true">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </div>
    </div>
  )
}

function PresetPicker() {
  const active = useStore((s) => s.activePresetId)
  const applyPreset = useStore((s) => s.applyPreset)
  return (
    <div className="preset-row" role="group" aria-label="Musical presets">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className={'preset-chip' + (active === p.id ? ' active' : '')}
          title={p.description}
          aria-pressed={active === p.id}
          onClick={() => applyPreset(p.id)}
        >
          {p.name}
        </button>
      ))}
      <button
        className={'preset-chip surprise' + (active === SURPRISE_ID ? ' active' : '')}
        title="A musically coherent twist on one of the families"
        onClick={() => applyPreset(SURPRISE_ID)}
      >
        🎲 Surprise Me
      </button>
    </div>
  )
}

function MacroPanel() {
  const s = useStore()
  return (
    <>
      <PresetPicker />
      <div className="macro-row">
        <MacroDial name="familiarity" label="Familiarity" left="Common" right="Unusual" />
        <MacroDial name="harmonicColor" label="Harmonic Color" left="Folk" right="Jazz" />
        <MacroDial name="tension" label="Tension" left="Resolved" right="Suspended" />
        <MacroDial name="motion" label="Motion" left="Still" right="Active" />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div className="control">
          <label>Seed chord</label>
          <select value={s.seedIndex} onChange={(e) => s.setSeedIndex(Number(e.target.value))}>
            {SEED_LIST.map((c, i) => (
              <option key={c} value={i}>{c}</option>
            ))}
          </select>
        </div>
        <button onClick={s.audition}>Audition seed</button>
      </div>
    </>
  )
}

/** Raw engine dials (Lab) — hand edits here show macros as "Custom". */
function GeneratorDials() {
  const s = useStore()
  return (
    <div className="row">
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
        <RhythmEditor />
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
    <section className="panel" id="connections-panel">
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
        <button onClick={s.testConnection} disabled={!s.loaded}>
          🔔 Test connection
        </button>
        {s.testReport && <span className="readout" role="status">{s.testReport}</span>}
      </div>
    </section>
  )
}

/** Why-this-chord panel for the selected card — deterministic data only:
 * roman function, the actual score breakdown, model prior, blend profile. */
function ExplanationPanel() {
  const s = useStore()
  const slot = s.progression.slots.find((x) => x.id === s.selectedSlotId)
  if (!slot) {
    return (
      <p className="explain-hint">
        Select a chord to see <em>why</em> it was chosen — its harmonic function and the scores
        that picked it.
      </p>
    )
  }
  const key = `${KEY_ROOTS[s.keyRoot]}:${s.keyMode}`
  const rn = romanNumeral(slot.symbol, key)
  const ex = slot.explanation
  const b = ex?.breakdown
  return (
    <div className="explain" aria-label={`Why ${slot.symbol}`}>
      <div className="explain-head">
        <span className="explain-symbol">{slot.symbol}</span>
        {rn && (
          <span className="explain-fn">
            Function: <b>{rn.numeral}</b> · Role: <b>{rn.degreeLabel}</b>
            {!rn.diatonic && ' (chromatic)'}
          </span>
        )}
        <span className="explain-src">
          {slot.source === 'response' ? 'chosen in response to your phrase'
            : slot.source === 'manual' ? 'edited by you'
            : 'generated'}
        </span>
      </div>
      {ex?.reasons && ex.reasons.length > 0 && (
        <ul className="explain-reasons">
          {ex.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {b && (
        <div className="explain-scores">
          {([
            // Melody fit only means something for chords chosen against a
            // played phrase; generated chords score it neutrally.
            ...(slot.source === 'response' ? ([['Melody fit', b.melodyFit]] as const) : []),
            ['Model preference', b.modelPrior],
            ['Voice leading', b.voiceLeadingFit],
            ['Cadence fit', b.cadenceFit],
            ['Novelty', b.noveltyFit],
          ] as const).map(([label, v]) => (
            <div className="score-row" key={label}>
              <span className="score-label">{label}</span>
              <span className="score-bar"><span style={{ width: `${Math.round(v * 100)}%` }} /></span>
              <span className="score-val">{v.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      {!b && ex?.prior != null && (
        <p className="panel-sub">Candidate score from the model: {ex.prior.toFixed(3)} (selection probability, not a confidence).</p>
      )}
      {ex?.blendProfile && (
        <p className="panel-sub">
          Blend profile at generation:{' '}
          {ex.blendProfile.map(([n, w]) => `${n} ${(w * 100).toFixed(0)}%`).join(' · ')}
        </p>
      )}
      {!ex && <p className="panel-sub">No generation data for this chord (edited or pre-V2).</p>}
    </div>
  )
}

function GenerateView() {
  const viewMode = useStore((s) => s.viewMode)
  return (
    <>
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>Progression</h2>
          <PhrasePosition />
        </div>
        <ActionBar />
        <ChordTimeline />
        <ExplanationPanel />
      </section>
      <section className="panel">
        <h2>Direction</h2>
        <p className="panel-sub">
          Pick a preset or shape it yourself — these four dials are the musical personality.
        </p>
        <MacroPanel />
      </section>
      <section className="panel">
        <h2>Transport</h2>
        <TransportBar />
      </section>
      {viewMode === 'lab' && (
        <section className="panel">
          <h2>Raw generator dials</h2>
          <p className="panel-sub">
            The parameters underneath the macros. Editing here shows the owning macro as <em>Custom</em>.
          </p>
          <GeneratorDials />
        </section>
      )}
      {viewMode === 'lab' && <LabPanels />}
      <OutputPanel />
      <ConnectionsPanel />
    </>
  )
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'READY',
  armed: 'ARMED — capture starts at the next phrase boundary',
  listening: 'LISTENING',
  analyzing: 'ANALYZING',
  responding: 'HOLDING RESPONSE',
  ready: 'READY — response holding until your next phrase',
}

function RespondView() {
  const s = useStore()
  const canListen = s.respondPhase === 'idle' || s.respondPhase === 'ready'
  const pct = s.respondProgress >= 0 ? Math.min(100, (s.respondProgress / s.phraseSteps) * 100) : 0
  return (
    <>
      <section className="panel">
        <h2>Listen &amp; Respond</h2>
        <p className="panel-sub">
          Press <em>New Listen</em>, play a phrase on your MIDI keyboard for the full window, and
          AutoHarm answers with harmony scored against your melody — held steady for the chosen
          number of repetitions.
        </p>
        {!s.midiEnabled && (
          <div className="banner">
            Respond listens to a MIDI keyboard — enable MIDI below and pick a MIDI in device.
          </div>
        )}
        <div className="respond-state" role="status">
          <span className={`phase-badge phase-${s.respondPhase}`}>{PHASE_LABEL[s.respondPhase]}</span>
          {s.respondPhase === 'responding' && (
            <span className="readout">{s.respondRepsLeft} repetition{s.respondRepsLeft === 1 ? '' : 's'} left</span>
          )}
        </div>
        {s.respondPhase === 'listening' && (
          <div className="listen-progress" aria-label="Capture progress">
            <div className="lp-fill" style={{ width: `${pct}%` }} />
            <span className="lp-text">
              {Math.floor(s.respondProgress / 16) + 1} / {Math.ceil(s.phraseSteps / 16)} bars
            </span>
          </div>
        )}
        <div className="transport" style={{ marginTop: 12 }}>
          <button className="primary big" onClick={s.newListen} disabled={!canListen || !s.loaded}>
            🎤 New Listen
          </button>
          {(s.respondPhase === 'armed' || s.respondPhase === 'listening' || s.respondPhase === 'analyzing') && (
            <button onClick={s.cancelListen}>Cancel</button>
          )}
          <PhraseLengthControl />
          <div className="control">
            <label>Response repetitions</label>
            <select value={s.repetitions} onChange={(e) => s.setRepetitions(Number(e.target.value))}>
              {[1, 2, 4, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button className="danger" onClick={s.panic}>Panic</button>
        </div>
      </section>
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>Response</h2>
        </div>
        <ChordTimeline />
        <ExplanationPanel />
      </section>
      <OutputPanel />
      <ConnectionsPanel />
    </>
  )
}

/** Live layout: the same instrument, big targets, minimal configuration. */
function PerformView() {
  const s = useStore()
  const canListen = s.respondPhase === 'idle' || s.respondPhase === 'ready'
  const pct = s.respondProgress >= 0 ? Math.min(100, (s.respondProgress / s.phraseSteps) * 100) : 0
  return (
    <div className="perform">
      <div className="perform-state">
        <span className={`phase-badge phase-${s.respondPhase}`} role="status">
          {s.respondPhase === 'idle' ? (s.playing ? 'PLAYING' : 'STOPPED') : PHASE_LABEL[s.respondPhase]}
        </span>
        <span className="perform-chord">{s.currentChord}</span>
        <span className="live-slot" role="status">
          {s.generating && <span className="gen-badge">Generating…</span>}
          {!s.generating && s.variationQueued && <span className="queued-badge">Variation queued</span>}
          {s.hold && <span className="queued-badge">Hold — vamping</span>}
        </span>
      </div>
      <PhrasePosition />
      {s.respondPhase === 'listening' && (
        <div className="listen-progress" aria-label="Capture progress">
          <div className="lp-fill" style={{ width: `${pct}%` }} />
          <span className="lp-text">
            {Math.floor(s.respondProgress / 16) + 1} / {Math.ceil(s.phraseSteps / 16)} bars
          </span>
        </div>
      )}
      <section className="panel timeline-panel">
        <ChordTimeline />
      </section>
      <div className="perform-actions">
        <button className="primary big" onClick={s.newListen} disabled={!canListen || !s.loaded}>
          🎤 New Listen
        </button>
        <button className="big" disabled={!s.loaded || s.generating} onClick={s.reroll}>
          ⟳ Variation
        </button>
        <button
          className="primary big"
          onClick={s.togglePlay}
          disabled={!s.loaded || s.clockSource === 'external'}
        >
          {s.playing ? '■ Stop' : '▶ Play'}
        </button>
        <button className={'big' + (s.hold ? ' active' : '')} onClick={() => s.setHold(!s.hold)} aria-pressed={s.hold}>
          Hold
        </button>
        <button className="danger big" onClick={s.panic}>Panic</button>
      </div>
      <section className="panel">
        <MacroPanel />
      </section>
    </div>
  )
}

export default function App() {
  // Narrow selectors: App is the tree root, so a bare useStore() here would
  // re-render every panel on each per-beat store patch during playback.
  const loadError = useStore((s) => s.loadError)
  const lastError = useStore((s) => s.lastError)
  const notice = useStore((s) => s.notice)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const midiSupported = useStore((s) => s.midiSupported)
  const appMode = useStore((s) => s.appMode)

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  // Global shortcuts. Never hijack typing in a form field, and never steal
  // Space from a focused button (that would break every keyboard control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing) return
      const st = useStore.getState()

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) {
        if (!st.loaded || st.clockSource === 'external') return
        e.preventDefault()
        st.togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loadError) {
    return (
      <main className="app">
        <h1>AutoHarm</h1>
        <div className="banner">Failed to load corpora: {loadError}</div>
      </main>
    )
  }

  return (
    <main className="app">
      <HeaderBar />
      <IntroCard />
      {lastError && (
        <div className="status-line">
          <span className="error-text">{lastError}</span>
        </div>
      )}
      {notice && (
        <div className="banner notice" role="status">
          {notice}
          <button className="banner-close" aria-label="Dismiss notice" onClick={dismissNotice}>
            ×
          </button>
        </div>
      )}
      {!midiSupported && (
        <div className="banner">
          This browser has no Web MIDI (Safari doesn't support it). The built-in synth still works —
          use Chrome, Edge or Firefox to route MIDI into your DAW.
        </div>
      )}
      {appMode === 'generate' && <GenerateView />}
      {appMode === 'respond' && <RespondView />}
      {appMode === 'perform' && <PerformView />}
    </main>
  )
}
