"""Emit what the Python tokenizer does, so the TypeScript port can be held to it.

    python tools/dump_python_tokenizer.py --bslm-repo /path/to/bslm

Writes tools/tokenizer-expected.json: for each sentence, the pre-tokenized
words, the token ids, the case ids and the word index, exactly as
`bslm/tokenizer.py` produces them.

The sentences are the ones a port gets wrong. Real rows from the held out set
for coverage, and then the cases where Python and JavaScript quietly disagree:
upper case Greek, where JavaScript lower cases a final sigma and Python does
not; words joined by the three apostrophes the pre-tokenizer accepts; digits and
underscores, which Python's \\w includes and JavaScript's does not; and single
characters, where the case rules have no second character to look at.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

EDGE_CASES = [
    "",
    " ",
    "a",
    "A",
    "Α",
    "ΟΔΟΣ ΕΡΜΟΥ",
    "ΟΔΟΣ",
    "Οδός Ερμού 15",
    "οδός ερμού",
    "ΚΑΛΗΜΕΡΑ ΚΟΣΜΕ",
    "Καλημέρα κόσμε",
    "τελικό σίγμα ς και μέσα σσσ",
    "Ἄνδρα μοι ἔννεπε Μοῦσα",
    "don't stop",
    "don’t stop",
    "don´t stop",
    "snake_case and_more",
    "1234 5678",
    "3.14 and 2,5",
    "email me at test@example.com",
    "MiXeD CaSe WoRdS",
    "ΑΘΗΝΑ 2026",
    "  leading   and   trailing   spaces  ",
    "tabs\tand\nnewlines",
    "emoji 😀 in the middle",
    "!!! ??? ...",
    "Ά Έ Ή Ί Ό Ύ Ώ",
    "ϊ ϋ ΐ ΰ",
    "a" * 80,
    "Θα είμαι εκεί σε δέκα λεπτά, έχει απαίσια κίνηση σήμερα.",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bslm-repo", required=True, type=Path)
    ap.add_argument("--test", type=Path, default=None)
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--out", type=Path, default=HERE / "tokenizer-expected.json")
    args = ap.parse_args()

    sys.path.insert(0, str(args.bslm_repo))
    from bslm.tokenizer import BPETokenizer, normalize, word_tokenize, case_id  # noqa: E402

    tok = BPETokenizer.load(args.bslm_repo / "checkpoints" / "tokenizer.json")

    sentences = list(EDGE_CASES)
    test = args.test or (args.bslm_repo / "data" / "test.jsonl")
    if test.exists():
        rows = [json.loads(line) for line in test.open(encoding="utf-8") if line.strip()]
        random.Random(20260921).shuffle(rows)
        sentences += [r["text"] for r in rows[: args.sample]]

    cases = []
    for text in sentences:
        words = [w for w, _, _ in word_tokenize(normalize(text))]
        ids, case_ids, widx = tok.encode(words, 64)
        cases.append(
            {
                "text": text,
                "words": words,
                "caseIds": [case_id(w) for w in words],
                "ids": ids,
                "cases": case_ids,
                "wordIndex": widx,
            }
        )

    args.out.write_text(
        json.dumps({"tokenizer": "bslm/tokenizer.py", "maxLen": 64, "cases": cases},
                   ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out.name}: {len(cases)} sentences, {len(EDGE_CASES)} of them edge cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
