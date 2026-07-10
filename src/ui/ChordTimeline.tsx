/** Chord timeline — the progression as large editable cards.
 *
 * Accessibility shape: a real <ul>/<li> list. Every action is a plain button,
 * so the whole card is reachable by keyboard; reordering is Move left / Move
 * right, never drag-only. Selection follows focus, so a keyboard user tabbing
 * through a card sees its explanation without an extra "select" control, and
 * `aria-current` announces it. Lock and playing states carry an icon and a
 * border, never colour alone.
 *
 * The six secondary actions are revealed on hover, focus-within, or selection.
 * Sixteen cards x seven always-visible buttons was 112 competing targets; the
 * lock stays visible because it is the concept Variation depends on.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { romanNumeral } from '../engine/theory/romanNumeral'
import { STEPS_PER_BAR } from '../engine/player/templates'
import type { ProgressionSlot } from '../engine/progression/types'

/** Human duration label for a step count (4/4, 16 steps per bar). */
export function durationLabel(steps: number): string {
  if (steps % STEPS_PER_BAR === 0) {
    const bars = steps / STEPS_PER_BAR
    return bars === 1 ? '1 bar' : `${bars} bars`
  }
  const beats = steps / 4
  return Number.isInteger(beats) ? `${beats} beat${beats === 1 ? '' : 's'}` : `${steps}/16`
}

const DURATION_CHOICES = [2, 4, 6, 8, 12, 16, 24, 32]
const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

function SymbolEditor({ slot, onCommit }: { slot: ProgressionSlot; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(slot.symbol)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Seed the field when the editor OPENS. Watching slot.symbol here would
    // clobber what the user is typing if a variation lands mid-edit.
    if (editing) {
      setValue(slot.symbol)
      ref.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (!editing) {
    return (
      <button className="cc-symbol" title="Edit chord" onClick={() => setEditing(true)}>
        {slot.symbol || '—'}
      </button>
    )
  }
  const commit = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== slot.symbol) onCommit(value.trim())
  }
  return (
    <input
      ref={ref}
      className="cc-symbol-input"
      value={value}
      aria-label="Chord symbol"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

function ChordCard({ slot, index, count }: { slot: ProgressionSlot; index: number; count: number }) {
  const displayMode = useStore((s) => s.displayMode)
  const selected = useStore((s) => s.selectedSlotId === slot.id)
  const playing = useStore((s) => s.playingSlotId === slot.id)
  const holding = useStore((s) => s.hold)
  const generating = useStore((s) => s.generating)
  const keyName = useStore((s) => `${KEY_NAMES[s.keyRoot]}:${s.keyMode}`)
  const selectSlot = useStore((s) => s.selectSlot)
  const editSlotSymbol = useStore((s) => s.editSlotSymbol)
  const toggleSlotLock = useStore((s) => s.toggleSlotLock)
  const setSlotDuration = useStore((s) => s.setSlotDuration)
  const moveSlot = useStore((s) => s.moveSlot)
  const deleteSlot = useStore((s) => s.deleteSlot)
  const duplicateSlot = useStore((s) => s.duplicateSlot)
  const rerollSlot = useStore((s) => s.rerollSlot)
  const auditionSlot = useStore((s) => s.auditionSlot)

  const roman = displayMode !== 'symbols' ? romanNumeral(slot.symbol, keyName) : null
  const vamping = playing && holding
  const state = vamping ? ', vamping' : playing ? ', playing' : ''

  return (
    <li
      className={
        'chord-card' +
        (selected ? ' selected' : '') +
        (playing ? ' playing' : '') +
        (vamping ? ' vamping' : '') +
        (slot.locked ? ' locked' : '')
      }
      aria-current={selected ? 'true' : undefined}
      aria-label={`Chord ${index + 1} of ${count}: ${slot.symbol}${slot.locked ? ', locked' : ''}${state}`}
      // Selection follows focus: tabbing into any control shows that chord's
      // explanation, so the panel is reachable without a pointer. React maps
      // onFocus to focusin, which bubbles from the card's inner buttons.
      onFocus={() => selectSlot(slot.id)}
      onClick={() => selectSlot(selected ? null : slot.id)}
    >
      <div className="cc-top">
        {displayMode !== 'symbols' && <span className="cc-roman">{roman?.numeral ?? ' '}</span>}
        {playing && (
          <span className="cc-play" aria-hidden="true" title={vamping ? 'Vamping (Hold)' : 'Playing'}>
            {vamping ? '⟳' : '▶'}
          </span>
        )}
      </div>

      {displayMode !== 'roman' ? (
        <div onClick={(e) => e.stopPropagation()}>
          <SymbolEditor slot={slot} onCommit={(v) => editSlotSymbol(slot.id, v)} />
        </div>
      ) : (
        <div className="cc-roman-only">{roman?.numeral ?? slot.symbol}</div>
      )}

      <div className="cc-row" onClick={(e) => e.stopPropagation()}>
        <select
          className="cc-duration"
          aria-label={`Duration of chord ${index + 1}`}
          value={slot.durationSteps}
          onChange={(e) => setSlotDuration(slot.id, Number(e.target.value))}
        >
          {(DURATION_CHOICES.includes(slot.durationSteps)
            ? DURATION_CHOICES
            : [...DURATION_CHOICES, slot.durationSteps].sort((a, b) => a - b)
          ).map((d) => (
            <option key={d} value={d}>{durationLabel(d)}</option>
          ))}
        </select>
        <button
          className={'cc-lock' + (slot.locked ? ' active' : '')}
          aria-label={slot.locked ? `Unlock chord ${index + 1}` : `Lock chord ${index + 1}`}
          aria-pressed={slot.locked}
          title={slot.locked ? 'Locked — survives Variation' : 'Lock so Variation keeps this chord'}
          onClick={() => toggleSlotLock(slot.id)}
        >
          {slot.locked ? '🔒' : '🔓'}
        </button>
      </div>

      <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
        <button aria-label={`Audition chord ${index + 1}`} title="Audition" onClick={() => auditionSlot(slot.id)}>
          ♪
        </button>
        <button
          aria-label={`Reroll chord ${index + 1}`}
          title="Reroll just this chord"
          disabled={slot.locked || generating}
          onClick={() => void rerollSlot(slot.id)}
        >
          ↻
        </button>
        <button
          aria-label={`Move chord ${index + 1} left`}
          title="Move left"
          disabled={index === 0}
          onClick={() => moveSlot(slot.id, -1)}
        >
          ◀
        </button>
        <button
          aria-label={`Move chord ${index + 1} right`}
          title="Move right"
          disabled={index === count - 1}
          onClick={() => moveSlot(slot.id, 1)}
        >
          ▶
        </button>
        <button aria-label={`Duplicate chord ${index + 1}`} title="Duplicate" onClick={() => duplicateSlot(slot.id)}>
          ⧉
        </button>
        <button
          aria-label={`Delete chord ${index + 1}`}
          title="Delete"
          disabled={count <= 1}
          onClick={() => deleteSlot(slot.id)}
        >
          ✕
        </button>
      </div>
    </li>
  )
}

export function ChordTimeline() {
  const slots = useStore((s) => s.progression.slots)
  const generating = useStore((s) => s.generating)
  if (slots.length === 0) {
    return <p className="timeline-empty">No progression yet — press <b>Generate</b>.</p>
  }
  return (
    <ul className={'chord-timeline' + (generating ? ' busy' : '')} aria-busy={generating} aria-label="Chord progression">
      {slots.map((slot, i) => (
        <ChordCard key={slot.id} slot={slot} index={i} count={slots.length} />
      ))}
    </ul>
  )
}
