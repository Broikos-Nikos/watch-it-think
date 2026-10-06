"""Write the library versions the recorded numbers were produced by.

    python tools/record_libraries.py --check    print what it would write
    python tools/record_libraries.py            write it

WS-F4, the supply chain pass of 22 September: "numpy is the only unpinned
dependency in the pipeline, and it is the one that produces the repository's
strongest number". `quantisation.measuredOn` recorded the runtime, the thread
count, the CPU, the Python version and the OS. It did not record numpy, which
computes `parity.attentionAgainstNumpyWitness`, nor torch, which produced the
weights that witness is computed from.

`quantize.py` writes `measuredOn.libraries` from this tick on. This backfills
the block that is already committed, and it is allowed to because the claim was
checked rather than assumed. At tick 219 the exporter was re-run against the
same checkpoint, sha256 `ff9d84451a7f72fa`, under this environment:

    copyAgainstOriginal            0.0
    graphAgainstOriginal           9.059906005859375e-06
    attentionRowSumDeviation       3.5762786865234375e-07
    attentionAgainstNumpyWitness   1.0059445660903776e-06

Bit for bit, all four, against what `meta.json` has carried since 2026-09-21.
So these are the libraries those digits came out of, and writing them down is a
record rather than a guess.

## Why this is python and not node

`tools/seal-artefact.mjs` writes one key into the same file from node, and it
has to insert it as text: node's `JSON.stringify` and python's `json.dumps`
disagree about when a number takes an exponent, so a node round trip rewrote
five of the quantiser's numbers the first time it was tried. Python wrote this
file, so python can rewrite it, and that is asserted here rather than assumed:
the file is parsed, re-dumped, and compared byte for byte against itself before
anything is changed. If that ever stops holding, this tool refuses.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
META = HERE.parent / "public" / "model" / "meta.json"


def libraries() -> dict:
    """The versions, from the environment that `requirements.txt` pins."""
    import numpy
    import onnx
    import onnxruntime
    import torch

    return {
        "numpy": numpy.__version__,
        "torch": torch.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": onnxruntime.__version__,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="print what would be written and change nothing")
    args = ap.parse_args()

    libs = libraries()
    raw = io.open(META, encoding="utf-8", newline="").read()
    meta = json.loads(raw)

    # The newline this file already uses, kept rather than chosen. A tool that
    # has an opinion about line endings rewrites 406 lines to change one.
    nl = "\r\n" if "\r\n" in raw else "\n"

    def dump(obj: dict) -> str:
        return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").replace("\n", nl)

    if dump(meta) != raw:
        print("FAIL  meta.json does not survive a round trip through this writer, so "
              "it would be rewritten in ways nobody asked for", file=sys.stderr)
        return 1

    where = meta.get("quantisation", {}).get("measuredOn")
    if where is None:
        print("FAIL  meta.json has no quantisation.measuredOn to write into", file=sys.stderr)
        return 1

    if args.check:
        print(json.dumps({"recorded": where.get("libraries"), "here": libs}, indent=2))
        return 0

    if where.get("libraries") == libs:
        print(f"already recorded: numpy {libs['numpy']}, torch {libs['torch']}")
        return 0

    before = dict(where)
    where["libraries"] = libs
    after = dump(meta)

    # One key, and the proof is the parse rather than the intention: everything
    # else in `measuredOn`, and every other block, has to come back unchanged.
    check = json.loads(after)
    moved = {k: v for k, v in check["quantisation"]["measuredOn"].items()
             if k != "libraries" and before.get(k) != v}
    if moved:
        print(f"FAIL  writing the versions would change {sorted(moved)} as well, "
              "so nothing was written", file=sys.stderr)
        return 1
    stripped = json.loads(after)
    stripped["quantisation"]["measuredOn"].pop("libraries")
    if dump(stripped) != raw:
        print("FAIL  writing the versions would change something outside measuredOn.libraries, "
              "so nothing was written", file=sys.stderr)
        return 1

    io.open(META, "w", encoding="utf-8", newline="").write(after)
    print(f"recorded: numpy {libs['numpy']}, torch {libs['torch']}, "
          f"onnx {libs['onnx']}, onnxruntime {libs['onnxruntime']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
