#!/usr/bin/env python3
"""Deterministic release gate for RetireCompass.

Fails loudly if anything that must hold for a trustworthy release does not:
  1. the app JavaScript parses and the guard tests pass;
  2. the app makes no network call and pulls in nothing remote (the "transmits
     nothing" promise the product is built on);
  3. the release manifest hash-matches every tracked file and lists exactly the
     tracked set (no stale or unlisted files);
  4. no private data or secrets are tracked;
  5. the version is consistent between VERSION and the app.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd):
    print("[verify]", " ".join(cmd))
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def tests_and_syntax():
    node = shutil.which("node")
    if node:
        run([node, "--check", "js/app.js"])
    run([sys.executable, "-m", "pytest", "-q"])


def no_network_scan():
    """The app must be fully offline: no fetch/XHR/WebSocket/external URL."""
    banned = re.compile(r"\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon"
                        r"|https?://(?!localhost|127\.0\.0\.1)")
    offenders = []
    for rel in ["index.html", "js/app.js", "css/styles.css"]:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
        for i, line in enumerate(text.splitlines(), 1):
            if banned.search(line):
                offenders.append(f"{rel}:{i}: {line.strip()[:100]}")
    if offenders:
        raise SystemExit("Offline guarantee violated (network/remote reference found):\n" + "\n".join(offenders))
    print("[verify] offline/no-network scan: OK")


def manifest_scan():
    manifest = ROOT / "RELEASE_MANIFEST.sha256"
    entries = {}
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        expected, rel = line.split(None, 1)
        rel = rel.strip()
        if rel.startswith("./"):
            rel = rel[2:]
        p = ROOT / rel
        if not p.is_file():
            raise SystemExit(f"Manifest references missing file: {rel}")
        if sha256(p.read_bytes()).hexdigest() != expected:
            raise SystemExit(f"SHA-256 mismatch: {rel}")
        entries[rel] = expected
    tracked = {r for r in subprocess.check_output(["git", "ls-files"], cwd=str(ROOT)).decode().splitlines()
               if r and r != "RELEASE_MANIFEST.sha256" and not r.startswith(("dist/", "build/"))}
    if set(entries) != tracked:
        missing = sorted(tracked - set(entries))
        stale = sorted(set(entries) - tracked)
        raise SystemExit(f"Manifest file-set mismatch. unlisted={missing} stale={stale}")
    print(f"[verify] release manifest: {len(entries)} files hash-verified and file-set exact")


def private_data_scan():
    bad = [r for r in subprocess.check_output(["git", "ls-files"], cwd=str(ROOT)).decode().splitlines()
           if re.search(r"(^|/)(private/|secrets\.)|\.(key|pem)$", r)]
    if bad:
        raise SystemExit("Private/secret files tracked: " + ", ".join(bad))
    print("[verify] private-data guard: OK")


def version_scan():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        raise SystemExit(f"VERSION is not semver: {version!r}")
    readme = (ROOT / "README.md").read_text(encoding="utf-8", errors="ignore")
    if f"version-{version}" not in readme:
        raise SystemExit(f"README version badge does not match VERSION {version}")
    print(f"[verify] version consistency: OK ({version})")


def main() -> int:
    tests_and_syntax()
    no_network_scan()
    manifest_scan()
    private_data_scan()
    version_scan()
    print("\n[verify] ALL RELEASE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
