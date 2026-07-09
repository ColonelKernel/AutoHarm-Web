/** Lookahead beat clock (Chris Wilson pattern) with a Web Worker tick source.
 *
 * Replaces the Max patch's `metro 500` / `metro 4n`. The tick timer lives in a
 * Worker because main-thread timers are throttled to >=1s in background tabs —
 * and the primary use case is this tab backgrounded while the DAW is focused.
 * Beats are scheduled against the AudioContext clock `scheduleAhead` seconds
 * out, so callees can sample-accurately schedule audio and timestamp MIDI.
 */

const WORKER_SOURCE = `
let id = null;
onmessage = (e) => {
  if (e.data === 'start') {
    if (id === null) id = setInterval(() => postMessage('tick'), 25);
  } else if (e.data === 'stop') {
    if (id !== null) { clearInterval(id); id = null; }
  }
};
`

export class LookaheadClock {
  bpm = 120
  /** seconds of lookahead per scheduling pass */
  scheduleAhead = 0.15

  private worker: Worker
  private running = false
  private nextBeatTime = 0
  private beatIndex = -1

  constructor(
    private ctx: AudioContext,
    private onBeat: (beatIndex: number, atTime: number) => void,
  ) {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
    this.worker = new Worker(URL.createObjectURL(blob))
    this.worker.onmessage = () => this.tick()
  }

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.beatIndex = -1
    // First beat lands just past "now" so it is still schedulable.
    this.nextBeatTime = this.ctx.currentTime + 0.05
    this.worker.postMessage('start')
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.worker.postMessage('stop')
  }

  dispose(): void {
    this.stop()
    this.worker.terminate()
  }

  private tick(): void {
    if (!this.running) return
    while (this.nextBeatTime < this.ctx.currentTime + this.scheduleAhead) {
      this.beatIndex += 1
      this.onBeat(this.beatIndex, this.nextBeatTime)
      this.nextBeatTime += 60 / this.bpm
    }
  }
}
