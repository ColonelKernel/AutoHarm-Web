# AutoHarm

[![Max/MSP sibling: Autoharmonizer](https://img.shields.io/badge/Max%2FMSP%20sibling-Autoharmonizer-8A2BE2?logo=github&logoColor=white)](https://github.com/ColonelKernel/Autoharmonizer)

> The DAW-agnostic web port of the [**Autoharmonizer**](https://github.com/ColonelKernel/Autoharmonizer) Max for Live device — same harmonic brain, running entirely in the browser.

**AutoHarm is a generative harmony instrument you can shape, perform, and play
against.** It invents chord progressions, shows them as editable chord cards,
listens to phrases you play on a MIDI keyboard and answers with harmony that
fits — and sends everything as live MIDI into **any DAW**, with a built-in
synth so it's playable with nothing attached.

Fully client-side, no install: it runs in the browser (Chrome/Edge/Firefox;
Safari lacks Web MIDI but the built-in sound still works).

## The three modes

**Generate** — pick a preset (Warm Neo-Soul, Restless Jazz, Dark Cinematic…)
or shape the four macro dials — *Familiarity* (common→unusual), *Harmonic
Color* (folk→jazz), *Tension* (resolved→suspended), *Motion* (still→active) —
and hit Generate. The progression appears as chord cards you can **edit, lock,
reorder, reroll one at a time, or regenerate around**: Variation replaces only
what you haven't 🔒 locked, and chords next to a lock are chosen to lead into
it. Undo/redo everywhere (Cmd/Ctrl+Z). Cards show chord symbols, Roman
numerals, or both, and clicking one explains *why* it was chosen — its
harmonic function, melody fit, voice-leading cost, and the model's own
preference. The explanation is the actual selection math, never a story.

**Respond** — the signature move. Press **New Listen**, play a phrase on your
MIDI keyboard; AutoHarm waits for the *complete* phrase (it never jumps in
early), analyzes the melody — which notes carry weight, where it lands — then
answers on the very next downbeat with a scored harmonic response, held steady
for as many repetitions as you choose before it's ready to listen again.
Call and response, with a collaborator that can explain itself.

**Perform** — the same instrument with big targets for live use: New Listen,
Variation, Play/Hold/Panic, the four macros, and the progression front and
center.

## Everything else it does

- **Playback follows YOUR edits.** The progression is canonical: edits land at
  musical boundaries mid-playback (bars for structure, phrase wraps for
  variations — "Variation queued"), and nothing regenerates unless you ask.
- **Rhythm** — 12 harmonic-rhythm templates (whole notes → syncopated clave →
  sixteenths) on one Motion-linked dial, plus a click-to-edit grid (rotate,
  bounded randomize) whose pattern IS what generation uses. **Swing** slides
  the off-beats (8th jazz / 16th funk feel) everywhere at once: synth, live
  MIDI, and the exported file.
- **Engines** — a four-corpus Markov blend (folk/pop/classical/jazz,
  "Corpus Blend") runs offline; JazzNet RNN/LSTM ("Neural Flow" / "Neural
  Memory") load lazily in-browser via ONNX Runtime. One Familiarity dial
  drives them all.
- **DAW-agnostic MIDI** — a virtual port (IAC/loopMIDI) that any DAW records;
  external **MIDI clock** slaves AutoHarm to the DAW's transport and tempo;
  **Test connection** proves the route with one safe chord. Setup guide:
  [docs/DAW_CHECKLIST.md](docs/DAW_CHECKLIST.md).
- **Export** — every take is captured as played (voiced notes, swing included)
  and exports as a standard `.mid`.
- Preferences persist locally; Quick view stays musical, **Lab** view exposes
  every underlying parameter (raw dials, neural sessions, voicing ladder,
  registers) — hand-edits show their owning macro as *Custom*.

V2 plays in 4/4 (the 16th-note grid is exact for fractional-bar phrases from
½ bar to 16 bars).

## Quick start

```bash
npm install          # also copies the ORT wasm into public/ort/
npm run dev          # http://localhost:5173  (Markov path)
npm test             # unit + golden-parity + ONNX-parity suites
npm run build        # static site -> dist/
npm run preview      # serve the build (needed for the neural models —
                     # Vite dev intercepts the ORT wasm's dynamic import)
```

Manual verification flows: [docs/V2_MANUAL_TEST_CHECKLIST.md](docs/V2_MANUAL_TEST_CHECKLIST.md).
Implementation ledger: [docs/AUTOHARM_V2_IMPLEMENTATION.md](docs/AUTOHARM_V2_IMPLEMENTATION.md).

## Architecture

Everything under `src/engine/` is **pure TypeScript** — no DOM, no React, no
Web MIDI/Audio — so the whole musical brain runs in Node under Vitest. Engines
emit typed events and take time from an injected clock; `io/` adapters and the
React UI sit on top.

```
src/
├── engine/
│   ├── progression/   canonical editable model: slots, pure ops, undo history,
│   │                  offline generator (locked-slot pass-through, lookahead
│   │                  toward locked neighbors), staleness scheduler
│   ├── respond/       phrase capture, melody analysis, decomposable chord
│   │                  scoring, response state machine, explanations
│   ├── macros/        the four musical macros -> engine parameters; presets
│   ├── markov/        4-corpus blend engine + candidates() distribution
│   ├── neural/        JazzNet RNN/LSTM via ONNX Runtime (v3 sessions, peek)
│   ├── theory/        chord vocab, notation bridge, roman numerals
│   ├── voicing/       chord parser + voicing engine + performance map
│   ├── rhythm/        editable custom grid (same shape playback consumes)
│   └── player/        progression player (staged swaps, hold, mute), swing,
│                      templates, sonifier
├── io/                lookahead worker clock, Web MIDI (+ external clock),
│                      preview synth, SMF writer
├── app/runtime.ts     composition root: generation session, MIDI routing,
│                      capture timestamping, recorder
├── state/             zustand store + versioned persistence
└── ui/                App shell (3 modes, Quick/Lab), chord timeline,
                       explanation panel
```

Provenance: ported from the UPF Autoharmonizer Max/MSP patch (blend engine,
voicing, player) and the autoharmonizer-max v3 neural sessions; the pure math
is pinned to the original Python engines by golden-fixture tests
(`tools/dump_golden_fixtures.py`, `tools/export_onnx.py` verifies torch↔ORT
logit parity at export).

## Deploying

`npm run build` → static `dist/` with `base: './'` (any subpath works).
Pushing `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
(build + test + GitHub Pages).
