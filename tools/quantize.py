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

# Every latency number here is taken at this thread count, and it is recorded
# next to them. A timing without a thread count cannot be compared to anything.
THREADS = 1

# The confidence below which bslm.infer.Parser answers "oos" instead of
# guessing, chosen upstream on 2026-09-06 from a sweep and documented at
# bslm/infer.py:45. It is recorded here because a figure measured with an
# abstain rule means nothing without the rule's number next to it.
ABSTAIN_THRESHOLD = 0.50


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
    # One timing per inference, not one stopwatch around the whole loop. The
    # old number divided a total by a count, which silently included
    # tokenization and gave a mean with no spread, on a quantity whose spread
    # is the entire story: this loop runs sentences from 2 to 64 tokens and
    # latency grows with the square of that.
    run_ms: list[float] = []
    abstain_hits = 0
    abstained = 0

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
        feeds = {
            "ids": np.array([ids], dtype=np.int64),
            "cases": np.array([cases], dtype=np.int64),
        }
        t0 = time.perf_counter()
        out = session.run(None, feeds)
        run_ms.append(1000 * (time.perf_counter() - t0))
        pred_intent = int(out[0][0].argmax())
        slot_logits = out[1][0]

        n += 1
        ok_intent = pred_intent == intent_index[gold_intent]
        intent_hits += ok_intent

        # The same weights, scored the way the deployed assistant scores them.
        # bslm.infer.Parser answers "oos" below confidence 0.50 rather than
        # guessing, so a row it declines is right only when the gold label is
        # itself oos. This is a strictly harder number than the argmax one and
        # it is the one a reader would meet if they used the assistant, so the
        # page is not allowed to quote either without the other.
        logits = out[0][0]
        shifted = np.exp(logits - logits.max())
        confidence = float((shifted / shifted.sum()).max())
        if confidence < ABSTAIN_THRESHOLD:
            abstained += 1
            abstain_hits += gold_intent == "oos"
        else:
            abstain_hits += ok_intent

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

    # Median, not mean. The first inference of a session is several times the
    # steady state one and a mean carries that warmup into every later quote.
    ordered = sorted(run_ms)
    pct = lambda p: round(ordered[min(len(ordered) - 1, int(p * len(ordered)))], 3) if ordered else 0.0

    return {
        "n": n,
        # Unrounded, kept beside the rounded one and never printed.
        #
        # `delta` used to be the difference of two values that had already been
        # rounded to two places, and `ship_int8` compared that to the budget.
        # The measurement audit put it exactly: the true difference here is
        # 74.5793 minus 74.5320, which is 0.0473 points and was reported as
        # 0.05, so the rounding can move the decision quantity by up to 0.01 in
        # either direction. It cannot change this outcome, where the cost is a
        # twentieth of the budget, but a threshold is written to be trusted at
        # the boundary and at the boundary it was not exact.
        "intentAccuracyExact": (100 * intent_hits / n) if n else 0.0,
        "intentAccuracy": round(100 * intent_hits / n, 2) if n else 0.0,
        "tagAccuracy": round(100 * tag_hits / tag_total, 2) if tag_total else 0.0,
        "exactMatch": round(100 * both / n, 2) if n else 0.0,
        "withAbstain": {
            "threshold": ABSTAIN_THRESHOLD,
            "intentAccuracy": round(100 * abstain_hits / n, 2) if n else 0.0,
            "abstained": abstained,
            "rows": n,
            "note": "the same weights scored the way bslm.infer.Parser scores "
                    "them: below this confidence it answers oos rather than "
                    "guessing, so a declined row counts only when the gold "
                    "label is itself oos.",
        },
        "latency": {
            "medianMs": pct(0.50),
            "p05Ms": pct(0.05),
            "p95Ms": pct(0.95),
            "firstRunMs": round(run_ms[0], 3) if run_ms else 0.0,
            "runs": len(run_ms),
            "note": "session.run only, one timing per sentence, over the "
                    "evaluated rows. Tokenization is not included: it is "
                    "about 0.005 ms and it is not what this measures.",
        },
        "rowsRead": len(rows),
        "rowsEvaluated": n,
        "skippedEmptyWords": skipped_empty,
        "skippedUnseenIntent": skipped_unseen,
        "unseenIntents": sorted(unseen_intents),
    }


def runtime_facts(threads: int) -> dict:
    """What the latency numbers were taken on, without which they say nothing.

    A millisecond figure with no machine, no runtime and no thread count is not
    a measurement, it is an anecdote. This project had five such figures for the
    same quantity, ranging from 0.71 to 3.4, and no way to tell which disagreed
    with which because none of them said what they ran on.
    """
    import platform

    import onnxruntime as ort

    cpu = platform.processor() or platform.machine()
    try:  # a real model name where Windows will give one
        import subprocess
        out = subprocess.run(["wmic", "cpu", "get", "name"], capture_output=True,
                             text=True, timeout=15)
        lines = [l.strip() for l in out.stdout.splitlines() if l.strip()]
        if len(lines) > 1:
            cpu = lines[1]
    except (OSError, subprocess.SubprocessError, IndexError):
        pass

    return {
        "runtime": f"onnxruntime {ort.__version__} CPUExecutionProvider",
        "threads": threads,
        "cpu": cpu,
        "python": platform.python_version(),
        "os": f"{platform.system()} {platform.release()}",
        "notThePage": "The page runs onnxruntime-web in wasm at one thread, "
                      "which is several times slower than this. These numbers "
                      "describe the graph, not the visitor's experience: the "
                      "page measures its own latency live and that is the "
                      "figure a reader should believe about the page.",
    }


def by_length(session, max_len: int, lengths=(6, 14, 32, 64), reps: int = 200) -> list:
    """Latency against token count, which is the shape of the thing.

    The claim this replaces was "five million parameters at a 64 token context
    are a millisecond of CPU", written to justify not shipping a WebGPU build.
    It was never measured. Attention is quadratic in the token count, so one
    number for "a sentence" hides the only variable that matters.
    """
    import numpy as np

    out = []
    for t in lengths:
        t = min(t, max_len)
        feeds = {
            "ids": np.ones((1, t), dtype=np.int64),
            "cases": np.zeros((1, t), dtype=np.int64),
        }
        for _ in range(20):  # warmup, discarded
            session.run(None, feeds)
        samples = []
        for _ in range(reps):
            t0 = time.perf_counter()
            session.run(None, feeds)
            samples.append(1000 * (time.perf_counter() - t0))
        samples.sort()
        out.append({
            "tokens": t,
            "medianMs": round(samples[len(samples) // 2], 3),
            "p95Ms": round(samples[int(0.95 * len(samples))], 3),
            "reps": reps,
        })
    return out


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
        # Pinned to one thread. Not because it is faster, it is not, but
        # because a number produced by however many cores were idle at the time
        # is not a number anyone can reproduce, and because the page runs at
        # one thread in wasm, so this is at least the comparable shape.
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = THREADS
        opts.inter_op_num_threads = THREADS
        sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        r = evaluate(sess, tok, meta, rows)
        r["byLength"] = by_length(sess, meta["maxLen"])
        results[name] = r
        lat = r["latency"]
        print(
            f"{name:5s} intent {r['intentAccuracy']:6.2f}%   "
            f"tags {r['tagAccuracy']:6.2f}%   "
            f"both {r['exactMatch']:6.2f}%   "
            f"{lat['medianMs']:.2f} ms median   n={r['n']}"
        )
        print(
            f"      abstain {r['withAbstain']['intentAccuracy']:.2f}% "
            f"declining {r['withAbstain']['abstained']} of {r['n']}   "
            f"latency p05 {lat['p05Ms']:.2f}  p95 {lat['p95Ms']:.2f}  "
            f"first run {lat['firstRunMs']:.2f}   "
            + "  ".join(f"T={b['tokens']} {b['medianMs']:.2f}" for b in r["byLength"])
        )

    # From the unrounded figures, rounded only for the report.
    delta_exact = results["int8"]["intentAccuracyExact"] - results["fp32"]["intentAccuracyExact"]
    delta = round(delta_exact, 2)
    shrink = round(fp32.stat().st_size / int8.stat().st_size, 2)
    print(f"\nint8 costs {-delta:+.2f} points of intent accuracy and is {shrink}x smaller")

    ship_int8 = -delta_exact <= ACCURACY_BUDGET
    print(
        f"budget is {ACCURACY_BUDGET} point, so shipping "
        + (
            "int8"
            if ship_int8
            else "fp32. Write why into README.md under The honest limits, "
                 "beside the accuracy table, before that ships"
        )
    )

    if results["fp32"]["unseenIntents"]:
        print(
            f"\nnote: {len(results['fp32']['unseenIntents'])} intents in the test set "
            f"are not in the checkpoint and were skipped: "
            f"{', '.join(results['fp32']['unseenIntents'][:6])}"
        )

    meta["quantisation"] = {
        "measuredAt": time.strftime("%Y-%m-%d"),
        "measuredOn": runtime_facts(THREADS),
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
