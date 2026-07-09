# AutoHarm Web

A **DAW-agnostic, fully client-side** web port of the Autoharmonizer Max/MSP
instrument. It generates chord progressions with a 4-corpus Markov blend engine
(plus optional JazzNet RNN/LSTM neural models), voices them to MIDI, and sends
them live to **any DAW** over a virtual MIDI port — with a built-in Web Audio
preview so it's playable with no DAW at all.

No Max, no Python service, no install. It's a static site (works on GitHub
Pages, or `npm run preview`), and the Markov path runs entirely offline.

## How it's DAW-agnostic

The app sends live MIDI through the **Web MIDI API** to a virtual MIDI port.
Every DAW sees that port as an ordinary MIDI input device, so there's nothing
DAW-specific in the app:

```
AutoHarm (browser)  ──Web MIDI──▶  IAC bus (macOS) / loopMIDI (Windows)  ──▶  any DAW
                    ◀──Web MIDI──   MIDI keyboard (seeds the chord chain)
```

See **[docs/DAW_CHECKLIST.md](docs/DAW_CHECKLIST.md)** for the one-time virtual
MIDI setup and an end-to-end test.

> Web MIDI works in Chrome, Edge, and Firefox. **Safari has no Web MIDI** — the
> Web Audio preview still works there, but live routing needs a Chromium/Firefox
> browser.

## What it does

- **Markov corpus blend** — Color morphs the harmonic flavour along
  folk → pop → classical → jazz; Adventure is a sampling temperature; Spice is a
  one-knob macro over both; Gravity pulls toward the tonic/dominant; Key
  transposes by harmonic function (blending happens in normalized C/Am space).
- **Neural models** — JazzNet `rnn` / `lstm` run in the browser via ONNX Runtime
  Web (lazy-loaded on first selection; Markov-only users download zero neural
  bytes). Stateful v3 sessions with an auto-feed hidden state and a 64-step
  auto-reset.
- **Voicing engine** — chord-symbol → MIDI voicing with nearest-voice-leading,
  a functional-harmony ladder (triads → +voice-leading → 7ths → drop-2 + upper
  extensions), and Harmony-Singer-style diatonic added voices.
- **Auto-player** — walks the chain over harmonic-rhythm templates with
  loop / regen / one-shot phrase modes, hold (vamp), and reroll.
- **Transport** — an internal Web Worker lookahead clock, or **external MIDI
  clock** to slave to the DAW's tempo/transport (Clock → External; follows
  0xFA/0xFB/0xFC + 24 PPQN and shows the detected BPM).
- **MIDI in** — a connected keyboard seeds the chain (played note → chord root);
  MPK-style program-change pads and CC control transport and dials.

## Quick start

```bash
npm install          # also copies the ORT wasm into public/ort/
npm run dev          # http://localhost:5173  (Markov path)
npm test             # 51 tests (golden-fixture parity + regression + ONNX parity)
npm run build        # static site -> dist/
npm run preview      # serve the build (required to exercise the neural models —
                     # Vite dev intercepts the ORT wasm's dynamic import)
```

## Architecture

Everything under `src/engine/` is **pure TypeScript** — no DOM, no React, no
Web MIDI/Audio — so the whole musical brain is unit-testable in Node. The
engine emits typed events and receives time from an injected clock; the `io/`
adapters and the React UI sit on top.

```
src/
├── engine/                        # pure, UI-free, unit-tested
│   ├── random.ts                  # mulberry32 + weighted sampling
│   ├── theory/                    # chordVocab, notation (Bb ↔ B-), chordSimplifier
│   ├── markov/                    # config, corpusLoader, blend, markovEngine
│   ├── neural/                    # vocab, inference, session (v3), neuralEngine, ortRunner
│   ├── registry.ts                # model switch + notation bridge + session modes
│   ├── voicing/                   # chordParser, performanceMap
│   └── player/                    # sonifier, autoPlayer
├── io/                            # clock, midi, synth  (browser adapters)
├── app/runtime.ts                 # composition root (wires engine ↔ io)
├── state/store.ts                 # zustand UI state
└── ui/App.tsx                     # controls
public/data/
├── markov_corpora_t.json          # 4-corpus transition counts (148 KB)
└── jazznet/                       # vocab.json + rnn.onnx + lstm.onnx (from tools/)
tools/                             # run-once Python: export_onnx.py, dump_golden_fixtures.py
```

## Provenance & parity

Ported from two source repos:

- **UPF Autoharmonizer Maxpatch** (canonical) — the blend engine
  (`blend.py`, `chord_vocab.py`, `corpus_loader.py`, `markov_engine.py`) and the
  already-JS voicing engine + auto-player (`chord_parser.js`, `markov_osc.js`,
  `performance_map.js`).
- **autoharmonizer-max** (`max-models` branch, protocol v3) — the neural session
  semantics and the in-repo JazzNet model definitions used for ONNX export.

The pure math (blend weights, temperature/cadence reshaping, transposition,
vocab ordering, neural logits) is pinned to the original engines by
**golden-fixture tests**: `tools/dump_golden_fixtures.py` runs the Python engine
and records exact outputs; `tools/export_onnx.py` verifies torch↔onnxruntime
logit parity at export time. Sampling parity is distributional (different PRNGs),
so deterministic parity is asserted on the math, not on individual draws.

Regenerate the assets (needs the source repos + `torch`, `onnx`, `onnxruntime`):

```bash
python3 tools/dump_golden_fixtures.py   # -> test/fixtures/*.json
python3 tools/export_onnx.py            # -> public/data/jazznet/{vocab.json,rnn.onnx,lstm.onnx}
```

## Deploying

`npm run build` produces a static `dist/`. `base: './'` makes it portable to any
subpath (GitHub Pages included). The ORT wasm is self-hosted under `public/ort/`
and served verbatim in dev and build; the neural `.onnx` graphs and wasm are
lazy-loaded only when a neural model is selected.

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which runs `npm ci`, builds, runs the test suite, and publishes `dist/` to
GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**.
