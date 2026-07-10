/** Generation staleness guard — one epoch for all async progression work.
 *
 * Replaces the V1 player's `generation` token. Any new job, transport stop,
 * model switch, or respond cancel invalidates in-flight walks; the generator
 * checks `isCancelled` between samples so a stale walk aborts quickly and its
 * result is dropped instead of landing on a progression the user has moved
 * past.
 */

export class GenerationScheduler {
  private epoch = 0

  /** Invalidate all in-flight jobs (stop/model switch/respond cancel). */
  invalidate(): void {
    this.epoch += 1
  }

  /**
   * Run `job` under a fresh epoch (implicitly invalidating older jobs).
   * Resolves null when a newer epoch superseded this one mid-flight.
   */
  async run<T>(job: (isCancelled: () => boolean) => Promise<T | null>): Promise<T | null> {
    this.epoch += 1
    const mine = this.epoch
    const isCancelled = () => mine !== this.epoch
    const result = await job(isCancelled)
    return isCancelled() ? null : result
  }
}
