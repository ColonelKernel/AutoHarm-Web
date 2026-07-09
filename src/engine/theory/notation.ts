/** Notation bridge between this project's chord spelling and JazzNet's.
 *
 * Port of `engines/notation.py` (UPF Autoharmonizer). Only the flat marker
 * differs: `Bb:maj7` (project) <-> `B-:maj7` (JazzNet). Sharps and the colon
 * format are identical. The bridge is load-bearing: the simplifier and vocab
 * lookups must run on the JazzNet spelling.
 */

/** Project spelling -> JazzNet spelling (`Bb:maj7` -> `B-:maj7`). */
export function toJazznet(chord: string): string {
  const m = /^([A-G])b(.*)$/.exec(chord)
  return m ? `${m[1]}-${m[2]}` : chord
}

/** JazzNet spelling -> project spelling (`B-:maj7` -> `Bb:maj7`). */
export function fromJazznet(chord: string): string {
  const m = /^([A-G])-(.*)$/.exec(chord)
  return m ? `${m[1]}b${m[2]}` : chord
}
