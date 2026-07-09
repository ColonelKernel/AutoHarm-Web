/** Engine constants.
 *
 * Markov/blend constants ported from the UPF repo's `python/src/config.py`;
 * neural (v3 session) constants from the reference repo's `config.py`.
 */

export const MODELS = ['markov', 'rnn', 'lstm'] as const
export type ModelName = (typeof MODELS)[number]
export const DEFAULT_MODEL: ModelName = 'markov'

export const FALLBACK_POLICIES = ['echo_input', 'global_top', 'random_source', 'error_only'] as const
export type FallbackPolicy = (typeof FALLBACK_POLICIES)[number]
export const DEFAULT_FALLBACK: FallbackPolicy = 'echo_input'

// --- Spice model tuning (see blend.ts) --------------------------------------
// Ordered single-corpus anchors for the Color dial: 0.0 = plainest (folk) ...
// 1.0 = spiciest (jazz).
export const COLOR_PATH = ['nottingham', 'pop909', 'bach', 'openbook'] as const
// Adventure -> sampling temperature tau. <1 sharpens, >1 flattens the tail.
export const ADVENTURE_TAU_MIN = 0.6
export const ADVENTURE_TAU_MAX = 1.8
// Dial defaults at startup.
export const DEFAULT_COLOR = 0.5
export const DEFAULT_ADVENTURE = 0.35
export const DEFAULT_KEY = 'C:maj'

// --- Cadence / harmonic-gravity bias (see blend.applyCadence) ---------------
export const DEFAULT_GRAVITY = 0.0
export const TONIC_PC: Readonly<Record<string, number>> = { maj: 0, min: 9 } // C / A
export const DOMINANT_PC: Readonly<Record<string, number>> = { maj: 7, min: 4 } // G / E
export const CADENCE_TONIC_BOOST = 3.0
export const CADENCE_DOMINANT_BOOST = 1.2

// --- Neural (JazzNet) defaults — protocol v3 --------------------------------
export const DEFAULT_NEURAL_TEMPERATURE = 1.5
export const DEFAULT_NEURAL_EXCLUDE_INPUT = true
export const SESSION_MODES = ['auto', 'stateless', 'session'] as const
export type SessionMode = (typeof SESSION_MODES)[number]
export const DEFAULT_SESSION_MODE: SessionMode = 'auto'
export const SESSION_MAX_STEPS = 64
export const SESSION_AUTO_FEED = true
