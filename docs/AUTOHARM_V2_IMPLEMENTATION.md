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

### V2.2 — scored generation everywhere + generated harmonic rhythm
- ONE walk for everything: `harmonizePhrase` gained locked pass-through (identity + chain steering), locked-next lookahead (transition folded into the model prior, reason recorded), a pick strategy (`argmax` for Respond, seeded score^5 sampling for Generate/Variation/Reroll-one variety), and a `source` label. `generateProgression` retired; generator.ts keeps only the sampler contracts + chainTail. Every generated card now carries a breakdown + reasons (melody row hidden in the UI for non-response chords — it's neutral without a phrase).
- `engine/rhythm/harmonicRhythm.ts`: harmonic rhythm is GENERATED, not tiled — per-bar patterns drawn from the template vocabulary around the selected feel (drift weights ±2 notches), 55% repeat bias for groove coherence, final bar draws one notch sparser (cadential broadening). Fresh rhythm per Generate/response; a VARIATION keeps the take's onset skeleton so locked slots keep index and timing; a custom-edited grid still tiles verbatim.
- Browser-verified: three fresh 8-bar generations vary in rhythm (all exactly 128 steps; one ends half-half…whole — the broadened final bar), variation preserved the rhythm skeleton + locked chords while changing harmony, and an unlocked card explained itself with "Chosen to lead into the locked G:maj".

## Known limitations

- 4/4 meter only; phrase lengths are multiples of half a bar (8 steps) plus custom fractional bars.
- Respond capture maps note times through the step timeline; notes in the final ~150 ms of a window (the lookahead horizon) may land past the close under heavy main-thread load.
- Neural response generation may add one muted "analyzing" cycle when the model is slower than the phrase remainder (markov answers on the closing downbeat).
- V1's live next-onset MIDI steering is now a boundary-queued reroll (documented behavior change).

## Verification log

- Baseline: 84 tests / build clean (recorded above).
- Final: **168 tests / 20 files**, `tsc -b && vite build` clean, no console errors.
- Browser-verified on the dev build: lock->variation preserves locks; undo/redo single-press; roman numerals live (Eb:maj7 in C = bIIImaj7); presets land macros exactly (Neo-Soul -> charleston + 60% swing); Lab edit -> macro Custom -> reclaim; Respond full loop at 240 BPM (0 notes sounded during capture, response on the closing downbeat, 2-rep commitment = 3998 ms, READY holds, slot-0 reasons correct); rhythm grid toggle/reset; Test-connection report; Perform view; persistence restore (Dark Cinematic + key mode, no auto-play); edited-progression playback == export (.mid parsed: onsets beats 0/2, Eb:maj pcs + tension-added 7th); mobile 375px no horizontal overflow.

## Adversarial review pass + UI improvements

A multi-agent review ran 8 correctness dimensions over the whole V2 diff, each
finding challenged by two independent skeptics (a refuter and a reproduction
engineer). 26 findings raised, 10 refuted, 16 confirmed; 10 were real defects
and were fixed in `a9685bf` (see that commit message for the full list). The
highest-value ones:

- `melodyAnalysis` compared a MIDI note number against a stored pitch class, so
  the "highest note of the last onset" tie-break was always true and degraded to
  "last note captured" — the wrong terminal pitch class fed cadence scoring.
- A generation kicked by one Respond listen could resolve during the *next*
  listen and answer a phrase the user never played (phase alone cannot
  distinguish window N's `listening` from window N+1's). Fixed with a per-listen
  epoch, and `cancelListen`/`newListen` now invalidate the generation scheduler.
- Variation matched locked slots by **index** against a freshly generated onset
  list whenever the phrase length had changed, silently shifting or dropping
  every lock. New pure `alignPriorToOnsets()` re-anchors locks by onset **step**
  and reports the ones whose position no longer exists.

### UI changes

Accessibility (the blocking items):
- Chord cards are a real `<ul>/<li>` list. Selection now **follows focus**, so a
  keyboard user tabbing a card sees its explanation without an extra control;
  `aria-current` announces it. Previously the card was a `<div role="group">`
  with a click handler and no `tabIndex` — selection was mouse-only.
- Global `:focus-visible` ring; 44px touch targets under `@media (pointer:
  coarse)`; `prefers-reduced-motion` now covers every transition/animation.
- Rhythm step cells carry no text, so their border is the only thing identifying
  the control — raised to 3.37:1 (WCAG 1.4.11 needs 3:1; it was 2.51:1).
- `role="status"` on the notice banner, generating pill and queued badge.

Core loop + live feedback:
- Panels reordered to the spec's hierarchy: Progression → Direction (macros) →
  Transport → Output → Connections.
- The six secondary actions per card are progressively disclosed on hover /
  focus-within / selection. Sixteen cards x seven always-on buttons was 112
  competing targets; the lock stays visible because Variation depends on it.
- New phrase-position bar (bar/beat/pass), driven by a once-per-beat `beat`
  event rather than per-step.
- Hold now highlights *which* chord is vamping (`⟳` icon, "vamping" in the
  accessible name) instead of tracking the passing playhead.
- `Generating…` pill, explanation empty-state hint, dismissible notice banner,
  Space = Play/Stop (never when a button is focused), connection chip works from
  every view.
- `App()` and `HeaderBar` no longer subscribe to the whole store — a bare
  `useStore()` at the tree root re-rendered every panel on each per-beat patch.

### Known gaps

- The four UI design agents and the synthesis step of the review workflow hit the
  account spend limit and never ran; the UI work above was designed directly from
  the confirmed findings rather than from a design panel.

## Composition-root tests (`test/runtime.test.ts`, 63 tests)

Closes the ledger's standing `runtime.ts` gap. The suite runs the **real** engine
graph — real corpora, real player, real respond engine, real scheduler — and fakes
only the browser (`AudioContext`, `Worker`, `fetch`). That is the point: every
confirmed V2 defect lived in the wiring between those parts, so a test that stubbed
the engine would have caught none of them. Where a test calls `midi.onNoteIn` or
`midi.onClockStep` it uses the entry point the real adapter calls.

Covered: eager load-time generation; swap-origin threading (`user` vs `auto`, the
undo-pollution seam); lock re-anchoring by onset step across a phrase-length change
plus the dropped-lock notice; `rerollSlot` id/lock preservation; the pristine
"performable dial" rule; edit staging (`now` / `bar` / `cycle`); scheduler
invalidation on `stopTransport` / `newListen` / `cancelListen` (a walk is caught
mid-flight with a gated sampler and must resolve to `null`); the frozen respond
window; MIDI note routing in all four modes; the external MIDI-clock transport;
recording, rebase and `.mid` export; `testConnection`'s guaranteed release.

### Bug these tests found: rhythm changes never changed the rhythm

`maybeRegenerate()` routed template and custom-grid changes through
`generateVariation()`, which deliberately reuses the take's onsets so locked slots
keep their timing. But a rhythm change never alters `phraseSteps`, so
`runGeneration`'s `prior.totalSteps === this.phraseSteps` branch always won and the
new grid was discarded. The chords resampled, so the UI looked alive while the
onsets never moved — the rhythm editor and the template dial were inert. Introduced
in `316d2f4` (generated harmonic rhythm); shipped in PR #1.

`pristine()` already guarantees no locks and no hand edits, so `maybeRegenerate`
now calls `runGeneration(undefined, …)` and draws a fresh grid. Guarded by
`pristine gating > redraws the GRID on a rhythm change, not just the chords`, which
was confirmed to fail against the pre-fix code.

Still uncovered: `stepFor()` capture timestamping against a real lookahead clock.
The fake `AudioContext`'s `currentTime` never advances, so the ring-buffer lookup is
never exercised with genuine MIDI arrival times. That stays a hardware-only check
(`docs/V2_MANUAL_TEST_CHECKLIST.md`).
