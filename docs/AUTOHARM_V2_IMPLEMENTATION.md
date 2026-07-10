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

### M2 — editable playback (`3f6ea68`)
- Added `progressionPlayer.ts` (staged swaps at bar/cycle, hold-latch, mute, cycle/slotOnset events), `generator.ts` (serial chain walk, locked pass-through, isCancelled), `scheduler.ts` (epoch), `templates.ts` (extracted grid + tileOnsets). Removed `autoPlayer.ts`. Runtime owns the generation session; eager generation at load.

### M3 — workspace UI (`898b351`)
- App shell (mode tabs, Quick/Lab), ChordTimeline/ChordCard (full editing, accessible buttons), `theory/romanNumeral.ts`, displayMode, bounded undo/redo + shortcuts. Fixed store-before-runtime ordering so the synchronous progressionApplied echo is identity-recognized.

### M4 — candidates() + lock-aware variation (`2dbf0a1`)
- `MarkovEngine.candidates()` (exact sample() distribution, no RNG), `NeuralEngine.candidates()` (softmax peek, session untouched), registry bridge; generator one-step lookahead toward locked successors (argmax prior x transition, floored); "Variation queued" badge via 'staged' event.

### M5-M6 — macros, presets, phrase timing (`4eb80fa`)
- `engine/macros/mapping.ts` (four macros -> engine params; defaults pin the V1 sound; tension: gravity below midpoint / sevenths above), `presets.ts` (7 curated + bounded Surprise Me). Lab edits mark owning macro Custom. Step-exact phrase lengths (1/2 bar .. 16 bars + custom).

### M7-M8 — Listen & Respond + explainability (`19fec83`, `24575df`)
- `engine/respond/`: types, phraseCapture (snapshot/finalize, retriggers, held-note synthesis, pickup grace), melodyAnalysis (duration x metric x modest velocity), scoring (5 components, total = exact weighted sum), explanation (derived reasons only), responseEngine (state machine; early kickoff one bar pre-close from notes already heard; response starts on the closing boundary when generation resolved in time, one muted analyzing cycle as fallback; N-rep commitment; READY holds).
- Runtime: StepTimeline ring buffer for capture timestamps (unswung grid), app-mode note router, buildResponse (scored slot-0 + walk + stage), `window.__autoharm` debug handle for the manual checklist.
- UI: RespondView (phase badges, capture progress, repetitions), ExplanationPanel (function/reasons/score bars/blend profile).

## Deviations from the spec

- Rhythm/phrase-length changes auto-regenerate ONLY a pristine progression (all slots generated + unlocked); with any lock/manual edit they defer to the next explicit Generate/Variation — preserves both V1 dial performability and user ownership (spec §36 stability rule).
- Reroll transport button = Generate Variation semantics (locked preserved).
- Respond: response length/rhythm follow the current phrase/rhythm settings; slot 0 is the scored "response chord", later slots are model-walked (spec §26 phrase-level depth).

### M9-M10 — rhythm editor, connections, perform (`ff27c94`)
- `engine/rhythm/customGrid.ts` (toggle >=1 invariant, rotate, bounded randomize) + clickable grid buttons in Lab; runtime.testConnection (C major, 700ms guaranteed release, honest report); header ConnectionChip; PerformView (56px targets, shared store/runtime).

### M11 — persistence, docs, hardening (`a0331a8`, `905a408`, +final)
- `state/persistence.ts` (`autoharm.v2.settings`, version 2, schema-checked, restored through real actions, debounced saves); README rewritten user-first; `docs/V2_MANUAL_TEST_CHECKLIST.md`.

### V2.1 — per-slot melody scoring in Respond
- `engine/respond/harmonizer.ts`: the captured phrase is segmented by the response's slot boundaries (notes clipped to their overlap; steps stay phrase-relative so metric weights hold) and EVERY slot's candidates are scored against its own segment, with voice-leading threaded through the picked voicings and novelty accumulating across the walk. Every response card carries its own breakdown + segment-specific reasons. Replaces the V2.0 "score slot 0, walk the rest" scheme (runtime.buildResponse is a thin harmonizer call; the respond effect passes raw captured notes).
- Scoring rebalance found via the new tests: an exact repeat's zero-movement voice-leading reward used to cancel the novelty penalty, so near-ties vamped forever — immediate-repeat novelty is now 0.15 and weights shifted (VL .15→.12, novelty .10→.13). Repeats stay possible when the melody clearly demands them.
- Early kick moved from one BAR to one BEAT before the window close (min half-phrase): the harmonization hears ~28/32 steps of a 2-bar phrase instead of 16/32; the muted analyzing-cycle fallback still covers slow generation.
- Browser-verified: C/E/G arpeggio in bar 1 + D/F/A in bar 2 → A:min ("Supports C, E"), E:min ("Supports G, E"), F:maj ("Supports F"), D:min ("Supports A") — last-bar melody reaching the response is the beat-early kick at work.

## Known limitations

- 4/4 meter only; phrase lengths are multiples of half a bar (8 steps) plus custom fractional bars.
- Respond capture maps note times through the step timeline; notes in the final ~150 ms of a window (the lookahead horizon) may land past the close under heavy main-thread load.
- Neural response generation may add one muted "analyzing" cycle when the model is slower than the phrase remainder (markov answers on the closing downbeat).
- V1's live next-onset MIDI steering is now a boundary-queued reroll (documented behavior change).

## Verification log

- Baseline: 84 tests / build clean (recorded above).
- Final: **168 tests / 20 files**, `tsc -b && vite build` clean, no console errors.
- Browser-verified on the dev build: lock->variation preserves locks; undo/redo single-press; roman numerals live (Eb:maj7 in C = bIIImaj7); presets land macros exactly (Neo-Soul -> charleston + 60% swing); Lab edit -> macro Custom -> reclaim; Respond full loop at 240 BPM (0 notes sounded during capture, response on the closing downbeat, 2-rep commitment = 3998 ms, READY holds, slot-0 reasons correct); rhythm grid toggle/reset; Test-connection report; Perform view; persistence restore (Dark Cinematic + key mode, no auto-play); edited-progression playback == export (.mid parsed: onsets beats 0/2, Eb:maj pcs + tension-added 7th); mobile 375px no horizontal overflow.
