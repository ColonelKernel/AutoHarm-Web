/** Pure, immutable edit operations on the progression model.
 *
 * Every operation returns a NEW Progression (slots array copied; untouched
 * slots shared) and never mutates its input — that is what makes undo/redo a
 * simple stack of snapshots. Operations that would produce an invalid model
 * (unknown id, deleting the last slot) return the input unchanged.
 */

import {
  makeProgression,
  makeSlot,
  newSlotId,
  type PlaybackPlan,
  type Progression,
  type ProgressionSlot,
} from './types'

function indexOf(p: Progression, slotId: string): number {
  return p.slots.findIndex((s) => s.id === slotId)
}

function withSlots(slots: ProgressionSlot[]): Progression {
  return makeProgression(slots)
}

/** Replace a slot's chord symbol (marks it as manually edited). */
export function replaceSymbol(p: Progression, slotId: string, symbol: string): Progression {
  const i = indexOf(p, slotId)
  const v = symbol.trim()
  if (i < 0 || !v) return p
  const slots = [...p.slots]
  // A manual edit invalidates any generated explanation for the old chord.
  const { explanation: _drop, ...rest } = slots[i]
  slots[i] = { ...rest, symbol: v, source: 'manual' }
  return withSlots(slots)
}

export function toggleLock(p: Progression, slotId: string): Progression {
  const i = indexOf(p, slotId)
  if (i < 0) return p
  const slots = [...p.slots]
  slots[i] = { ...slots[i], locked: !slots[i].locked }
  return withSlots(slots)
}

/** Change a slot's duration (min 1 step); total length changes with it. */
export function setDuration(p: Progression, slotId: string, steps: number): Progression {
  const i = indexOf(p, slotId)
  const d = Math.round(steps)
  if (i < 0 || !Number.isFinite(d) || d < 1 || d === p.slots[i].durationSteps) return p
  const slots = [...p.slots]
  slots[i] = { ...slots[i], durationSteps: d }
  return withSlots(slots)
}

/** Move a slot one position left (-1) or right (+1) — the accessible reorder. */
export function move(p: Progression, slotId: string, dir: -1 | 1): Progression {
  const i = indexOf(p, slotId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= p.slots.length) return p
  const slots = [...p.slots]
  ;[slots[i], slots[j]] = [slots[j], slots[i]]
  return withSlots(slots)
}

/** Insert a new slot after `afterId` (or at the start when null). */
export function insertAfter(p: Progression, afterId: string | null, slot: ProgressionSlot): Progression {
  const at = afterId === null ? 0 : indexOf(p, afterId) + 1
  if (afterId !== null && at === 0) return p // unknown anchor
  const slots = [...p.slots]
  slots.splice(at, 0, slot)
  return withSlots(slots)
}

/** Delete a slot. The last remaining slot cannot be deleted (an empty
 * progression has no playable timeline; clear = generate a new one instead). */
export function remove(p: Progression, slotId: string): Progression {
  if (p.slots.length <= 1) return p
  const i = indexOf(p, slotId)
  if (i < 0) return p
  const slots = p.slots.filter((s) => s.id !== slotId)
  return withSlots(slots)
}

/** Duplicate a slot immediately after itself (new id, lock cleared). */
export function duplicate(p: Progression, slotId: string): Progression {
  const i = indexOf(p, slotId)
  if (i < 0) return p
  const src = p.slots[i]
  const copy: ProgressionSlot = { ...src, id: newSlotId(), locked: false }
  const slots = [...p.slots]
  slots.splice(i + 1, 0, copy)
  return withSlots(slots)
}

/** Compile the per-step onset lookup the player walks. O(slots). */
export function compilePlan(p: Progression): PlaybackPlan {
  const onsetSteps: number[] = []
  const onsetToSlot = new Map<number, number>()
  let step = 0
  p.slots.forEach((slot, i) => {
    onsetSteps.push(step)
    onsetToSlot.set(step, i)
    step += slot.durationSteps
  })
  return { onsetSteps, onsetToSlot, totalSteps: step }
}

/**
 * Re-index a prior progression onto a DIFFERENT onset grid, matching slots by
 * their onset STEP rather than their index. Used when the phrase length or the
 * harmonic rhythm changed underneath a variation: index-matching would silently
 * shift every lock (or drop the tail), so a lock is honored only where its
 * exact step survives in the new grid.
 *
 * Returns a progression shaped like `onsets` (one slot per onset) plus the
 * number of locks that could not be placed.
 */
export function alignPriorToOnsets(
  prior: Progression,
  onsets: number[],
  totalSteps: number,
): { aligned: Progression; droppedLocks: number } {
  const priorPlan = compilePlan(prior)
  const byStep = new Map<number, ProgressionSlot>()
  priorPlan.onsetSteps.forEach((step, i) => byStep.set(step, prior.slots[i]))

  const target = new Set(onsets)
  let droppedLocks = 0
  for (const [step, slot] of byStep) {
    if (slot.locked && !target.has(step)) droppedLocks += 1
  }

  const slots = onsets.map((step, i) => {
    const duration = Math.max(1, (i + 1 < onsets.length ? onsets[i + 1] : totalSteps) - step)
    const hit = byStep.get(step)
    // Only LOCKED slots carry over. Unlocked ones are regenerated anyway, so
    // they become placeholders — the walk overwrites both symbol and id.
    if (hit?.locked) return { ...hit, durationSteps: duration }
    return makeSlot(hit?.symbol ?? '', duration, 'generated')
  })
  return { aligned: makeProgression(slots), droppedLocks }
}

/** The slot sounding at `stepInPhrase` (the latest onset at or before it). */
export function slotAtStep(plan: PlaybackPlan, p: Progression, stepInPhrase: number): ProgressionSlot | null {
  if (p.slots.length === 0) return null
  let idx = 0
  for (let i = 0; i < plan.onsetSteps.length; i++) {
    if (plan.onsetSteps[i] <= stepInPhrase) idx = i
    else break
  }
  return p.slots[idx] ?? null
}
