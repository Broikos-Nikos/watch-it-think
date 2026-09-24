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

_erf = np.vectorize(math.erf)
import torch.nn as nn

from provenance import describe, repo_facts

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent

# The gate: the largest absolute difference we will accept between the original
# module, this copy, and the exported graph, on real sentences.
PARITY_TOLERANCE = 1e-4

# Attention rows are a softmax output, so they sum to one by construction and a
# looser bound here would mean nothing. This is float32 rounding and nothing
# else, which is why gate 3 is labelled a sanity check wherever it is reported:
# a cube with its layers reversed passes it at exactly zero.
ROW_SUM_TOLERANCE = 1e-5


# Keys in the training config that describe the training run rather than the
# graph. Anything here is moved out of `config` and into `trainingOnly`.
TRAINING_ONLY = {"dropout"}


def attention_from_weights(sd, cfg, ids, cases, layer, head):
    """Recompute one attention field from the raw weights, in numpy.

    This is the only independent witness the attention tensor has.

    Gates 1 and 2 compare the intent and slot logits, and they cannot do more,
    because `bslm/model.py` throws attention away and has nothing to compare
    against. Gate 3 checks that the rows sum to one, which is true of any
    softmax output including a completely wrong one. So the tensor that is the
    entire reason this file re-declares the architecture was the one output
    nothing checked: reversing the layer order or rolling the head axis passed
    every gate here at 0.000e+00.

    Nothing below imports the model. It reads the state dict and follows the
    architecture by hand, so it fails if the layer index, the head index, the
    axis order, the scaling or the softmax is wrong anywhere in the chain.
    """
    d_model, n_heads = cfg["d_model"], cfg["n_heads"]
    dk = d_model // n_heads
    T = len(ids)

    x = (sd["tok.weight"][ids].numpy()
         + sd["pos.weight"][:T].numpy()
         + sd["case.weight"][cases].numpy())

    def layer_norm(v, w, b, eps=1e-5):
        m = v.mean(-1, keepdims=True)
        s = v.var(-1, keepdims=True)
        return (v - m) / np.sqrt(s + eps) * w + b

    def gelu(v):
        # The exact erf form, which is what nn.GELU() defaults to. The tanh
        # approximation differs by up to 4.1e-04, which is invisible at layer 0
        # because no feed forward has run yet, and then shows up from layer 1
        # onward as a ~2e-04 divergence that looks exactly like a broken export.
        # It cost this gate one false failure before the per layer numbers made
        # the cause obvious.
        return 0.5 * v * (1.0 + _erf(v / np.sqrt(2.0)))

    for L in range(cfg["n_layers"]):
        p_ = f"blocks.{L}."
        h = layer_norm(x, sd[p_ + "n1.weight"].numpy(), sd[p_ + "n1.bias"].numpy())
        qkv = h @ sd[p_ + "attn.qkv.weight"].numpy().T + sd[p_ + "attn.qkv.bias"].numpy()
        q, k, v = np.split(qkv, 3, axis=-1)
        q = q.reshape(T, n_heads, dk).transpose(1, 0, 2)
        k = k.reshape(T, n_heads, dk).transpose(1, 0, 2)
        v = v.reshape(T, n_heads, dk).transpose(1, 0, 2)

        scores = q @ k.transpose(0, 2, 1) / math.sqrt(dk)
        scores = scores - scores.max(-1, keepdims=True)
        att = np.exp(scores)
        att = att / att.sum(-1, keepdims=True)

        if L == layer:
            return att[head]

        out = (att @ v).transpose(1, 0, 2).reshape(T, d_model)
        x = x + out @ sd[p_ + "attn.proj.weight"].numpy().T + sd[p_ + "attn.proj.bias"].numpy()
        h2 = layer_norm(x, sd[p_ + "n2.weight"].numpy(), sd[p_ + "n2.bias"].numpy())
        ff = gelu(h2 @ sd[p_ + "ff.0.weight"].numpy().T + sd[p_ + "ff.0.bias"].numpy())
        x = x + ff @ sd[p_ + "ff.2.weight"].numpy().T + sd[p_ + "ff.2.bias"].numpy()

    raise ValueError(f"layer {layer} out of range")


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
#
# The last two are long on purpose. Until 2026-09-21 the numpy witness ran on
# the first four entries of this list, which are all English and 6 to 14
# tokens, while the comment above it claimed both languages and the page's own
# worst case is a 64 token context. Every sentence here was shorter than a
# quarter of that, so the witness had never checked a large field at all. These
# two are 63 and 62 tokens, which is as close to the 64 the page allows as a
# sentence gets without being truncated.
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
    "remind me to call my sister on Friday afternoon about the invoice for the "
    "kitchen lights and then add milk bread and coffee to the shopping list "
    "before the weather changes in Thessaloniki and cancel the alarm I set for "
    "seven thirty tomorrow morning and send Maria a message saying I am "
    "running late again and play something quiet",
    "πρόσθεσε γάλα ψωμί και καφέ στη λίστα για αύριο το πρωί και μετά βάλε "
    "ξυπνητήρι στις εφτά και μισή και σβήσε όλα τα φώτα στην κουζίνα και στο "
    "υπνοδωμάτιο και πες μου τι καιρό κάνει αύριο στη Θεσσαλονίκη και πάρε "
    "τηλέφωνο τη Μαρία να της πεις ότι άργησα πάλι και βάλε λίγη μουσική",
]


def is_greek(text: str) -> bool:
    """Any Greek letter, monotonic or polytonic."""
    return any("Ͱ" <= c <= "Ͽ" or "ἀ" <= c <= "῿" for c in text)


def witness_sample(samples):
    """Which sentences the numpy witness recomputes, and why those.

    The shortest and the longest of each language. Derived from the sentences
    rather than written as indices, because the defect this replaces was a
    literal slice, `samples[:4]`, that silently stopped meaning what its
    comment said the moment the list was reordered or extended.

    Four sentences, the same count as before, so the gate costs what it cost.
    What changes is that two of them are Greek and one of them is nearly a full
    context, which is what the comment had been claiming all along.
    """
    by_lang: dict[str, list[int]] = {}
    for i, s in enumerate(samples):
        by_lang.setdefault("el" if is_greek(s[0]) else "en", []).append(i)

    picked: list[int] = []
    for lang in sorted(by_lang):
        idx = sorted(by_lang[lang], key=lambda i: len(samples[i][2]))
        picked += [idx[0], idx[-1]]
    return sorted(set(picked))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, type=Path)
    ap.add_argument("--bslm-repo", type=Path, default=None,
                    help="the bslm repository, used only for the parity gate and the tokenizer")
    ap.add_argument("--out", type=Path, default=PROJECT / "public" / "model",
                    help="what the page fetches: meta.json and tokenizer.json")
    ap.add_argument(
        "--fp32-out",
        type=Path,
        default=PROJECT / "build-model",
        help=(
            "the fp32 graph, an intermediate. Deliberately outside the served tree: "
            "it is 20 MB, the page never loads it, and it was being copied into dist."
        ),
    )
    ap.add_argument(
        "--exporter",
        choices=("dynamo", "torchscript"),
        default="torchscript",
        help=(
            "the legacy TorchScript path, or the torch.export based one. Read D6 in "
            "DECISIONS.md before changing the default: dynamo passes every parity gate "
            "in this file and then produces a graph onnxruntime cannot quantise, and "
            "int8 is what the page actually loads."
        ),
    )
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
    args.fp32_out.mkdir(parents=True, exist_ok=True)
    onnx_path = args.fp32_out / "router.onnx"
    example = samples[0]
    ex = (torch.tensor([example[2]]), torch.tensor([example[3]]))
    names = dict(
        input_names=["ids", "cases"],
        output_names=["intent_logits", "slot_logits", "attention"],
    )

    if args.exporter == "dynamo":
        # torch.export based, the default since torch 2.9. The token axis is
        # dynamic because the page tokenizes whatever is typed, and a graph
        # baked to the length of one example sentence is useless.
        tokens = torch.export.Dim("tokens", min=2, max=cfg["max_len"])
        torch.onnx.export(
            model, ex, str(onnx_path),
            dynamic_shapes={"ids": {1: tokens}, "cases": {1: tokens}},
            opset_version=18, dynamo=True, **names,
        )
    else:
        torch.onnx.export(
            model, ex, str(onnx_path),
            dynamic_axes={
                "ids": {1: "tokens"},
                "cases": {1: "tokens"},
                "slot_logits": {1: "tokens"},
                "attention": {3: "tokens", 4: "tokens"},
            },
            opset_version=17, dynamo=False, **names,
        )
    print(f"exporter: {args.exporter}")
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

    # ---- gate four: the attention itself, against an independent witness ---
    #
    # Every layer and every head, recomputed from the raw weights in numpy, on
    # the shortest and longest sentence of each language. This is what makes
    # the layer index, the head index and the axis order checkable at all.
    witness = witness_sample(samples)

    # The gate on the gate. The sample above is chosen by a function, and the
    # claim made about it downstream is that it covers both languages and the
    # longest sentence there is. Nothing checked that before, which is exactly
    # how this gate spent nine ticks reading four English sentences under a
    # comment that said otherwise. An assertion is cheaper than a comment.
    witness_langs = {"el" if is_greek(samples[i][0]) else "en" for i in witness}
    longest = max(range(len(samples)), key=lambda i: len(samples[i][2]))
    if witness_langs != {"el", "en"} or longest not in witness:
        print(f"FAIL: the witness sample is {sorted(witness_langs)} and "
              f"{'includes' if longest in witness else 'excludes'} the longest "
              f"sentence. It must cover both languages and the longest.")
        return 2

    witness_tokens = [len(samples[i][2]) for i in witness]
    worst_att = 0.0
    checked = 0
    value_sum = 0.0
    value_n = 0
    for text, words, ids, cases, widx, oi, os_, att in (samples[i] for i in witness):
        out = sess.run(None, {
            "ids": np.array([ids], dtype=np.int64),
            "cases": np.array([cases], dtype=np.int64),
        })
        cube = out[2]
        for layer in range(cfg["n_layers"]):
            for head in range(cfg["n_heads"]):
                want = attention_from_weights(ck["model"], cfg, ids, cases, layer, head)
                got = cube[layer, 0, head]
                worst_att = max(worst_att, float(np.abs(got - want).max()))
                checked += 1
                # The scale the tolerance is judged against. A tight absolute
                # difference means nothing without it: on a quantity that is
                # always near zero it would be free.
                value_sum += float(want.sum())
                value_n += want.size

    value_mean = value_sum / value_n if value_n else 0.0
    print(f"gate 4, attention against an independent numpy witness: "
          f"max abs diff {worst_att:.3e} over {checked} fields, "
          f"{value_n:,} values, mean value {value_mean:.4f}")
    print(f"        sample: {len(witness)} sentences, {sorted(witness_langs)}, "
          f"{min(witness_tokens)} to {max(witness_tokens)} tokens, "
          f"up to {max(witness_tokens) ** 2:,} cells a field")

    if worst_onnx > PARITY_TOLERANCE or worst_attention_row > ROW_SUM_TOLERANCE or worst_att > PARITY_TOLERANCE:
        print("FAIL: the exported graph does not reproduce the model")
        onnx_path.unlink(missing_ok=True)
        return 2

    # ---- what the page needs alongside the graph ------------------------
    shutil.copy(repo / "checkpoints" / "tokenizer.json", args.out / "tokenizer.json")
    # A re-export invalidates any quantisation numbers already in meta.json,
    # because they describe a graph that no longer exists. Dropping them is
    # correct and doing it silently is not: it happened once and was noticed
    # only by the file getting smaller.
    meta_path = args.out / "meta.json"
    if meta_path.exists():
        try:
            previous = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous = {}
        if "quantisation" in previous:
            print("note: dropping the quantisation block, it described the previous graph.")
            print("      run tools/quantize.py again before shipping.")

    meta = {
        "exporter": args.exporter,
        "source": "bslm router, trained from random init, no pretrained weights",
        # Which files these numbers were made from. Two of them cannot be
        # obtained from the repository that holds them, and the record says so
        # rather than leaving a reader to discover it. See tools/provenance.py.
        "inputs": {
            "bslm": repo_facts(repo),
            "checkpoint": describe(args.checkpoint, repo),
            "architecture": describe(repo / "bslm" / "model.py", repo),
            "vocabulary": describe(repo / "checkpoints" / "tokenizer.json", repo),
        },
        "parameters": int(sum(v.numel() for v in ck["model"].values())),
        # The architecture the graph has, and only that.
        #
        # This used to be `cfg` verbatim, which carries `dropout` from the
        # training run. An exported graph has no dropout in it at all: it is a
        # training time regulariser and it leaves no node behind. A reader of
        # meta.json was told the shipped model has dropout 0.1, and it has none,
        # sitting in a block where everything else is measured. The measurement
        # audit's line: the two fields that are transcribed look measured too.
        "config": {k: v for k, v in cfg.items() if k not in TRAINING_ONLY},
        # Kept rather than dropped, because it is true of the run that produced
        # the weights and somebody will want it. Named for what it describes.
        "trainingOnly": {k: v for k, v in cfg.items() if k in TRAINING_ONLY},
        "maxLen": max_len,
        "intents": intents,
        "slotTags": tags,
        "slots": slots,
        "onnxBytes": size,
        # Each gate carries its own sample and its own tolerance. They used to
        # share one `tolerance` and one `sentences`, and both were wrong for
        # two of the four: gate 3 is gated ten times tighter, and the witness
        # saw four sentences rather than all of them. Four small numbers in a
        # row read as four pieces of evidence, so each one has to say what it
        # is evidence of.
        "parity": {
            "copyAgainstOriginal": {
                "value": worst_copy,
                "tolerance": PARITY_TOLERANCE,
                "sentences": len(GATE_SENTENCES),
                "note": "the re-declared architecture against bslm/model.py",
            },
            "graphAgainstOriginal": {
                "value": worst_onnx,
                "tolerance": PARITY_TOLERANCE,
                "sentences": len(GATE_SENTENCES),
                "note": "the exported graph against the module it came from",
            },
            "attentionRowSumDeviation": {
                "value": worst_attention_row,
                "tolerance": ROW_SUM_TOLERANCE,
                "sentences": len(GATE_SENTENCES),
                "note": "a sanity check on the softmax, not on the fields. "
                        "Any attention cube passes this, including a wrong "
                        "one: a cube with its layers reversed passes at 0.",
            },
            "attentionAgainstNumpyWitness": {
                "value": worst_att,
                "tolerance": PARITY_TOLERANCE,
                "sentences": len(witness),
                "languages": sorted(witness_langs),
                "sentenceTokens": witness_tokens,
                "fields": checked,
                "values": value_n,
                "valueMean": value_mean,
                "note": "every layer and head recomputed from the raw weights "
                        "in numpy. The tolerance is the one that means "
                        "something: reversing the layers or rolling the head "
                        "axis fails it at about 9.8e-01.",
            },
        },
    }
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8")
    print(f"wrote meta.json, {len(intents)} intents, {len(tags)} slot tags")
    print("all gates passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
