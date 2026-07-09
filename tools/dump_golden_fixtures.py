#!/usr/bin/env python3
"""Dump golden fixtures from the original Python engine for the TS port tests.

Imports the UPF Autoharmonizer repo's `python/src` and records exact outputs of
the deterministic (non-sampling) functions: color_weights, temperature,
_apply_temperature, _apply_cadence, blended_choices, key parsing/transposition,
and corpus normalization spot checks. Written to test/fixtures/*.json.

Usage:
    python3 tools/dump_golden_fixtures.py \
        [--source "/Users/zacharyscheffler/Desktop/UPF Autoharmonizer Maxpatch"]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_SOURCE = "/Users/zacharyscheffler/Desktop/UPF Autoharmonizer Maxpatch"
HERE = Path(__file__).resolve().parent
FIXTURES_DIR = HERE.parent / "test" / "fixtures"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="Path to the UPF Autoharmonizer repo")
    args = ap.parse_args()

    source = Path(args.source)
    sys.path.insert(0, str(source / "python"))

    from src import blend  # noqa: E402
    from src.chord_vocab import (  # noqa: E402
        parse_key,
        transpose_offset,
        key_offset,
        transpose_chord,
        CANON_ROOT,
    )
    from src.corpus_loader import load_corpora  # noqa: E402

    corpora = load_corpora(source / "data" / "markov_corpora_t.json")
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    # --- color_weights over a c grid x corpus subsets -------------------------
    subsets = [
        None,  # no filter
        ["nottingham", "pop909", "bach", "openbook"],
        ["nottingham", "pop909", "openbook"],  # bach missing
        ["pop909"],  # single corpus
        ["bach", "openbook"],
        [],  # nothing available
    ]
    color_cases = []
    for si, available in enumerate(subsets):
        for step in range(0, 21):
            c = step / 20.0
            w = blend.color_weights(c, available=available)
            color_cases.append({
                "c": c,
                "available": available,
                "weights": [[k, v] for k, v in w.items()],  # preserve insertion order
            })
    (FIXTURES_DIR / "color_weights.json").write_text(json.dumps(color_cases, indent=1))

    # --- temperature mapping ---------------------------------------------------
    temp_cases = [{"a": step / 20.0, "tau": blend.temperature(step / 20.0)} for step in range(0, 21)]
    (FIXTURES_DIR / "temperature.json").write_text(json.dumps(temp_cases, indent=1))

    # --- _apply_temperature / _apply_cadence on real distributions -------------
    reshape_cases = []
    probe = [
        ("pop909", "C:maj"), ("pop909", "A:min"), ("nottingham", "C:maj"),
        ("bach", "C:maj"), ("openbook", "C:maj7"), ("openbook", "G:7"),
        ("all", "D:min7"), ("all", "E:min"),
    ]
    for corpus_name, source_chord in probe:
        table = corpora.corpora[corpus_name]
        dist = table.dist_by_source.get(source_chord)
        if not dist:
            continue
        for tau in (0.6, 1.0, 1.02, 1.8):
            tempered = blend._apply_temperature(dist, tau)
            for mode in ("maj", "min"):
                for gravity in (0.0, 0.5, 1.0):
                    caded = blend._apply_cadence(tempered, mode, gravity)
                    reshape_cases.append({
                        "corpus": corpus_name,
                        "source": source_chord,
                        "tau": tau,
                        "mode": mode,
                        "gravity": gravity,
                        "choices": [[t, p] for t, p in caded],
                    })
    (FIXTURES_DIR / "temperature_cadence.json").write_text(json.dumps(reshape_cases, indent=1))

    # --- full blended_choices pipeline -----------------------------------------
    pipeline_cases = []
    combos = [
        ("C:maj", "C:maj", 0.0, 0.35, 0.0),
        ("C:maj", "C:maj", 0.5, 0.35, 0.0),
        ("C:maj", "C:maj", 1.0, 0.35, 0.0),
        ("C:maj", "C:maj", 0.33, 1.0, 0.5),
        ("G:7", "C:maj", 1.0, 0.0, 0.0),
        ("G:7", "C:maj", 0.66, 0.5, 1.0),
        ("A:min", "A:min", 0.5, 0.35, 0.0),
        ("E:min", "G:maj", 0.25, 0.6, 0.3),
        ("D:maj", "D:maj", 0.1, 0.2, 0.0),
        ("Bb:maj7", "F:maj", 0.9, 0.8, 0.2),
        ("F#:min7", "E:maj", 1.0, 0.5, 0.0),
        ("C:maj7", "C:maj", 0.75, 0.4, 0.0),
        ("D:min7", "C:maj", 0.66, 0.35, 0.0),
        ("Eb:maj", "Eb:maj", 0.4, 0.7, 0.8),
        ("B:hdim7", "C:maj", 1.0, 0.35, 0.0),
        ("G:min", "Bb:maj", 0.85, 0.45, 0.1),
        ("Z:xx", "C:maj", 0.5, 0.35, 0.0),        # unknown chord -> []
        ("C#:sus4", "C#:maj", 0.2, 0.9, 0.0),      # likely unknown in window
        ("A:7", "D:min", 0.7, 0.3, 0.6),
        ("F:maj", "F:maj", 0.0, 1.0, 1.0),
    ]
    for chord, key, color, adventure, gravity in combos:
        norm_in, offset = blend.normalize_to_key(chord, key)
        weights = blend.color_weights(color, available=corpora.names())
        tau = blend.temperature(adventure)
        _, mode = parse_key(key)
        choices = blend.blended_choices(corpora, weights, tau, norm_in, mode, gravity)
        pipeline_cases.append({
            "chord": chord, "key": key, "color": color, "adventure": adventure,
            "gravity": gravity,
            "normIn": norm_in, "offset": offset, "mode": mode, "tau": tau,
            "weights": [[k, v] for k, v in weights.items()],
            "choices": [[t, p] for t, p in choices],
            "choicesBack": [[transpose_chord(t, -offset), p] for t, p in choices],
        })
    (FIXTURES_DIR / "blended_choices.json").write_text(json.dumps(pipeline_cases, indent=1))

    # --- key parsing / transposition -------------------------------------------
    key_cases = []
    for key_str in [
        "C:maj", "A:min", "Am", "Gm", "Eb major", "F# minor", "Bb", "C", "",
        "  D:min ", "H:maj", "junk", "E", "Fb:maj", "B#:min", "Db major",
    ]:
        tonic_pc, mode = parse_key(key_str)
        key_cases.append({
            "key": key_str,
            "tonicPc": tonic_pc,
            "mode": mode,
            "offset": key_offset(key_str),
        })
    all_keys = []
    for pc in range(12):
        for mode in ("maj", "min"):
            all_keys.append({
                "tonicPc": pc, "mode": mode, "offset": transpose_offset(pc, mode),
            })
    transpose_cases = []
    for chord in ["C:maj", "Bb:maj7", "F#:min7", "N", "-", "", "B:hdim7", "Ab:7", "X:maj"]:
        for off in range(-6, 7):
            transpose_cases.append({
                "chord": chord, "offset": off, "result": transpose_chord(chord, off),
            })
    (FIXTURES_DIR / "keys_transpose.json").write_text(json.dumps({
        "parseKey": key_cases,
        "transposeOffset": all_keys,
        "transposeChord": transpose_cases,
        "canonRoot": list(CANON_ROOT),
    }, indent=1))

    # --- corpus normalization spot checks ---------------------------------------
    spot = {}
    for corpus_name in ("pop909", "nottingham", "bach", "openbook", "all"):
        table = corpora.corpora[corpus_name]
        entry = {}
        for src_chord in ("C:maj", "G:7", "A:min"):
            dist = table.dist_by_source.get(src_chord)
            if dist:
                entry[src_chord] = {
                    "total": table.total_by_source[src_chord],
                    "dist": [[t, p] for t, p in dist.items()],
                }
        spot[corpus_name] = entry
    spot["globalFallbackTop10"] = [[t, p] for t, p in corpora.global_fallback[:10]]
    spot["names"] = corpora.names()
    (FIXTURES_DIR / "corpus_spot.json").write_text(json.dumps(spot, indent=1))

    print(f"Wrote fixtures to {FIXTURES_DIR}")
    for f in sorted(FIXTURES_DIR.glob("*.json")):
        print(f"  {f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
