/** Edge-case parity for corpusLoader vs the Python loader (regression for the
 * empty-"all" truthiness bug and the array-guard bug found in review). */

import { describe, expect, it } from 'vitest'
import { loadCorpora, CorpusLoadError, type RawCorpora } from '../src/engine/markov/corpusLoader'

describe('loadCorpora guards', () => {
  it('rejects a top-level array (typeof [] === "object" must not slip through)', () => {
    // Python: isinstance(nested, dict) fails -> CorpusLoadError.
    const arr = [{ 'C:maj': { 'G:maj': 1 } }] as unknown as RawCorpora
    expect(() => loadCorpora(arr)).toThrow(CorpusLoadError)
  })

  it('rejects an empty object', () => {
    expect(() => loadCorpora({})).toThrow(CorpusLoadError)
  })

  it('rejects null', () => {
    expect(() => loadCorpora(null as unknown as RawCorpora)).toThrow(CorpusLoadError)
  })
})

describe('global fallback pool with an empty "all" corpus', () => {
  it('builds the pool from the union when "all" is present but empty', () => {
    // Python treats `{}` as falsy -> unions every corpus. JS `{}` is truthy, so
    // this exercises the explicit-emptiness fix.
    const nested: RawCorpora = {
      nottingham: { 'C:maj': { 'G:maj': 3, 'F:maj': 1 } },
      all: {},
    }
    const set = loadCorpora(nested)
    expect(set.globalFallback.length).toBeGreaterThan(0)
    // Most frequent target across the union is G:maj (count 3).
    expect(set.globalFallback[0][0]).toBe('G:maj')
  })

  it('uses the "all" corpus when it is non-empty', () => {
    const nested: RawCorpora = {
      nottingham: { 'C:maj': { 'G:maj': 1 } },
      all: { 'C:maj': { 'A:min': 5, 'G:maj': 1 } },
    }
    const set = loadCorpora(nested)
    expect(set.globalFallback[0][0]).toBe('A:min') // from "all", not the union
  })
})
