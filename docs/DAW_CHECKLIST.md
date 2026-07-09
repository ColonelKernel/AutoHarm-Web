# Connecting AutoHarm to your DAW

AutoHarm sends live MIDI to a **virtual MIDI port**; your DAW records that port
like any external keyboard. This works with any DAW — Ableton Live, Logic,
GarageBand, FL Studio, Cubase, Bitwig, Reaper, Studio One, etc.

Requires a Chromium-based browser or Firefox (Web MIDI). Safari won't route MIDI.

## 1. Create a virtual MIDI port (one time)

**macOS** — enable the built-in IAC Driver:
1. Open **Audio MIDI Setup** (Applications → Utilities).
2. Menu → **Window → Show MIDI Studio**.
3. Double-click **IAC Driver**.
4. Check **Device is online**. Keep the default "Bus 1".

**Windows** — install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
(free) and click **+** to create one port.

**Linux** — a virtual ALSA/JACK port (e.g. `a2jmidid`, or your DAW's own virtual
input) works the same way.

## 2. Point AutoHarm at it

1. Open the app (`npm run preview`, or the deployed URL).
2. Under **Connections**, click **Enable MIDI + Audio** (this also unlocks audio —
   browsers require a user gesture).
3. Set **MIDI out** to your virtual port (IAC Bus 1 / loopMIDI Port).
4. Optionally set **MIDI in** to a keyboard to seed the chord chain, and turn the
   **Preview synth** off if you only want the DAW's sound.

## 3. Record in the DAW

1. Create a MIDI/instrument track and add an instrument (piano, pad, …).
2. Set the track's MIDI input to the same virtual port (IAC Bus 1 / loopMIDI).
3. Arm/monitor the track.
4. In AutoHarm, pick a **Seed chord**, **Key**, and dials, then press **Play**.
5. You should hear the DAW's instrument and see MIDI arriving. Record a phrase.

### Verify it's working

- **Chords land on the grid** — with the app's BPM matched to the DAW tempo and
  the DAW's input quantize off, chord changes fall on beats per the Rhythm dial.
- **Background-tab stability** — click into the DAW so the browser tab is
  backgrounded; playback should keep steady time (AutoHarm's clock runs in a Web
  Worker specifically for this).
- **Panic** — the **Panic** button and pressing **Stop** send All-Notes-Off, so
  nothing hangs.
- **N.C.** — a no-chord result silences held notes rather than sounding.
- **Key transposition** — change **Key** to e.g. E major; the progression
  transposes by harmonic function.

## Follow the DAW's tempo (MIDI clock)

AutoHarm can slave to your DAW's transport instead of running its own clock:

1. Enable **MIDI clock / sync output** in your DAW and point it at the same
   virtual port (IAC / loopMIDI). In Ableton: Preferences → Link/Tempo/MIDI →
   set the port's **Sync** output on.
2. In AutoHarm, set **MIDI in** (Connections) to that port and switch **Clock**
   (Transport) to **External (MIDI)**. The Play button is now driven by the DAW.
3. Press Play in the DAW. AutoHarm starts on the DAW's transport, advances one
   chord per beat per the Rhythm dial, follows tempo changes, and stops when the
   DAW stops. The BPM field shows the detected incoming tempo.

## Tips

- **Tempo sync**: with **Clock = Internal**, match AutoHarm's BPM to your DAW by
  hand; with **Clock = External (MIDI)** it follows the DAW automatically (above).
- **Latency**: the internal preview and MIDI out are scheduled from the same
  lookahead clock; if the DAW adds monitoring latency, prefer recording and
  nudging, or mute the preview synth and monitor through the DAW.
- **Neural models**: `rnn`/`lstm` load on first selection (a few MB, one time).
  If they fail to load, the app stays on Markov automatically — it never breaks.
