import { useEffect, useState } from 'react'
import { useStore, SEED_LIST, KEY_ROOTS, MODES } from '../state/store'
import { MODEL_LIST } from '../engine/voicing/performanceMap'
import { SESSION_MODES, type ModelName, type SessionMode } from '../engine/markov/config'
import type { PlayerMode } from '../engine/voicing/performanceMap'

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

/** Visualizes the current rhythm template on its 16th-note grid — filled cells
 * are chord onsets, every 4th step (a beat) is emphasized. */
function RhythmGrid({ steps, onsets }: { steps: number; onsets: number[] }) {
  const set = new Set(onsets)
  return (
    <div className="rhythm-grid" aria-label="rhythm pattern">
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={
            'rg-cell' + (set.has(i) ? ' on' : '') + (i % 4 === 0 ? ' beat' : '') + (i % 16 === 0 ? ' bar' : '')
          }
        />
      ))}
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
        <strong>AutoHarm invents chord progressions and plays them for you</strong> — through its
        built-in sound, or as live MIDI into any DAW (Ableton, Logic, GarageBand…). Great for
        sketching harmony, beating writer's block, or generating parts to record.
      </p>
      <ol className="intro-steps">
        <li>
          <span className="step-n">1</span>
          <span>
            <b>Shape a vibe.</b> Pick a Seed chord &amp; Key, then turn the dials — Color
            (folk→jazz), Adventure (safe→surprising), Gravity (pull to home).
          </span>
        </li>
        <li>
          <span className="step-n">2</span>
          <span>
            <b>Press Play.</b> It walks a chord progression in time. You'll hear the built-in synth
            immediately.
          </span>
        </li>
        <li>
          <span className="step-n">3</span>
          <span>
            <b>Send it out.</b> Connect a MIDI port to record into your DAW live, or hit
            <b> Export .mid</b> to save the take as a file. See the DAW setup guide.
          </span>
        </li>
      </ol>
    </div>
  )
}

export default function App() {
  const s = useStore()

  useEffect(() => {
    void useStore.getState().init()
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
      <header className="app-header">
        <h1>AutoHarm</h1>
        <span className="tagline">
          a chord-progression generator that plays into any DAW over MIDI
        </span>
      </header>

      <IntroCard />

      <div className="status-line">
        <span className={`status-badge${s.playing ? ' playing' : ''}`}>{s.status}</span>
        {s.lastError && <span className="error-text">{s.lastError}</span>}
      </div>

      {!s.midiSupported && (
        <div className="banner">
          This browser has no Web MIDI (Safari doesn't support it). The built-in synth still works —
          use Chrome, Edge or Firefox to route MIDI into your DAW.
        </div>
      )}

      <section className="panel">
        <h2>Transport</h2>
        <p className="panel-sub">Start &amp; stop, set the tempo, and shape the phrasing.</p>
        <div className="transport">
          <button
            className="primary"
            onClick={s.togglePlay}
            disabled={!s.loaded || s.clockSource === 'external'}
            title={s.clockSource === 'external' ? 'Driven by the DAW’s MIDI clock' : undefined}
          >
            {s.playing ? '■ Stop' : '▶ Play'}
          </button>
          <button onClick={s.reroll} disabled={!s.playing}>Reroll</button>
          <button className={s.hold ? 'active' : ''} onClick={() => s.setHold(!s.hold)}>
            Hold
          </button>
          <button className="danger" onClick={s.panic}>Panic</button>
          <div className="control">
            <label>Clock</label>
            <select value={s.clockSource} onChange={(e) => s.setClockSource(e.target.value as 'internal' | 'external')}>
              <option value="internal">Internal</option>
              <option value="external">External (MIDI)</option>
            </select>
          </div>
          <div className="control">
            <label>BPM{s.clockSource === 'external' ? ' (from DAW)' : ''}</label>
            {s.clockSource === 'external' ? (
              <input
                type="text"
                readOnly
                value={s.externalBpm ? `${s.externalBpm.toFixed(1)} ♪` : 'waiting for clock…'}
              />
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
        </div>
        <RhythmGrid steps={s.rhythmSteps} onsets={s.rhythmOnsets} />
      </section>

      <section className="panel">
        <h2>Generator</h2>
        <p className="panel-sub">Chooses <em>which</em> chord comes next. Start here — Seed, Key, and the dials.</p>
        <div className="row">
          <div className="control">
            <label>Model</label>
            <select
              value={s.model}
              disabled={s.modelLoading}
              onChange={(e) => void s.setModel(e.target.value as ModelName)}
            >
              {MODEL_LIST.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <span className="readout">
              {s.modelLoading ? 'loading…' : (s.modelError ?? '')}
            </span>
          </div>
          <div className="control">
            <label>Seed chord</label>
            <select value={s.seedIndex} onChange={(e) => s.setSeedIndex(Number(e.target.value))}>
              {SEED_LIST.map((c, i) => (
                <option key={c} value={i}>{c}</option>
              ))}
            </select>
          </div>
          <button onClick={s.audition}>Audition seed</button>
          <div className="control">
            <label>Key</label>
            <select value={s.keyRoot} onChange={(e) => s.setKeyRoot(Number(e.target.value))}>
              {KEY_ROOTS.map((r, pc) => (
                <option key={r} value={pc}>{r}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label>Mode</label>
            <select value={s.keyMode} onChange={(e) => s.setKeyMode(e.target.value as 'maj' | 'min')}>
              <option value="maj">major</option>
              <option value="min">minor</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Dial label="Color (folk→jazz)" value={s.color} onChange={s.setColor} />
          <Dial label="Adventure" value={s.adventure} onChange={s.setAdventure} />
          <Dial label="Spice (macro)" value={s.spice} onChange={s.setSpice} />
          <Dial label="Gravity" value={s.gravity} onChange={s.setGravity} />
        </div>
        {s.model !== 'markov' && (
          <div className="row" style={{ marginTop: 14 }}>
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
          </div>
        )}
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

      <section className="panel">
        <h2>Output</h2>
        <p className="panel-sub">What's playing right now. Each Play captures a take you can export.</p>
        <div className="chord-display">
          <span className="symbol">{s.currentChord}</span>
          <span className="notes">
            {s.currentNotes.length > 0 ? `MIDI ${s.currentNotes.join(' ')}` : ''}
          </span>
        </div>
        <div className="history">
          {s.history.slice(-24).map((h) => (
            <span className="chip" key={h.at}>{h.symbol}</span>
          ))}
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
                <label>MIDI in (keyboard seeds the chain)</label>
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
    </main>
  )
}
