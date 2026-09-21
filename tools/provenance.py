"""Where every published number came from, recorded by the tool that made it.

Every figure this project ships was produced from two files that are not in
this repository: a checkpoint and a test set. Until 2026-09-21 nothing recorded
which ones. `meta.json` held `measuredAt` and the results, and no path, size,
hash or commit for either input, so the numbers were reproducible only by
somebody who already knew where the author kept his files.

This module makes each tool write down what it read. It does not make the
inputs obtainable, and it is careful not to imply that it does: `obtainable` is
the field that says whether a reader could actually get this file, and for the
checkpoint and the test set the answer today is no.

Paths are recorded relative to the repository that holds them, with that
repository's remote and commit, rather than as absolute paths. An absolute path
is true only on one machine and tells a reader nothing they can act on, and it
publishes the layout of the author's disk into a file the browser downloads.
`checkpoints/bslm.pt` at a named commit of a named remote is a thing somebody
can go and look for.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path


def sha256(path: Path) -> str:
    """Streamed, because the checkpoint is 20 MB."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _git(repo: Path, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def repo_facts(repo: Path) -> dict:
    """The commit a reader would have to check out, and whether it is clean.

    `dirty` matters and is easy to leave out. A commit identifies the code only
    if the tree matched it when the numbers were made.
    """
    commit = _git(repo, "rev-parse", "HEAD")
    if commit is None:
        return {"path": repo.name, "vcs": None}
    status = _git(repo, "status", "--porcelain")
    return {
        "name": repo.name,
        "remote": _git(repo, "config", "--get", "remote.origin.url"),
        "commit": commit[:7],
        "dirty": bool(status),
    }


def _tracked(repo: Path, path: Path) -> bool:
    try:
        rel = path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        return False
    return _git(repo, "ls-files", "--error-unmatch", rel) is not None


def describe(path: Path, repo: Path | None = None) -> dict:
    """Identify one input file: what it is, how big, its hash, and whether a
    reader can obtain it.

    The hash is the part that does the work. It cannot be used to fetch the
    file, but it settles whether two people ran the same numbers on the same
    bytes, which is the question that actually comes up.
    """
    path = Path(path)
    out: dict = {"bytes": path.stat().st_size, "sha256": sha256(path)}

    if repo is not None:
        try:
            out["path"] = path.resolve().relative_to(repo.resolve()).as_posix()
        except ValueError:
            out["path"] = path.name
        out["obtainable"] = _tracked(repo, path)
        if not out["obtainable"]:
            out["note"] = (
                "not committed to that repository, so this file cannot be "
                "obtained from it. The hash identifies it; nothing here "
                "produces it."
            )
    else:
        out["path"] = path.name
        out["obtainable"] = False

    return out
