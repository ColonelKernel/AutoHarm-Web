/** Load the nested per-corpus Markov transition counts.
 *
 * Port of `python/src/corpus_loader.py`. Input is the parsed
 * `markov_corpora_t.json` — first-order transition counts nested per corpus
 * (pop909, nottingham, openbook, bach, all), key-transposed to C/Am. Each
 * corpus is normalized per source chord into probability distributions,
 * keeping the corpora separate so the blend engine can mix them live.
 */

export type RawCorpora = Record<string, Record<string, Record<string, number>>>

export interface CorpusTable {
  /** source chord -> {target chord: probability within this corpus} */
  distBySource: Map<string, Map<string, number>>
  /** source chord -> total transition count from that source */
  totalBySource: Map<string, number>
}

export interface CorporaSet {
  corpora: Map<string, CorpusTable>
  /** pooled fallback distribution (from the "all" corpus), most-common first */
  globalFallback: Array<[string, number]>
}

export class CorpusLoadError extends Error {}

export function corpusNames(set: CorporaSet): string[] {
  return [...set.corpora.keys()].filter((n) => n !== 'all')
}

function normalizeCorpus(raw: Record<string, Record<string, number>>): CorpusTable {
  const distBySource = new Map<string, Map<string, number>>()
  const totalBySource = new Map<string, number>()
  for (const [source, targets] of Object.entries(raw)) {
    let total = 0
    for (const c of Object.values(targets)) total += c
    totalBySource.set(source, total)
    if (total <= 0) {
      distBySource.set(source, new Map())
      continue
    }
    const dist = new Map<string, number>()
    for (const [t, c] of Object.entries(targets)) dist.set(t, c / total)
    distBySource.set(source, dist)
  }
  return { distBySource, totalBySource }
}

export function loadCorpora(nested: RawCorpora): CorporaSet {
  // Match Python's `isinstance(nested, dict) and nested` — reject arrays and
  // other non-plain-objects (in JS `typeof [] === 'object'`), not just null.
  if (
    typeof nested !== 'object' ||
    nested === null ||
    Array.isArray(nested) ||
    Object.keys(nested).length === 0
  ) {
    throw new CorpusLoadError('Corpora JSON must be a non-empty object')
  }

  const corpora = new Map<string, CorpusTable>()
  for (const [name, raw] of Object.entries(nested)) {
    corpora.set(name, normalizeCorpus(raw))
  }

  // Global fallback pool from the pooled "all" corpus (or the union if absent).
  // Match Python's `[all_raw] if all_raw else nested.values()`: an EMPTY "all"
  // dict is falsy in Python, so fall back to the union — but `{}` is truthy in
  // JS, so test emptiness explicitly.
  const poolCounts = new Map<string, number>()
  const allRaw = nested['all']
  const sources = allRaw && Object.keys(allRaw).length > 0 ? [allRaw] : Object.values(nested)
  for (const corpusRaw of sources) {
    for (const targets of Object.values(corpusRaw)) {
      for (const [target, count] of Object.entries(targets)) {
        poolCounts.set(target, (poolCounts.get(target) ?? 0) + count)
      }
    }
  }
  let total = 0
  for (const c of poolCounts.values()) total += c
  if (total === 0) total = 1
  const globalFallback = [...poolCounts.entries()]
    .sort((a, b) => b[1] - a[1]) // stable sort: ties keep first-seen order, like Python
    .map(([t, c]): [string, number] => [t, c / total])

  return { corpora, globalFallback }
}
