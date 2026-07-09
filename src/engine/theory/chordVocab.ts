/** Chord root/quality vocabulary and key transposition.
 *
 * Port of `python/src/chord_vocab.py` (UPF Autoharmonizer). Key-space
 * convention: a song is transposed so its tonic sits at C for major keys / A
 * for minor keys. `keyOffset()` returns that semitone shift; `transposeChord()`
 * applies any shift; passing the negated offset transposes a normalized chord
 * back into the song's key.
 */

/** Note-name (incl. enharmonics) -> pitch class 0..11 */
export const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}

/** Pitch class 0..11 -> canonical spelling used in every corpus symbol */
export const CANON_ROOT: readonly string[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
]

/** Chord quality -> interval set (authoritative corpus quality vocabulary). */
export const QUALITY_INTERVALS: Readonly<Record<string, readonly number[]>> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], '7': [0, 4, 7, 10],
  dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10], minmaj7: [0, 3, 7, 11],
  maj6: [0, 4, 7, 9], min6: [0, 3, 7, 9], '6': [0, 4, 7, 9],
  '9': [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2], min9: [0, 3, 7, 10, 2],
}

export type Mode = 'maj' | 'min'

/** Return [tonicPc, mode] from a key string.
 *
 * Accepts 'C:maj' / 'A:min' (Root:mode), 'Eb major', and bare 'C' / 'Am'.
 * Unknown -> [null, 'maj'].
 */
export function parseKey(keyStr: string): [number | null, Mode] {
  if (typeof keyStr !== 'string' || !keyStr.trim()) return [null, 'maj']
  keyStr = keyStr.trim()
  if (keyStr.includes(':')) {
    const [root, mode] = splitOnce(keyStr, ':')
    return [pcOrNull(root), mode.startsWith('min') ? 'min' : 'maj']
  }
  if (keyStr.includes(' ')) {
    const [root, mode] = splitOnce(keyStr, ' ')
    return [pcOrNull(root), mode.startsWith('min') ? 'min' : 'maj']
  }
  if (keyStr.endsWith('m')) {
    return [pcOrNull(keyStr.slice(0, -1)), 'min']
  }
  return [pcOrNull(keyStr), 'maj']
}

function pcOrNull(root: string): number | null {
  const pc = PITCH_CLASSES[root]
  return pc === undefined ? null : pc
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  return [s.slice(0, i), s.slice(i + sep.length)]
}

/** Semitone shift putting the tonic at C (major) / A (minor), in -5..+6. */
export function transposeOffset(tonicPc: number | null, mode: Mode): number | null {
  if (tonicPc === null) return null
  const target = mode === 'maj' ? 0 : 9
  const off = (((target - tonicPc) % 12) + 12) % 12
  return off > 6 ? off - 12 : off
}

/** Semitone shift moving a chord in `keyStr` into normalized (C/Am) space.
 * Returns 0 for an unknown/blank key (transposition degrades to identity). */
export function keyOffset(keyStr: string): number {
  const [tonicPc, mode] = parseKey(keyStr)
  const off = transposeOffset(tonicPc, mode)
  return off === null ? 0 : off
}

/** Shift a `Root:quality` symbol by `offset` semitones (mod 12).
 * Non-chord tokens ('' / '-' / 'N') pass through unchanged. */
export function transposeChord(simple: string, offset: number): string {
  if (simple === '' || simple === '-' || simple === 'N' || !simple.includes(':')) {
    return simple
  }
  const [root, qual] = splitOnce(simple, ':')
  const pc = PITCH_CLASSES[root]
  if (pc === undefined) return simple
  return `${CANON_ROOT[(((pc + offset) % 12) + 12) % 12]}:${qual}`
}
