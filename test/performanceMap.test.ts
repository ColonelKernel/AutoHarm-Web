/**
 * performanceMap.test.ts — port of `max/performance_map.test.js` to Vitest.
 * All original assertions preserved via the same check() harness.
 */

import { describe, expect, it } from 'vitest'
import * as M from '../src/engine/voicing/performanceMap'

describe('performanceMap (ported regression suite)', () => {
  it('passes all original performance_map.test.js checks', () => {
    let passed = 0
    let failed = 0
    const failures: string[] = []

    function check(name: string, cond: unknown, extra?: unknown) {
      if (cond) passed++
      else {
        failed++
        failures.push(name + (extra !== undefined ? '  -> ' + String(extra) : ''))
      }
    }
    function eqArr(a: unknown, b: unknown) {
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => v === b[i])
      )
    }

    /* --- Phrase length --- */
    check('barsFromDial 0 -> 8', M.barsFromDial(0) === 8)
    check('barsFromDial 1 -> 32', M.barsFromDial(1) === 32)
    check('barsFromDial 0.5 -> 16 or 24', [16, 24].indexOf(M.barsFromDial(0.5)) !== -1, M.barsFromDial(0.5))
    check('barsFromDial 0.34 -> 16', M.barsFromDial(0.34) === 16, M.barsFromDial(0.34))
    check('barsFromDial clamps >1', M.barsFromDial(5) === 32)
    check("barsFromDial NaN -> 8", M.barsFromDial('x') === 8)

    /* --- Phrase mode --- */
    check('modeFromValue 0 -> loop', M.modeFromValue(0) === 'loop')
    check('modeFromValue 1 -> regen', M.modeFromValue(1) === 'regen')
    check('modeFromValue 2 -> oneshot', M.modeFromValue(2) === 'oneshot')
    check("modeFromValue 'regen' -> regen", M.modeFromValue('regen') === 'regen')
    check('modeFromValue bad -> loop', M.modeFromValue('nope') === 'loop')
    check('nextMode loop -> regen', M.nextMode('loop') === 'regen')
    check('nextMode oneshot -> loop (wrap)', M.nextMode('oneshot') === 'loop')

    /* --- Program Change decode --- */
    check('pgm 0 -> playtoggle', M.decodePgm(0).action === 'playtoggle')
    check('pgm 1 -> reroll', M.decodePgm(1).action === 'reroll')
    check('pgm 2 -> holdtoggle', M.decodePgm(2).action === 'holdtoggle')
    check('pgm 3 -> modecycle', M.decodePgm(3).action === 'modecycle')
    check('pgm 4 -> length 8', M.decodePgm(4).action === 'length' && M.decodePgm(4).arg === 8)
    check('pgm 7 -> length 32', M.decodePgm(7).arg === 32)
    check('pgm 16 -> keyroot 0', M.decodePgm(16).action === 'keyroot' && M.decodePgm(16).arg === 0)
    check('pgm 27 -> keyroot 11', M.decodePgm(27).arg === 11)
    check('pgm 28 -> keymode maj', M.decodePgm(28).action === 'keymode' && M.decodePgm(28).arg === 'maj')
    check('pgm 29 -> keymode min', M.decodePgm(29).arg === 'min')
    check('pgm 99 -> none', M.decodePgm(99).action === 'none')

    /* --- CC -> param --- */
    check('cc 1 127 -> adventure 1.0', (() => {
      const r = M.ccToParam(1, 127)
      return r && r.param === 'adventure' && Math.abs(r.value - 1) < 1e-6
    })())
    check('cc 1 0 -> adventure 0', (() => {
      const r = M.ccToParam(1, 0)
      return r && r.value === 0
    })())
    check('cc 1 64 -> adventure ~0.5', (() => {
      const r = M.ccToParam(1, 64)
      return r && Math.abs(r.value - 64 / 127) < 1e-6
    })())
    check('cc unmapped -> null', M.ccToParam(74, 100) === null)

    /* --- Voicing level bands --- */
    const vb0 = M.voicingLevelBands(0.0)
    check('voicing 0 -> triads, no VL', vb0.triadsOnly === true && vb0.voiceLeading === false && eqArr(vb0.extensions, []))
    const vb3 = M.voicingLevelBands(0.3)
    check('voicing 0.3 -> triads + VL', vb3.triadsOnly === true && vb3.voiceLeading === true)
    const vb5 = M.voicingLevelBands(0.55)
    check('voicing 0.55 -> 7ths (triadsOnly false)', vb5.triadsOnly === false && eqArr(vb5.extensions, []))
    const vb1 = M.voicingLevelBands(1.0)
    check('voicing 1.0 -> extensions 9+13, drop2, wide spread', eqArr(vb1.extensions, [14, 21]) && vb1.drop2 === true && vb1.spreadCap >= 32)
    check('voicing spreadCap monotonic-ish', M.voicingLevelBands(1.0).spreadCap >= M.voicingLevelBands(0.0).spreadCap)

    /* --- Voice-distance positions --- */
    check('vd 0 -> off', M.voiceDistancePosition(0).name === 'off' && eqArr(M.voiceDistancePosition(0).steps, []))
    check('vd 1 -> last position', M.voiceDistancePosition(1).name === 'High+Low')
    check('vd has a +2 (3rd above) somewhere', M.VOICE_DISTANCE_POSITIONS.some((p) => eqArr(p.steps, [2])))
    check('vd has a -3 (4th below) somewhere', M.VOICE_DISTANCE_POSITIONS.some((p) => eqArr(p.steps, [-3])))
    check('vd 9 positions total (off + 8)', M.VOICE_DISTANCE_POSITIONS.length === 9)

    /* --- List selectors (Seed / Key root / Model) --- */
    check('seedFromDial 0 -> C:maj', M.seedFromDial(0) === 'C:maj', M.seedFromDial(0))
    check('seedFromDial 1 -> last seed', M.seedFromDial(1) === M.SEED_LIST[M.SEED_LIST.length - 1])
    check(
      'seedFromDial spans the whole list',
      (() => {
        const seen = new Set<string>()
        for (let i = 0; i <= 100; i++) seen.add(M.seedFromDial(i / 100))
        return seen.size === M.SEED_LIST.length
      })(),
      'not every seed reachable',
    )
    check('every seed is Root:quality', M.SEED_LIST.every((s) => /^[A-G][b#]?:[a-z0-9]+$/.test(s)))
    check('keyRootFromDial 0 -> 0 (C)', M.keyRootFromDial(0) === 0)
    check('keyRootFromDial 1 -> 11 (B)', M.keyRootFromDial(1) === 11)
    check(
      'keyRootFromDial in 0..11',
      [0, 0.25, 0.5, 0.75, 1].every((v) => {
        const r = M.keyRootFromDial(v)
        return Number.isInteger(r) && r >= 0 && r <= 11
      }),
    )
    check('12 key roots, C first', M.KEY_ROOTS.length === 12 && M.KEY_ROOTS[0] === 'C')
    check('modelFromDial 0 -> markov', M.modelFromDial(0) === 'markov')
    check('modelFromDial 1 -> lstm', M.modelFromDial(1) === 'lstm', M.modelFromDial(1))
    check('model list is markov/rnn/lstm', eqArr([...M.MODEL_LIST], ['markov', 'rnn', 'lstm']))
    check('pickFromList clamps out-of-range', M.pickFromList(['a', 'b'], 5) === 'b' && M.pickFromList(['a', 'b'], -5) === 'a')

    expect(failed, 'failed checks:\n  ' + failures.join('\n  ')).toBe(0)
    expect(passed).toBeGreaterThan(40)
  })
})
