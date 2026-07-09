#!/usr/bin/env python3
"""Export the JazzNet RNN/LSTM checkpoints to ONNX for onnxruntime-web.

Reads the checkpoints + chords.json from the UPF Autoharmonizer repo, rebuilds
the exact vocab (sorted-set ordering: pad=0, <BOS>=1, <EOS>=2), wraps the
models in ONNX-clean forwards, exports single graphs with explicit hidden-state
inputs/outputs, verifies torch vs onnxruntime logit parity, and dumps fixture
logits for the TS inference tests.

Outputs:
    public/data/jazznet/vocab.json
    public/data/jazznet/rnn.onnx
    public/data/jazznet/lstm.onnx
    test/fixtures/neural_logits.json

Pitfalls handled here:
  - pack_padded_sequence/pad_packed_sequence do not export to ONNX; for
    batch-1 full-length inference they are a no-op, so the LSTM wrapper calls
    the raw nn.LSTM directly (parity is asserted below).
  - PyTorch >= 2.6 flipped torch.load's weights_only default; pass it
    explicitly.
  - Without explicit input/output names ORT invents "onnx::RNN_1"-style names;
    we pin tokens/h0/c0/logits/hn/cn.
  - Dropout must be disabled (eval()) before export or logits won't match.
  - hidden=None in torch equals explicit zero hidden; asserted below so the
    web runtime can always pass zeros on the first step.

Usage:
    python3 tools/export_onnx.py \
        [--source "/Users/zacharyscheffler/Desktop/UPF Autoharmonizer Maxpatch"] \
        [--epoch 35]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

DEFAULT_SOURCE = "/Users/zacharyscheffler/Desktop/UPF Autoharmonizer Maxpatch"
HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "public" / "data" / "jazznet"
FIXTURES_DIR = HERE.parent / "test" / "fixtures"


def build_vocab(chords_path: Path) -> dict:
    """Rebuild the vocab exactly like jazznet_vocab.load_vocab."""
    raw = json.loads(chords_path.read_text())
    sequences = [["<BOS>"] + seq + ["<EOS>"] for seq in raw]
    chord_vocab = sorted({chord for seq in sequences for chord in seq})
    tokens = ["pad"] + chord_vocab  # index order 0..N
    bos_idx = tokens.index("<BOS>")
    eos_idx = tokens.index("<EOS>")
    return {
        "tokens": tokens,
        "bosIdx": bos_idx,
        "eosIdx": eos_idx,
        "padIdx": 0,
        "vocabSize": len(tokens),
    }


def load_checkpoint_state(path: Path) -> dict:
    try:
        payload = torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:  # very old torch without weights_only
        payload = torch.load(path, map_location="cpu")
    if isinstance(payload, dict) and "model_state_dict" in payload:
        return payload["model_state_dict"]
    return payload


class RnnExport(nn.Module):
    """ONNX-clean wrapper: (tokens, h0) -> (logits, hn)."""

    def __init__(self, vocab_size: int, embedding_dim: int, hidden_dim: int, n_layers: int):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        self.rnn = nn.RNN(embedding_dim, hidden_dim, num_layers=n_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, vocab_size)

    def forward(self, tokens, h0):
        embedded = self.embedding(tokens)
        output, hn = self.rnn(embedded, h0)
        return self.fc(output), hn


class LstmExport(nn.Module):
    """ONNX-clean wrapper: (tokens, h0, c0) -> (logits, hn, cn).

    Drops pack_padded_sequence (not exportable; a no-op for batch-1
    full-length input — parity asserted at export time).
    """

    def __init__(self, vocab_size: int, embedding_dim: int, hidden_dim: int, n_layers: int):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.lstm = nn.LSTM(embedding_dim, hidden_dim, num_layers=n_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, vocab_size)

    def forward(self, tokens, h0, c0):
        embedded = self.embedding(tokens)
        output, (hn, cn) = self.lstm(embedded, (h0, c0))
        return self.fc(output), hn, cn


def remap_state(state: dict, kind: str) -> dict:
    """Map the original module names (rnn./lstm.) onto the export wrappers.

    The wrappers use the same submodule names, so the state dict loads as-is —
    except dropout, which has no parameters. Strict load verifies coverage.
    """
    return state


def export_model(kind: str, source: Path, epoch: int, vocab: dict, hparams: dict) -> Path:
    vocab_size = vocab["vocabSize"]
    embedding_dim = hparams.get("embedding_dim", 48)
    hidden_dim = hparams.get("hidden_dim", 128)
    n_layers = hparams.get("n_layers", 2)

    if kind == "rnn":
        ckpt = source / "data" / "jazznet" / "checkpoints" / "rnn" / f"baselineRNN-epoch{epoch}.pt"
        model = RnnExport(vocab_size, embedding_dim, hidden_dim, n_layers)
        input_names = ["tokens", "h0"]
        output_names = ["logits", "hn"]
    else:
        ckpt = source / "data" / "jazznet" / "checkpoints" / "lstm" / f"ChordLSTM-epoch{epoch}.pt"
        model = LstmExport(vocab_size, embedding_dim, hidden_dim, n_layers)
        input_names = ["tokens", "h0", "c0"]
        output_names = ["logits", "hn", "cn"]

    if not ckpt.is_file():
        raise FileNotFoundError(f"checkpoint not found: {ckpt}")

    state = load_checkpoint_state(ckpt)
    model.load_state_dict(remap_state(state, kind), strict=True)
    model.eval()  # dropout OFF — mandatory before export

    tokens = torch.LongTensor([[vocab["bosIdx"], 5]])
    h0 = torch.zeros(n_layers, 1, hidden_dim)
    args = (tokens, h0) if kind == "rnn" else (tokens, h0, torch.zeros(n_layers, 1, hidden_dim))

    out_path = OUT_DIR / f"{kind}.onnx"
    dynamic_axes = {"tokens": {1: "seq"}, "logits": {1: "seq"}}
    try:
        torch.onnx.export(
            model, args, str(out_path),
            input_names=input_names, output_names=output_names,
            dynamic_axes=dynamic_axes, opset_version=17, dynamo=False,
        )
    except TypeError:  # older torch without the dynamo kwarg
        torch.onnx.export(
            model, args, str(out_path),
            input_names=input_names, output_names=output_names,
            dynamic_axes=dynamic_axes, opset_version=17,
        )
    return out_path


def original_forward(kind: str, source: Path, epoch: int, vocab: dict, hparams: dict):
    """Rebuild the ORIGINAL model classes (with packing) for parity checks."""
    sys.path.insert(0, str(Path("/Volumes/Mac-Storage/GitHub/autoharmonizer-max/python")))
    from src.engines.jazznet_models import BaselineRNN, ChordLSTM  # noqa: E402

    vocab_size = vocab["vocabSize"]
    if kind == "rnn":
        model = BaselineRNN(vocab_size, hparams.get("embedding_dim", 48), hparams.get("hidden_dim", 128), vocab_size, hparams.get("n_layers", 2), dropout=hparams.get("dropout", 0.3))
        ckpt = source / "data" / "jazznet" / "checkpoints" / "rnn" / f"baselineRNN-epoch{epoch}.pt"
    else:
        model = ChordLSTM(vocab_size, hparams.get("embedding_dim", 48), hparams.get("hidden_dim", 128), vocab_size, hparams.get("n_layers", 2), dropout=hparams.get("dropout", 0.3), padding_idx=0)
        ckpt = source / "data" / "jazznet" / "checkpoints" / "lstm" / f"ChordLSTM-epoch{epoch}.pt"
    model.load_state_dict(load_checkpoint_state(ckpt))
    model.eval()

    def run(tokens: list[int], hidden=None):
        x = torch.LongTensor([tokens])
        with torch.no_grad():
            if kind == "rnn":
                out, hn = model(x, hidden)
                return out, hn
            lengths = torch.tensor([len(tokens)])
            out, hn = model(x, lengths, hidden)
            return out, hn

    return run


def verify_and_dump(kind: str, onnx_path: Path, source: Path, epoch: int, vocab: dict, hparams: dict) -> list[dict]:
    import onnxruntime as ort

    n_layers = hparams.get("n_layers", 2)
    hidden_dim = hparams.get("hidden_dim", 128)
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    torch_run = original_forward(kind, source, epoch, vocab, hparams)

    zeros = np.zeros((n_layers, 1, hidden_dim), dtype=np.float32)

    def ort_run(tokens: list[int], h=None, c=None):
        feeds = {
            "tokens": np.array([tokens], dtype=np.int64),
            "h0": h if h is not None else zeros,
        }
        if kind == "lstm":
            feeds["c0"] = c if c is not None else zeros
        outs = sess.run(None, feeds)
        return outs  # logits, hn(, cn)

    fixtures = []
    bos = vocab["bosIdx"]
    probe_tokens = [3, 10, 25, 60, 100]  # arbitrary in-vocab chord indices

    for tok in probe_tokens:
        # --- from-context call: [BOS, tok] with zero hidden ------------------
        t_out, t_hidden = torch_run([bos, tok], None)
        o = ort_run([bos, tok])
        o_logits = o[0]
        np.testing.assert_allclose(
            t_out.numpy(), o_logits, atol=1e-4,
            err_msg=f"{kind}: from-context logits mismatch for token {tok}",
        )

        # torch hidden=None == explicit zeros (web runtime always passes zeros)
        t_out_z, _ = torch_run([bos, tok], _zeros_hidden(kind, n_layers, hidden_dim))
        np.testing.assert_allclose(t_out.numpy(), t_out_z.numpy(), atol=0,
                                   err_msg=f"{kind}: hidden=None != zero hidden")

        # --- carried-hidden step: feed [tok+1] with the hidden from above ----
        step_tok = tok + 1
        t_step_out, _ = torch_run([step_tok], t_hidden)
        if kind == "rnn":
            o_step = ort_run([step_tok], h=o[1])
        else:
            o_step = ort_run([step_tok], h=o[1], c=o[2])
        np.testing.assert_allclose(
            t_step_out.numpy(), o_step[0], atol=1e-4,
            err_msg=f"{kind}: carried-hidden step logits mismatch for token {step_tok}",
        )

        fixtures.append({
            "kind": kind,
            "contextTokens": [bos, tok],
            "contextLogitsLast": o_logits[0][-1].astype(float).tolist(),
            "stepToken": step_tok,
            "stepLogitsLast": o_step[0][0][-1].astype(float).tolist(),
        })

    print(f"  {kind}: torch<->onnxruntime parity OK ({len(probe_tokens)} contexts + steps)")
    return fixtures


def _zeros_hidden(kind: str, n_layers: int, hidden_dim: int):
    h = torch.zeros(n_layers, 1, hidden_dim)
    return h if kind == "rnn" else (h, h.clone())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--epoch", type=int, default=35)
    args = ap.parse_args()
    source = Path(args.source)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    chords_path = source / "data" / "jazznet" / "chords.json"
    meta_path = source / "data" / "jazznet" / "metadata.json"
    hparams = {}
    if meta_path.is_file():
        hparams = json.loads(meta_path.read_text()).get("hyperparameters", {})

    vocab = build_vocab(chords_path)
    assert vocab["bosIdx"] == 1 and vocab["eosIdx"] == 2, "unexpected vocab ordering"
    vocab_out = dict(vocab)
    vocab_out["hyperparameters"] = {
        "embedding_dim": hparams.get("embedding_dim", 48),
        "hidden_dim": hparams.get("hidden_dim", 128),
        "n_layers": hparams.get("n_layers", 2),
    }
    (OUT_DIR / "vocab.json").write_text(json.dumps(vocab_out))
    print(f"vocab: {vocab['vocabSize']} tokens (BOS={vocab['bosIdx']}, EOS={vocab['eosIdx']})")

    all_fixtures = []
    for kind in ("rnn", "lstm"):
        path = export_model(kind, source, args.epoch, vocab, hparams)
        print(f"exported {path} ({path.stat().st_size} bytes)")
        all_fixtures += verify_and_dump(kind, path, source, args.epoch, vocab, hparams)

    (FIXTURES_DIR / "neural_logits.json").write_text(json.dumps({
        "vocabSize": vocab["vocabSize"],
        "bosIdx": vocab["bosIdx"],
        "eosIdx": vocab["eosIdx"],
        "cases": all_fixtures,
    }))
    print(f"fixtures -> {FIXTURES_DIR / 'neural_logits.json'}")


if __name__ == "__main__":
    main()
