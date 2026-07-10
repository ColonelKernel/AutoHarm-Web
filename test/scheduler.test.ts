/** GenerationScheduler — the epoch guard that replaced V1's tested
 * "stale replies from a previous generation are dropped" behavior. */

import { describe, expect, it } from 'vitest'
import { GenerationScheduler } from '../src/engine/progression/scheduler'

const defer = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('GenerationScheduler', () => {
  it('drops the earlier of two overlapping runs, keeps the later', async () => {
    const s = new GenerationScheduler()
    const a = defer<string>()
    const b = defer<string>()
    const first = s.run(() => a.promise)
    const second = s.run(() => b.promise)
    b.resolve('new')
    a.resolve('stale')
    expect(await first).toBeNull()
    expect(await second).toBe('new')
  })

  it('invalidate() drops a job that has not resolved yet', async () => {
    const s = new GenerationScheduler()
    const d = defer<string>()
    const job = s.run(() => d.promise)
    s.invalidate()
    d.resolve('too late')
    expect(await job).toBeNull()
  })

  it('exposes cancellation to the job so it can abort mid-walk', async () => {
    const s = new GenerationScheduler()
    const seen: boolean[] = []
    const job = s.run(async (isCancelled) => {
      seen.push(isCancelled())
      await Promise.resolve()
      s.invalidate() // something else supersedes us here
      seen.push(isCancelled())
      return 'value'
    })
    expect(await job).toBeNull()
    expect(seen).toEqual([false, true])
  })

  it('a completed run is unaffected by a later invalidate', async () => {
    const s = new GenerationScheduler()
    const done = await s.run(async () => 'ok')
    expect(done).toBe('ok')
    s.invalidate()
    expect(done).toBe('ok')
  })

  it('a job returning null stays null (failure is not masked)', async () => {
    const s = new GenerationScheduler()
    expect(await s.run(async () => null)).toBeNull()
  })
})
