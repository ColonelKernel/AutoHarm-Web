/** Product-facing model names. Engine IDs ('markov'/'rnn'/'lstm') are stable
 * internals; the UI speaks in musical terms and Lab mode shows the detail. */

import type { ModelName } from '../engine/markov/config'

export const MODEL_DISPLAY: Record<ModelName, { name: string; detail: string }> = {
  markov: { name: 'Corpus Blend', detail: 'four-corpus Markov blend' },
  rnn: { name: 'Neural Flow', detail: 'JazzNet RNN' },
  lstm: { name: 'Neural Memory', detail: 'JazzNet LSTM' },
}

export function modelDisplayName(id: ModelName): string {
  return MODEL_DISPLAY[id]?.name ?? id
}
