/** Chord timeline — the progression as large editable cards.
 *
 * Every card action is a plain button (keyboard + screen-reader operable);
 * reordering is Move left / Move right, not drag-only. Lock and playing
 * states use icons + borders, never color alone.
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

function SymbolEditor({ slot, onCommit }: { slot: ProgressionSlot; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(slot.symbol)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setValue(slot.symbol)
      ref.current?.select()
    }
  }, [editing, slot.symbol])

  if (!editing) {
    return (
      <button className="cc-symbol" title="Edit chord" onClick={() => setEditing(true)}>
        {slot.symbol}
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
  const s = useStore()
  const key = useStore((st) => `${['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][st.keyRoot]}:${st.keyMode}`)
  const selected = s.selectedSlotId === slot.id
  const playing = s.playingSlotId === slot.id
  const roman = s.displayMode !== 'symbols' ? romanNumeral(slot.symbol, key) : null

  return (
    <div
      className={
        'chord-card' +
        (selected ? ' selected' : '') +
        (playing ? ' playing' : '') +
        (slot.locked ? ' locked' : '')
      }
      role="group"
      aria-label={`Chord ${index + 1}: ${slot.symbol}${slot.locked ? ', locked' : ''}`}
      onClick={() => s.selectSlot(selected ? null : slot.id)}
    >
      {s.displayMode !== 'symbols' && (
        <div className="cc-roman">{roman?.numeral ?? ' '}</div>
      )}
      {s.displayMode !== 'roman' ? (
        <div onClick={(e) => e.stopPropagation()}>
          <SymbolEditor slot={slot} onCommit={(v) => s.editSlotSymbol(slot.id, v)} />
        </div>
      ) : (
        <div className="cc-roman-only">{roman?.numeral ?? slot.symbol}</div>
      )}
      <div onClick={(e) => e.stopPropagation()}>
        <select
          className="cc-duration"
          aria-label="Duration"
          value={slot.durationSteps}
          onChange={(e) => s.setSlotDuration(slot.id, Number(e.target.value))}
        >
          {(DURATION_CHOICES.includes(slot.durationSteps)
            ? DURATION_CHOICES
            : [...DURATION_CHOICES, slot.durationSteps].sort((a, b) => a - b)
          ).map((d) => (
            <option key={d} value={d}>{durationLabel(d)}</option>
          ))}
        </select>
      </div>
      <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
        <button
          aria-label={slot.locked ? 'Unlock chord' : 'Lock chord'}
          aria-pressed={slot.locked}
          className={slot.locked ? 'active' : ''}
          title={slot.locked ? 'Unlock' : 'Lock (survives variations)'}
          onClick={() => s.toggleSlotLock(slot.id)}
        >
          {slot.locked ? '🔒' : '🔓'}
        </button>
        <button aria-label="Audition chord" title="Audition" onClick={() => s.auditionSlot(slot.id)}>
          ♪
        </button>
        <button
          aria-label="Reroll this chord"
          title="Reroll this chord"
          disabled={slot.locked || s.generating}
          onClick={() => void s.rerollSlot(slot.id)}
        >
          ↻
        </button>
        <button
          aria-label="Move left"
          title="Move left"
          disabled={index === 0}
          onClick={() => s.moveSlot(slot.id, -1)}
        >
          ◀
        </button>
        <button
          aria-label="Move right"
          title="Move right"
          disabled={index === count - 1}
          onClick={() => s.moveSlot(slot.id, 1)}
        >
          ▶
        </button>
        <button aria-label="Duplicate chord" title="Duplicate" onClick={() => s.duplicateSlot(slot.id)}>
          ⧉
        </button>
        <button
          aria-label="Delete chord"
          title="Delete"
          disabled={count <= 1}
          onClick={() => s.deleteSlot(slot.id)}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export function ChordTimeline() {
  const progression = useStore((st) => st.progression)
  const count = progression.slots.length
  if (count === 0) {
    return <div className="timeline-empty">No progression yet — press Generate.</div>
  }
  return (
    <div className="chord-timeline" role="list" aria-label="Chord progression">
      {progression.slots.map((slot, i) => (
        <ChordCard key={slot.id} slot={slot} index={i} count={count} />
      ))}
    </div>
  )
}
