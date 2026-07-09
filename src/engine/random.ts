/** Seedable PRNG + weighted sampling.
 *
 * mulberry32 is fast and good enough for musical sampling. Parity with the
 * Python engine is distributional, not bit-exact (`random.Random` is Mersenne
 * Twister); deterministic parity is asserted on the pure math instead.
 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Non-deterministic seed for default engine construction. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0]
  }
  return (Math.random() * 0xffffffff) >>> 0
}

/** Weighted draw over [item, weight] pairs (replaces random.Random.choices). */
export function weightedChoice<T>(rng: Rng, choices: ReadonlyArray<readonly [T, number]>): T {
  let total = 0
  for (const [, w] of choices) total += w
  if (total <= 0 || choices.length === 0) {
    throw new Error('weightedChoice: no positive weights')
  }
  let r = rng() * total
  for (const [item, w] of choices) {
    r -= w
    if (r <= 0) return item
  }
  return choices[choices.length - 1][0]
}

/** Uniform draw (replaces random.Random.choice). */
export function choice<T>(rng: Rng, items: ReadonlyArray<T>): T {
  if (items.length === 0) throw new Error('choice: empty list')
  return items[Math.floor(rng() * items.length)]
}
