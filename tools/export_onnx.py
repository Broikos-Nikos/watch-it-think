"""Export the router to ONNX, with its attention as a real output.

    python tools/export_onnx.py --checkpoint /path/to/bslm.pt

The page is going to draw what the model attends to, so attention cannot be
inferred or approximated from the outside. It has to come out of the graph as a
named output. That is the only reason this file re-declares the architecture
instead of importing it: the original forward pass throws the attention away.

The re-declaration is the risk, so it is gated. The state dict is loaded into
this copy strictly, every tensor matched, and then the outputs are compared
against the original module running the same sentences. If the copy has drifted
by so much as a layer norm placement, the gate fails and nothing is written.

Outputs, into public/model/:
  router.onnx      the graph, fp32
  meta.json        intents, slot tags, config, and the parity numbers
  tokenizer.json   copied from next to the checkpoint
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent

# The gate: the largest absolute difference we will accept between the original
# module, this copy, and the exported graph, on real sentences.
PARITY_TOLERANCE = 1e-4


# --------------------------------------------------------------------------
# The architecture, re-declared so that attention can leave the building.
# This must stay identical to bslm/model.py. The parity gate is what proves it.
# --------------------------------------------------------------------------


class MultiHeadSelfAttention(nn.Module):
    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        self.h = n_heads
        self.dk = d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model)
        self.proj = nn.Linear(d_model, d_model)

    def forward(self, x, pad_mask):
        B, T, C = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)
        q = q.view(B, T, self.h, self.dk).transpose(1, 2)
        k = k.view(B, T, self.h, self.dk).transpose(1, 2)
        v = v.view(B, T, self.h, self.dk).transpose(1, 2)

        att = (q @ k.transpose(-2, -1)) / math.sqrt(self.dk)
        att = att.masked_fill(~pad_mask[:, None, None, :], float("-inf"))
        att = att.softmax(dim=-1)
        out = (att @ v).transpose(1, 2).reshape(B, T, C)
        # The second return value is the whole point of this file.
        return self.proj(out), att


class Block(nn.Module):
    def __init__(self, d_model: int, n_heads: int, d_ff: int):
        super().__init__()
        self.n1 = nn.LayerNorm(d_model)
        self.attn = MultiHeadSelfAttention(d_model, n_heads)
        self.n2 = nn.LayerNorm(d_model)
        self.ff = nn.Sequential(
            nn.Linear(d_model, d_ff), nn.GELU(), nn.Linear(d_ff, d_model), nn.Dropout(0.0)
        )

    def forward(self, x, pad_mask):
        delta, att = self.attn(self.n1(x), pad_mask)
        x = x + delta
        x = x + self.ff(self.n2(x))
        return x, att


class RouterWithAttention(nn.Module):
    def __init__(self, cfg: dict):
        super().__init__()
        d_model = cfg["d_model"]
        self.tok = nn.Embedding(cfg["vocab_size"], d_model, padding_idx=0)
        self.pos = nn.Embedding(cfg["max_len"], d_model)
        self.case = nn.Embedding(3, d_model)
        self.drop = nn.Dropout(0.0)
        self.blocks = nn.ModuleList(
            [Block(d_model, cfg["n_heads"], cfg["d_ff"]) for _ in range(cfg["n_layers"])]
        )
        self.norm = nn.LayerNorm(d_model)
        self.intent_head = nn.Sequential(
            nn.Linear(d_model, d_model), nn.GELU(), nn.Dropout(0.0),
            nn.Linear(d_model, cfg["n_intents"]),
        )
        self.slot_head = nn.Linear(d_model, cfg["n_slot_tags"])

    def forward(self, ids, cases):
        T = ids.shape[1]
        pad_mask = ids.ne(0)
        pos = torch.arange(T, device=ids.device)
        x = self.tok(ids) + self.pos(pos)[None] + self.case(cases)
        x = self.drop(x)

        atts = []
        for b in self.blocks:
            x, att = b(x, pad_mask)
            atts.append(att)

        x = self.norm(x)
        cls = x[:, 0]
        m = pad_mask.unsqueeze(-1).float()
        mean = (x * m).sum(1) / m.sum(1).clamp(min=1)
        intent_logits = self.intent_head(cls + mean)
        slot_logits = self.slot_head(x)
        # layers, batch, heads, query, key
        attention = torch.stack(atts, dim=0)
        return intent_logits, slot_logits, attention


# --------------------------------------------------------------------------
# Sentences the gate runs on. Real ones, both languages, spread over the task
# list, including the short ones where a single token decides the intent.
# --------------------------------------------------------------------------

GATE_SENTENCES = [
    "set an alarm for seven thirty tomorrow",
    "turn off the kitchen lights",
    "play something by Eleftheria Arvanitaki",
    "what is the weather in Thessaloniki tomorrow",
    "add milk and bread to the shopping list",
    "call my sister",
    "how far is Patras from Athens",
    "remind me to send the invoice on Friday",
    "what is forty seven times nine",
    "cancel the alarm",
    "dim the bedroom lights to twenty percent",
    "who wrote the Odyssey",
    "send a message to Maria saying I am running late",
    "stop the music",
    "βάλε ξυπνητήρι στις εφτά και μισή",
    "σβήσε τα φώτα στην κουζίνα",
    "τι καιρό κάνει αύριο στη Θεσσαλονίκη",
    "πρόσθεσε γάλα και ψωμί στη λίστα",
    "πάρε τηλέφωνο τη Μαρία",
    "σταμάτα τη μουσική",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--bslm-repo", type=Path, default=None,
                    help="the bslm repository, used only for the parity gate and the tokenizer")
    ap.add_argument("--out", type=Path, default=PROJECT / "public" / "model")
    args = ap.parse_args()

    repo = args.bslm_repo or args.checkpoint.resolve().parent.parent
    ck = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    cfg = dict(ck["cfg"])
    intents = list(ck["intents"])
    tags = list(ck["tags"])
    slots = list(ck["slots"])
    max_len = int(ck["max_len"])
    print(f"checkpoint: {sum(v.numel() for v in ck['model'].values()):,} parameters")
    print(f"cfg: {cfg}")

    # ---- build the copy and load the weights strictly -----------------
    model = RouterWithAttention(cfg).eval()
    model.load_state_dict(ck["model"], strict=True)
    print(f"state dict loaded strictly into the re-declared copy, {len(ck['model'])} tensors")

    # ---- the original, for comparison ---------------------------------
    sys.path.insert(0, str(repo))
    from bslm.model import BSLM  # noqa: E402
    from bslm.tokenizer import BPETokenizer, normalize, word_tokenize  # noqa: E402

    original = BSLM(**cfg).eval()
    original.load_state_dict(ck["model"], strict=True)

    tok = BPETokenizer.load(repo / "checkpoints" / "tokenizer.json")

    # ---- gate one: the copy against the original ----------------------
    worst_copy = 0.0
    samples = []
    for text in GATE_SENTENCES:
        words = [w for w, _, _ in word_tokenize(normalize(text))]
        ids, cases, widx = tok.encode(words, max_len)
        t_ids = torch.tensor([ids])
        t_cases = torch.tensor([cases])
        with torch.no_grad():
            oi, os_ = original(t_ids, t_cases)
            ci, cs, att = model(t_ids, t_cases)
        d = max(float((oi - ci).abs().max()), float((os_ - cs).abs().max()))
        worst_copy = max(worst_copy, d)
        samples.append((text, words, ids, cases, widx, oi, os_, att))

    print(f"gate 1, copy against original: max abs diff {worst_copy:.3e}")
    if worst_copy > PARITY_TOLERANCE:
        print("FAIL: the re-declared architecture does not match bslm/model.py")
        return 2

    # ---- export --------------------------------------------------------
    args.out.mkdir(parents=True, exist_ok=True)
    onnx_path = args.out / "router.onnx"
    example = samples[0]
    torch.onnx.export(
        model,
        (torch.tensor([example[2]]), torch.tensor([example[3]])),
        str(onnx_path),
        input_names=["ids", "cases"],
        output_names=["intent_logits", "slot_logits", "attention"],
        dynamic_axes={
            "ids": {1: "tokens"},
            "cases": {1: "tokens"},
            "slot_logits": {1: "tokens"},
            "attention": {3: "tokens", 4: "tokens"},
        },
        opset_version=17,
        dynamo=False,
    )
    size = onnx_path.stat().st_size
    print(f"exported {onnx_path.name}, {size / 1e6:.1f} MB")

    # ---- gate two: the graph against the original ----------------------
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    worst_onnx = 0.0
    worst_attention_row = 0.0
    for text, words, ids, cases, widx, oi, os_, att in samples:
        out = sess.run(None, {
            "ids": np.array([ids], dtype=np.int64),
            "cases": np.array([cases], dtype=np.int64),
        })
        d = max(
            float(np.abs(out[0] - oi.numpy()).max()),
            float(np.abs(out[1] - os_.numpy()).max()),
        )
        worst_onnx = max(worst_onnx, d)
        # Attention rows must still be distributions after the round trip.
        rows = out[2].sum(axis=-1)
        worst_attention_row = max(worst_attention_row, float(np.abs(rows - 1.0).max()))

    print(f"gate 2, graph against original: max abs diff {worst_onnx:.3e}")
    print(f"gate 3, attention rows sum to one: worst deviation {worst_attention_row:.3e}")
    if worst_onnx > PARITY_TOLERANCE or worst_attention_row > 1e-5:
        print("FAIL: the exported graph does not reproduce the model")
        onnx_path.unlink(missing_ok=True)
        return 2

    # ---- what the page needs alongside the graph ------------------------
    shutil.copy(repo / "checkpoints" / "tokenizer.json", args.out / "tokenizer.json")
    meta = {
        "exportedAt": __import__("datetime").date.today().isoformat(),
        "source": "bslm router, trained from random init, no pretrained weights",
        "parameters": int(sum(v.numel() for v in ck["model"].values())),
        "config": cfg,
        "maxLen": max_len,
        "intents": intents,
        "slotTags": tags,
        "slots": slots,
        "onnxBytes": size,
        "parity": {
            "tolerance": PARITY_TOLERANCE,
            "copyAgainstOriginal": worst_copy,
            "graphAgainstOriginal": worst_onnx,
            "attentionRowSumDeviation": worst_attention_row,
            "sentences": len(GATE_SENTENCES),
        },
    }
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8")
    print(f"wrote meta.json, {len(intents)} intents, {len(tags)} slot tags")
    print("all gates passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
