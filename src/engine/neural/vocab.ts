/** JazzNet chord vocabulary.
 *
 * The token ORDER is produced by `tools/export_onnx.py` with the exact
 * `load_vocab` algorithm from the Python engine (sorted set; pad=0, <BOS>=1,
 * <EOS>=2, chords 3..N). TS never sorts — it loads the pre-ordered list, so
 * there is no sort-parity risk between Python and JS.
 */

export interface VocabJson {
  tokens: string[]
  bosIdx: number
  eosIdx: number
  padIdx: number
  vocabSize: number
  hyperparameters: {
    embedding_dim: number
    hidden_dim: number
    n_layers: number
  }
}

export class JazzNetVocab {
  readonly chordToIdx = new Map<string, number>()
  readonly tokens: string[]
  readonly bosIdx: number
  readonly eosIdx: number
  readonly padIdx: number
  readonly vocabSize: number
  readonly hiddenDim: number
  readonly nLayers: number

  constructor(json: VocabJson) {
    this.tokens = json.tokens
    this.bosIdx = json.bosIdx
    this.eosIdx = json.eosIdx
    this.padIdx = json.padIdx
    this.vocabSize = json.vocabSize
    this.hiddenDim = json.hyperparameters.hidden_dim
    this.nLayers = json.hyperparameters.n_layers
    json.tokens.forEach((t, i) => this.chordToIdx.set(t, i))
  }

  chordIndex(chord: string): number | null {
    const i = this.chordToIdx.get(chord)
    return i === undefined ? null : i
  }

  indexChord(index: number): string | null {
    return this.tokens[index] ?? null
  }

  isSpecial(index: number): boolean {
    return index === this.padIdx || index === this.bosIdx || index === this.eosIdx
  }
}
