/** Per-slot phrase harmonization — the contour-aware response walk.
 *
 * Instead of scoring only the first response chord against the whole melody
 * (V2.0), every slot's candidates are scored against the melody segment that
 * actually sounds during that slot. The walk stays serial (each pick is the
 * next slot's chain context), voice-leading threads through the PICKED
 * voicings, and every slot carries its own score breakdown — so every card
 * in a response can explain itself.
 *
 * Notes are clipped to slot windows: a held note contributes its overlapping
 * duration to every slot it sounds in; the clipped onset stands in for its
 * accent within that slot. Steps stay phrase-relative (the phrase opens on a
 * bar downbeat, so metric weights remain correct).
 */

import { analyzeMelody } from './melodyAnalysis'
import { scoreChord } from './scoring'
import { explainResponseChord } from './explanation'
import { chordToNotes, type VoicingOptions } from '../voicing/chordParser'
import {
  makeProgression,
  makeSlot,
  type ChordExplanation,
  type Progression,
  type ProgressionSlot,
} from '../progression/types'
import type { CandidateLike, ChordSampler } from '../progression/generator'
import type { CapturedNote } from './types'

/** Candidates considered per slot (one model forward per slot for neural). */
export const SLOT_CANDIDATES = 12

/**
 * Split finalized (phrase-relative) notes into per-slot segments, clipping
 * each note to its overlap with the slot window. Empty segments are normal
 * (rests) — scoring treats them as melody-neutral.
 */
export function segmentPhrase(
  notes: CapturedNote[],
  onsets: number[],
  totalSteps: number,
): CapturedNote[][] {
  return onsets.map((start, i) => {
    const end = i + 1 < onsets.length ? onsets[i + 1] : totalSteps
    const seg: CapturedNote[] = []
    for (const n of notes) {
      const off = n.offStep ?? totalSteps
      const clipOn = Math.max(n.onStep, start)
      const clipOff = Math.min(off, end)
      if (clipOff > clipOn) seg.push({ ...n, onStep: clipOn, offStep: clipOff })
    }
    return seg
  })
}

export interface HarmonizeOptions {
  /** Finalized capture, phrase-relative steps. */
  notes: CapturedNote[]
  /** Slot onsets across the phrase, ascending, starting at 0. */
  onsets: number[]
  totalSteps: number
  /** Chain context the walk continues from (last handled chord). */
  seed: string
  key: string
  tension: number
  /** Recently sounded symbols (novelty context); the walk appends its picks. */
  recent: string[]
  voicingOptions?: VoicingOptions
  blendProfile?: Array<[string, number]>
  isCancelled?: () => boolean
}

/** Sensible preview defaults when no voicing options are injected: without a
 * register window + voice leading, candidates voice at the bottom of the
 * keyboard and the voice-leading score punishes every NON-repeat, letting
 * exact repeats win ties they shouldn't. */
const PREVIEW_VOICING: VoicingOptions = {
  registerCenter: 60,
  low: 48,
  high: 72,
  triadsOnly: true,
  voiceLeadingEnabled: true,
  colorMajor: 0,
  colorMinor: 0,
  color7th: 0,
}

function voicing(symbol: string, options: VoicingOptions | undefined, prev: number[] | null): number[] | null {
  try {
    const notes = chordToNotes(symbol, options ?? PREVIEW_VOICING, prev).notes
    return notes.length > 0 ? notes : null
  } catch {
    return null
  }
}

/**
 * Harmonize a captured phrase slot by slot. Returns null when cancelled.
 * Falls back to a plain chain sample for a slot when the model exposes no
 * candidates (e.g. unknown chord context) — the walk never stalls.
 */
export async function harmonizePhrase(
  sampler: ChordSampler,
  opts: HarmonizeOptions,
): Promise<Progression | null> {
  const onsets = opts.onsets.length > 0 ? opts.onsets : [0]
  const total = Math.max(1, Math.round(opts.totalSteps))
  const segments = segmentPhrase(opts.notes, onsets, total)
  const slots: ProgressionSlot[] = []
  const recent = [...opts.recent]
  let chain = opts.seed
  let prevVoicing = voicing(opts.seed, opts.voicingOptions, null)

  for (let i = 0; i < onsets.length; i++) {
    if (opts.isCancelled?.()) return null
    const duration = (i + 1 < onsets.length ? onsets[i + 1] : total) - onsets[i]
    if (duration <= 0) continue
    const analysis = analyzeMelody(segments[i], total)

    let symbol = chain
    let explanation: ChordExplanation | undefined
    let cands: CandidateLike[] = []
    try {
      cands = await Promise.resolve(sampler.candidates?.(chain, SLOT_CANDIDATES) ?? [])
    } catch {
      cands = []
    }
    if (opts.isCancelled?.()) return null

    if (cands.length > 0) {
      const maxPrior = Math.max(...cands.map((c) => c.prior))
      let bestTotal = -1
      for (const c of cands) {
        const candidateNotes = voicing(c.symbol, opts.voicingOptions, prevVoicing)
        const breakdown = scoreChord(c.symbol, {
          analysis,
          key: opts.key,
          tension: opts.tension,
          prior: maxPrior > 0 ? c.prior / maxPrior : 0,
          candidateNotes,
          prevVoicing,
          recent,
        })
        if (breakdown.total > bestTotal) {
          bestTotal = breakdown.total
          symbol = c.symbol
          explanation = {
            reasons: explainResponseChord(c.symbol, opts.key, breakdown, analysis),
            breakdown,
            prior: c.prior,
            ...(opts.blendProfile ? { blendProfile: opts.blendProfile } : {}),
          }
        }
      }
    } else {
      try {
        const res = await Promise.resolve(sampler.sample(chain))
        if (res.output && !res.error) {
          symbol = res.output
          explanation = { reasons: [], ...(res.probability != null ? { prior: res.probability } : {}) }
        }
      } catch {
        /* keep the chain chord — same degradation rule as the generator */
      }
    }
    if (opts.isCancelled?.()) return null

    slots.push(makeSlot(symbol, duration, 'response', { explanation }))
    prevVoicing = voicing(symbol, opts.voicingOptions, prevVoicing) ?? prevVoicing
    recent.push(symbol)
    chain = symbol
  }

  if (slots.length === 0) return null
  return makeProgression(slots)
}
