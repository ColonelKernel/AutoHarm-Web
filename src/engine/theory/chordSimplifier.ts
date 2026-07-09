/** Port of JazzNet's ChordSimplifier (via `python/src/chord_simplifier.py`):
 * maps free-form/openbook labels onto the 7 MIREX qualities used by the
 * neural vocab. Expects JazzNet dash-flat spelling (run toJazznet first). */

const JAZZ5_MIREX_KINDS = [':maj', ':min', ':maj7', ':min7', ':7', ':hdim7', ':dim7'] as const

const PLAYSTYLE_SYMBOLS = ['^', '*', ';', '+']

export const INVALID_CHORD = 'Invalid/No Chord'

function getRoot(chord: string): string {
  // The Python source indexes chord[1] unconditionally, which throws
  // IndexError on a 1-char input that slips past _is_chord (e.g. "H"). We guard
  // the length instead: the net outcome is identical (the label misses the
  // vocab and the caller applies its fallback) but without the crash. Kept
  // deliberately — do not "restore" the unguarded index.
  if (chord.length > 1 && (chord[1] === '-' || chord[1] === '#')) return chord.slice(0, 2)
  return chord[0]
}

function isChord(chord: string): boolean {
  if (chord.slice(0, 2).includes('r')) return false
  const c = chord.replace(/C-/g, 'B')
  // bare root notes (optionally with -, # or ^) are not chords
  if (c.length <= 2 && /^[A-G](-|#|\^)?$/.test(c)) return false
  return true
}

function chopChord(chord: string): string {
  let c = chord
  for (const symbol of PLAYSTYLE_SYMBOLS) c = c.split(symbol).join('')
  return c
}

function extractChordQuality(chord: string): string | null {
  const qualityList: Array<[string, string]> = [
    ['maj7', JAZZ5_MIREX_KINDS[2]],
    ['min7', JAZZ5_MIREX_KINDS[3]],
    ['h', JAZZ5_MIREX_KINDS[5]],
    ['o', JAZZ5_MIREX_KINDS[6]],
    ['7', JAZZ5_MIREX_KINDS[4]],
    ['maj', JAZZ5_MIREX_KINDS[0]],
    ['min', JAZZ5_MIREX_KINDS[1]],
  ]
  for (const [quality, chordType] of qualityList) {
    if (chord.includes(quality)) return chordType
  }
  return null
}

/** Reduce a chord label to `<root><:MIREX-quality>` or `Invalid/No Chord`. */
export function simplifyChord(chord: string | null | undefined): string {
  if (chord == null || chord.length === 0 || !isChord(chord)) return INVALID_CHORD
  const rootNote = getRoot(chord)
  const chopped = chopChord(chord)
  if (!isChord(chopped)) return INVALID_CHORD

  const chordType = extractChordQuality(chopped)
  if (chordType !== null) return rootNote + chordType

  // The Python port falls through to :maj for anything root-shaped.
  return rootNote + JAZZ5_MIREX_KINDS[0]
}
