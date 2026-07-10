# AutoHarm V2 — manual test checklist

Tip: with no MIDI keyboard attached, drive Respond synthetically from the
console: `__autoharm.midi.onNoteIn?.(60, 100, performance.now())` (note-on)
and `__autoharm.midi.onNoteIn?.(60, 0, performance.now())` (note-off).

## Basic startup
- [ ] App loads; header shows Generate/Respond/Perform tabs, Key/Mode/BPM, status `ready`
- [ ] A progression is already on the timeline (eager generation)
- [ ] No console errors

## Generate
- [ ] ✨ Generate new replaces the progression
- [ ] Click a chord symbol → inline edit → Enter commits (roman numeral updates)
- [ ] 🔒 Lock two chords → ⟳ Variation → locked chords unchanged, others differ
- [ ] Reroll-one (↻ on a card) changes only that card
- [ ] Undo restores in ONE press; Redo restores the variation; Cmd/Ctrl+Z(+Shift) work; typing in an input never triggers them
- [ ] Move ◀ ▶ / duplicate ⧉ / delete ✕ / duration select all work; last card refuses delete
- [ ] Select a card → explanation shows function, reasons, score bars/blend profile where present

## Playback
- [ ] Play walks the edited progression exactly (edit a chord, hear the edit)
- [ ] Structural edits while playing land at the next bar; variations at the phrase boundary ("Variation queued" badge shows)
- [ ] Hold vamps the current chord; release resumes
- [ ] Stop / Panic leave no stuck notes (DAW check)
- [ ] Swing dial audibly swings; grid shows displaced off-beats

## Macros & presets
- [ ] Each preset chip moves all four macros + overrides (swing/voicing/register); chip highlights
- [ ] Moving any macro detaches the preset
- [ ] Lab: editing Gravity shows Tension = `Custom`; moving Tension reclaims it
- [ ] 🎲 Surprise Me lands somewhere musical, never changes the key root

## MIDI
- [ ] Enable MIDI + Audio; select IAC/loopMIDI out; DAW receives chords
- [ ] Header chip goes ● green with the port name
- [ ] 🔔 Test connection: DAW hears a C major; report names the port; chord releases (~0.7 s)
- [ ] MIDI keyboard note while stopped auditions a chain reply; while playing, queues a reroll seeded from that pitch class (boundary swap)

## Respond
- [ ] Choose 2-bar phrase, repetitions 2, press 🎤 New Listen → ARMED → LISTENING at the boundary; playback mutes
- [ ] Play a melody; progress bar counts bars; NOTHING sounds during capture
- [ ] At the window close, the response starts on that downbeat (markov; neural may add one quiet cycle)
- [ ] Response holds for exactly N repetitions → READY; keeps playing until the next New Listen
- [ ] Slot 0 explanation shows melody-derived reasons + score bars
- [ ] Cancel during listening unmutes and resumes; switching app mode cancels cleanly

## Models
- [ ] Corpus Blend (markov) default works offline
- [ ] Neural Flow (RNN) / Neural Memory (LSTM) load lazily (`npm run preview` build); on missing .onnx the app stays on markov with an error message

## Clock
- [ ] Internal: BPM changes apply immediately
- [ ] External: Clock→External; DAW Start/Stop drive playback; BPM readout tracks the DAW; steps land on the DAW grid

## Export
- [ ] Play an EDITED progression (with swing) → Export .mid → import into a DAW: chords, order and timing match what was heard
- [ ] Clear take zeroes the counter

## Persistence
- [ ] Change macros/key/BPM/view → reload → restored; playback NOT auto-started
- [ ] Corrupt `localStorage['autoharm.v2.settings']` by hand → app still loads with defaults

## Responsive / a11y
- [ ] Narrow window: timeline wraps, primary actions visible; no horizontal page scroll
- [ ] Mobile width (~380px): readable, auditionable, cards editable
- [ ] Tab reaches cards, grid cells, all controls; focus visible; lock state announced (aria-pressed)
- [ ] `prefers-reduced-motion`: listening pulse and card transitions stop
