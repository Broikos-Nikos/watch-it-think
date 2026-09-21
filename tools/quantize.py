"""Quantise the router to int8, and find out what it cost.

    python tools/quantize.py --test /path/to/test.jsonl

Twenty megabytes is a lot to send someone before they have decided whether they
care. Dynamic int8 quantisation takes it to about five, which is the difference
between a page that starts working and a page that is still downloading.

Quantisation is lossy, so the only question that matters is how lossy, and the
answer has to be measured on held out data rather than asserted. This runs both
graphs over whatever `--test` points at, and records in meta.json which file
that was, how many rows it held, how many were evaluated and which it hashed to.
The docstring used to say "the same 10,578 held out sentences", which is a
property of one invocation and not of this tool: `--test` takes any path and
`--limit` truncates.

Three numbers for each graph: intent accuracy, per word slot tag accuracy, and
the share of sentences where the intent and every tag are right together.

The rule, decided before running it: if int8 costs more than one point of intent
accuracy, ship fp32 and say why. A page that loads faster and answers worse is
not a better page.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from provenance import describe, repo_facts

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent

ACCURACY_BUDGET = 1.0  # percentage points of intent accuracy


def load_rows(path: Path, limit: int | None):
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
            if limit and len(rows) >= limit:
                break
    return rows


def evaluate(session, tok, meta, rows):
    """Intent accuracy, per word tag accuracy, and both right at once."""
    intents = meta["intents"]
    tags = meta["slotTags"]
    max_len = meta["maxLen"]
    intent_index = {name: i for i, name in enumerate(intents)}
    tag_index = {name: i for i, name in enumerate(tags)}

    n = 0
    intent_hits = 0
    tag_total = 0
    tag_hits = 0
    both = 0
    unseen_intents = set()
    # Two different counts have both been called "the held out set": the rows
    # read from the file, and the rows actually evaluated. They are equal on the
    # current data and there is nothing in the arithmetic that keeps them equal.
    skipped_empty = 0
    skipped_unseen = 0
    started = time.perf_counter()

    for row in rows:
        words = row["words"]
        if not words:
            skipped_empty += 1
            continue
        gold_intent = row["intent"]
        if gold_intent not in intent_index:
            unseen_intents.add(gold_intent)
            skipped_unseen += 1
            continue

        ids, cases, widx = tok.encode(words, max_len)
        out = session.run(
            None,
            {
                "ids": np.array([ids], dtype=np.int64),
                "cases": np.array([cases], dtype=np.int64),
            },
        )
        pred_intent = int(out[0][0].argmax())
        slot_logits = out[1][0]

        n += 1
        ok_intent = pred_intent == intent_index[gold_intent]
        intent_hits += ok_intent

        # The first sub token of each word carries that word's tag, which is how
        # the model was trained and the only position its prediction means
        # anything at.
        first_pos = {}
        for pos, w in enumerate(widx):
            if w >= 0 and w not in first_pos:
                first_pos[w] = pos

        ok_tags = True
        for w, gold_tag in enumerate(row["tags"]):
            pos = first_pos.get(w)
            if pos is None:
                continue  # the word fell outside max_len
            tag_total += 1
            pred_tag = int(slot_logits[pos].argmax())
            if gold_tag in tag_index and pred_tag == tag_index[gold_tag]:
                tag_hits += 1
            else:
                ok_tags = False

        both += ok_intent and ok_tags

    elapsed = time.perf_counter() - started
    return {
        "n": n,
        "intentAccuracy": round(100 * intent_hits / n, 2) if n else 0.0,
        "tagAccuracy": round(100 * tag_hits / tag_total, 2) if tag_total else 0.0,
        "exactMatch": round(100 * both / n, 2) if n else 0.0,
        "msPerSentence": round(1000 * elapsed / n, 2) if n else 0.0,
        "rowsRead": len(rows),
        "rowsEvaluated": n,
        "skippedEmptyWords": skipped_empty,
        "skippedUnseenIntent": skipped_unseen,
        "unseenIntents": sorted(unseen_intents),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", required=True, type=Path)
    ap.add_argument("--bslm-repo", required=True, type=Path)
    ap.add_argument("--model-dir", type=Path, default=PROJECT / "public" / "model")
    ap.add_argument("--fp32-dir", type=Path, default=PROJECT / "build-model")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    sys.path.insert(0, str(args.bslm_repo))
    from bslm.tokenizer import BPETokenizer  # noqa: E402

    import onnxruntime as ort
    from onnxruntime.quantization import quantize_dynamic, QuantType

    fp32 = args.fp32_dir / "router.onnx"
    int8 = args.model_dir / "router.int8.onnx"
    meta_path = args.model_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    tok = BPETokenizer.load(args.bslm_repo / "checkpoints" / "tokenizer.json")

    print(f"quantising {fp32.name} ({fp32.stat().st_size / 1e6:.1f} MB)")
    quantize_dynamic(
        model_input=str(fp32),
        model_output=str(int8),
        weight_type=QuantType.QInt8,
        # The attention output is a probability field the page draws. Quantising
        # the activations around it would show up as banding in something a
        # visitor is looking at directly, so only the weights are quantised.
        extra_options={"MatMulConstBOnly": True},
    )
    print(f"wrote {int8.name} ({int8.stat().st_size / 1e6:.1f} MB)")

    rows = load_rows(args.test, args.limit)
    test_set = describe(args.test, args.bslm_repo)
    # The page tells the visitor this is the adversarial split, so the claim is
    # checked against the file that was actually read rather than recalled.
    # bslm/benchmark.py:244, run_adversarial, reads data/test.jsonl.
    test_set["split"] = (
        "adversarial" if test_set.get("path") == "data/test.jsonl" else "unknown"
    )
    if args.limit:
        test_set["limit"] = args.limit
    print(f"test set: {test_set['path']}, {len(rows)} rows read, "
          f"split {test_set['split']}, sha256 {test_set['sha256'][:12]}\n")

    results = {}
    for name, path in (("fp32", fp32), ("int8", int8)):
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        r = evaluate(sess, tok, meta, rows)
        results[name] = r
        print(
            f"{name:5s} intent {r['intentAccuracy']:6.2f}%   "
            f"tags {r['tagAccuracy']:6.2f}%   "
            f"both {r['exactMatch']:6.2f}%   "
            f"{r['msPerSentence']:.2f} ms/sentence   n={r['n']}"
        )

    delta = round(results["int8"]["intentAccuracy"] - results["fp32"]["intentAccuracy"], 2)
    shrink = round(fp32.stat().st_size / int8.stat().st_size, 2)
    print(f"\nint8 costs {-delta:+.2f} points of intent accuracy and is {shrink}x smaller")

    ship_int8 = -delta <= ACCURACY_BUDGET
    print(
        f"budget is {ACCURACY_BUDGET} point, so shipping "
        + ("int8" if ship_int8 else "fp32, and the README says why")
    )

    if results["fp32"]["unseenIntents"]:
        print(
            f"\nnote: {len(results['fp32']['unseenIntents'])} intents in the test set "
            f"are not in the checkpoint and were skipped: "
            f"{', '.join(results['fp32']['unseenIntents'][:6])}"
        )

    meta["quantisation"] = {
        "measuredAt": time.strftime("%Y-%m-%d"),
        "testSet": test_set,
        "bslm": repo_facts(args.bslm_repo),
        "rowsRead": results["fp32"]["rowsRead"],
        "rowsEvaluated": results["fp32"]["rowsEvaluated"],
        "heldOutSentences": results["fp32"]["n"],
        "budgetPoints": ACCURACY_BUDGET,
        "fp32": {k: v for k, v in results["fp32"].items() if k != "unseenIntents"},
        "int8": {k: v for k, v in results["int8"].items() if k != "unseenIntents"},
        "intentAccuracyDelta": delta,
        "bytesFp32": fp32.stat().st_size,
        "bytesInt8": int8.stat().st_size,
        "shrink": shrink,
        "ships": "int8" if ship_int8 else "fp32",
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {meta_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
