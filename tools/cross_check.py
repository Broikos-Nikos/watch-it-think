"""The ONNX harness against the reference implementation, row by row.

    python tools/cross_check.py --bslm-repo /path/to/bslm --test /path/to/test.jsonl

Two questions, and they are different questions.

**Is this harness right.** 74.58 percent intent accuracy is lower than a router
of this kind sounds like it should be, so the harness was the first suspect
rather than the model. It is checked against `bslm.infer.Parser`, the
implementation the assistant actually ships on, over the same rows.

Row by row, not accuracy against accuracy. Two harnesses can reach the same
percentage while disagreeing on hundreds of rows in compensating directions, and
that is precisely the failure this is meant to exclude. What is reported is the
number of rows where the two argmax intents differ, which is a much harder
number to pass by accident.

**What the visitor is being told.** The deployed assistant abstains below
confidence 0.50 rather than guessing, and this page draws what the model
predicts, so the page quotes the argmax figure. The abstaining figure is lower
and it is the one a reader would meet if they used the assistant. Both are
recorded here, because quoting either alone is a different claim.

This file exists because the devlog asserted at tick 8 that both numbers were in
`meta.json` so neither could be quoted without the other, and neither was, and
the check that produced them had no script, no seed and no record of which rows
it ran on. A claim with no command behind it is the thing this workspace is
supposed to be against.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

from provenance import describe, repo_facts

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent

SEED = 20260921


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bslm-repo", required=True, type=Path)
    ap.add_argument("--test", type=Path, default=None)
    ap.add_argument("--model-dir", type=Path, default=PROJECT / "public" / "model")
    ap.add_argument("--fp32-dir", type=Path, default=PROJECT / "build-model")
    ap.add_argument("--rows", type=int, default=800)
    ap.add_argument("--threshold", type=float, default=0.50)
    ap.add_argument("--write", action="store_true",
                    help="record the result in meta.json")
    args = ap.parse_args()

    sys.path.insert(0, str(args.bslm_repo))
    from bslm.infer import Parser  # noqa: E402
    from bslm.tokenizer import BPETokenizer  # noqa: E402

    import onnxruntime as ort

    test = args.test or (args.bslm_repo / "data" / "test.jsonl")
    rows = [json.loads(l) for l in test.open(encoding="utf-8") if l.strip()]

    # The seed is the point. The original check ran on "the same 800 rows" and
    # nothing recorded which 800 they were, so it could not be re-run.
    random.Random(SEED).shuffle(rows)
    rows = rows[: args.rows]

    meta_path = args.model_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    # The reference is fp32 torch, so the fair comparison is the fp32 graph.
    # int8 is expected to disagree on a few rows: that difference is what the
    # quantisation block measures, and conflating the two would hide it.
    fp32 = args.fp32_dir / "router.onnx"
    graph = fp32 if fp32.exists() else args.model_dir / "router.int8.onnx"
    print(f"graph:     {graph.name}")
    print(f"reference: bslm.infer.Parser")
    print(f"rows:      {len(rows)} sampled from {test.name} with seed {SEED}\n")

    sess = ort.InferenceSession(str(graph), providers=["CPUExecutionProvider"])
    tok = BPETokenizer.load(args.bslm_repo / "checkpoints" / "tokenizer.json")
    parser = Parser(ckpt=args.bslm_repo / "checkpoints" / "bslm.pt",
                    tok=args.bslm_repo / "checkpoints" / "tokenizer.json")

    intents = meta["intents"]
    max_len = meta["maxLen"]

    disagreements = []
    onnx_hits = 0
    ref_argmax_hits = 0
    abstain_hits = 0
    abstained = 0
    n = 0

    for row in rows:
        words = row["words"]
        if not words:
            continue
        gold = row["intent"]
        n += 1

        ids, cases, _ = tok.encode(words, max_len)
        out = sess.run(None, {
            "ids": np.array([ids], dtype=np.int64),
            "cases": np.array([cases], dtype=np.int64),
        })
        onnx_intent = intents[int(out[0][0].argmax())]

        p = parser.parse(row["text"], threshold=args.threshold)

        if onnx_intent != p["raw_intent"]:
            disagreements.append({
                "text": row["text"], "onnx": onnx_intent, "reference": p["raw_intent"],
                "confidence": p["confidence"],
            })

        onnx_hits += onnx_intent == gold
        ref_argmax_hits += p["raw_intent"] == gold
        abstain_hits += p["intent"] == gold
        abstained += bool(p["below_threshold"])

    pct = lambda h: round(100 * h / n, 2) if n else 0.0
    print(f"onnx harness, argmax:              {pct(onnx_hits):6.2f}%   n={n}")
    print(f"reference Parser, argmax:          {pct(ref_argmax_hits):6.2f}%   n={n}")
    print(f"reference Parser, threshold {args.threshold:.2f}:    "
          f"{pct(abstain_hits):6.2f}%   abstains on {abstained} of {n}")
    print(f"\nrow by row argmax disagreements:   {len(disagreements)} of {n}")
    for d in disagreements[:5]:
        print(f"  {d['text'][:56]!r}")
        print(f"    onnx {d['onnx']}  reference {d['reference']}  conf {d['confidence']}")

    result = {
        "reference": "bslm.infer.Parser",
        "graph": graph.name,
        "seed": SEED,
        "rows": n,
        "testSet": describe(test, args.bslm_repo),
        "bslm": repo_facts(args.bslm_repo),
        "onnxArgmaxAccuracy": pct(onnx_hits),
        "referenceArgmaxAccuracy": pct(ref_argmax_hits),
        "argmaxDisagreements": len(disagreements),
        "withAbstain": {
            "threshold": args.threshold,
            "intentAccuracy": pct(abstain_hits),
            "abstained": abstained,
            "rows": n,
            "note": "the deployed assistant declines below this confidence rather "
                    "than guessing. The page quotes the argmax figure because the "
                    "page draws what the model predicts, and this is what the same "
                    "weights score when they are allowed to say nothing.",
        },
    }

    # The harness being right is the premise of every accuracy number this
    # project publishes, so a disagreement is a failure and not a note.
    if disagreements:
        print(f"\nFAIL: the harness and the reference disagree on {len(disagreements)} rows. "
              f"Every accuracy figure here rests on them agreeing.")
        return 2

    if args.write:
        meta.setdefault("quantisation", {})["crossCheck"] = result
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
        print(f"\nwrote {meta_path.name}")
    else:
        print("\nnot written: pass --write to record this in meta.json")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
