/** Golden-fixture parity tests: TS Markov/blend port vs the original Python
 * engine. Fixtures are produced by `tools/dump_golden_fixtures.py` from the
 * UPF Autoharmonizer repo and committed under test/fixtures/.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyCadence,
  applyTemperature,
  blendedChoices,
  colorWeights,
  normalizeToKey,
  temperature,
} from '../src/engine/markov/blend'
import { loadCorpora, corpusNames, type RawCorpora } from '../src/engine/markov/corpusLoader'
import {
  CANON_ROOT,
  keyOffset,
  parseKey,
  transposeChord,
  transposeOffset,
  type Mode,
} from '../src/engine/theory/chordVocab'

const FIXTURES = join(__dirname, 'fixtures')
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))

const rawCorpora: RawCorpora = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'data', 'markov_corpora_t.json'), 'utf-8'),
)
const corpora = loadCorpora(rawCorpora)

function expectChoicesEqual(actual: Array<[string, number]>, expected: Array<[string, number]>) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i][0], `target at rank ${i}`).toBe(expected[i][0])
    expect(actual[i][1], `prob for ${expected[i][0]}`).toBeCloseTo(expected[i][1], 9)
  }
}

describe('colorWeights', () => {
  const cases = readJson('color_weights.json') as Array<{
    c: number
    available: string[] | null
    weights: Array<[string, number]>
  }>
  it(`matches Python across ${cases.length} grid points`, () => {
    for (const tc of cases) {
      const w = colorWeights(tc.c, tc.available)
      const entries = [...w.entries()]
      expect(entries.length, `c=${tc.c} avail=${JSON.stringify(tc.available)}`).toBe(tc.weights.length)
      for (let i = 0; i < tc.weights.length; i++) {
        expect(entries[i][0]).toBe(tc.weights[i][0])
        expect(entries[i][1]).toBeCloseTo(tc.weights[i][1], 12)
      }
    }
  })
})

describe('temperature', () => {
  const cases = readJson('temperature.json') as Array<{ a: number; tau: number }>
  it('matches Python tau mapping', () => {
    for (const tc of cases) {
      expect(temperature(tc.a)).toBeCloseTo(tc.tau, 12)
    }
  })
})

describe('applyTemperature + applyCadence on real corpus distributions', () => {
  const cases = readJson('temperature_cadence.json') as Array<{
    corpus: string
    source: string
    tau: number
    mode: Mode
    gravity: number
    choices: Array<[string, number]>
  }>
  it(`matches Python across ${cases.length} cases`, () => {
    for (const tc of cases) {
      const table = corpora.corpora.get(tc.corpus)!
      const dist = table.distBySource.get(tc.source)!
      const result = applyCadence(applyTemperature(dist, tc.tau), tc.mode, tc.gravity)
      expectChoicesEqual(result, tc.choices)
    }
  })
})

describe('blendedChoices full pipeline', () => {
  const cases = readJson('blended_choices.json') as Array<{
    chord: string
    key: string
    color: number
    adventure: number
    gravity: number
    normIn: string
    offset: number
    mode: Mode
    tau: number
    weights: Array<[string, number]>
    choices: Array<[string, number]>
    choicesBack: Array<[string, number]>
  }>
  it(`matches Python across ${cases.length} combos`, () => {
    for (const tc of cases) {
      const [normIn, offset] = normalizeToKey(tc.chord, tc.key)
      expect(normIn, `normIn for ${tc.chord} in ${tc.key}`).toBe(tc.normIn)
      expect(offset).toBe(tc.offset)

      const weights = colorWeights(tc.color, corpusNames(corpora))
      const wEntries = [...weights.entries()]
      expect(wEntries.map(([k]) => k)).toEqual(tc.weights.map(([k]) => k))
      for (let i = 0; i < wEntries.length; i++) {
        expect(wEntries[i][1]).toBeCloseTo(tc.weights[i][1], 12)
      }

      const tau = temperature(tc.adventure)
      expect(tau).toBeCloseTo(tc.tau, 12)

      const [, mode] = parseKey(tc.key)
      expect(mode).toBe(tc.mode)

      const choices = blendedChoices(corpora, weights, tau, normIn, mode, tc.gravity)
      expectChoicesEqual(choices, tc.choices)

      const back = choices.map(([t, p]): [string, number] => [transposeChord(t, -offset), p])
      expectChoicesEqual(back, tc.choicesBack)
    }
  })
})

describe('key parsing and transposition', () => {
  const fx = readJson('keys_transpose.json') as {
    parseKey: Array<{ key: string; tonicPc: number | null; mode: Mode; offset: number }>
    transposeOffset: Array<{ tonicPc: number; mode: Mode; offset: number }>
    transposeChord: Array<{ chord: string; offset: number; result: string }>
    canonRoot: string[]
  }

  it('parseKey matches Python', () => {
    for (const tc of fx.parseKey) {
      const [pc, mode] = parseKey(tc.key)
      expect(pc, `tonic for '${tc.key}'`).toBe(tc.tonicPc)
      expect(mode, `mode for '${tc.key}'`).toBe(tc.mode)
      expect(keyOffset(tc.key), `offset for '${tc.key}'`).toBe(tc.offset)
    }
  })

  it('transposeOffset matches Python for all 24 keys', () => {
    for (const tc of fx.transposeOffset) {
      expect(transposeOffset(tc.tonicPc, tc.mode)).toBe(tc.offset)
    }
  })

  it('transposeChord matches Python', () => {
    for (const tc of fx.transposeChord) {
      expect(transposeChord(tc.chord, tc.offset), `${tc.chord} @ ${tc.offset}`).toBe(tc.result)
    }
  })

  it('CANON_ROOT matches', () => {
    expect([...CANON_ROOT]).toEqual(fx.canonRoot)
  })
})

describe('corpus normalization', () => {
  const spot = readJson('corpus_spot.json') as Record<string, unknown> & {
    globalFallbackTop10: Array<[string, number]>
    names: string[]
  }

  it('per-source distributions match Python', () => {
    for (const corpusName of ['pop909', 'nottingham', 'bach', 'openbook', 'all']) {
      const entry = spot[corpusName] as Record<
        string,
        { total: number; dist: Array<[string, number]> }
      >
      const table = corpora.corpora.get(corpusName)!
      for (const [src, expected] of Object.entries(entry)) {
        expect(table.totalBySource.get(src)).toBe(expected.total)
        const dist = table.distBySource.get(src)!
        const entries = [...dist.entries()]
        expectChoicesEqual(entries, expected.dist)
      }
    }
  })

  it('global fallback pool matches Python (top 10)', () => {
    for (let i = 0; i < spot.globalFallbackTop10.length; i++) {
      expect(corpora.globalFallback[i][0]).toBe(spot.globalFallbackTop10[i][0])
      expect(corpora.globalFallback[i][1]).toBeCloseTo(spot.globalFallbackTop10[i][1], 9)
    }
  })

  it('corpus names exclude "all"', () => {
    expect(corpusNames(corpora)).toEqual(spot.names)
  })
})
