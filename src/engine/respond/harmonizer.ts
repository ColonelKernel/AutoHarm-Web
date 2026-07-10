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
  type SlotSource,
} from '../progression/types'
import type { CandidateLike, ChordSampler } from '../progression/generator'
import type { CapturedNote } from './types'
import { weightedChoice, type Rng } from '../random'

/** Candidates considered per slot (one model forward per slot for neural). */
export const SLOT_CANDIDATES = 12
/** Unseen transitions into a locked neighbor are rare, not impossible. */
const LOOKAHEAD_FLOOR = 1e-4
/** Scored-sampling contrast: weight = total^SHARPNESS. High enough that a
 * clearly better chord usually wins, low enough that variations vary. */
export const SAMPLE_SHARPNESS = 5

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

export type PickStrategy =
  | { mode: 'argmax' } // respond: the single best answer, deterministic
  | { mode: 'sample'; rng: Rng; sharpness?: number } // generate: scored variety

export interface HarmonizeOptions {
  /** Finalized capture, phrase-relative steps ([] = no melody: generation). */
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
  /** Variation source: locked slots (matched by order) pass through
   * untouched, steer the chain, and pull their predecessors toward them. */
  prior?: Progression
  /** How the scored candidate is chosen. Default: argmax. */
  pick?: PickStrategy
  /** Slot provenance label. Default: 'response'. */
  source?: SlotSource
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

  const source = opts.source ?? 'response'
  for (let i = 0; i < onsets.length; i++) {
    if (opts.isCancelled?.()) return null
    const duration = (i + 1 < onsets.length ? onsets[i + 1] : total) - onsets[i]
    if (duration <= 0) continue

    // Locked slots (variation) pass through untouched and steer the walk.
    const lockedSlot = opts.prior?.slots[i]?.locked ? opts.prior.slots[i] : null
    if (lockedSlot) {
      slots.push({ ...lockedSlot, durationSteps: duration })
      prevVoicing = voicing(lockedSlot.symbol, opts.voicingOptions, prevVoicing) ?? prevVoicing
      recent.push(lockedSlot.symbol)
      chain = lockedSlot.symbol
      continue
    }

    const analysis = analyzeMelody(segments[i], total)
    const nextLocked = opts.prior?.slots[i + 1]?.locked ? opts.prior.slots[i + 1].symbol : null

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
      // Approaching a locked chord: fold the transition INTO it into each
      // candidate's model prior (one-step lookahead) so the pick both fits
      // here and leads convincingly onward.
      let effective = cands.map((c) => ({ ...c }))
      if (nextLocked && sampler.candidates) {
        effective = []
        for (const c of cands) {
          const nexts = await Promise.resolve(sampler.candidates(c.symbol, 24))
          if (opts.isCancelled?.()) return null
          const into = nexts.find((n) => n.symbol === nextLocked)?.prior ?? LOOKAHEAD_FLOOR
          effective.push({ symbol: c.symbol, prior: c.prior * into })
        }
      }
      const maxPrior = Math.max(...effective.map((c) => c.prior))
      const scored = effective.map((c) => {
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
        return { symbol: c.symbol, prior: c.prior, breakdown }
      })

      let picked = scored[0]
      for (const s of scored) if (s.breakdown.total > picked.breakdown.total) picked = s
      if (opts.pick?.mode === 'sample' && scored.length > 1 && picked.breakdown.total > 0) {
        const sharpness = opts.pick.sharpness ?? SAMPLE_SHARPNESS
        const weights: Array<[string, number]> = scored.map((s) => [s.symbol, Math.pow(s.breakdown.total, sharpness)])
        const chosen = weightedChoice(opts.pick.rng, weights)
        picked = scored.find((s) => s.symbol === chosen) ?? picked
      }

      symbol = picked.symbol
      const reasons = explainResponseChord(picked.symbol, opts.key, picked.breakdown, analysis)
      if (nextLocked) reasons.unshift(`Chosen to lead into the locked ${nextLocked}`)
      explanation = {
        reasons,
        breakdown: picked.breakdown,
        prior: picked.prior,
        ...(opts.blendProfile ? { blendProfile: opts.blendProfile } : {}),
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

    slots.push(makeSlot(symbol, duration, source, { explanation }))
    prevVoicing = voicing(symbol, opts.voicingOptions, prevVoicing) ?? prevVoicing
    recent.push(symbol)
    chain = symbol
  }

  if (slots.length === 0) return null
  return makeProgression(slots)
}
