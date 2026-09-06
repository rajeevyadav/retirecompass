#!/usr/bin/env python3
"""Write RELEASE_MANIFEST.sha256 — a SHA-256 for every tracked release file.

The manifest is the integrity record for the repository: verify_release.py checks
that every listed file is present and unchanged and that the manifest lists
exactly the tracked file set. Run this after adding or changing tracked files.
"""
from __future__ import annotations

import subprocess
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "RELEASE_MANIFEST.sha256"

# Never hashed: build output, caches, the manifest itself.
_SKIP_SUFFIX = {".pyc", ".pyo"}
_SKIP_PREFIX = ("dist/", "build/", ".venv/", ".git/")
# Text files are hashed with LF line endings so the manifest matches regardless
# of the checkout's line-ending conversion (Windows CRLF vs Linux LF).
_BINARY_SUFFIX = {".png", ".ico", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".woff", ".woff2"}


def hash_file(path: Path) -> str:
    data = path.read_bytes()
    if path.suffix.lower() not in _BINARY_SUFFIX:
        data = data.replace(b"\r\n", b"\n")
    return sha256(data).hexdigest()


def release_files():
    out = subprocess.check_output(["git", "ls-files", "-z"], cwd=str(ROOT))
    for rel in out.decode("utf-8").split("\0"):
        rel = rel.strip()
        if not rel or rel == "RELEASE_MANIFEST.sha256":
            continue
        if rel.startswith(_SKIP_PREFIX) or Path(rel).suffix in _SKIP_SUFFIX:
            continue
        p = ROOT / rel
        if p.is_file():
            yield rel


def main() -> int:
    lines = []
    for rel in sorted(release_files()):
        lines.append(f"{hash_file(ROOT / rel)}  ./{rel}")
    MANIFEST.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {len(lines)} SHA-256 entries to {MANIFEST.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
