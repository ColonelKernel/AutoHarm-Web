/** Web Audio preview polysynth.
 *
 * Replaces the Max patch's `makenote -> midiformat -> midiout` audibly in the
 * browser. Notes sustain until the next chord onset (or an explicit stop), so
 * a new chord schedules the release of the held voices at the same timestamp
 * as its own attacks — mirroring the patch's flush-before-new-chord chain.
 */

interface Voice {
  oscs: OscillatorNode[]
  gain: GainNode
}

const ATTACK = 0.01
const RELEASE = 0.08

export class PreviewSynth {
  enabled = true

  private master: GainNode
  private held: Voice[] = []

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain()
    this.master.gain.value = 0.25
    this.master.connect(ctx.destination)
  }

  setVolume(v: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, v)) * 0.5
  }

  /** Play a chord at `at` (AudioContext seconds), releasing held voices then. */
  playChord(notes: number[], velocity: number, at?: number): void {
    const t = at ?? this.ctx.currentTime
    this.releaseAll(t)
    if (!this.enabled) return

    const level = (velocity / 127) * 0.9
    for (const midi of notes) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(level / Math.max(3, notes.length), t + ATTACK)
      gain.connect(this.master)

      // Two slightly detuned triangles per voice — soft pad-like preview tone.
      const oscs = [-4, 4].map((cents) => {
        const osc = this.ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.value = freq
        osc.detune.value = cents
        osc.connect(gain)
        osc.start(t)
        return osc
      })
      this.held.push({ oscs, gain })
    }
  }

  /** Release all held voices at `at` (or now). */
  releaseAll(at?: number): void {
    const t = at ?? this.ctx.currentTime
    for (const v of this.held) {
      try {
        v.gain.gain.cancelScheduledValues(t)
        v.gain.gain.setValueAtTime(v.gain.gain.value || 0.0001, t)
        v.gain.gain.linearRampToValueAtTime(0, t + RELEASE)
        for (const o of v.oscs) o.stop(t + RELEASE + 0.05)
      } catch {
        // voice may already be stopped
      }
    }
    this.held = []
  }
}
