# AutoHarm V2 — implementation ledger

Concise record of the V2 build: confirmed architecture, decisions, files, deviations, limitations, verification. Updated per milestone.

## Baseline (before any V2 change)

- Commit `717f719` on `main`. `npm test`: **84 passed** (12 files). `npm run build`: clean (`tsc -b && vite build`). GitHub Pages deploy green.
- Work happens on branch `autoharm-v2`; merged to `main` (which triggers the Pages deploy) only at final verification, so intermediate states never ship.

## Confirmed V1 architecture

```
src/engine/   pure TS, no DOM/MIDI/Audio (markov blend, neural ONNX, voicing, theory, player, swing)
src/app/      runtime.ts — composition root; owns clock funnel (advanceStep), recorder, MIDI wiring
src/io/       clock (worker lookahead), midi (Web MIDI + external clock), synth, smf, download
src/state/    store.ts — single flat zustand store (455 lines)
src/ui/       App.tsx — single-file UI (432 lines)
```

Facts the V2 design leans on:
- Full next-chord distributions exist internally but are not public: `blendedChoices()` (markov/blend.ts) returns `[chord, prob][]`; `applySamplingDistribution()` (neural/inference.ts) returns the full softmax. V2 exposes them as `candidates()`.
- `parseChord()` (voicing/chordParser.ts) is public and returns root pc / intervals / pitchClasses — reused for melody fit + Roman numerals (no second parser).
- `parseKey()` (theory/chordVocab.ts) is the single key parser used for Roman numerals.
- Swing is applied only in `runtime.advanceStep` (step index → wall-clock); everything upstream is swing-agnostic and stays that way.
- Under the lookahead clock, `advanceStep` runs ~150 ms ahead of audio — capture timestamping must map note arrival times through a step↔grid-time ring buffer, not read `currentStep` directly.

## Major design decisions

1. **Slots are onsets.** `ProgressionSlot { id, symbol, durationSteps, locked, source, explanation? }`; progression total = phrase length; playback strikes each slot at its boundary step. Rhythm templates/custom grid = generation-density presets.
2. **Generation is explicit and offline**; playback never mutates the progression. Variations queue to the cycle boundary. A progression always pre-exists (eager generation) because external MIDI Start plays immediately.
3. **AutoPlayer → ProgressionPlayer** (same transport/sonifier contracts, same swing-agnostic `onStep(at)`).
4. **Model prior via real distributions** (`candidates()`), one-step lookahead scoring toward locked next neighbors.
5. **Macros** (Familiarity/Harmonic Color/Tension/Motion) are a pure mapping module onto existing parameters; Lab edits of macro-controlled params show the macro as Custom.
6. **Respond** is a pure state machine fed by step + note events; scoring breakdown (melody/model/voice-leading/cadence/novelty) IS the explanation — no post-hoc prose, no fabricated confidences.
7. **4/4 only** in V2 (16-step bars). Documented limitation, not an accident.
8. Persistence in `localStorage['autoharm.v2.settings']`, versioned, schema-checked, never restores playback/devices/half-captures.

## Intentional behavior changes (V1 → V2)

- Live MIDI steering during playback (note-in → next onset chord) becomes a **queued reroll seeded from the played pitch class**, applied at the phrase boundary (Generate mode). Stopped-state immediate audition is preserved.
- (updated as milestones land)

## Files added / changed

Tracked per milestone below.

### M0 — this ledger

### M1 — progression domain
- Added `src/engine/progression/types.ts`, `operations.ts`, `history.ts`; `test/progression.test.ts`, `test/progressionHistory.test.ts`.

## Deviations from the spec

- (none yet)

## Known limitations

- 4/4 meter only; phrase lengths are multiples of half a bar (8 steps) plus custom step counts.

## Verification log

- Baseline: 84 tests / build clean (recorded above).
